use crate::model::Task;
use chrono::{Timelike, Utc};
use std::cmp::Ordering;

pub fn levels() -> Vec<String> {
    vec!["低".into(), "中".into(), "高".into()]
}
pub fn sort_tasks(mut tasks: Vec<Task>, mode: &str) -> Vec<Task> {
    let levels = levels();
    tasks.sort_by(|a, b| compare(a, b, mode, &levels));
    tasks
}
fn compare(a: &Task, b: &Task, mode: &str, levels: &[String]) -> Ordering {
    let today = Utc::now().date_naive();
    let bucket = |t: &Task| match t.due.map(|d| d.date_naive()) {
        Some(_) if t.overdue(today) => 0,
        Some(d) if d == today => 1,
        Some(_) => 2,
        None => 3,
    };
    let rank = |t: &Task| {
        levels
            .iter()
            .position(|x| Some(x) == t.priority.as_ref())
            .unwrap_or(0)
    };
    if mode == "urgency" {
        urgency(b)
            .partial_cmp(&urgency(a))
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    } else {
        bucket(a)
            .cmp(&bucket(b))
            .then_with(|| rank(b).cmp(&rank(a)))
            .then_with(|| {
                a.due
                    .map(|d| d.num_seconds_from_midnight())
                    .cmp(&b.due.map(|d| d.num_seconds_from_midnight()))
            })
            .then_with(|| a.id.cmp(&b.id))
    }
}
pub fn urgency(t: &Task) -> f64 {
    let today = Utc::now().date_naive();
    let due = match t.due.map(|d| d.date_naive()) {
        Some(d) if d < today => 12.,
        Some(d) if d == today => 8.,
        Some(d) => 1.0 / (1.0 + (d - today).num_days().max(0) as f64),
        None => 0.,
    };
    due + levels()
        .iter()
        .position(|x| Some(x) == t.priority.as_ref())
        .unwrap_or(0) as f64
        * 3.
}
