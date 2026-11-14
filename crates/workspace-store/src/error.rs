use std::fmt;
#[derive(Debug)]
pub struct Error(pub &'static str);
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn invalid() -> Self {
        Self("invalid-data")
    }
    pub fn missing() -> Self {
        Self("not-found")
    }
    pub fn conflict() -> Self {
        Self("revision-conflict")
    }
    pub fn internal() -> Self {
        Self("storage-error")
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        if matches!(error, rusqlite::Error::SqliteFailure(ref code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation)
        {
            Self::invalid()
        } else {
            Self::internal()
        }
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::invalid()
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::internal()
    }
}
