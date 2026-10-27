//! OS notifications are hints. Only stable, capability-relative reads decide
//! what changed, and accepting or removing content remains an explicit action.
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::{Component, Path},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const QUIET: Duration = Duration::from_millis(300);
const MAX_WAIT: Duration = Duration::from_secs(2);
const MAX_PATHS: usize = 512;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub paths: Vec<String>,
    pub full: bool,
    pub available: bool,
}
#[derive(Default)]
struct Pending {
    paths: BTreeSet<String>,
    full: bool,
    first: Option<Instant>,
    last: Option<Instant>,
}
impl Pending {
    fn add(&mut self, event: notify::Result<Event>, root: &Path, now: Instant) {
        let event = match event {
            Ok(event) => event,
            Err(_) => {
                self.full = true;
                self.touch(now);
                return;
            }
        };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        if event.need_rescan() {
            self.full = true;
            self.touch(now);
        }
        for path in event.paths {
            let Ok(path) = path.strip_prefix(root) else {
                continue;
            };
            if path.as_os_str().is_empty() {
                self.full = true;
                self.touch(now);
                continue;
            }
            let mut parts = Vec::new();
            let mut safe = true;
            for part in path.components() {
                let Component::Normal(part) = part else {
                    safe = false;
                    break;
                };
                let Some(part) = part.to_str() else {
                    self.full = true;
                    self.touch(now);
                    safe = false;
                    break;
                };
                if part.starts_with('.') {
                    safe = false;
                    break;
                }
                parts.push(part);
            }
            if !safe
                || !parts
                    .first()
                    .is_some_and(|part| ["notes", "sources", "assets"].contains(part))
            {
                continue;
            }
            let name = parts.last().copied().unwrap_or("");
            if name.ends_with('~')
                || [".tmp", ".swp", ".swx", ".bak", ".part"]
                    .iter()
                    .any(|suffix| name.ends_with(suffix))
            {
                continue;
            }
            if !self.full {
                self.paths.insert(parts.join("/"));
            }
            if self.paths.len() > MAX_PATHS {
                self.paths.clear();
                self.full = true;
            }
            self.touch(now);
        }
    }
    fn touch(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }
    fn take(&mut self, now: Instant, available: bool) -> Option<Changes> {
        let (Some(first), Some(last)) = (self.first, self.last) else {
            return None;
        };
        if now.duration_since(last) < QUIET && now.duration_since(first) < MAX_WAIT {
            return None;
        }
        let result = Changes {
            paths: std::mem::take(&mut self.paths).into_iter().collect(),
            full: self.full,
            available,
        };
        *self = Self::default();
        Some(result)
    }
}
pub struct DirectoryWatch {
    pending: Arc<Mutex<Pending>>,
    watcher: Option<RecommendedWatcher>,
}
impl DirectoryWatch {
    pub fn new(root: &Path) -> Self {
        let root = root.canonicalize().unwrap_or_else(|_| root.to_owned());
        let pending = Arc::new(Mutex::new(Pending::default()));
        let events = pending.clone();
        let directory = root.clone();
        let watcher = RecommendedWatcher::new(
            move |event| {
                if let Ok(mut queue) = events.lock() {
                    queue.add(event, &directory, Instant::now());
                }
            },
            Config::default().with_follow_symlinks(false),
        )
        .and_then(|mut watcher| {
            watcher.watch(&root, RecursiveMode::NonRecursive)?;
            for folder in ["notes", "sources", "assets"] {
                watcher.watch(&root.join(folder), RecursiveMode::Recursive)?;
            }
            Ok(watcher)
        })
        .ok();
        if watcher.is_none()
            && let Ok(mut queue) = pending.lock()
        {
            queue.full = true;
            queue.touch(Instant::now());
        }
        Self { pending, watcher }
    }
    pub fn take(&self) -> Option<Changes> {
        self.pending
            .lock()
            .ok()?
            .take(Instant::now(), self.watcher.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, DataChange, ModifyKind};
    fn changed(path: &Path) -> notify::Result<Event> {
        Ok(
            Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
                .add_path(path.to_owned()),
        )
    }

    #[test]
    fn coalesces_saves_ignores_reads_private_files_and_editor_temporaries() {
        let root = Path::new("/workspace");
        let start = Instant::now();
        let mut queue = Pending::default();
        for path in [
            ".repeaty/state.sqlite3-wal",
            "notes/.swap.md",
            "notes/card.md~",
            "notes/tmp.swp",
            "assets/file.part",
        ] {
            queue.add(changed(&root.join(path)), root, start);
        }
        queue.add(
            Ok(Event::new(EventKind::Access(AccessKind::Read))
                .add_path(root.join("notes/card.md"))),
            root,
            start,
        );
        assert!(queue.take(start + Duration::from_secs(3), true).is_none());
        queue.add(changed(&root.join("notes/中文.md")), root, start);
        queue.add(
            changed(&root.join("notes/中文.md")),
            root,
            start + Duration::from_millis(100),
        );
        queue.add(
            changed(&root.join("assets/audio.wav")),
            root,
            start + Duration::from_millis(200),
        );
        assert!(
            queue
                .take(start + Duration::from_millis(300), true)
                .is_none()
        );
        let batch = queue
            .take(start + Duration::from_millis(500), true)
            .unwrap();
        assert_eq!(batch.paths, vec!["assets/audio.wav", "notes/中文.md"]);
        assert!(!batch.full);
        assert!(queue.take(start + Duration::from_secs(3), true).is_none());
    }
    #[test]
    fn bounded_overflow_errors_and_a_continuous_burst_request_reconciliation() {
        let root = Path::new("/workspace");
        let now = Instant::now();
        let mut queue = Pending::default();
        for i in 0..=MAX_PATHS {
            queue.add(changed(&root.join(format!("notes/{i}.md"))), root, now);
        }
        let batch = queue.take(now + QUIET, true).unwrap();
        assert!(batch.full);
        assert!(batch.paths.is_empty());
        queue.add(Err(notify::Error::generic("overflow")), root, now);
        assert!(queue.take(now + QUIET, true).unwrap().full);
        for i in 0..20 {
            queue.add(
                changed(&root.join("notes/live.md")),
                root,
                now + Duration::from_millis(i * 100),
            );
        }
        assert!(queue.take(now + MAX_WAIT, true).is_some());
    }
    #[test]
    fn real_notifications_are_available_without_loading_or_modifying_learning_data() {
        let temp = tempfile::tempdir().unwrap();
        for folder in ["notes", "sources", "assets"] {
            std::fs::create_dir(temp.path().join(folder)).unwrap();
        }
        let watcher = DirectoryWatch::new(temp.path());
        assert!(watcher.watcher.is_some());
        std::fs::write(temp.path().join("notes/中文.md"), "external save").unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            if let Some(batch) = watcher.take() {
                assert!(batch.available);
                assert!(batch.full || batch.paths.contains(&"notes/中文.md".into()));
                break;
            }
            assert!(Instant::now() < deadline, "missing OS notification");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
