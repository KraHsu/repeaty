//! Content-addressed, resumable objects. Partial bytes never become library references.
use crate::{
    atomic,
    error::{Error, Result},
    files,
    library::Library,
    records::{MAX_DOCUMENT, MAX_MEDIA},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use cap_std::fs::{Dir, OpenOptions};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
};

const CHUNK: usize = 256 * 1024;
const MAX_OBJECTS: usize = 50_000;
const MAX_STAGED: usize = 1024;
pub(crate) fn schema(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS sync_object_documents(hash TEXT PRIMARY KEY,size INTEGER NOT NULL);")?;
    Ok(())
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Object {
    kind: String,
    id: String,
    mime: String,
    hash: String,
    size: u64,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Manifest {
    kind: String,
    hash: String,
    size: u64,
}
fn fail(code: &'static str) -> Error {
    Error(code)
}
fn disk(error: io::Error) -> Error {
    if error.kind() == io::ErrorKind::StorageFull
        || (cfg!(windows) && matches!(error.raw_os_error(), Some(39 | 112)))
    {
        fail("sync-disk-full")
    } else {
        fail("sync-storage-error")
    }
}
fn hash_valid(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn extension(mime: &str) -> Result<&'static str> {
    Ok(match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "text/markdown" => "md",
        "text/plain" => "txt",
        "text/html" => "html",
        "application/pdf" => "pdf",
        "application/epub+zip" => "epub",
        "application/json" => "json",
        "application/octet-stream" => "bin",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/mp4" => "m4a",
        "audio/webm" => "webm",
        "audio/flac" => "flac",
        "audio/aac" => "aac",
        "audio/wav" | "audio/x-wav" => "wav",
        _ => return Err(fail("sync-invalid-object")),
    })
}
impl Object {
    fn validate(&self) -> Result<()> {
        if !hash_valid(&self.hash) || self.id.is_empty() || self.id.encode_utf16().count() > 150 {
            return Err(fail("sync-invalid-object"));
        }
        let limit = match self.kind.as_str() {
            "document" if self.mime == "text/markdown" && self.id == self.hash => {
                files::MAX_TEXT_BYTES
            }
            "media" => {
                extension(&self.mime)?;
                if matches!(
                    self.mime.as_str(),
                    "application/pdf"
                        | "application/epub+zip"
                        | "text/html"
                        | "application/octet-stream"
                ) {
                    MAX_DOCUMENT as u64
                } else {
                    MAX_MEDIA as u64
                }
            }
            _ => return Err(fail("sync-invalid-object")),
        };
        if self.size > limit || (self.kind == "media" && self.size == 0) {
            return Err(fail("sync-invalid-object"));
        }
        if self.kind == "media"
            && self.mime.starts_with("text/")
            && self.mime != "text/html"
            && self.size > 1024 * 1024
        {
            return Err(fail("sync-invalid-object"));
        }
        Ok(())
    }
    fn directory(&self) -> &str {
        if self.kind == "document" {
            "objects"
        } else {
            "media"
        }
    }
    fn target(&self) -> Result<String> {
        Ok(if self.kind == "document" {
            self.hash.clone()
        } else {
            format!("{}.{}", self.hash, extension(&self.mime)?)
        })
    }
    fn stage(&self) -> String {
        format!("sync-{}-{}", self.kind, self.hash)
    }
    fn manifest(&self) -> Manifest {
        Manifest {
            kind: self.kind.clone(),
            hash: self.hash.clone(),
            size: self.size,
        }
    }
    fn chunks(&self) -> u64 {
        self.size.div_ceil(CHUNK as u64)
    }
}
fn directory(parent: &Dir, name: &str) -> Result<Dir> {
    let parent = parent.try_clone().map_err(disk)?.into_std_file();
    let file = cap_primitives::fs::open_dir_nofollow(&parent, Path::new(name)).map_err(disk)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if file.metadata().map_err(disk)?.file_attributes() & 0x400 != 0 {
            return Err(fail("sync-unsafe-object"));
        }
    }
    Ok(Dir::from_std_file(file))
}
fn regular(file: File) -> Result<File> {
    let metadata = file.metadata().map_err(disk)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(fail("sync-unsafe-object"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(fail("sync-unsafe-object"));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(fail("sync-unsafe-object"));
        }
        // SAFETY: the file owns its handle and the initialized result buffer is writable.
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0
            || info.nNumberOfLinks != 1
        {
            return Err(fail("sync-unsafe-object"));
        }
    }
    Ok(file)
}
fn open(dir: &Dir, name: &str) -> Result<Option<File>> {
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
    match dir.open_with(name, &options) {
        Ok(file) => regular(file.into_std()).map(Some),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(disk(error)),
    }
}
fn create(dir: &Dir, name: &str) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    dir.open_with(name, &options)
        .map(|f| f.into_std())
        .map_err(disk)
}
#[cfg(test)]
thread_local! {static FAIL_WRITE:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
fn write_bytes(file: &mut File, content: &[u8]) -> io::Result<()> {
    #[cfg(test)]
    if FAIL_WRITE.with(|fault| fault.replace(false)) {
        file.write_all(&content[..content.len() / 2])?;
        return Err(io::ErrorKind::StorageFull.into());
    }
    file.write_all(content)
}
fn sync_dir(dir: &Dir) -> Result<()> {
    #[cfg(unix)]
    dir.try_clone()
        .map_err(disk)?
        .into_std_file()
        .sync_all()
        .map_err(disk)?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}
fn bytes(mut file: File, limit: usize) -> Result<Vec<u8>> {
    if file.metadata().map_err(disk)?.len() > limit as u64 {
        return Err(fail("sync-object-limit"));
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(disk)?;
    if bytes.len() > limit {
        return Err(fail("sync-object-limit"));
    }
    Ok(bytes)
}
fn verify(mut file: File, object: &Object) -> Result<()> {
    let before = file.metadata().map_err(disk)?;
    if before.len() != object.size {
        return Err(fail("sync-hash-mismatch"));
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; CHUNK];
    let mut read = 0;
    loop {
        let count = file.read(&mut buffer).map_err(disk)?;
        if count == 0 {
            break;
        }
        read += count as u64;
        if read > object.size {
            return Err(fail("sync-hash-mismatch"));
        }
        hash.update(&buffer[..count]);
    }
    let after = file.metadata().map_err(disk)?;
    if read != object.size
        || format!("{:x}", hash.finalize()) != object.hash
        || before.len() != after.len()
        || before.modified().map_err(disk)? != after.modified().map_err(disk)?
    {
        return Err(fail("sync-hash-mismatch"));
    }
    Ok(())
}
fn stage(root: &Dir, object: &Object, create_stage: bool) -> Result<Option<Dir>> {
    let private = directory(root, ".repeaty")?;
    let staging = directory(&private, "staging")?;
    let name = object.stage();
    if create_stage {
        if !staging.try_exists(&name).map_err(disk)? {
            let count = staging
                .entries()
                .map_err(disk)?
                .filter_map(std::result::Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with("sync-"))
                .count();
            if count >= MAX_STAGED {
                return Err(fail("sync-object-limit"));
            }
        }
        match staging.create_dir(&name) {
            Ok(()) => sync_dir(&staging)?,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(disk(error)),
        }
    } else if !staging.try_exists(&name).map_err(disk)? {
        return Ok(None);
    }
    let dir = directory(&staging, &name)?;
    if let Some(file) = open(&dir, "manifest.json")? {
        let manifest: Manifest = serde_json::from_slice(&bytes(file, 4096)?)?;
        if manifest != object.manifest() {
            return Err(fail("sync-object-conflict"));
        }
    } else if create_stage {
        let temp = format!("{}.manifest", uuid::Uuid::new_v4());
        let mut file = create(&dir, &temp)?;
        file.write_all(&serde_json::to_vec(&object.manifest())?)
            .map_err(disk)?;
        file.sync_all().map_err(disk)?;
        drop(file);
        // This is only disposable transfer metadata, never an existing library file.
        dir.rename(&temp, &dir, "manifest.json").map_err(disk)?;
        sync_dir(&dir)?;
    } else {
        return Err(fail("sync-object-conflict"));
    }
    Ok(Some(dir))
}
fn chunk_name(index: u64, hash: &str) -> String {
    format!("{index:06}-{hash}.chunk")
}
fn chunks(dir: &Dir, object: &Object, verify_hash: bool) -> Result<Vec<(u64, String)>> {
    let mut found = Vec::new();
    let mut seen = BTreeSet::new();
    for entry in dir.entries().map_err(disk)? {
        let entry = entry.map_err(disk)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| fail("sync-unsafe-object"))?;
        if !name.ends_with(".chunk") {
            continue;
        }
        let Some((index, hash)) = name.trim_end_matches(".chunk").split_once('-') else {
            return Err(fail("sync-unsafe-object"));
        };
        let index = index
            .parse::<u64>()
            .map_err(|_| fail("sync-unsafe-object"))?;
        if index >= object.chunks() || !hash_valid(hash) || !seen.insert(index) {
            return Err(fail("sync-object-conflict"));
        }
        let file = open(dir, &name)?.ok_or(fail("sync-object-missing"))?;
        let expected = (object.size - index * CHUNK as u64).min(CHUNK as u64) as usize;
        if file.metadata().map_err(disk)?.len() != expected as u64 {
            return Err(fail("sync-hash-mismatch"));
        }
        if verify_hash && files::digest(&bytes(file, CHUNK)?) != hash {
            return Err(fail("sync-hash-mismatch"));
        }
        found.push((index, name));
    }
    found.sort_by_key(|(index, _)| *index);
    Ok(found)
}
fn cleanup_stage(root: &Dir, object: &Object) -> Result<()> {
    let Some(dir) = stage(root, object, false)? else {
        return Ok(());
    };
    for entry in dir.entries().map_err(disk)? {
        let name = entry
            .map_err(disk)?
            .file_name()
            .into_string()
            .map_err(|_| fail("sync-unsafe-object"))?;
        let disposable = name == "manifest.json"
            || name.ends_with(".chunk")
            || [".partial", ".assembled", ".manifest"]
                .iter()
                .any(|suffix| {
                    name.strip_suffix(suffix)
                        .is_some_and(|stem| uuid::Uuid::parse_str(stem).is_ok())
                });
        if !disposable {
            return Ok(());
        }
        // Never follow a link or recursively remove anything placed here by another writer.
        if open(&dir, &name)?.is_some() {
            dir.remove_file(&name).map_err(disk)?;
        }
    }
    let private = directory(root, ".repeaty")?;
    let staging = directory(&private, "staging")?;
    staging.remove_dir(object.stage()).map_err(disk)?;
    sync_dir(&staging)
}
impl Library {
    /// Called only by a confirmed synchronous Save, never by inventory or incoming RPC.
    /// As with local media import, a failed later SQLite commit can leave a complete,
    /// unreferenced public file; existing working content is never overwritten.
    pub(crate) fn publish_sync_assets(&self, ids: &[String]) -> Result<()> {
        if ids.len() > MAX_OBJECTS {
            return Err(fail("sync-object-limit"));
        }
        let private = directory(&self.anchor, ".repeaty")?;
        let media = directory(&private, "media")?;
        let staging = directory(&private, "staging")?;
        let working = directory(&self.anchor, "assets")?;
        for id in ids.iter().collect::<BTreeSet<_>>() {
            let (mime, path, size): (String, String, i64) = self
                .db
                .connection
                .query_row("SELECT mime,path,size FROM assets WHERE id=?1", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })
                .optional()?
                .ok_or(fail("sync-object-missing"))?;
            let object = Object {
                kind: "media".into(),
                id: id.clone(),
                hash: path
                    .split('.')
                    .next()
                    .ok_or(fail("sync-invalid-object"))?
                    .into(),
                mime,
                size: u64::try_from(size).map_err(|_| fail("sync-invalid-object"))?,
            };
            object.validate()?;
            if object.target()? != path {
                return Err(fail("sync-invalid-object"));
            }
            if let Some(file) = open(&working, &path)? {
                verify(file, &object).map_err(|_| fail("working-file-changed"))?;
                continue;
            }
            let mut source = open(&media, &path)?.ok_or(fail("sync-object-missing"))?;
            let temp = format!("sync-working-{}", uuid::Uuid::new_v4());
            let mut output = create(&staging, &temp)?;
            let copied = (|| -> Result<()> {
                let mut hash = Sha256::new();
                let mut size = 0;
                let mut buffer = [0u8; CHUNK];
                loop {
                    let count = source.read(&mut buffer).map_err(disk)?;
                    if count == 0 {
                        break;
                    }
                    size += count as u64;
                    if size > object.size {
                        return Err(fail("sync-hash-mismatch"));
                    }
                    hash.update(&buffer[..count]);
                    write_bytes(&mut output, &buffer[..count]).map_err(disk)?;
                }
                if size != object.size || format!("{:x}", hash.finalize()) != object.hash {
                    return Err(fail("sync-hash-mismatch"));
                }
                output.sync_all().map_err(disk)?;
                Ok(())
            })();
            drop(output);
            if let Err(error) = copied {
                let _ = staging.remove_file(&temp);
                return Err(error);
            }
            self.guard(&self.token.clone())?;
            let candidate = self.root.join(".repeaty/staging").join(&temp);
            let target = self.root.join("assets").join(&path);
            match atomic::publish_new(&candidate, &target) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    let file = open(&working, &path)?.ok_or(fail("working-file-changed"))?;
                    verify(file, &object).map_err(|_| fail("working-file-changed"))?;
                    let _ = staging.remove_file(&temp);
                }
                Err(error) => {
                    let _ = staging.remove_file(&temp);
                    return Err(disk(error));
                }
            }
            sync_dir(&working)?;
        }
        Ok(())
    }
    fn object_complete(&self, object: &Object) -> Result<bool> {
        let private = directory(&self.anchor, ".repeaty")?;
        let target = directory(&private, object.directory())?;
        let Some(file) = open(&target, &object.target()?)? else {
            return Ok(false);
        };
        verify(file, object)?;
        Ok(true)
    }
    fn object_info(&self, object: &Object) -> Result<Value> {
        let complete = self.object_complete(object)?;
        let received = if complete {
            (0..object.chunks()).collect::<Vec<_>>()
        } else if let Some(dir) = stage(&self.anchor, object, false)? {
            chunks(&dir, object, true)?
                .into_iter()
                .map(|(i, _)| i)
                .collect()
        } else {
            vec![]
        };
        Ok(json!({"complete":complete,"received":received,"chunkSize":CHUNK}))
    }
    fn object_inventory(&self) -> Result<Value> {
        let mut objects = Vec::new();
        let mut stmt = self
            .db
            .connection
            .prepare("SELECT id,mime,path,size FROM assets ORDER BY id LIMIT 50001")?;
        for row in stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })? {
            let (id, mime, path, size) = row?;
            let hash = path
                .split('.')
                .next()
                .ok_or(fail("sync-invalid-object"))?
                .to_owned();
            let object = Object {
                kind: "media".into(),
                id,
                mime,
                hash,
                size: u64::try_from(size).map_err(|_| fail("sync-invalid-object"))?,
            };
            object.validate()?;
            if object.target()? != path {
                return Err(fail("sync-invalid-object"));
            }
            objects.push(object);
            if objects.len() > MAX_OBJECTS {
                return Err(fail("sync-object-limit"));
            }
        }
        let mut stmt=self.db.connection.prepare("SELECT hash FROM documents UNION SELECT hash FROM retired_documents UNION SELECT hash FROM sync_object_documents ORDER BY hash LIMIT 50001")?;
        let private = directory(&self.anchor, ".repeaty")?;
        let documents = directory(&private, "objects")?;
        for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
            let hash = row?;
            if !hash_valid(&hash) {
                return Err(fail("sync-invalid-object"));
            }
            let file = open(&documents, &hash)?.ok_or(fail("sync-object-missing"))?;
            let object = Object {
                kind: "document".into(),
                id: hash.clone(),
                mime: "text/markdown".into(),
                hash,
                size: file.metadata().map_err(disk)?.len(),
            };
            object.validate()?;
            objects.push(object);
            if objects.len() > MAX_OBJECTS {
                return Err(fail("sync-object-limit"));
            }
        }
        Ok(json!({"objects":objects,"chunkSize":CHUNK}))
    }
    pub fn sync_object_request(&mut self, method: &str, payload: Value) -> Result<Value> {
        self.guard(&self.token.clone())?;
        if method == "objects/info" && payload.get("object").is_none() {
            return self.object_inventory();
        }
        let object: Object = serde_json::from_value(payload["object"].clone())?;
        object.validate()?;
        match method {
            "objects/info" => self.object_info(&object),
            "objects/read" => {
                let offset = payload["offset"].as_u64().ok_or_else(Error::invalid)?;
                if offset % CHUNK as u64 != 0 || offset >= object.size {
                    return Err(fail("sync-invalid-object"));
                }
                let private = directory(&self.anchor, ".repeaty")?;
                let dir = directory(&private, object.directory())?;
                let mut file = open(&dir, &object.target()?)?.ok_or(fail("sync-object-missing"))?;
                if file.metadata().map_err(disk)?.len() != object.size {
                    return Err(fail("sync-hash-mismatch"));
                }
                file.seek(SeekFrom::Start(offset)).map_err(disk)?;
                let mut bytes = vec![0; (object.size - offset).min(CHUNK as u64) as usize];
                file.read_exact(&mut bytes).map_err(disk)?;
                Ok(
                    json!({"offset":offset,"chunkHash":files::digest(&bytes),"data":STANDARD.encode(bytes)}),
                )
            }
            "objects/write" => self.write_object_chunk(&object, &payload),
            "objects/finish" => self.finish_object(&object),
            _ => Err(Error::invalid()),
        }
    }
    fn write_object_chunk(&self, object: &Object, payload: &Value) -> Result<Value> {
        let offset = payload["offset"].as_u64().ok_or_else(Error::invalid)?;
        let hash = payload["chunkHash"]
            .as_str()
            .filter(|h| hash_valid(h))
            .ok_or_else(Error::invalid)?;
        let encoded = payload["data"].as_str().ok_or_else(Error::invalid)?;
        if encoded.len() > CHUNK.div_ceil(3) * 4
            || offset % CHUNK as u64 != 0
            || offset >= object.size
        {
            return Err(fail("sync-invalid-object"));
        }
        let content = STANDARD
            .decode(encoded)
            .map_err(|_| fail("sync-invalid-object"))?;
        if content.len() != (object.size - offset).min(CHUNK as u64) as usize
            || files::digest(&content) != hash
        {
            return Err(fail("sync-hash-mismatch"));
        }
        if self.object_complete(object)? {
            return self.object_info(object);
        }
        let dir = stage(&self.anchor, object, true)?.ok_or(fail("sync-object-missing"))?;
        let index = offset / CHUNK as u64;
        let mut found = chunks(&dir, object, false)?;
        if let Some((_, name)) = found.iter().find(|(i, _)| *i == index) {
            if name != &chunk_name(index, hash) {
                return Err(fail("sync-object-conflict"));
            }
            if files::digest(&bytes(
                open(&dir, name)?.ok_or(fail("sync-object-missing"))?,
                CHUNK,
            )?) != hash
            {
                return Err(fail("sync-hash-mismatch"));
            }
            return Ok(
                json!({"complete":false,"received":found.iter().map(|(i,_)|i).collect::<Vec<_>>(),"chunkSize":CHUNK}),
            );
        }
        let name = chunk_name(index, hash);
        let temp = format!("{}.partial", uuid::Uuid::new_v4());
        let mut file = create(&dir, &temp)?;
        if let Err(error) = write_bytes(&mut file, &content).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = dir.remove_file(&temp);
            return Err(disk(error));
        }
        drop(file);
        self.guard(&self.token.clone())?;
        let stage_path = self.root.join(".repeaty/staging").join(object.stage());
        atomic::publish_new(&stage_path.join(&temp), &stage_path.join(&name)).map_err(disk)?;
        sync_dir(&dir)?;
        found.push((index, name));
        found.sort_by_key(|(i, _)| *i);
        Ok(
            json!({"complete":false,"received":found.iter().map(|(i,_)|i).collect::<Vec<_>>(),"chunkSize":CHUNK}),
        )
    }
    fn finish_object(&mut self, object: &Object) -> Result<Value> {
        if !self.object_complete(object)? {
            let dir = stage(&self.anchor, object, true)?.ok_or(fail("sync-object-missing"))?;
            let found = chunks(&dir, object, true)?;
            if found.len() as u64 != object.chunks() {
                return Err(fail("sync-object-incomplete"));
            }
            let temp = format!("{}.assembled", uuid::Uuid::new_v4());
            let mut file = create(&dir, &temp)?;
            let mut hash = Sha256::new();
            let result = (|| -> Result<()> {
                for (_, name) in found {
                    let content = bytes(
                        open(&dir, &name)?.ok_or(fail("sync-object-missing"))?,
                        CHUNK,
                    )?;
                    hash.update(&content);
                    write_bytes(&mut file, &content).map_err(disk)?;
                }
                if format!("{:x}", hash.finalize()) != object.hash {
                    return Err(fail("sync-hash-mismatch"));
                }
                file.sync_all().map_err(disk)?;
                Ok(())
            })();
            drop(file);
            if let Err(error) = result {
                let _ = dir.remove_file(&temp);
                return Err(error);
            }
            // Text validation remains equivalent to put_media; all temporary bytes stay private.
            if object.kind == "document" || object.mime.starts_with("text/") {
                let content = bytes(
                    open(&dir, &temp)?.ok_or(fail("sync-object-missing"))?,
                    object.size as usize,
                )?;
                if std::str::from_utf8(&content).is_err() {
                    let _ = dir.remove_file(&temp);
                    return Err(fail("sync-invalid-object"));
                }
            }
            self.guard(&self.token.clone())?;
            let source = self
                .root
                .join(".repeaty/staging")
                .join(object.stage())
                .join(&temp);
            let target = self
                .root
                .join(".repeaty")
                .join(object.directory())
                .join(object.target()?);
            match atomic::publish_new(&source, &target) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    self.object_complete(object)?;
                    let _ = dir.remove_file(&temp);
                }
                Err(error) => return Err(disk(error)),
            }
            let private = directory(&self.anchor, ".repeaty")?;
            sync_dir(&directory(&private, object.directory())?)?;
            if !self.object_complete(object)? {
                return Err(fail("sync-object-missing"));
            }
        }
        if object.kind == "media" {
            let tx = self.db.connection.transaction()?;
            let prior: Option<(String, String, i64)> = tx
                .query_row(
                    "SELECT mime,path,size FROM assets WHERE id=?1",
                    [&object.id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let expected = (object.mime.clone(), object.target()?, object.size as i64);
            if prior.as_ref().is_some_and(|p| p != &expected) {
                return Err(fail("sync-object-conflict"));
            }
            if prior.is_none() {
                tx.execute(
                    "INSERT INTO assets VALUES(?1,?2,?3,?4,unixepoch())",
                    params![object.id, object.mime, expected.1, expected.2],
                )?;
            }
            tx.commit()?;
        } else {
            self.db.connection.execute("INSERT INTO sync_object_documents(hash,size) VALUES(?1,?2) ON CONFLICT(hash) DO UPDATE SET size=excluded.size",params![object.hash,object.size as i64])?;
        }
        // A successful publication and asset transaction make the verified cache disposable.
        // Cleanup failure cannot turn a complete object back into an incomplete transfer.
        let _ = cleanup_stage(&self.anchor, object);
        Ok(json!({"complete":true}))
    }
}

#[cfg(test)]
mod tests;
