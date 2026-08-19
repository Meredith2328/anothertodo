pub mod config;
pub mod model;
pub mod parse;
pub mod priority;
pub mod query;
pub mod storage;
pub mod sync;
pub mod tui;
pub mod watch;

use chrono::{DateTime, Utc};
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}
