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
