use crate::api::AppState;
use axum::{Router, routing::post};

/// Backend modules are installed by the deployer and compiled into the service.
/// Routes are relative to /api/plugins and share the service's authentication.
pub trait BackendPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn routes(&self) -> Router<AppState>;
}
struct LeetCodePlugin;
impl BackendPlugin for LeetCodePlugin {
    fn id(&self) -> &'static str {
        "leetcode"
    }
    fn routes(&self) -> Router<AppState> {
        Router::new().route("/leetcode", post(crate::leetcode::handle))
    }
}
pub fn installed() -> Vec<Box<dyn BackendPlugin>> {
    vec![Box::new(LeetCodePlugin)]
}
pub fn enabled_from_env() -> Result<Vec<String>, String> {
    let setting = std::env::var("REPEATY_PLUGINS").unwrap_or_else(|_| "leetcode".into());
    let ids: Vec<_> = setting
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();
    if ids
        .iter()
        .any(|id| !installed().iter().any(|plugin| plugin.id() == id))
    {
        return Err("REPEATY_PLUGINS contains a module that is not installed".into());
    }
    Ok(ids)
}
