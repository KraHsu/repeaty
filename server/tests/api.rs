use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use repeaty_server::api::{AppState, router};
use serde_json::{Value, json};
use tower::ServiceExt;
fn request(path: &str) -> axum::http::request::Builder {
    Request::builder()
        .uri(format!("/api{path}"))
        .header("Host", "127.0.0.1:8080")
        .header("X-Repeaty-Client", "1")
}
async fn call(app: &Router, path: &str, token: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut req = request(path).header("Authorization", format!("Bearer {token}"));
    if !token.is_empty() {
        let response = app
            .clone()
            .oneshot(
                request("/auth/session")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let value: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        if let Some(id) = value["user"]["id"].as_str() {
            req = req.header("X-Repeaty-User", id);
        }
    }
    let body = if let Some(body) = body {
        req = req
            .method("POST")
            .header("Content-Type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn register(app: &Router, name: &str) -> String {
    let response = app
        .clone()
        .oneshot(
            request("/auth/register")
                .method("POST")
                .header("X-Repeaty-Session", "bearer")
                .header("Content-Type", "application/json")
                .body(Body::from(
                    json!({"username":name,"password":"strong-test-password"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    value["token"].as_str().unwrap().into()
}
fn app(directory: &std::path::Path) -> Router {
    router(
        AppState::open(
            directory.into(),
            "http://127.0.0.1:8080".into(),
            "127.0.0.1:8080".into(),
            true,
        )
        .unwrap(),
        "missing".into(),
    )
}
#[tokio::test]
async fn accounts_isolate_identical_record_ids_media_and_backups() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path());
    let alice = register(&app, "alice").await;
    let bob = register(&app, "bob").await;
    let mut fixture: Value = serde_json::from_str(include_str!("fixtures/library.json")).unwrap();
    fixture["practices"] = json!([{
        "id":"practice", "cardId":fixture["cards"][0]["id"], "contentRevision":"sha256",
        "question":{"front":"Problem","back":"","format":"plain","plugin":{"id":"leetcode","version":1,"data":{}}},
        "startedAt":"2026-10-18T00:00:00.000Z"
    }]);
    fixture["attempts"] = json!([{
        "id":"attempt", "practiceId":"practice", "language":"python3", "code":"private source code",
        "submittedAt":"2026-10-18T00:00:00.000Z", "updatedAt":"2026-10-18T00:00:00.000Z",
        "elapsedMs":1000, "status":"unknown"
    }]);
    let patches:Vec<_>=["decks","notes","cards","reviews","savedSearches","practices","attempts"].into_iter().flat_map(|store| fixture[store].as_array().unwrap().iter().enumerate().map(move |(position,value)|json!({"store":store,"id":value["id"],"position":position,"value":value}))).collect();
    assert_eq!(
        call(
            &app,
            "/library/commit",
            &alice,
            Some(json!({"expectedRevision":0,"patches":patches}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/library", &bob, None).await.1["library"]["notes"],
        json!([])
    );
    assert_eq!(
        call(&app, "/library", &bob, None).await.1["library"]["attempts"],
        json!([])
    );
    assert_eq!(
        call(&app, "/library", &alice, None).await.1["library"]["attempts"][0]["code"],
        "private source code"
    );
    let summary = call(&app, "/library/summary", &alice, None).await;
    assert_eq!(summary.0, StatusCode::OK);
    assert!(summary.1["library"]["attempts"][0].get("code").is_none());
    assert_eq!(call(&app, "/status", "", None).await.1["historyVersion"], 1);
    let one = json!({"mode":"one","id":"attempt","revision":1});
    let body = call(&app, "/library/attempts", &alice, Some(one.clone())).await;
    assert_eq!(body.0, StatusCode::OK);
    assert_eq!(body.1["attempts"][0]["code"], "private source code");
    assert_eq!(
        call(
            &app,
            "/library/attempts",
            &bob,
            Some(json!({"mode":"one","id":"attempt","revision":0}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "/library/attempts",
            &alice,
            Some(json!({"mode":"one","id":"attempt","revision":0}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let batch = call(
        &app,
        "/library/attempts",
        &alice,
        Some(json!({"mode":"batch","offset":0,"revision":1})),
    )
    .await;
    assert_eq!(batch.1["attempts"], body.1["attempts"]);
    assert_eq!(
        call(
            &app,
            "/library/attempts",
            &alice,
            Some(json!({"mode":"batch","offset":-1,"revision":1}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let who = call(&app, "/auth/session", &alice, None).await.1;
    for (path, body) in [("/library/summary", None), ("/library/attempts", Some(one))] {
        let mut request = request(path)
            .header("Authorization", format!("Bearer {bob}"))
            .header("X-Repeaty-User", who["user"]["id"].as_str().unwrap());
        let payload = if let Some(body) = body {
            request = request
                .method("POST")
                .header("Content-Type", "application/json");
            Body::from(body.to_string())
        } else {
            Body::empty()
        };
        assert_eq!(
            app.clone()
                .oneshot(request.body(payload).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
    }
    assert_eq!(
        call(
            &app,
            "/library/commit",
            &bob,
            Some(json!({"expectedRevision":0,"patches":patches}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let user = call(&app, "/auth/session", &alice, None).await.1;
    let id = "11111111-1111-4111-8111-111111111111";
    let response = app
        .clone()
        .oneshot(
            request(&format!("/media/{id}"))
                .method("PUT")
                .header("X-Repeaty-User", user["user"]["id"].as_str().unwrap())
                .header("Authorization", format!("Bearer {alice}"))
                .header("Content-Type", "audio/wav")
                .body(Body::from("RIFFtest-media"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        call(&app, &format!("/media/{id}"), &bob, None).await.0,
        StatusCode::NOT_FOUND
    );
    call(&app, "/backups", &alice, Some(json!({"force":true}))).await;
    let backups = call(&app, "/backups", &alice, None).await.1;
    let id = backups[0]["id"].as_str().unwrap();
    assert_eq!(
        call(&app, &format!("/backups/{id}"), &bob, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "/plugins/leetcode",
            &alice,
            Some(json!({"action":"ping"}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "/auth/password",
            &alice,
            Some(
                json!({"currentPassword":"strong-test-password","password":"new-strong-password"})
            )
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "/library", &alice, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(call(&app, "/library", &bob, None).await.0, StatusCode::OK);
}
#[tokio::test]
async fn browser_login_uses_http_only_cookie_and_rejects_cross_origin_requests() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path());
    for path in ["/library", "/backups", "/media/id"] {
        assert_eq!(call(&app, path, "", None).await.0, StatusCode::UNAUTHORIZED);
    }
    for req in [
        Request::builder()
            .uri("/api/library")
            .header("Host", "127.0.0.1:8080"),
        request("/auth/register").header("Origin", "https://evil.test"),
        Request::builder()
            .uri("/api/library")
            .header("Host", "evil.test")
            .header("X-Repeaty-Client", "1"),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(req.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    let response = app
        .clone()
        .oneshot(
            request("/auth/register")
                .method("POST")
                .header("Content-Type", "application/json")
                .body(Body::from(
                    json!({"username":"browser","password":"strong-test-password"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cookie.contains("HttpOnly; SameSite=Strict"));
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(body.get("token").is_none());
    let response = app
        .clone()
        .oneshot(
            request("/library")
                .header("X-Repeaty-User", body["user"]["id"].as_str().unwrap())
                .header("Cookie", cookie.split(';').next().unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bob = register(&app, "bob").await;
    let response = app
        .oneshot(
            request("/library/commit")
                .method("POST")
                .header("Authorization", format!("Bearer {bob}"))
                .header("X-Repeaty-User", body["user"]["id"].as_str().unwrap())
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{"expectedRevision":0,"patches":[]}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}
#[tokio::test]
async fn closed_registration_and_oversized_credentials_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(
        dir.path().into(),
        "https://example.com".into(),
        "127.0.0.1:8080".into(),
        false,
    )
    .unwrap();
    let app = router(state, "missing".into());
    assert_eq!(
        call(
            &app,
            "/auth/register",
            "",
            Some(json!({"username":"alice","password":"strong-test-password"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "/auth/login",
            "",
            Some(json!({"username":"alice","password":"x".repeat(5000)}))
        )
        .await
        .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
}
