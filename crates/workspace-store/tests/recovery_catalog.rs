use chrono::{DateTime, Utc};
use repeaty_workspace::{
    files,
    recovery_catalog::{Catalog, Policy, retained},
    sessions::Sessions,
};
use std::{collections::HashSet, fs, path::PathBuf, sync::atomic::AtomicBool};

struct Fixture {
    _temp: tempfile::TempDir,
    state: PathBuf,
    library: PathBuf,
    primary: PathBuf,
    secondary: PathBuf,
    sessions: Sessions,
    catalog: Catalog,
    id: String,
    token: String,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let state = temp.path().join("device");
        let library = temp.path().join("library");
        let primary = temp.path().join("primary");
        let secondary = temp.path().join("secondary");
        for path in [&state, &library, &primary, &secondary] {
            fs::create_dir(path).unwrap();
        }
        let mut sessions = Sessions::open(&state).unwrap();
        let epoch = sessions.status().unwrap()["epoch"]
            .as_str()
            .unwrap()
            .to_owned();
        let status = sessions.choose(&epoch, &library, true).unwrap();
        let id = status["active"]["id"].as_str().unwrap().to_owned();
        let token = status["active"]["token"].as_str().unwrap().to_owned();
        let catalog = Catalog::open(&state).unwrap();
        catalog.target(&id, &library, 0, Some(&primary)).unwrap();
        catalog.target(&id, &library, 1, Some(&secondary)).unwrap();
        Self {
            _temp: temp,
            state,
            library,
            primary,
            secondary,
            sessions,
            catalog,
            id,
            token,
        }
    }
}

#[test]
fn disconnected_secondary_preserves_its_old_copy_and_primary_stays_restorable() {
    let f = Fixture::new();
    let reports = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(reports.len(), 2);
    assert!(
        reports
            .iter()
            .all(|r| r.error.is_none() && r.backup.is_some())
    );
    let old_second = reports[1].backup.as_ref().unwrap();
    let old_bytes = fs::read(&old_second.archive_path).unwrap();
    let old_relative = PathBuf::from(&old_second.archive_path)
        .file_name()
        .unwrap()
        .to_owned();
    let disconnected = f._temp.path().join("disconnected-device");
    fs::rename(&f.secondary, &disconnected).unwrap();
    let result = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    assert!(result[0].error.is_none());
    assert!(result[1].error.is_some());
    assert_eq!(result[1].pruned, 0);
    let primary = result[0].backup.as_ref().unwrap();
    assert_eq!(
        Sessions::inspect_backup(PathBuf::from(&primary.archive_path).as_path())
            .unwrap()
            .sha256,
        primary.sha256
    );
    assert_eq!(
        fs::read(
            disconnected
                .join(format!("repeaty-{}", f.id))
                .join(old_relative)
        )
        .unwrap(),
        old_bytes
    );
    let (entries, errors) = f.catalog.list(&f.id).unwrap();
    assert!(!entries.is_empty());
    assert_eq!(errors.len(), 1);
    assert!(entries.iter().all(|e| {
        PathBuf::from(&e.archive_path).starts_with(fs::canonicalize(&f.primary).unwrap())
    }));
}

#[test]
fn cancellation_or_failed_source_validation_never_prunes_existing_archives() {
    let f = Fixture::new();
    let reports = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    let old = reports
        .iter()
        .map(|r| {
            let backup = r.backup.as_ref().unwrap();
            (
                backup.archive_path.clone(),
                files::digest(&fs::read(&backup.archive_path).unwrap()),
            )
        })
        .collect::<Vec<_>>();
    let error = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(true))
        .err()
        .unwrap();
    assert_eq!(error.0, "backup-cancelled");
    let marker = f.library.join("workspace.json");
    let original = fs::read(&marker).unwrap();
    fs::write(&marker, b"invalid marker").unwrap();
    let failed = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    assert!(
        failed
            .iter()
            .all(|r| r.error.is_some() && r.pruned == 0 && r.backup.is_none())
    );
    fs::write(&marker, original).unwrap();
    for (path, digest) in old {
        assert_eq!(files::digest(&fs::read(&path).unwrap()), digest);
        assert!(Sessions::inspect_backup(PathBuf::from(path).as_path()).is_ok());
    }
}

#[test]
fn policy_destinations_and_successful_interval_survive_catalog_restart() {
    let f = Fixture::new();
    let policy = Policy {
        enabled: true,
        interval_minutes: 90,
        hourly: 6,
        daily: 14,
        weekly: 4,
        monthly: 2,
    };
    f.catalog.set_policy(&f.id, policy).unwrap();
    let first = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, true, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(first.len(), 2);
    assert!(first.iter().all(|r| r.backup.is_some()));
    drop(f.catalog);
    let reopened = Catalog::open(&f.state).unwrap();
    let config = reopened.configuration(&f.id).unwrap();
    assert!(config.policy.enabled);
    assert_eq!(config.policy.interval_minutes, 90);
    assert_eq!(
        (
            config.policy.hourly,
            config.policy.daily,
            config.policy.weekly,
            config.policy.monthly
        ),
        (6, 14, 4, 2)
    );
    assert_eq!(config.targets.len(), 2);
    assert!(
        reopened
            .run(&f.sessions, &f.token, &f.id, true, &AtomicBool::new(false))
            .unwrap()
            .is_empty()
    );
    assert!(
        reopened
            .configuration(&uuid::Uuid::new_v4().to_string())
            .unwrap()
            .targets
            .is_empty()
    );
}

