use serde::Deserialize;
use serde_json::json;
use std::path::Path;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Client {
    Codex,
    ClaudeCode,
    ClaudeDesktop,
    Http,
}
impl super::Mcp {
    pub fn client_configuration(
        &self,
        client: Client,
        executable: &Path,
    ) -> Result<String, &'static str> {
        if matches!(client, Client::Http) {
            return serde_json::to_string_pretty(&self.configuration()?)
                .map_err(|_| "invalid-data");
        }
        let path = self.connection_file.as_ref().ok_or("library-unavailable")?;
        if !path.is_absolute() || !executable.is_absolute() {
            return Err("invalid-data");
        }
        let command = executable.to_str().ok_or("invalid-data")?;
        let path = path.to_str().ok_or("invalid-data")?;
        let args = ["--mcp-stdio", "--connection-file", path];
        if matches!(client, Client::Codex) {
            // JSON basic strings and string arrays are also valid TOML; escaping preserves Windows paths.
            return Ok(format!(
                "[mcp_servers.repeaty]\ncommand = {}\nargs = {}\n",
                json!(command),
                json!(args)
            ));
        }
        serde_json::to_string_pretty(
            &json!({"mcpServers":{"repeaty":{"command":command,"args":args}}}),
        )
        .map_err(|_| "invalid-data")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::Mcp;

    #[test]
    fn stable_configurations_preserve_paths_and_never_include_http_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("Repeaty 用户 & settings")
            .join("connection.json");
        let binary = directory.path().join("Repeaty 'quoted'\\binary.exe");
        let bridge = Mcp::with_connection_file(path.clone());
        for client in [Client::ClaudeCode, Client::ClaudeDesktop] {
            let value: serde_json::Value =
                serde_json::from_str(&bridge.client_configuration(client, &binary).unwrap())
                    .unwrap();
            assert_eq!(
                value["mcpServers"]["repeaty"]["command"],
                binary.to_str().unwrap()
            );
            assert_eq!(
                value["mcpServers"]["repeaty"]["args"][2],
                path.to_str().unwrap()
            );
            assert!(value["mcpServers"]["repeaty"].get("headers").is_none());
        }
        let codex = bridge.client_configuration(Client::Codex, &binary).unwrap();
        assert!(codex.starts_with("[mcp_servers.repeaty]\ncommand = "));
        assert!(codex.contains("--mcp-stdio"));
        assert!(!codex.contains("Authorization"));
        assert!(bridge.client_configuration(Client::Http, &binary).is_err());
    }
}
