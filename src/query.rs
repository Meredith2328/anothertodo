use crate::{model::Task, parse::scan_date};
use chrono::{Datelike, Duration, NaiveDate, Utc};

#[derive(Debug, Clone, PartialEq)]
enum DateValue {
    Date(NaiveDate),
    Range(NaiveDate, NaiveDate),
    Invalid,
}

fn date_value(raw: &str, today: NaiveDate) -> DateValue {
    match raw {
        "today" => DateValue::Date(today),
        "tomorrow" => DateValue::Date(today + Duration::days(1)),
        "yesterday" => DateValue::Date(today - Duration::days(1)),
        "week" | "thisweek" => {
            let start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
            DateValue::Range(start, start + Duration::days(6))
        }
        _ => scan_date(raw, today)
            .map(DateValue::Date)
            .unwrap_or(DateValue::Invalid),
    }
}

fn keyword(task: &Task, needle: &str) -> bool {
    let needle = needle.to_lowercase();
    task.title.to_lowercase().contains(&needle)
        || task
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(&needle))
}

pub fn filter_at(
    tasks: &[Task],
    query: &str,
    today: NaiveDate,
    levels: &[String],
) -> Result<Vec<Task>, String> {
    let mut out = Vec::new();
    'task: for task in tasks {
        for token in query.split_whitespace() {
            let ok = if token == "overdue" {
                task.overdue(today)
            } else if let Some(tag) = token.strip_prefix('+') {
                task.tags.iter().any(|value| value == tag)
            } else if let Some(value) = token.strip_prefix('-') {
                if levels.iter().any(|level| level == value) {
                    task.priority.as_deref() != Some(value)
                } else {
                    !task.tags.iter().any(|tag| tag == value)
                }
            } else if let Some(value) = token.strip_prefix('/') {
                keyword(task, value)
            } else if let Some((key, value)) = token.split_once(':') {
                match key.to_ascii_lowercase().as_str() {
                    "status" | "st" => task.status == value.to_ascii_lowercase(),
                    "project" | "proj" => task.project.as_deref() == Some(value),
                    "priority" => task.priority.as_deref() == Some(value),
                    "wait" => match date_value(value, today) {
                        DateValue::Date(date) => task.wait == Some(date),
                        DateValue::Range(start, end) => {
                            task.wait.is_some_and(|date| start <= date && date <= end)
                        }
                        DateValue::Invalid => task.wait.is_none(),
                    },
                    "due" => {
                        let (comparison, raw) = value
                            .strip_prefix("before:")
                            .map(|v| ("before", v))
                            .or_else(|| value.strip_prefix("after:").map(|v| ("after", v)))
                            .unwrap_or(("exact", value));
                        match (task.due.map(|due| due.date_naive()), date_value(raw, today)) {
                            (Some(date), DateValue::Date(limit)) if comparison == "before" => {
                                date < limit
                            }
                            (Some(date), DateValue::Date(limit)) if comparison == "after" => {
                                date > limit
                            }
                            (Some(date), DateValue::Date(limit)) => date == limit,
                            (Some(date), DateValue::Range(start, end)) => {
                                start <= date && date <= end
                            }
                            _ => false,
                        }
                    }
                    other => return Err(format!("不认识的过滤器：{other}")),
                }
            } else {
                keyword(task, token)
            };
            if !ok {
                continue 'task;
            }
        }
        out.push(task.clone());
    }
    Ok(out)
}

pub fn filter(tasks: &[Task], query: &str) -> Vec<Task> {
    filter_at(
        tasks,
        query,
        Utc::now().date_naive(),
        &crate::priority::levels(),
    )
    .unwrap_or_default()
}
