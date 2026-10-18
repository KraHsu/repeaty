use crate::{
    api::AppState,
    error::{Error, Result},
};
use axum::{Json, extract::State, http::StatusCode};
use reqwest::{Client, redirect::Policy};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Credentials {
    pub session: String,
    pub csrf: String,
}
pub struct LeetCode {
    client: Client,
    credentials: HashMap<String, Credentials>,
    submit_lock: Arc<Mutex<()>>,
    #[cfg(test)]
    test_origin: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
pub enum Request {
    Ping,
    Question {
        site: String,
        slug: String,
    },
    Submit {
        site: String,
        slug: String,
        #[serde(rename = "questionId")]
        question_id: String,
        lang: String,
        code: String,
    },
    Check {
        site: String,
        #[serde(rename = "submissionId")]
        submission_id: String,
    },
}
impl LeetCode {
    pub fn new(
        credentials: HashMap<String, Credentials>,
    ) -> std::result::Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(Policy::none())
                .user_agent("Mozilla/5.0 Repeaty/0.6")
                .build()?,
            credentials,
            submit_lock: Arc::new(Mutex::new(())),
            #[cfg(test)]
            test_origin: None,
        })
    }
    pub fn configured(&self) -> Vec<String> {
        self.credentials.keys().cloned().collect()
    }
    pub fn from_env() -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let mut credentials = HashMap::new();
        for (site, prefix) in [
            ("leetcode.cn", "LEETCODE_CN"),
            ("leetcode.com", "LEETCODE_COM"),
        ] {
            match (
                std::env::var(format!("{prefix}_SESSION")).ok(),
                std::env::var(format!("{prefix}_CSRF")).ok(),
            ) {
                (Some(session), Some(csrf)) if valid_cookie(&session) && valid_cookie(&csrf) => {
                    credentials.insert(site.to_string(), Credentials { session, csrf });
                }
                (None, None) => {}
                _ => {
                    return Err(format!(
                        "Set both {prefix}_SESSION and {prefix}_CSRF to valid cookie values"
                    )
                    .into());
                }
            }
        }
        Ok(Self::new(credentials)?)
    }
    pub async fn request(&self, request: Request) -> Result<Value> {
        if matches!(request, Request::Ping) {
            return Ok(json!({"version":1,"configured":self.configured()}));
        }
        let (site, path, body, submit) = request_parts(&request)?;
        let credentials = self.credentials.get(site);
        if submit && credentials.is_none() {
            return Err(Error(
                StatusCode::PRECONDITION_FAILED,
                "leetcode-not-configured",
            ));
        }
        let _guard = if submit {
            Some(
                self.submit_lock
                    .clone()
                    .try_lock_owned()
                    .map_err(|_| Error(StatusCode::CONFLICT, "submission-busy"))?,
            )
        } else {
            None
        };
        let origin = format!("https://{site}");
        #[cfg(test)]
        let origin = self.test_origin.clone().unwrap_or(origin);
        let url = format!("{origin}{path}");
        let mut operation = if let Some(body) = body {
            self.client.post(url).json(&body)
        } else {
            self.client.get(url)
        };
        operation = operation.header("Referer", format!("https://{site}/"));
        if let Some(credentials) = credentials {
            operation = operation
                .header(
                    "Cookie",
                    format!(
                        "LEETCODE_SESSION={}; csrftoken={}",
                        credentials.session, credentials.csrf
                    ),
                )
                .header("X-CSRFToken", &credentials.csrf);
        }
        let response = operation.send().await.map_err(|_| {
            Error(
                StatusCode::BAD_GATEWAY,
                if submit {
                    "submission-unknown"
                } else {
                    "request-failed"
                },
            )
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(Error(
                StatusCode::BAD_GATEWAY,
                match status.as_u16() {
                    401 | 403 => "login-required",
                    429 => "rate-limit",
                    _ if submit => "submission-unknown",
                    _ => "request-failed",
                },
            ));
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            Error(
                StatusCode::BAD_GATEWAY,
                if submit {
                    "submission-unknown"
                } else {
                    "request-failed"
                },
            )
        })? {
            if bytes.len() + chunk.len() > 1_000_000 {
                return Err(Error(
                    StatusCode::BAD_GATEWAY,
                    if submit {
                        "submission-unknown"
                    } else {
                        "invalid-response"
                    },
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
            Error(
                StatusCode::BAD_GATEWAY,
                if submit {
                    "submission-unknown"
                } else {
                    "invalid-response"
                },
            )
        })?;
        if !value["errors"].is_null() || !value["error"].is_null() {
            return Err(Error(
                StatusCode::BAD_GATEWAY,
                if submit {
                    "submission-unknown"
                } else {
                    "request-failed"
                },
            ));
        }
        Ok(value)
    }
}
fn valid_cookie(s: &str) -> bool {
    !s.is_empty() && s.len() <= 8192 && s.bytes().all(|b| b.is_ascii_graphic() && b != b';')
}
fn slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 160
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn number(s: &str) -> bool {
    !s.is_empty() && s.len() <= 30 && s.bytes().all(|b| b.is_ascii_digit())
}
fn request_parts(request: &Request) -> Result<(&str, String, Option<Value>, bool)> {
    let site = match request {
        Request::Question { site, .. }
        | Request::Submit { site, .. }
        | Request::Check { site, .. } => site.as_str(),
        Request::Ping => return Err(Error::invalid()),
    };
    if site != "leetcode.cn" && site != "leetcode.com" {
        return Err(Error::invalid());
    }
    match request {
        Request::Question { slug: name, .. } if slug(name) => {
            let translated = if site == "leetcode.cn" {
                "translatedTitle translatedContent"
            } else {
                ""
            };
            Ok((
                site,
                "/graphql/".into(),
                Some(
                    json!({"query":format!("query RepeatyQuestion($slug: String!) {{ question(titleSlug: $slug) {{ questionId questionFrontendId title titleSlug content {translated} difficulty isPaidOnly codeSnippets {{ lang langSlug code }} }} }}"),"variables":{"slug":name}}),
                ),
                false,
            ))
        }
        Request::Submit {
            slug: name,
            question_id,
            lang,
            code,
            ..
        } if slug(name)
            && number(question_id)
            && !lang.is_empty()
            && lang.len() <= 40
            && lang.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            && !code.trim().is_empty()
            && code.len() <= 200_000 =>
        {
            Ok((
                site,
                format!("/problems/{name}/submit/"),
                Some(json!({"lang":lang,"question_id":question_id,"typed_code":code})),
                true,
            ))
        }
        Request::Check { submission_id, .. } if number(submission_id) => Ok((
            site,
            format!("/submissions/detail/{submission_id}/check/"),
            None,
            false,
        )),
        _ => Err(Error::invalid()),
    }
}
pub async fn handle(
    State(state): State<AppState>,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    Ok(Json(state.leetcode.request(request).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        http::HeaderMap,
        routing::{get, post},
    };
    fn submission() -> Request {
        Request::Submit {
            site: "leetcode.cn".into(),
            slug: "two-sum".into(),
            question_id: "1".into(),
            lang: "python3".into(),
            code: "return 1".into(),
        }
    }
    async fn mock(routes: Router) -> (LeetCode, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, routes).await.unwrap() });
        let mut client = LeetCode::new(HashMap::from([(
            "leetcode.cn".into(),
            Credentials {
                session: "test-session".into(),
                csrf: "test-csrf".into(),
            },
        )]))
        .unwrap();
        client.test_origin = Some(origin);
        (client, task)
    }
    #[test]
    fn validates_sites_operations_and_cookie_values() {
        for site in ["evil.test", "leetcode.cn.evil.test", "http://127.0.0.1"] {
            assert!(
                request_parts(&Request::Question {
                    site: site.into(),
                    slug: "two-sum".into()
                })
                .is_err()
            );
        }
        assert!(
            request_parts(&Request::Question {
                site: "leetcode.cn".into(),
                slug: "../admin".into()
            })
            .is_err()
        );
        assert!(
            request_parts(&Request::Check {
                site: "leetcode.cn".into(),
                submission_id: "../../private".into()
            })
            .is_err()
        );
        assert!(!valid_cookie("value; injected=1"));
        assert!(!valid_cookie("value\r\nHeader: secret"));
        assert!(request_parts(&submission()).is_ok());
    }
    #[tokio::test]
    async fn forwards_only_fixed_operations_and_keeps_credentials_server_side() {
        let (client, task) = mock(
            Router::new()
                .route(
                    "/graphql/",
                    post(|Json(value): Json<Value>| async move {
                        assert_eq!(value["variables"]["slug"], "two-sum");
                        assert!(value["query"].as_str().unwrap().contains("translatedTitle"));
                        Json(json!({"data":{"question":{"questionId":"1"}}}))
                    }),
                )
                .route(
                    "/problems/two-sum/submit/",
                    post(|headers: HeaderMap, Json(value): Json<Value>| async move {
                        assert_eq!(headers["x-csrftoken"], "test-csrf");
                        assert_eq!(
                            headers["cookie"],
                            "LEETCODE_SESSION=test-session; csrftoken=test-csrf"
                        );
                        assert_eq!(value["typed_code"], "return 1");
                        Json(json!({"submission_id":123}))
                    }),
                )
                .route(
                    "/submissions/detail/123/check/",
                    get(|| async { Json(json!({"state":"SUCCESS","status_code":10})) }),
                ),
        )
        .await;
        assert_eq!(
            client
                .request(Request::Question {
                    site: "leetcode.cn".into(),
                    slug: "two-sum".into()
                })
                .await
                .unwrap()["data"]["question"]["questionId"],
            "1"
        );
        let (first, second) =
            tokio::join!(client.request(submission()), client.request(submission()));
        assert_eq!(first.unwrap()["submission_id"], 123);
        assert_eq!(second.unwrap_err().1, "submission-busy");
        assert_eq!(
            client
                .request(Request::Check {
                    site: "leetcode.cn".into(),
                    submission_id: "123".into()
                })
                .await
                .unwrap()["status_code"],
            10
        );
        let status = client.request(Request::Ping).await.unwrap().to_string();
        assert!(!status.contains("test-session"));
        assert!(!status.contains("test-csrf"));
        task.abort();
    }
    #[tokio::test]
    async fn distinguishes_configuration_authentication_and_uncertain_submissions() {
        assert_eq!(
            LeetCode::new(HashMap::new())
                .unwrap()
                .request(submission())
                .await
                .unwrap_err()
                .1,
            "leetcode-not-configured"
        );
        for (status, expected) in [
            (StatusCode::FORBIDDEN, "login-required"),
            (StatusCode::TOO_MANY_REQUESTS, "rate-limit"),
            (StatusCode::BAD_GATEWAY, "submission-unknown"),
            (StatusCode::OK, "submission-unknown"),
        ] {
            let (client, task) = mock(Router::new().route(
                "/problems/two-sum/submit/",
                post(move || async move { (status, "not JSON") }),
            ))
            .await;
            assert_eq!(client.request(submission()).await.unwrap_err().1, expected);
            task.abort();
        }
    }
}
