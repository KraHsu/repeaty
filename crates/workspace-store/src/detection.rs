//! Read-only file observations for the desktop monitor. Unchanged files and old
//! attempt bodies are never read here; a full reconciliation is explicit.
use crate::{
    error::{Error, Result},
    files,
    library::Library,
    working_media,
};
use rusqlite::params;
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    path::{Component, Path},
};

fn safe_path(path: &str) -> bool {
    path.len() <= 1024
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        && ["notes", "sources", "assets"]
            .iter()
            .any(|folder| path == *folder || path.starts_with(&format!("{folder}/")))
        && !path.split('/').any(|part| part.starts_with('.'))
}
impl Library {
    pub(crate) fn bindings(&self, ids: Option<&[String]>) -> Result<Value> {
        let query = "SELECT d.kind,d.id,json_extract(r.data,'$.inlineMedia') FROM documents d JOIN (SELECT 'note' AS kind,id,data FROM notes UNION ALL SELECT 'source' AS kind,id,data FROM sources) r ON r.kind=d.kind AND r.id=d.id WHERE (?1 IS NULL OR d.id IN (SELECT value FROM json_each(?1))) AND json_array_length(json_extract(r.data,'$.inlineMedia'))>0";
        let mut statement = self.db.connection.prepare(query)?;
        let rows = statement
            .query_map([ids.map(serde_json::to_string).transpose()?], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut bindings = Vec::new();
        for (kind, id, raw) in rows {
            let media: Value = serde_json::from_str(&raw)?;
            bindings.push(json!({"kind":kind,"id":id,"media":media}));
        }
        Ok(json!(bindings))
    }
    pub(crate) fn observe(&self, request: &Value) -> Result<Value> {
        if request["full"].as_bool() == Some(true) {
            let mut scan = self.scan()?;
            scan["full"] = json!(true);
            scan["bindings"] = self.bindings(None)?;
            return Ok(scan);
        }
        let paths: Vec<String> = serde_json::from_value(request["paths"].clone())?;
        let known: Vec<String> = serde_json::from_value(request["known"].clone())?;
        if paths.len() > 512
            || known.len() > 8192
            || paths.iter().any(|path| !safe_path(path))
            || known
                .iter()
                .any(|id| id.is_empty() || id.encode_utf16().count() > 150)
        {
            return Err(Error::invalid());
        }
        let paths: Vec<_> = paths
            .into_iter()
            .filter(|path| path.starts_with("notes") || path.starts_with("sources"))
            .collect();
        let mut working = Vec::new();
        let mut bytes = 0;
        for path in &paths {
            let target = self.root.join(path);
            match std::fs::symlink_metadata(&target) {
                Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
                    self.walk(path, path.split('/').count() - 1, &mut working, &mut bytes)?
                }
                Ok(_) if path.ends_with(".md") => {
                    match self.read_working(path) {
                        Ok(Some(raw)) => {
                            bytes += raw.len();
                            if bytes > 32 * 1024 * 1024 {
                                return Err(Error("workspace-limit"));
                            }
                            match String::from_utf8(raw) { Ok(raw) => working.push(json!({"path":path,"hash":files::digest(raw.as_bytes()),"raw":raw})), Err(_) => working.push(json!({"path":path,"error":"invalid-utf8"})) }
                        }
                        Ok(None) => {}
                        Err(error) => working.push(json!({"path":path,"error":error.0})),
                    }
                }
                Ok(meta) if meta.file_type().is_symlink() => {
                    working.push(json!({"path":path,"error":"unsafe-file"}))
                }
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(error.into());
                }
                _ => {}
            }
        }
        let mut ids = BTreeSet::from_iter(known);
        let mut statement = self.db.connection.prepare("SELECT id,path FROM documents WHERE id IN (SELECT value FROM json_each(?1)) OR EXISTS(SELECT 1 FROM json_each(?2) p WHERE documents.path=p.value OR substr(documents.path,1,length(p.value)+1)=p.value||'/')")?;
        let current = statement
            .query_map(
                params![serde_json::to_string(&ids)?, serde_json::to_string(&paths)?],
                |row| row.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?;
        let removed = ids.difference(&current).cloned().collect::<Vec<_>>();
        ids.extend(current);
        let ids: Vec<_> = ids.into_iter().collect();
        let retired = crate::retirement::listing(&self.db.connection, "", 0)?;
        Ok(
            json!({"full":false,"prefixes":paths,"working":working,"accepted":self.documents(Some(&ids))?,"removed":removed,"bindings":self.bindings(Some(&ids))?,"attention":self.attention()?,"retired":retired["notes"],"retiredCount":retired["total"]}),
        )
    }
    pub(crate) fn inspect_assets(&self, request: &Value) -> Result<Value> {
        let paths: Vec<String> = serde_json::from_value(request["paths"].clone())?;
        if paths.len() > 4
            || paths
                .iter()
                .any(|path| !safe_path(path) || !path.starts_with("assets/"))
        {
            return Err(Error::invalid());
        }
        let mut result = Vec::new();
        for path in paths {
            result.push(match working_media::read(&self.anchor, &path) {
                Ok(Some(bytes)) => json!({"path":path,"hash":files::digest(&bytes)}),
                Ok(None) => json!({"path":path,"hash":null,"error":"not-found"}),
                Err(error) => json!({"path":path,"hash":null,"error":error.0}),
            });
        }
        Ok(json!(result))
    }
}
