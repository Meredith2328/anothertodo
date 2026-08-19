use crate::{
    model::{load_jsonl, tombstone, Task},
    now_iso,
};
use chrono::Utc;
use fs2::FileExt;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

pub struct Store {
    pub dir: PathBuf,
}
struct Lock(File);
impl Lock {
    fn new(path: &Path) -> io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)?;
        file.lock_exclusive()?;
        Ok(Self(file))
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

impl Store {
    pub fn new(dir: Option<PathBuf>) -> io::Result<Self> {
        let dir = dir
            .or_else(|| std::env::var_os("ATD_HOME").map(PathBuf::from))
            .unwrap_or_else(|| home().join(".atd"));
        fs::create_dir_all(&dir)?;
        for name in ["tasks.jsonl", "undo.jsonl"] {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(name))?;
        }
        Ok(Self { dir })
    }
    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }
    fn read(&self, name: &str) -> io::Result<Vec<Value>> {
        let path = self.path(name);
        if !path.exists() {
            return Ok(vec![]);
        }
        Ok(load_jsonl(&fs::read_to_string(path)?))
    }
    fn canonical(objects: Vec<Value>) -> Vec<Value> {
        let mut by_id = BTreeMap::new();
        for object in objects {
            if let Some(id) = object.get("id").and_then(Value::as_str) {
                by_id.insert(id.to_owned(), object);
            }
        }
        by_id.into_values().collect()
    }
    fn atomic_write(&self, name: &str, objects: &[Value]) -> io::Result<()> {
        let destination = self.path(name);
        let temporary = self.path(&format!(".{name}.tmp-{}", std::process::id()));
        let mut file = File::create(&temporary)?;
        for object in objects {
            writeln!(
                file,
                "{}",
                serde_json::to_string(object).map_err(io::Error::other)?
            )?;
        }
        file.sync_all()?;
        fs::rename(&temporary, destination)?;
        Ok(())
    }
    fn append_undo_locked(&self, before: Option<&Task>, after: Option<&Task>) -> io::Result<()> {
        let mut records = self.read("undo.jsonl")?;
        records.push(json!({"before": before, "after": after, "ts": now_iso()}));
        self.atomic_write("undo.jsonl", &records)
    }
    pub fn tasks(&self) -> io::Result<Vec<Task>> {
        Self::canonical(self.read("tasks.jsonl")?)
            .into_iter()
            .filter(|object| {
                !object
                    .get("deleted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .map(serde_json::from_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(io::Error::other)
    }
    pub fn find(&self, prefix: &str) -> io::Result<Task> {
        if prefix.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "ID 前缀不能为空",
            ));
        }
        let matches: Vec<_> = self
            .tasks()?
            .into_iter()
            .filter(|task| task.id.starts_with(prefix))
            .collect();
        match matches.as_slice() {
            [] => Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("找不到任务：{prefix}"),
            )),
            [task] => Ok(task.clone()),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "ID 前缀 {prefix:?} 有歧义：{}",
                    matches
                        .iter()
                        .map(|t| t.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )),
        }
    }
    pub fn save(
        &self,
        mut task: Task,
        before: Option<Task>,
        record_undo: bool,
    ) -> io::Result<Task> {
        let _lock = Lock::new(&self.path(".lock"))?;
        if task.id.is_empty() {
            task.id = crate::model::new_id();
        }
        task.normalize();
        task.modified = now_iso();
        if task.entry.is_empty() {
            task.entry = task.modified.clone();
        }
        let mut objects = Self::canonical(self.read("tasks.jsonl")?);
        objects.retain(|object| object.get("id").and_then(Value::as_str) != Some(&task.id));
        objects.push(serde_json::to_value(&task).map_err(io::Error::other)?);
        self.atomic_write("tasks.jsonl", &Self::canonical(objects))?;
        if record_undo {
            self.append_undo_locked(before.as_ref(), Some(&task))?;
        }
        Ok(task)
    }
    pub fn save_many(&self, tasks: Vec<Task>, _description: &str) -> io::Result<()> {
        let _lock = Lock::new(&self.path(".lock"))?;
        let mut objects = Self::canonical(self.read("tasks.jsonl")?);
        for mut task in tasks {
            task.normalize();
            task.modified = now_iso();
            if task.entry.is_empty() {
                task.entry = task.modified.clone();
            }
            objects.retain(|value| value.get("id").and_then(Value::as_str) != Some(&task.id));
            objects.push(serde_json::to_value(task).map_err(io::Error::other)?);
        }
        self.atomic_write("tasks.jsonl", &Self::canonical(objects))
    }

    pub fn delete_many(&self, prefixes: &[String]) -> io::Result<()> {
        for prefix in prefixes {
            self.delete(prefix)?;
        }
        Ok(())
    }

    pub fn delete(&self, prefix: &str) -> io::Result<Task> {
        let task = self.find(prefix)?;
        let _lock = Lock::new(&self.path(".lock"))?;
        let mut objects = Self::canonical(self.read("tasks.jsonl")?);
        objects.retain(|object| object.get("id").and_then(Value::as_str) != Some(&task.id));
        objects.push(tombstone(&task.id));
        self.atomic_write("tasks.jsonl", &Self::canonical(objects))?;
        self.append_undo_locked(Some(&task), None)?;
        Ok(task)
    }
    pub fn undo(&self) -> io::Result<String> {
        let _lock = Lock::new(&self.path(".lock"))?;
        let mut records = self.read("undo.jsonl")?;
        let record = records
            .pop()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "没有可撤销的操作"))?;
        let before = record.get("before").filter(|v| !v.is_null()).cloned();
        let after = record.get("after").filter(|v| !v.is_null()).cloned();
        let id = after
            .as_ref()
            .or(before.as_ref())
            .and_then(|v| v.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "撤销记录缺少任务 ID"))?
            .to_owned();
        let mut objects = Self::canonical(self.read("tasks.jsonl")?);
        objects.retain(|object| object.get("id").and_then(Value::as_str) != Some(&id));
        let description = match (before, after) {
            (None, Some(after)) => {
                objects.push(tombstone(&id));
                format!(
                    "撤销新增：{}",
                    after.get("title").and_then(Value::as_str).unwrap_or("")
                )
            }
            (Some(mut before), Some(_)) => {
                before["modified"] = Value::String(now_iso());
                let title = before
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                objects.push(before);
                format!("撤销修改：{title}")
            }
            (Some(mut before), None) => {
                before["modified"] = Value::String(now_iso());
                let title = before
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                objects.push(before);
                format!("撤销删除：{title}")
            }
            _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "无效撤销记录")),
        };
        self.atomic_write("tasks.jsonl", &Self::canonical(objects))?;
        self.atomic_write("undo.jsonl", &records)?;
        Ok(description)
    }
    pub fn archive(&self, days: i64) -> io::Result<usize> {
        if days < 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "归档天数不能为负数",
            ));
        }
        let _lock = Lock::new(&self.path(".lock"))?;
        let now = Utc::now();
        let mut keep = vec![];
        let mut moved = vec![];
        for object in Self::canonical(self.read("tasks.jsonl")?) {
            let stale_state = object
                .get("deleted")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || matches!(
                    object.get("status").and_then(Value::as_str),
                    Some("done" | "cancelled")
                );
            let age = object
                .get("modified")
                .and_then(Value::as_str)
                .and_then(crate::parse_datetime)
                .map(|dt| (now - dt).num_days())
                .unwrap_or(i64::MAX);
            if stale_state && age >= days {
                moved.push(object);
            } else {
                keep.push(object);
            }
        }
        if !moved.is_empty() {
            let mut archived = self.read("archive.jsonl")?;
            archived.extend(moved.iter().cloned());
            self.atomic_write("archive.jsonl", &archived)?;
            self.atomic_write("tasks.jsonl", &keep)?;
        }
        Ok(moved.len())
    }
    pub fn archived(&self) -> io::Result<Vec<Value>> {
        self.read("archive.jsonl")
    }
    pub fn restore(&self, prefix: &str) -> io::Result<Task> {
        if prefix.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "ID 前缀不能为空",
            ));
        }
        let _lock = Lock::new(&self.path(".lock"))?;
        let archived = self.read("archive.jsonl")?;
        let ids: Vec<String> = archived
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .filter(|id| id.starts_with(prefix))
            .map(str::to_owned)
            .collect();
        let id = match ids.as_slice() {
            [] => {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("归档里找不到任务 {prefix}"),
                ))
            }
            [id] => id.clone(),
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("前缀 {prefix:?} 匹配多个归档任务：{}", ids.join(", ")),
                ))
            }
        };
        let mut found = None;
        let mut remaining = vec![];
        for object in archived {
            if object.get("id").and_then(Value::as_str) == Some(&id) && found.is_none() {
                found = Some(object);
            } else {
                remaining.push(object);
            }
        }
        let mut restored = found.unwrap();
        if restored
            .get("deleted")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            restored.as_object_mut().unwrap().remove("deleted");
            restored["status"] = Value::String("todo".into());
        }
        restored["modified"] = Value::String(now_iso());
        let task: Task = serde_json::from_value(restored.clone()).map_err(io::Error::other)?;
        let mut active = Self::canonical(self.read("tasks.jsonl")?);
        active.retain(|v| v.get("id").and_then(Value::as_str) != Some(&id));
        active.push(restored);
        self.atomic_write("tasks.jsonl", &Self::canonical(active))?;
        self.atomic_write("archive.jsonl", &remaining)?;
        Ok(task)
    }
}

