use crate::{
    error::{Error, Result},
    files,
};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Component, Path},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub path: String,
    pub hash: String,
}

pub fn read(root: &Dir, path: &str) -> Result<Option<Vec<u8>>> {
    if path.len() > 1024
        || !path.starts_with("assets/")
        || path.contains('\\')
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(Error::invalid());
    }
    let mut parts = Path::new(path).components().peekable();
    let mut parent = root.try_clone()?;
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            let mut options = OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
            }
            #[cfg(windows)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.custom_flags(0x00200000);
            }
            return match parent.open_with(part.as_os_str(), &options) {
                Ok(file) => Ok(Some(files::read_stable_file(
                    file.into_std(),
                    10 * 1024 * 1024,
                )?)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(error.into()),
            };
        }
        let file = parent.try_clone()?.into_std_file();
        parent = match cap_primitives::fs::open_dir_nofollow(&file, Path::new(part.as_os_str())) {
            Ok(dir) => Dir::from_std_file(dir),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
    }
    Err(Error::invalid())
}
pub fn verify(root: &Dir, observations: &[Observation]) -> Result<()> {
    if observations.len() > 64 {
        return Err(Error::invalid());
    }
    for observation in observations {
        if read(root, &observation.path)?
            .map(|bytes| files::digest(&bytes))
            .as_deref()
            != Some(&observation.hash)
        {
            return Err(Error("working-file-changed"));
        }
    }
    Ok(())
}
pub fn mime(path: &str) -> Result<&'static str> {
    Ok(
        match path
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" | "oga" => "audio/ogg",
            "m4a" | "mp4" => "audio/mp4",
            "webm" => "audio/webm",
            "flac" => "audio/flac",
            "aac" => "audio/aac",
            _ => return Err(Error::invalid()),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn observations_detect_replacement_and_reject_unsafe_or_oversized_files() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("assets")).unwrap();
        fs::write(temp.path().join("assets/a.png"), b"old").unwrap();
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        let observations = [Observation {
            path: "assets/a.png".into(),
            hash: files::digest(b"old"),
        }];
        verify(&root, &observations).unwrap();
        fs::write(temp.path().join("assets/a.png"), b"new").unwrap();
        assert_eq!(
            verify(&root, &observations).unwrap_err().0,
            "working-file-changed"
        );
        for path in [
            "assets/../outside.png",
            ".repeaty/private.png",
            "/assets/a.png",
            "assets/\\a.png",
        ] {
            assert!(read(&root, path).is_err());
        }
        let oversized = fs::File::create(temp.path().join("assets/large.wav")).unwrap();
        oversized.set_len(10 * 1024 * 1024 + 1).unwrap();
        assert!(read(&root, "assets/large.wav").is_err());
        assert!(mime("assets/script.svg").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn directory_links_file_links_hard_links_and_special_files_are_never_imported() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("assets")).unwrap();
        fs::create_dir(temp.path().join("private")).unwrap();
        fs::write(temp.path().join("private/a.png"), b"private").unwrap();
        symlink("../private", temp.path().join("assets/linked")).unwrap();
        symlink("../private/a.png", temp.path().join("assets/file.png")).unwrap();
        fs::hard_link(
            temp.path().join("private/a.png"),
            temp.path().join("assets/hard.png"),
        )
        .unwrap();
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        for path in [
            "assets/linked/a.png",
            "assets/file.png",
            "assets/hard.png",
            "assets",
        ] {
            assert!(read(&root, path).is_err());
        }
    }
}
