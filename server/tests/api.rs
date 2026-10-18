use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use repeaty_server::{
    api::{AppState, router},
    db::Database,
    leetcode::LeetCode,
};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tower::ServiceExt;
fn state() -> AppState {
    AppState {
        db: Arc::new(Mutex::new(Database::open(Path::new(":memory:")).unwrap())),
        leetcode: Arc::new(LeetCode::new(HashMap::new()).unwrap()),
        token: Some("test-only-access-token-123456".into()),
        origin: "http://127.0.0.1:8080".into(),
        host: "127.0.0.1:8080".into(),
        enabled_plugins: vec!["leetcode".into()],
    }
}
fn request(path: &str) -> axum::http::request::Builder {
    Request::builder()
        .uri(path)
        .header("Host", "127.0.0.1:8080")
        .header("X-Repeaty-Client", "1")
}
#[tokio::test]
async fn protects_data_and_rejects_cross_origin_and_rebinding_requests() {
    let app = router(state(), "missing".into());
    let response = app
        .clone()
        .oneshot(request("/api/status").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    for path in ["/api/library", "/api/backups", "/api/media/id"] {
        assert_eq!(
            app.clone()
                .oneshot(request(path).body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    for builder in [
        Request::builder()
            .uri("/api/library")
            .header("Host", "127.0.0.1:8080"),
        request("/api/library").header("Origin", "https://evil.test"),
        Request::builder()
            .uri("/api/library")
            .header("Host", "evil.test:8080")
            .header("X-Repeaty-Client", "1"),
    ] {
        let response = app
            .clone()
            .oneshot(
                builder
                    .header("Authorization", "Bearer test-only-access-token-123456")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let response = app
        .oneshot(
            request("/api/library")
                .header("Authorization", "Bearer test-only-access-token-123456")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(value["library"]["version"], 4);
}
#[tokio::test]
async fn disabled_backend_plugin_has_no_api_route() {
    let mut state = state();
    state.enabled_plugins.clear();
    let app = router(state, "missing".into());
    let response = app
        .oneshot(
            request("/api/plugins/leetcode")
                .method("POST")
                .header("Authorization", "Bearer test-only-access-token-123456")
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{"action":"ping"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

async fn credential_request(
    app: axum::Router,
    body: serde_json::Value,
    authorized: bool,
    origin: &str,
) -> (StatusCode, String) {
    let mut builder = request("/api/plugins/leetcode/credentials")
        .method("POST")
        .header("Content-Type", "application/json")
        .header("Origin", origin);
    if authorized {
        builder = builder.header("Authorization", "Bearer test-only-access-token-123456");
    }
    let response = app
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let text = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    (status, text)
}
#[tokio::test]
async fn credentials_require_authentication_and_same_origin_and_never_leave_the_server() {
    use serde_json::json;
    let state = state();
    let client = state.leetcode.clone();
    let app = router(state, "missing".into());
    let save = json!({"action":"save","site":"leetcode.cn","session":"private-session-test","csrf":"private-csrf-test"});
    for (auth, origin, status) in [
        (false, "http://127.0.0.1:8080", StatusCode::UNAUTHORIZED),
        (true, "https://evil.test", StatusCode::FORBIDDEN),
        (true, "http://127.0.0.1:8080", StatusCode::OK),
    ] {
        let (actual, body) = credential_request(app.clone(), save.clone(), auth, origin).await;
        assert_eq!(actual, status);
        assert!(!body.contains("private-"));
    }
    assert_eq!(client.configured().unwrap(), vec!["leetcode.cn"]);
    let (status, _) = credential_request(
        app.clone(),
        json!({"action":"save","site":"leetcode.cn","session":"bad;cookie","csrf":"valid"}),
        true,
        "http://127.0.0.1:8080",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(client.configured().unwrap(), vec!["leetcode.cn"]);
    for path in ["/api/status", "/api/library", "/api/backups"] {
        let response = app
            .clone()
            .oneshot(
                request(path)
                    .header("Authorization", "Bearer test-only-access-token-123456")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = String::from_utf8(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap();
        assert!(!body.contains("private-"));
    }
    let response = app
        .clone()
        .oneshot(
            request("/api/plugins/leetcode/credentials")
                .method("POST")
                .header("Authorization", "Bearer test-only-access-token-123456")
                .header("Content-Type", "application/json")
                .body(Body::from("x".repeat(21 * 1024)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let (status, body) = credential_request(
        app,
        json!({"action":"clear","site":"leetcode.cn"}),
        true,
        "http://127.0.0.1:8080",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap()["configured"],
        json!([])
    );
}
#[tokio::test]
async fn disabled_plugin_rejects_credential_configuration() {
    let mut state = state();
    state.enabled_plugins.clear();
    let (status, _) = credential_request(
        router(state, "missing".into()),
        serde_json::json!({"action":"clear","site":"leetcode.cn"}),
        true,
        "http://127.0.0.1:8080",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
