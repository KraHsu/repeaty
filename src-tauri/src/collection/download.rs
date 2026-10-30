//! Explicit one-shot downloads from a user-confirmed HTTPS origin. No account credentials.
use super::{Collection, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadFormat {
    Pdf,
    Epub,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    name: String,
    r#type: &'static str,
    bytes: String,
    size: usize,
}
const DOWNLOAD_LIMIT: usize = 64 * 1024 * 1024;
fn url(raw: &str) -> Result<reqwest::Url> {
    if raw.len() > 16 * 1024 {
        return Err("invalid-download-url".into());
    }
    let url = reqwest::Url::parse(raw).map_err(|_| "invalid-download-url")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid-download-url".into());
    }
    Ok(url)
}
fn filename(raw: &str, format: DownloadFormat) -> Result<String> {
    if raw.is_empty()
        || raw.len() > 200
        || raw
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        || raw.ends_with(['.', ' '])
    {
        return Err("invalid-download-filename".into());
    }
    let extension = match format {
        DownloadFormat::Pdf => ".pdf",
        DownloadFormat::Epub => ".epub",
    };
    Ok(if raw.to_ascii_lowercase().ends_with(extension) {
        raw.into()
    } else {
        format!("{raw}{extension}")
    })
}
fn verify(bytes: &[u8], format: DownloadFormat, mime: &str) -> Result<&'static str> {
    if bytes.len() > DOWNLOAD_LIMIT {
        return Err("source-download-limit".into());
    }
    let mime = mime.split(';').next().unwrap_or("").trim();
    let generic = matches!(
        mime,
        "" | "application/octet-stream" | "binary/octet-stream"
    );
    match format {
        DownloadFormat::Pdf
            if (generic || mime == "application/pdf") && bytes.starts_with(b"%PDF-") =>
        {
            Ok("application/pdf")
        }
        DownloadFormat::Epub
            if (generic || matches!(mime, "application/epub+zip" | "application/zip"))
                && bytes.len() >= 58
                && bytes.starts_with(b"PK\x03\x04") =>
        {
            let compression = u16::from_le_bytes([bytes[8], bytes[9]]);
            let name = u16::from_le_bytes([bytes[26], bytes[27]]) as usize;
            let extra = u16::from_le_bytes([bytes[28], bytes[29]]) as usize;
            let start = 30 + name + extra;
            if compression == 0
                && name == 8
                && bytes.get(30..38) == Some(b"mimetype")
                && bytes.get(start..start + 20) == Some(b"application/epub+zip")
            {
                Ok("application/epub+zip")
            } else {
                Err("source-download-type".into())
            }
        }
        _ => Err("source-download-type".into()),
    }
}
#[tauri::command]
pub async fn collection_download(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    url: String,
    filename: String,
    format: DownloadFormat,
) -> Result<Option<DownloadedFile>> {
    crate::main_window(&window)?;
    let target = self::url(&url)?;
    let name = self::filename(&filename, format)?;
    let manager = state.0.clone();
    let epoch = manager
        .lock()
        .map_err(|_| "source-download-failed")?
        .check(&expected_scope)?;
    let origin = target.origin().ascii_serialization();
    let prompt_name = name.clone();
    let approved = tauri::async_runtime::spawn_blocking(move || window.dialog()
        .message(format!("从 {origin} 下载“{prompt_name}”？\n\n本次只下载该文件，不向下载站点发送账号令牌或 Cookie。最大 64 MiB。"))
        .title("获取材料原件")
        .parent(&window)
        .buttons(MessageDialogButtons::OkCancelCustom("下载".into(), "取消".into()))
        .blocking_show()).await.map_err(|_| "source-download-failed")?;
    if !approved {
        return Ok(None);
    }
    let check = || -> Result<()> {
        if manager
            .lock()
            .map_err(|_| "source-download-failed")?
            .check(&expected_scope)?
            != epoch
        {
            return Err("stale-collection-scope".into());
        }
        Ok(())
    };
    check()?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "source-download-failed")?;
    // Intentionally no caller headers, cookie jar, or plugin-secret API is involved.
    let mut response = client
        .get(target)
        .send()
        .await
        .map_err(|_| "source-download-failed")?;
    if response.status().is_redirection() {
        return Err("source-download-redirect".into());
    }
    if !response.status().is_success() {
        return Err("source-download-status".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > DOWNLOAD_LIMIT as u64)
    {
        return Err("source-download-limit".into());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "source-download-failed")?
    {
        check()?;
        if bytes.len() + chunk.len() > DOWNLOAD_LIMIT {
            return Err("source-download-limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    check()?;
    let r#type = verify(&bytes, format, &mime)?;
    Ok(Some(DownloadedFile {
        name,
        r#type,
        size: bytes.len(),
        bytes: STANDARD.encode(bytes),
    }))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_https_without_embedded_credentials_and_keeps_signed_query() {
        for value in [
            "http://example.org/a",
            "file:///a",
            "https://user:token@example.org/a",
            "https://example.org/a#secret",
        ] {
            assert!(url(value).is_err());
        }
        assert_eq!(
            url("https://objects.example.org/a?Signature=opaque")
                .unwrap()
                .query(),
            Some("Signature=opaque")
        );
        let request = reqwest::Client::new()
            .get(url("https://objects.example.org/a?Signature=opaque").unwrap())
            .build()
            .unwrap();
        assert!(request.headers().get("authorization").is_none());
        assert!(request.headers().get("cookie").is_none());
    }
    #[test]
    fn validates_documents_not_html_error_pages_or_mislabelled_bytes() {
        assert!(verify(b"%PDF-1.7\n", DownloadFormat::Pdf, "application/pdf").is_ok());
        assert!(verify(b"<!doctype html>", DownloadFormat::Pdf, "application/pdf").is_err());
        assert!(verify(b"%PDF-1.7\n", DownloadFormat::Pdf, "text/html").is_err());
        let mut epub = vec![0; 30];
        epub[..4].copy_from_slice(b"PK\x03\x04");
        epub[26] = 8;
        epub.extend_from_slice(b"mimetypeapplication/epub+zip");
        assert!(verify(&epub, DownloadFormat::Epub, "application/octet-stream").is_ok());
        epub[30] = b'x';
        assert!(verify(&epub, DownloadFormat::Epub, "application/zip").is_err());
    }
}
