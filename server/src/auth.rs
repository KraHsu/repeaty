use crate::error::{Error, Result};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::http::StatusCode;
use rand_core::{OsRng, RngCore};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, Instant},
};

const SESSION_SECONDS: i64 = 7 * 24 * 60 * 60;
#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub id: String,
    pub username: String,
}
pub struct AuthStore {
    connection: Connection,
    attempts: HashMap<String, (Instant, u32)>,
    global_attempts: (Instant, u32),
    dummy_hash: String,
}
fn unauthorized() -> Error {
    Error(StatusCode::UNAUTHORIZED, "unauthorized")
}
fn password_hash(password: &str) -> Result<String> {
    if !(12..=128).contains(&password.len()) {
        return Err(Error(StatusCode::BAD_REQUEST, "invalid-password"));
    }
    Argon2::default()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|value| value.to_string())
        .map_err(|_| Error::internal())
}
fn verify(password: &str, hash: &str) -> bool {
    password.len() <= 128
        && PasswordHash::new(hash).ok().is_some_and(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok()
        })
}
fn username(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(Error(StatusCode::BAD_REQUEST, "invalid-username"));
    }
    Ok(value)
}
fn digest(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
pub fn private_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
impl AuthStore {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);")?;
        Ok(Self {
            connection,
            attempts: HashMap::new(),
            global_attempts: (Instant::now(), 0),
            dummy_hash: password_hash("unused-dummy-password")?,
        })
    }
    pub fn throttle(&mut self, name: &str) -> Result<()> {
        // Bound both memory and expensive password operations, including unknown users.
        let window = Duration::from_secs(60);
        self.attempts.retain(|_, (time, _)| time.elapsed() < window);
        if self.global_attempts.0.elapsed() >= window {
            self.global_attempts = (Instant::now(), 0);
        }
        self.global_attempts.1 += 1;
        if self.global_attempts.1 > 60 {
            return Err(Error(StatusCode::TOO_MANY_REQUESTS, "rate-limit"));
        }
        let entry = self
            .attempts
            .entry(name.trim().to_ascii_lowercase())
            .or_insert((Instant::now(), 0));
        entry.1 += 1;
        if entry.1 > 10 {
            return Err(Error(StatusCode::TOO_MANY_REQUESTS, "rate-limit"));
        }
        Ok(())
    }
    pub fn create(&mut self, name: &str, password: &str) -> Result<User> {
        let name = username(name)?;
        let hash = password_hash(password)?;
        let user = User {
            id: uuid::Uuid::new_v4().to_string(),
            username: name,
        };
        if self.find(&user.username)?.is_some() {
            return Err(Error(StatusCode::CONFLICT, "username-unavailable"));
        }
        self.connection.execute(
            "INSERT INTO users VALUES (?1,?2,?3)",
            params![user.id, user.username, hash],
        )?;
        Ok(user)
    }
    pub fn find(&self, name: &str) -> Result<Option<User>> {
        Ok(self
            .connection
            .query_row(
                "SELECT id,username FROM users WHERE username=?1",
                [username(name)?],
                |row| {
                    Ok(User {
                        id: row.get(0)?,
                        username: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }
    pub fn login(&mut self, name: &str, password: &str) -> Result<User> {
        let name = username(name).map_err(|_| unauthorized())?;
        let stored = self
            .connection
            .query_row(
                "SELECT id,username,password_hash FROM users WHERE username=?1",
                [name],
                |row| {
                    Ok((
                        User {
                            id: row.get(0)?,
                            username: row.get(1)?,
                        },
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let hash = stored
            .as_ref()
            .map(|(_, hash)| hash)
            .unwrap_or(&self.dummy_hash);
        let valid = verify(password, hash);
        match stored {
            Some((user, _)) if valid => Ok(user),
            _ => Err(unauthorized()),
        }
    }
    pub fn issue(&mut self, user: &User) -> Result<String> {
        let mut bytes = [0; 32];
        OsRng.fill_bytes(&mut bytes);
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let now = chrono::Utc::now().timestamp();
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM sessions WHERE expires<=?1", [now])?;
        // Keep at most 20 concurrent sessions per account.
        tx.execute("DELETE FROM sessions WHERE user_id=?1 AND hash NOT IN (SELECT hash FROM sessions WHERE user_id=?1 ORDER BY expires DESC LIMIT 19)",[&user.id])?;
        tx.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3)",
            params![digest(&token), user.id, now + SESSION_SECONDS],
        )?;
        tx.commit()?;
        Ok(token)
    }
    pub fn authenticate(&self, token: &str) -> Result<User> {
        if token.len() != 64 {
            return Err(unauthorized());
        }
        self.connection.query_row("SELECT users.id,username FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=?1 AND expires>?2",params![digest(token),chrono::Utc::now().timestamp()], |row| Ok(User {id:row.get(0)?,username:row.get(1)?})).optional()?.ok_or_else(unauthorized)
    }
    pub fn logout(&self, token: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM sessions WHERE hash=?1", [digest(token)])?;
        Ok(())
    }
    pub fn reset_password(&mut self, user: &User, password: &str) -> Result<()> {
        let hash = password_hash(password)?;
        let tx = self.connection.transaction()?;
        tx.execute(
            "UPDATE users SET password_hash=?1 WHERE id=?2",
            params![hash, user.id],
        )?;
        tx.execute("DELETE FROM sessions WHERE user_id=?1", [&user.id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn change_password(&mut self, user: &User, current: &str, password: &str) -> Result<()> {
        self.login(&user.username, current)?;
        self.reset_password(user, password)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hashed_sessions_expire_and_password_changes_revoke_every_device() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("accounts.sqlite3");
        let mut auth = AuthStore::open(&path).unwrap();
        let user = auth.create("Alice", "a-strong-test-password").unwrap();
        assert!(auth.create("ALICE", "a-strong-test-password").is_err());
        let token = auth.issue(&user).unwrap();
        assert_eq!(auth.authenticate(&token).unwrap().username, "alice");
        assert_eq!(
            auth.connection
                .query_row("SELECT hash FROM sessions", [], |r| r.get::<_, String>(0))
                .unwrap(),
            digest(&token)
        );
        drop(auth);
        let mut auth = AuthStore::open(&path).unwrap();
        assert!(auth.authenticate(&token).is_ok());
        auth.change_password(&user, "a-strong-test-password", "another-strong-password")
            .unwrap();
        assert!(auth.authenticate(&token).is_err());
        assert!(auth.login("alice", "a-strong-test-password").is_err());
        assert!(auth.login("alice", "another-strong-password").is_ok());
        let token = auth.issue(&user).unwrap();
        auth.connection
            .execute("UPDATE sessions SET expires=0", [])
            .unwrap();
        assert!(auth.authenticate(&token).is_err());
    }
    #[test]
    fn bounds_guessing_and_rejects_weak_passwords_and_path_names() {
        let mut auth = AuthStore::open(Path::new(":memory:")).unwrap();
        for name in ["../user", "ab", "<script>"] {
            assert!(auth.create(name, "a-strong-test-password").is_err());
        }
        assert!(auth.create("alice", "short").is_err());
        for _ in 0..10 {
            auth.throttle("alice").unwrap();
        }
        assert_eq!(
            auth.throttle("ALICE").unwrap_err().0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }
}