fn retime_archive(path: &str, time: DateTime<Utc>, damage_payload: bool) {
    let bytes = fs::read(path).unwrap();
    let length = u64::from_le_bytes(bytes[16..24].try_into().unwrap()) as usize;
    let mut manifest: serde_json::Value = serde_json::from_slice(&bytes[24..24 + length]).unwrap();
    manifest["createdAt"] = serde_json::json!(time.to_rfc3339());
    let raw = serde_json::to_vec(&manifest).unwrap();
    let mut rewritten = bytes[..16].to_vec();
    rewritten.extend((raw.len() as u64).to_le_bytes());
    rewritten.extend(raw);
    rewritten.extend(&bytes[24 + length..]);
    if damage_payload {
        let last = rewritten.len() - 1;
        rewritten[last] ^= 1;
    }
    fs::write(path, rewritten).unwrap();
}

#[test]
fn listing_is_unverified_and_a_damaged_retention_representative_never_prunes_healthy_copies() {
    let f = Fixture::new();
    f.catalog.target(&f.id, &f.library, 1, None).unwrap();
    let first = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    let healthy = first[0].backup.as_ref().unwrap();
    retime_archive(
        &healthy.archive_path,
        Utc::now() - chrono::Duration::days(2),
        false,
    );
    let healthy_bytes = fs::read(&healthy.archive_path).unwrap();
    let second = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    let damaged = second[0].backup.as_ref().unwrap();
    retime_archive(
        &damaged.archive_path,
        Utc::now() - chrono::Duration::days(1),
        true,
    );
    let (entries, errors) = f.catalog.list(&f.id).unwrap();
    assert!(errors.is_empty());
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|entry| !entry.verified
        && entry.sha256.is_empty()
        && !entry.manifest_sha256.is_empty()));
    assert!(Sessions::inspect_backup(PathBuf::from(&damaged.archive_path).as_path()).is_err());
    f.catalog
        .set_policy(
            &f.id,
            Policy {
                hourly: 0,
                daily: 2,
                weekly: 0,
                monthly: 0,
                ..Policy::default()
            },
        )
        .unwrap();
    let third = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    assert!(third[0].backup.as_ref().unwrap().verified);
    assert!(third[0].error.is_some());
    assert_eq!(third[0].pruned, 0);
    assert_eq!(fs::read(&healthy.archive_path).unwrap(), healthy_bytes);
    assert!(PathBuf::from(&damaged.archive_path).exists());
    assert!(
        Sessions::inspect_backup(PathBuf::from(&healthy.archive_path).as_path())
            .unwrap()
            .verified
    );
}

#[test]
fn damaged_prune_candidate_is_preserved_after_header_only_selection() {
    let f = Fixture::new();
    f.catalog.target(&f.id, &f.library, 1, None).unwrap();
    let first = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    let damaged = first[0].backup.as_ref().unwrap();
    retime_archive(
        &damaged.archive_path,
        Utc::now() - chrono::Duration::days(1),
        true,
    );
    let before = fs::read(&damaged.archive_path).unwrap();
    f.catalog
        .set_policy(
            &f.id,
            Policy {
                hourly: 0,
                daily: 0,
                weekly: 0,
                monthly: 0,
                ..Policy::default()
            },
        )
        .unwrap();
    let next = f
        .catalog
        .run(&f.sessions, &f.token, &f.id, false, &AtomicBool::new(false))
        .unwrap();
    assert!(next[0].error.is_some());
    assert_eq!(next[0].pruned, 0);
    assert_eq!(fs::read(&damaged.archive_path).unwrap(), before);
}

fn dt(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}
#[test]
fn utc_buckets_are_identical_for_beijing_timestamps_across_month_and_iso_week_boundaries() {
    let utc = [
        dt("2026-12-31T23:45:00Z"),
        dt("2027-01-01T00:15:00Z"),
        dt("2027-01-04T00:05:00Z"),
    ];
    let beijing = [
        dt("2027-01-01T07:45:00+08:00"),
        dt("2027-01-01T08:15:00+08:00"),
        dt("2027-01-04T08:05:00+08:00"),
    ];
    let policy = Policy {
        hourly: 0,
        daily: 0,
        weekly: 2,
        monthly: 2,
        ..Policy::default()
    };
    let now = dt("2027-01-05T00:00:00Z");
    assert_eq!(retained(&utc, &policy, now), HashSet::from([0, 1, 2]));
    assert_eq!(
        retained(&utc, &policy, now),
        retained(&beijing, &policy, now)
    );
    let future = [
        dt("2030-01-01T00:00:00Z"),
        dt("2026-10-29T02:00:00Z"),
        dt("2026-10-29T01:00:00Z"),
        dt("2026-10-29T00:00:00Z"),
    ];
    assert_eq!(
        retained(
            &future,
            &Policy {
                hourly: 2,
                daily: 0,
                weekly: 0,
                monthly: 0,
                ..Policy::default()
            },
            dt("2026-10-29T03:00:00Z")
        ),
        HashSet::from([0, 1, 2])
    );
}
