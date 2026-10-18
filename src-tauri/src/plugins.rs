use repeaty_leetcode_local::leetcode::{CredentialRequest, LeetCode, Request};
use serde_json::Value;
use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};

pub type PluginResult = Result<Value, String>;
pub type PluginFuture<'a> = Pin<Box<dyn Future<Output = PluginResult> + Send + 'a>>;
/// Local plugins are compiled into the desktop application; no server-supplied code runs here.
pub trait LocalPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn call(&self, operation: String, payload: Value) -> PluginFuture<'_>;
}
impl LocalPlugin for LeetCode {
    fn id(&self) -> &'static str {
        "leetcode"
    }
    fn call(&self, operation: String, payload: Value) -> PluginFuture<'_> {
        Box::pin(async move {
            match operation.as_str() {
                "request" => self
                    .request(
                        serde_json::from_value::<Request>(payload).map_err(|_| "invalid-data")?,
                    )
                    .await
                    .map_err(|e| e.1.to_string()),
                "credentials" => self
                    .configure(
                        serde_json::from_value::<CredentialRequest>(payload)
                            .map_err(|_| "invalid-data")?,
                    )
                    .map_err(|e| e.1.to_string()),
                _ => Err("unknown-operation".into()),
            }
        })
    }
}
pub struct Plugins(HashMap<&'static str, Arc<dyn LocalPlugin>>);
impl Plugins {
    pub fn new(entries: Vec<Arc<dyn LocalPlugin>>) -> Result<Self, String> {
        let mut plugins = HashMap::new();
        for plugin in entries {
            if plugins.insert(plugin.id(), plugin).is_some() {
                return Err("duplicate-plugin".into());
            }
        }
        Ok(Self(plugins))
    }
    pub async fn call(&self, id: &str, operation: String, payload: Value) -> PluginResult {
        self.0
            .get(id)
            .ok_or("plugin-unavailable")?
            .call(operation, payload)
            .await
    }
}
