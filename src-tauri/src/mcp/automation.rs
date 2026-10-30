//! Automation capabilities share the UI-owned transaction service, never a second database writer.
use rmcp::model::{Tool, ToolAnnotations};
use serde::Deserialize;
use serde_json::Value;

pub fn schemas() -> Value {
    serde_json::from_str(include_str!("automation.schema.json"))
        .expect("generated automation schemas must be valid JSON")
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    #[serde(default)]
    pub read_enabled: bool,
    #[serde(default)]
    pub write_enabled: bool,
}

impl Grant {
    pub fn allows(&self, tool: &str) -> bool {
        match tool {
            "repeaty_query_library" | "repeaty_operation_status" => self.read_enabled,
            "repeaty_preview_changes" | "repeaty_apply_changes" => {
                self.read_enabled && self.write_enabled
            }
            _ => true,
        }
    }
}

pub fn is_tool(tool: &str) -> bool {
    matches!(
        tool,
        "repeaty_automation_status"
            | "repeaty_query_library"
            | "repeaty_preview_changes"
            | "repeaty_apply_changes"
            | "repeaty_operation_status"
    )
}

pub fn tools() -> impl Iterator<Item = Tool> {
    let schemas = schemas();
    [
        ("repeaty_automation_status", "Get the current library scope, revision and explicit automation grants. Does not expose study content.", false),
        ("repeaty_query_library", "Query the authorized current library. Supply a versioned query object; paginate using the returned revision. Read grant required.", false),
        ("repeaty_preview_changes", "Validate a bounded batch of versioned commands in the current library and return a reviewable plan without saving. Read and write grants required. Use the current expected revision.", false),
        ("repeaty_apply_changes", "Apply a reviewed preview through Repeaty's application transaction. Supply the preview fingerprint and plan identity, the original request with its expected revision and stable operation ID. Retrying the same operation is idempotent; query its receipt after an uncertain response. Read and write grants required.", true),
        ("repeaty_operation_status", "Read a durable operation receipt in the current library by operation ID, including whether an interrupted request committed. Read grant required.", false),
    ].into_iter().map(move |(name, description, writes)| {
        let schema_name = match name {
            "repeaty_query_library" => "query",
            "repeaty_preview_changes" => "preview",
            "repeaty_apply_changes" => "apply",
            "repeaty_operation_status" => "operation",
            _ => "status",
        };
        // Generated from canonical TypeScript; additional semantic refinements still run in the host.
        Tool::new(name, description, schemas[schema_name].as_object().unwrap().clone())
            .with_annotations(ToolAnnotations::new().read_only(!writes).destructive(writes).idempotent(true).open_world(false))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn automation_grants_are_opt_in_and_read_does_not_authorize_writes() {
        let off = Grant::default();
        assert!(off.allows("repeaty_automation_status"));
        assert!(off.allows("repeaty_due_cards"));
        assert!(!off.allows("repeaty_query_library"));
        assert!(!off.allows("repeaty_apply_changes"));
        let read = Grant {
            read_enabled: true,
            ..off
        };
        assert!(read.allows("repeaty_query_library"));
        assert!(read.allows("repeaty_operation_status"));
        assert!(!read.allows("repeaty_preview_changes"));
        let write_without_read = Grant {
            write_enabled: true,
            ..off
        };
        assert!(!write_without_read.allows("repeaty_apply_changes"));
        assert!(
            Grant {
                read_enabled: true,
                write_enabled: true
            }
            .allows("repeaty_apply_changes")
        );
        assert!(serde_json::from_value::<Grant>(json!({"readEnabled":true,"extra":true})).is_err());
    }

    #[test]
    fn automation_tools_publish_discoverable_versioned_argument_schemas() {
        let schemas = schemas();
        assert!(schemas["query"]["oneOf"].is_array() || schemas["query"]["anyOf"].is_array());
        assert_eq!(
            schemas["preview"]["properties"]["protocolVersion"]["const"],
            1
        );
        assert!(schemas["apply"]["properties"]["request"].is_object());
        assert_eq!(tools().count(), 5);
    }
}
