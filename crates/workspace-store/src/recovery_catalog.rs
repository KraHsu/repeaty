//! Device-local backup destinations and retention. Never included in portable workspaces.
use crate::{
    backup::Summary,
    error::{Error, Result},
    sessions::Sessions,
};
use chrono::{DateTime, Datelike, Timelike, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub hourly: usize,
    pub daily: usize,
    pub weekly: usize,
    pub monthly: usize,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 60,
            hourly: 24,
            daily: 7,
            weekly: 4,
            monthly: 12,
        }
    }
}
impl Policy {
    pub fn validate(&self) -> Result<()> {
        if !(15..=10080).contains(&self.interval_minutes)
            || [self.hourly, self.daily, self.weekly, self.monthly]
                .iter()
                .any(|n| *n > 1000)
        {
            return Err(Error::invalid());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub policy: Policy,
    pub targets: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetResult {
    pub target: String,
    pub backup: Option<Summary>,
    pub error: Option<String>,
    pub pruned: usize,
}
pub struct Catalog {
    db: Connection,
}
impl Catalog {
    pub fn open(directory: &Path) -> Result<Self> {
        let db = Connection::open(directory.join("workspace-backups.sqlite3"))?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS configuration (workspace TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs (workspace TEXT NOT NULL, target TEXT NOT NULL, attempted INTEGER NOT NULL, succeeded INTEGER, PRIMARY KEY(workspace,target));")?;
        Ok(Self { db })
    }
    pub fn configuration(&self, id: &str) -> Result<Configuration> {
        let raw: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM configuration WHERE workspace=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        raw.map(|v| serde_json::from_str(&v).map_err(Into::into))
            .unwrap_or_else(|| Ok(Configuration::default()))
    }
    pub fn set_policy(&self, id: &str, policy: Policy) -> Result<Configuration> {
        policy.validate()?;
        let mut config = self.configuration(id)?;
        config.policy = policy;
        self.save(id, &config)?;
        Ok(config)
    }
    pub fn target(
        &self,
        id: &str,
        workspace: &Path,
        slot: usize,
        target: Option<&Path>,
    ) -> Result<Configuration> {
        if slot > 1 {
            return Err(Error::invalid());
        }
        let mut config = self.configuration(id)?;
        if let Some(target) = target {
            let root = checked_directory(target)?;
            let workspace = std::fs::canonicalize(workspace)?;
            if root.starts_with(&workspace) || workspace.starts_with(&root) {
                return Err(Error("backup-target-overlap"));
            }
            let root = root.to_string_lossy().into_owned();
            if config
                .targets
                .iter()
                .enumerate()
                .any(|(index, value)| index != slot && value == &root)
            {
                return Err(Error::invalid());
            }
            if slot > config.targets.len() {
                return Err(Error::invalid());
            }
            if slot == config.targets.len() {
                config.targets.push(root);
            } else {
                config.targets[slot] = root;
            }
        } else if slot < config.targets.len() {
            config.targets.remove(slot);
        }
        self.save(id, &config)?;
        Ok(config)
    }
    fn save(&self, id: &str, config: &Configuration) -> Result<()> {
        self.db.execute("INSERT INTO configuration VALUES(?1,?2) ON CONFLICT(workspace) DO UPDATE SET value=excluded.value", params![id, serde_json::to_string(config)?])?;
        Ok(())
    }
    pub fn list(&self, id: &str) -> Result<(Vec<Summary>, Vec<TargetResult>)> {
        let mut entries = vec![];
        let mut errors = vec![];
        for target in self.configuration(id)?.targets {
            match managed_directory(Path::new(&target), id, false).and_then(|p| scan(&p, id)) {
                Ok(mut found) => entries.append(&mut found),
                Err(error) => errors.push(TargetResult {
                    target,
                    backup: None,
                    error: Some(error.0.into()),
                    pruned: 0,
                }),
            }
        }
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok((entries, errors))
    }
    pub fn run(
        &self,
        sessions: &Sessions,
        token: &str,
        id: &str,
        automatic: bool,
        cancel: &AtomicBool,
    ) -> Result<Vec<TargetResult>> {
        let config = self.configuration(id)?;
        if automatic && !config.policy.enabled {
            return Ok(vec![]);
        }
        let now = Utc::now().timestamp();
        let mut results = vec![];
        for target in config.targets {
            if cancel.load(Ordering::Acquire) {
                return Err(Error("backup-cancelled"));
            }
            if automatic {
                let last: Option<(i64, Option<i64>)> = self
                    .db
                    .query_row(
                        "SELECT attempted,succeeded FROM runs WHERE workspace=?1 AND target=?2",
                        params![id, target],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                if last.is_some_and(|(attempt, success)| {
                    now.saturating_sub(attempt) < 300
                        || success.is_some_and(|s| {
                            now.saturating_sub(s) < i64::from(config.policy.interval_minutes) * 60
                        })
                }) {
                    continue;
                }
            }
            self.db.execute("INSERT INTO runs VALUES(?1,?2,?3,NULL) ON CONFLICT(workspace,target) DO UPDATE SET attempted=excluded.attempted", params![id,target,now])?;
            let mut result = TargetResult {
                target: target.clone(),
                backup: None,
                error: None,
                pruned: 0,
            };
            let outcome = (|| -> Result<()> {
                let directory = managed_directory(Path::new(&target), id, true)?;
                let output =
                    directory.join(format!("backup-{}.repeaty-workspace", uuid::Uuid::new_v4()));
                let created = sessions.backup_with_cancel(token, &output, cancel)?;
                // A failed or interrupted write must never license deletion of older copies.
                let verified = Sessions::inspect_backup_with_cancel(&output, cancel)?;
                if verified.sha256 != created.sha256 || verified.source_workspace_id != id {
                    return Err(Error::invalid());
                }
                result.backup = Some(verified);
                self.db.execute(
                    "UPDATE runs SET succeeded=?3 WHERE workspace=?1 AND target=?2",
                    params![id, target, now],
                )?;
                if !cancel.load(Ordering::Acquire) {
                    let entries = scan(&directory, id)?;
                    let times = entries
                        .iter()
                        .map(|e| {
                            DateTime::parse_from_rfc3339(&e.created_at)
                                .map(|d| d.with_timezone(&Utc))
                                .map_err(|_| Error::invalid())
                        })
                        .collect::<Result<Vec<_>>>()?;
                    let keep = retained(&times, &config.policy, Utc::now());
                    // Header-only metadata cannot make a damaged representative
                    // displace a healthy older copy in the same retention tier.
                    // Verify every kept representative before deleting any candidate.
                    for index in &keep {
                        let entry = &entries[*index];
                        let checked = Sessions::inspect_backup_with_cancel(
                            Path::new(&entry.archive_path),
                            cancel,
                        )?;
                        if !checked.verified
                            || checked.manifest_sha256 != entry.manifest_sha256
                            || checked.source_workspace_id != id
                        {
                            return Err(Error("working-file-changed"));
                        }
                    }
                    for (index, entry) in entries.iter().enumerate() {
                        if keep.contains(&index)
                            || entry.archive_path == output.to_string_lossy()
                            || cancel.load(Ordering::Acquire)
                        {
                            continue;
                        }
                        let path = Path::new(&entry.archive_path);
                        // Listing reads headers only. A candidate must pass a complete
                        // inspection before deletion, and must still be the same file.
                        let before = crate::files::regular_file(path)?;
                        let before_metadata = before.metadata()?;
                        let identity = same_file::Handle::from_file(before)?;
                        let verified = Sessions::inspect_backup_with_cancel(path, cancel)?;
                        let after = crate::files::regular_file(path)?;
                        let after_metadata = after.metadata()?;
                        if checked_directory(&directory)? != directory
                            || !verified.verified
                            || verified.manifest_sha256 != entry.manifest_sha256
                            || verified.source_workspace_id != id
                            || same_file::Handle::from_file(after)? != identity
                            || before_metadata.len() != after_metadata.len()
                            || before_metadata.modified().ok() != after_metadata.modified().ok()
                        {
                            return Err(Error("working-file-changed"));
                        }
                        if cancel.load(Ordering::Acquire) {
                            return Err(Error("backup-cancelled"));
                        }
                        std::fs::remove_file(path)?;
                        result.pruned += 1;
                    }
                }
                Ok(())
            })();
            if let Err(error) = outcome {
                result.error = Some(error.0.into());
            }
            results.push(result);
        }
        Ok(results)
    }
}

fn checked_directory(path: &Path) -> Result<PathBuf> {
    let meta = std::fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(Error("unsafe-file"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(Error("unsafe-file"));
        }
    }
    Ok(std::fs::canonicalize(path)?)
}
fn managed_directory(root: &Path, id: &str, create: bool) -> Result<PathBuf> {
    uuid::Uuid::parse_str(id).map_err(|_| Error::invalid())?;
    let root = checked_directory(root)?;
    let directory = root.join(format!("repeaty-{id}"));
    if create && !directory.exists() {
        crate::files::create_private_dir(&directory)?;
    }
    if !create && !directory.try_exists()? {
        return Ok(directory);
    }
    checked_directory(&directory)
}
fn scan(directory: &Path, id: &str) -> Result<Vec<Summary>> {
    let mut found = vec![];
    if !directory.try_exists()? {
        return Ok(found);
    }
    for (count, entry) in std::fs::read_dir(directory)?.enumerate() {
        if count >= 10000 {
            return Err(Error("workspace-limit"));
        }
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(uuid) = name
            .strip_prefix("backup-")
            .and_then(|s| s.strip_suffix(".repeaty-workspace"))
        else {
            continue;
        };
        if uuid::Uuid::parse_str(uuid).is_err() {
            continue;
        }
        if found.len() >= 2000 {
            return Err(Error("workspace-limit"));
        }
        // Headers are enough for a directory listing and retention selection. Payload
        // verification belongs to explicit inspection and each deletion candidate.
        let summary = Sessions::list_backup_summary(&entry.path())?;
        if summary.source_workspace_id != id {
            return Err(Error::invalid());
        }
        found.push(summary);
    }
    Ok(found)
}

/// Union of newest N distinct UTC hour/day/ISO-week/month buckets. Always keep newest.
pub fn retained(times: &[DateTime<Utc>], policy: &Policy, now: DateTime<Utc>) -> HashSet<usize> {
    let mut order: Vec<_> = (0..times.len()).collect();
    order.sort_by_key(|i| std::cmp::Reverse(times[*i]));
    let mut keep = HashSet::new();
    let mut buckets = [
        HashSet::new(),
        HashSet::new(),
        HashSet::new(),
        HashSet::new(),
    ];
    for (position, index) in order.into_iter().enumerate() {
        let time = times[index];
        if position == 0 || time > now {
            keep.insert(index);
        }
        if time > now {
            continue;
        }
        let week = time.iso_week();
        let keys = [
            format!("{}-{}", time.date_naive(), time.hour()),
            time.date_naive().to_string(),
            format!("{}-{}", week.year(), week.week()),
            format!("{}-{}", time.year(), time.month()),
        ];
        for ((bucket, limit), key) in buckets
            .iter_mut()
            .zip([policy.hourly, policy.daily, policy.weekly, policy.monthly])
            .zip(keys)
        {
            if bucket.len() < limit && bucket.insert(key) {
                keep.insert(index);
            }
        }
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dt(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    #[test]
    fn retention_union_uses_utc_and_keeps_latest_even_with_zero_buckets() {
        let times = [
            dt("2026-10-29T08:20:00+08:00"),
            dt("2026-10-29T00:10:00Z"),
            dt("2026-10-28T23:20:00Z"),
            dt("2026-09-01T00:00:00Z"),
        ];
        let policy = Policy {
            hourly: 1,
            daily: 2,
            weekly: 0,
            monthly: 2,
            ..Policy::default()
        };
        assert_eq!(
            retained(&times, &policy, dt("2026-10-30T00:00:00Z")),
            HashSet::from([0, 2, 3])
        );
        assert_eq!(
            retained(
                &times,
                &Policy {
                    hourly: 0,
                    daily: 0,
                    weekly: 0,
                    monthly: 0,
                    ..policy
                },
                dt("2026-10-30T00:00:00Z")
            ),
            HashSet::from([0])
        );
    }
    #[test]
    fn policy_and_destinations_persist_per_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir(&library).unwrap();
        let target = tmp.path().join("copies");
        std::fs::create_dir(&target).unwrap();
        let catalog = Catalog::open(tmp.path()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(catalog.target(&id, &library, 0, Some(&library)).is_err());
        catalog.target(&id, &library, 0, Some(&target)).unwrap();
        catalog
            .set_policy(
                &id,
                Policy {
                    enabled: true,
                    ..Policy::default()
                },
            )
            .unwrap();
        drop(catalog);
        let catalog = Catalog::open(tmp.path()).unwrap();
        assert!(catalog.configuration(&id).unwrap().policy.enabled);
        assert!(
            catalog
                .configuration(&uuid::Uuid::new_v4().to_string())
                .unwrap()
                .targets
                .is_empty()
        );
    }
}
