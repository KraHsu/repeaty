use base64::{Engine, engine::general_purpose::STANDARD};
use std::{io::Write, path::PathBuf};
struct Pending {
    token: String,
    file: tempfile::NamedTempFile,
    destination: PathBuf,
}
#[derive(Default)]
pub struct Exporter {
    pending: Option<Pending>,
}
impl Exporter {
    pub fn active(&self) -> bool {
        self.pending.is_some()
    }
    pub fn begin(&mut self, destination: PathBuf) -> Result<String, String> {
        if self.active() {
            return Err("export-busy".into());
        }
        let parent = destination.parent().ok_or("invalid-path")?;
        let file = tempfile::NamedTempFile::new_in(parent).map_err(|_| "export-failed")?;
        let token = uuid::Uuid::new_v4().to_string();
        self.pending = Some(Pending {
            token: token.clone(),
            file,
            destination,
        });
        Ok(token)
    }
    pub fn write(&mut self, token: &str, chunk: &str) -> Result<(), String> {
        let pending = self
            .pending
            .as_mut()
            .filter(|p| p.token == token)
            .ok_or("invalid-export")?;
        if chunk.len() > 1_398_104 {
            return Err("chunk-too-large".into());
        }
        let bytes = STANDARD.decode(chunk).map_err(|_| "invalid-data")?;
        pending
            .file
            .write_all(&bytes)
            .map_err(|_| "export-failed".into())
    }
    pub fn finish(&mut self, token: &str) -> Result<(), String> {
        if self.pending.as_ref().is_none_or(|p| p.token != token) {
            return Err("invalid-export".into());
        }
        let pending = self.pending.take().ok_or("invalid-export")?;
        pending
            .file
            .as_file()
            .sync_all()
            .map_err(|_| "export-failed")?;
        pending
            .file
            .persist(pending.destination)
            .map_err(|_| "export-failed")?;
        Ok(())
    }
    pub fn cancel(&mut self, token: &str) -> Result<(), String> {
        if self.pending.as_ref().is_none_or(|p| p.token != token) {
            return Err("invalid-export".into());
        }
        self.pending = None;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_binary_chunks_atomically_and_cancellation_preserves_the_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.repeaty");
        std::fs::write(&path, b"previous backup").unwrap();
        let mut export = Exporter::default();
        let token = export.begin(path.clone()).unwrap();
        assert!(export.write("wrong", "YQ==").is_err());
        let bytes = vec![173; 1024 * 1024];
        for _ in 0..128 {
            export.write(&token, &STANDARD.encode(&bytes)).unwrap();
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"previous backup");
        export.finish(&token).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 128 * 1024 * 1024);
        let token = export.begin(path.clone()).unwrap();
        export.write(&token, "YQ==").unwrap();
        export.cancel(&token).unwrap();
        assert_eq!(std::fs::metadata(path).unwrap().len(), 128 * 1024 * 1024);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
