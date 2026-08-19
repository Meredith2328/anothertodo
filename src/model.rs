use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use uuid::Uuid;

pub const ACTIVE: &[&str] = &["todo", "waiting", "meeting"];

fn is_false(value: &bool) -> bool {
    !*value
}
fn is_zero(value: &u32) -> bool {
    *value == 0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Reminder {
    pub at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hooks: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub fired: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

fn deserialize_due<'de, D>(deserializer: D) -> Result<Option<DateTime<Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    value
        .map(|raw| {
            parse_iso_datetime(&raw)
                .ok_or_else(|| D::Error::custom(format!("invalid ISO datetime: {raw}")))
        })
        .transpose()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Task {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_due"
    )]
    pub due: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reminders: Vec<Reminder>,
    #[serde(default)]
    pub entry: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
}

fn default_status() -> String {
    "todo".into()
}

impl Default for Task {
    fn default() -> Self {
        Self {
            id: new_id(),
            title: String::new(),
            status: default_status(),
            due: None,
            priority: None,
            tags: vec![],
            project: None,
            parent: None,
            wait: None,
            notes: String::new(),
            reminders: vec![],
            entry: String::new(),
            modified: String::new(),
            end: None,
        }
    }
}

impl Task {
    pub fn overdue(&self, today: NaiveDate) -> bool {
        self.status == "todo" && self.due.is_some_and(|due| due.date_naive() < today)
    }

    pub fn hidden_by_wait(&self, today: NaiveDate) -> bool {
        self.wait.is_some_and(|wait| wait > today)
    }

    pub fn is_active(&self) -> bool {
        ACTIVE.contains(&self.status.as_str())
    }

    pub fn normalize(&mut self) {
        self.title = self.title.trim().to_owned();
        self.tags.sort();
        self.tags.dedup();
        if self
            .reminders
            .iter()
            .any(|reminder| reminder.hooks.is_empty())
        {
            for reminder in &mut self.reminders {
                if reminder.hooks.is_empty() {
                    reminder.hooks.push("toast".into());
                }
            }
        }
    }
}

pub fn parse_iso_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f%:z")
                .map(|dt| dt.with_timezone(&Utc))
        })
        .ok()
        .or_else(|| {
            [
                "%Y-%m-%dT%H:%M:%S%.f",
                "%Y-%m-%d %H:%M:%S%.f",
                "%Y-%m-%dT%H:%M",
                "%Y-%m-%d %H:%M",
            ]
            .iter()
            .find_map(|format| NaiveDateTime::parse_from_str(value, format).ok())
            .map(|dt| dt.and_utc())
        })
}

pub fn new_id() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_string()
}

pub fn tombstone(id: &str) -> serde_json::Value {
    serde_json::json!({"id": id, "deleted": true, "modified": crate::now_iso()})
}

pub fn load_jsonl(text: &str) -> Vec<serde_json::Value> {
    text.lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("<<<<<<<")
                && !line.starts_with("=======")
                && !line.starts_with(">>>>>>>")
        })
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omits_python_default_fields() {
        let task = Task {
            id: "abc12345".into(),
            entry: "2026-08-19T10:00:00+00:00".into(),
            modified: "2026-08-19T10:00:00+00:00".into(),
            ..Task::default()
        };
        let value = serde_json::to_value(task).unwrap();
        assert_eq!(value["status"], "todo");
        for key in [
            "due",
            "priority",
            "tags",
            "project",
            "parent",
            "wait",
            "notes",
            "reminders",
            "end",
        ] {
            assert!(value.get(key).is_none(), "{key} should be omitted");
        }
    }

    #[test]
    fn accepts_naive_and_offset_due_datetimes() {
        let naive: Task =
            serde_json::from_str(r#"{"id":"a","due":"2026-08-19T12:30:00"}"#).unwrap();
        let offset: Task =
            serde_json::from_str(r#"{"id":"b","due":"2026-08-19T12:30:00+08:00"}"#).unwrap();
        assert_eq!(naive.due.unwrap().hour(), 12);
        assert_eq!(offset.due.unwrap().hour(), 4);
    }

    use chrono::Timelike;
}
