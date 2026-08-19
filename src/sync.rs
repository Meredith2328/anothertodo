use crate::{
    model::{load_jsonl, Task},
    storage::{collapse, Store},
};
use serde_json::Value;
use std::{
    fs, io,
    path::Path,
    process::{Command, Output},
};

pub fn sync(store: &Store) -> io::Result<String> {
    ensure_repo(&store.dir)?;
    run(
        &store.dir,
        &[
            "add",
            "tasks.jsonl",
            "archive.jsonl",
            "config.toml",
            ".gitattributes",
        ],
    )?;
    let _ = run(&store.dir, &["commit", "-m", "atd: sync"]);
    if has_remote(&store.dir)? {
        run(&store.dir, &["fetch", "--all"])?;
        match run(&store.dir, &["rebase"]) {
            Ok(_) => {}
            Err(error) => {
                let result = (|| {
                    let path = store.dir.join("tasks.jsonl");
                    if !path.exists() {
                        return Err(error);
                    }
                    merge_conflicted_file(&path)?;
                    run(&store.dir, &["add", "tasks.jsonl"])?;
                    run(
                        &store.dir,
                        &["-c", "core.editor=true", "rebase", "--continue"],
                    )?;
                    Ok(())
                })();
                if let Err(error) = result {
                    let _ = run(&store.dir, &["rebase", "--abort"]);
                    return Err(error);
                }
            }
        }
        let _ = run(&store.dir, &["push"]);
    }
    Ok("同步完成".into())
}
fn ensure_repo(dir: &Path) -> io::Result<()> {
    if !dir.join(".git").exists() {
        run(dir, &["init"])?;
    }
    let attrs = dir.join(".gitattributes");
    let mut text = match fs::read_to_string(&attrs) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error),
    };
    if !text
        .lines()
        .any(|line| line.trim() == "*.jsonl merge=union")
    {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str("*.jsonl merge=union\n");
        crate::storage::atomic_write_path(&attrs, text.as_bytes())?;
    }
    Ok(())
}
fn has_remote(dir: &Path) -> io::Result<bool> {
    Ok(command(dir, &["remote"])?
        .stdout
        .iter()
        .any(|b| !b.is_ascii_whitespace()))
}
fn command(dir: &Path, args: &[&str]) -> io::Result<Output> {
    Command::new("git").arg("-C").arg(dir).args(args).output()
}
fn run(dir: &Path, args: &[&str]) -> io::Result<Output> {
    let output = command(dir, args)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(io::Error::other(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ))
    }
}
fn merge_conflicted_file(path: &Path) -> io::Result<()> {
    let text = fs::read_to_string(path)?;
    let records = parse_conflict_union(&text);
    let mut data = Vec::new();
    for record in records {
        serde_json::to_writer(&mut data, &record).map_err(io::Error::other)?;
        data.push(b'\n');
    }
    crate::storage::atomic_write_path(path, &data)
}
pub fn parse_conflict_union(text: &str) -> Vec<Value> {
    let cleaned = text
        .lines()
        .filter(|line| {
            !line.starts_with("<<<<<<<")
                && !line.starts_with("=======")
                && !line.starts_with(">>>>>>>")
        })
        .collect::<Vec<_>>()
        .join("\n");
    collapse(load_jsonl(&cleaned)).into_values().collect()
}
pub fn merge_tasks(left: &[Task], right: &[Task]) -> Vec<Task> {
    let values = left
        .iter()
        .chain(right)
        .filter_map(|t| serde_json::to_value(t).ok())
        .collect();
    collapse(values)
        .into_values()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ensure_repo_adds_attributes_to_existing_repo() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init"]).unwrap();
        crate::storage::atomic_write_path(&dir.path().join(".gitattributes"), b"*.txt text\n")
            .unwrap();
        ensure_repo(dir.path()).unwrap();
        let text = fs::read_to_string(dir.path().join(".gitattributes")).unwrap();
        assert!(text.contains("*.txt text\n"));
        assert_eq!(text.matches("*.jsonl merge=union").count(), 1);
    }
    #[test]
    fn conflict_union_selects_latest() {
        let text="<<<<<<< HEAD\n{\"id\":\"a\",\"modified\":\"1\",\"title\":\"old\"}\n=======\n{\"id\":\"a\",\"modified\":\"2\",\"title\":\"new\"}\n>>>>>>> remote\n";
        assert_eq!(parse_conflict_union(text)[0]["title"], "new");
    }
}
