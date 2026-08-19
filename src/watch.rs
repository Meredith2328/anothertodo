use crate::{model::Task, storage::Store};
use notify_rust::Notification;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

pub fn once(store: &Store) -> io::Result<usize> {
    let now = chrono::Utc::now();
    let mut changed = Vec::new();
    let mut fired = 0;
    for mut task in store.tasks()? {
        if !task.is_active() {
            continue;
        }
        let mut dirty = false;
        let dispatch_task = task.clone();
        for reminder in &mut task.reminders {
            if !reminder.fired && crate::parse_datetime(&reminder.at).is_some_and(|at| at <= now) {
                reminder.attempts += 1;
                reminder.fired = true;
                match dispatch(store, &dispatch_task, reminder) {
                    Ok(()) => {
                        reminder.last_error = None;
                        fired += 1
                    }
                    Err(error) => reminder.last_error = Some(error.to_string()),
                }
                dirty = true;
            }
        }
        if dirty {
            changed.push(task)
        }
    }
    if !changed.is_empty() {
        store.save_many(changed, "fire reminders")?;
    }
    Ok(fired)
}
fn dispatch(store: &Store, task: &Task, reminder: &crate::model::Reminder) -> io::Result<()> {
    for hook in &reminder.hooks {
        match hook.as_str() {
            "toast" => {
                Notification::new()
                    .summary("atd 提醒")
                    .body(&task.title)
                    .show()
                    .map_err(io::Error::other)?;
            }
            "email" => email(&task.title)?,
            "stdout" => println!("提醒：{}", task.title),
            custom => dispatch_executable(store, custom, task, reminder)?,
        }
    }
    Ok(())
}
fn dispatch_executable(
    store: &Store,
    name: &str,
    task: &Task,
    reminder: &crate::model::Reminder,
) -> io::Result<()> {
    let hook = discover_hooks(&store.dir)?
        .into_iter()
        .find(|(hook_name, _)| hook_name == name)
        .map(|(_, path)| path)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("未知提醒 hook：{name}"),
            )
        })?;
    let payload = serde_json::to_vec(&serde_json::json!({"task": task, "reminder": reminder}))
        .map_err(io::Error::other)?;
    let mut child = Command::new(hook)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "hook stdin 不可用"))?
        .write_all(&payload)?;
    let output = child.wait_with_output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "hook {name} 失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}
pub fn hook_names(store: &Store) -> io::Result<Vec<String>> {
    let mut names = vec!["toast".into(), "email".into(), "stdout".into()];
    names.extend(
        discover_hooks(&store.dir)?
            .into_iter()
            .map(|(name, _)| name),
    );
    names.sort();
    names.dedup();
    Ok(names)
}
fn discover_hooks(home: &Path) -> io::Result<Vec<(String, PathBuf)>> {
    let dir = home.join("hooks");
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut hooks = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        if !metadata.is_file() || path.extension().is_some_and(|extension| extension == "py") {
            continue;
        }
        #[cfg(unix)]
        if metadata.permissions().mode() & 0o111 == 0 {
            continue;
        }
        #[cfg(not(unix))]
        if path.extension().is_none() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            hooks.push((name.to_owned(), path));
        }
    }
    hooks.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(hooks)
}
fn email(title: &str) -> io::Result<()> {
    let status=Command::new("sh").args(["-c","command -v sendmail >/dev/null && printf 'Subject: atd reminder\\n\\n%s\\n' \"$1\" | sendmail -t", "atd",title]).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other("sendmail 不可用"))
    }
}
pub fn run(store: Store) -> io::Result<()> {
    loop {
        if let Err(error) = once(&store) {
            eprintln!("watch: {error}");
        }
        let interval = crate::config::load(&store.dir)
            .get("watch")
            .and_then(|value| value.get("interval_seconds"))
            .and_then(toml::Value::as_integer)
            .unwrap_or(30)
            .max(1) as u64;
        thread::sleep(Duration::from_secs(interval));
    }
}
pub fn install(uninstall: bool) -> String {
    if uninstall {
        "请从系统服务管理器移除 atd watch".into()
    } else if cfg!(target_os = "linux") {
        "请创建 systemd 用户服务运行 `atd watch`".into()
    } else if cfg!(target_os = "macos") {
        "请创建 launchd agent 运行 `atd watch`".into()
    } else {
        "请使用系统任务计划运行 `atd watch`".into()
    }
}
pub fn snooze(store: &Store, key: &str, when: &str) -> io::Result<Task> {
    let mut task = store.find(key)?;
    let before = task.clone();
    let now = chrono::Utc::now();
    let at = parse_snooze_time(when, now)?;
    let reminder = task
        .reminders
        .iter_mut()
        .rev()
        .find(|reminder| !reminder.fired)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "没有未触发的待处理提醒"))?;
    reminder.at = at.to_rfc3339();
    reminder.last_error = None;
    store.save(task, Some(before), true)
}
fn parse_snooze_time(
    when: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> io::Result<chrono::DateTime<chrono::Utc>> {
    let raw = when.trim();
    let split = raw
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(raw.len());
    let (amount, unit) = raw.split_at(split);
    if !amount.is_empty() && matches!(unit, "" | "m" | "h") {
        let amount: i64 = amount
            .parse()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "无效的稍后提醒时长"))?;
        let delta = if unit == "h" {
            chrono::Duration::hours(amount)
        } else {
            chrono::Duration::minutes(amount)
        };
        return Ok(now + delta);
    }
    let parsed = crate::parse::parse(raw, now, &crate::priority::levels());
    parsed
        .due
        .or_else(|| {
            parsed
                .reminders
                .first()
                .and_then(|reminder| crate::parse_datetime(&reminder.at))
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "无法解析稍后提醒时间"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn snooze_durations_accept_bare_minutes_minutes_and_hours() {
        let now = chrono::Utc.with_ymd_and_hms(2026, 8, 19, 8, 0, 0).unwrap();
        assert_eq!(
            (parse_snooze_time("30", now).unwrap() - now).num_minutes(),
            30
        );
        assert_eq!(
            (parse_snooze_time("10m", now).unwrap() - now).num_minutes(),
            10
        );
        assert_eq!(
            (parse_snooze_time("1h", now).unwrap() - now).num_minutes(),
            60
        );
    }

    #[test]
    fn snooze_updates_last_unfired_reminder_and_errors_without_one() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(Some(dir.path().to_path_buf())).unwrap();
        let task = Task {
            title: "test".into(),
            reminders: vec![
                crate::model::Reminder {
                    at: "2026-01-01T00:00:00Z".into(),
                    fired: false,
                    ..Default::default()
                },
                crate::model::Reminder {
                    at: "2026-01-02T00:00:00Z".into(),
                    fired: false,
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let task = store.save(task, None, true).unwrap();
        let updated = snooze(&store, &task.id, "10m").unwrap();
        assert_eq!(updated.reminders[0].at, "2026-01-01T00:00:00Z");
        assert_ne!(updated.reminders[1].at, "2026-01-02T00:00:00Z");
        let mut fired = updated;
        fired
            .reminders
            .iter_mut()
            .for_each(|reminder| reminder.fired = true);
        store.save(fired, None, true).unwrap();
        assert_eq!(
            snooze(&store, &task.id, "30").unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }
}