pub fn collapse(objects: Vec<Value>) -> BTreeMap<String, Value> {
    let mut by_id: BTreeMap<String, Value> = BTreeMap::new();
    for object in objects {
        let Some(id) = object.get("id").and_then(Value::as_str).map(str::to_owned) else {
            continue;
        };
        let replace = match by_id.get(&id) {
            None => true,
            Some(current) => {
                let deleted = object
                    .get("deleted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let current_deleted = current
                    .get("deleted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                deleted && !current_deleted
                    || deleted == current_deleted
                        && object.get("modified").and_then(Value::as_str).unwrap_or("")
                            >= current
                                .get("modified")
                                .and_then(Value::as_str)
                                .unwrap_or("")
            }
        };
        if replace {
            by_id.insert(id, object);
        }
    }
    by_id
}

pub fn atomic_write_path(path: &Path, data: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        crate::model::new_id()
    ));
    let mut file = File::create(&temporary)?;
    file.write_all(data)?;
    file.sync_all()?;
    fs::rename(temporary, path)
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(Some(dir.path().to_owned())).unwrap();
        (dir, store)
    }
    #[test]
    fn save_canonicalizes_and_undoes_add_edit_delete() {
        let (_dir, store) = store();
        let original = store
            .save(
                Task {
                    id: "abcdef12".into(),
                    title: "one".into(),
                    ..Task::default()
                },
                None,
                true,
            )
            .unwrap();
        let mut edited = original.clone();
        edited.title = "two".into();
        store.save(edited, Some(original.clone()), true).unwrap();
        assert_eq!(store.tasks().unwrap()[0].title, "two");
        assert!(store.undo().unwrap().contains("修改"));
        assert_eq!(store.tasks().unwrap()[0].title, "one");
        store.delete("abc").unwrap();
        assert!(store.tasks().unwrap().is_empty());
        assert!(store.undo().unwrap().contains("删除"));
        assert_eq!(store.tasks().unwrap()[0].title, "one");
        assert!(store.undo().unwrap().contains("新增"));
        assert!(store.tasks().unwrap().is_empty());
        let objects = store.read("tasks.jsonl").unwrap();
        assert_eq!(objects.iter().filter(|v| v["id"] == "abcdef12").count(), 1);
    }
    #[test]
    fn restore_requires_unique_prefix_and_removes_archive_record() {
        let (_dir, store) = store();
        let old = "2000-01-01T00:00:00Z";
        store
            .atomic_write(
                "archive.jsonl",
                &[
                    json!({"id":"abc11111","title":"a","status":"done","entry":old,"modified":old}),
                    json!({"id":"abc22222","title":"b","status":"done","entry":old,"modified":old}),
                ],
            )
            .unwrap();
        assert_eq!(
            store.restore("abc").unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
        assert_eq!(store.restore("abc1").unwrap().id, "abc11111");
        assert_eq!(store.archived().unwrap().len(), 1);
    }
}
