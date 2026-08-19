use atd::{
    model::Task,
    parse::{apply, parse, preview},
    priority::sort_tasks,
    query::filter,
    storage::Store,
};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[arg(long, global = true)]
    data_dir: Option<std::path::PathBuf>,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    Add {
        text: Vec<String>,
    },
    List {
        query: Vec<String>,
        #[arg(short, long, default_value = "levels")]
        mode: String,
        #[arg(long)]
        all: bool,
    },
    Done {
        ids: Vec<String>,
    },
    Reopen {
        ids: Vec<String>,
    },
    Rm {
        ids: Vec<String>,
    },
    Edit {
        id: String,
        text: Vec<String>,
    },
    Show {
        id: String,
    },
    Undo,
    Archive {
        #[arg(default_value_t = 14)]
        days: i64,
        #[arg(long)]
        list: bool,
        #[arg(long)]
        restore: Option<String>,
    },
    Restore {
        id: String,
    },
    Sync,
    Watch {
        #[arg(long)]
        install: bool,
        #[arg(long)]
        uninstall: bool,
        #[arg(long)]
        once: bool,
    },
    Hooks,
    Snooze {
        id: String,
        when: Vec<String>,
    },
    Config {
        #[arg(long)]
        path: bool,
        key: Option<String>,
        value: Option<String>,
    },
    Preview {
        text: Vec<String>,
    },
}

fn joined(parts: Vec<String>) -> anyhow::Result<String> {
    let value = parts.join(" ").trim().to_owned();
    if value.is_empty() {
        anyhow::bail!("缺少任务内容");
    }
    Ok(value)
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let store = Store::new(cli.data_dir)?;
    match cli.command {
        None => atd::tui::run(store)?,
        Some(Command::Add { text }) => {
            let raw = joined(text)?;
            let parsed = parse(raw.as_str(), chrono::Utc::now(), levels(&store).as_slice());
            if parsed.title.is_empty() {
                anyhow::bail!("无法解析出标题");
            }
            let mut task = Task::default();
            apply(&mut task, &parsed);
            let task = store.save(task, None, true)?;
            println!("{} {}", task.id, task.title);
        }
        Some(Command::List { query, mode, all }) => {
            let mut tasks = store.tasks()?;
            if !all {
                tasks.retain(Task::is_active);
            }
            if !query.is_empty() {
                tasks = filter(&tasks, &query.join(" "));
            }
            for task in sort_tasks(tasks, &mode) {
                let due = task
                    .due
                    .map(|d| format!("  {}", d.to_rfc3339()))
                    .unwrap_or_default();
                println!("{} [{}] {}{}", task.id, task.status, task.title, due);
            }
        }
        Some(Command::Done { ids }) => update_many(&store, ids, |task| {
            task.status = "done".into();
            task.end = Some(atd::now_iso());
        })?,
        Some(Command::Reopen { ids }) => update_many(&store, ids, |task| {
            task.status = "todo".into();
            task.end = None;
            for reminder in &mut task.reminders {
                reminder.fired = false;
                reminder.last_error = None;
            }
        })?,
        Some(Command::Rm { ids }) => store.delete_many(&ids)?,
        Some(Command::Edit { id, text }) => {
            let mut task = store.find(&id)?;
            let before = Some(task.clone());
            let parsed = parse(
                joined(text)?.as_str(),
                chrono::Utc::now(),
                levels(&store).as_slice(),
            );
            apply(&mut task, &parsed);
            store.save(task, before, true)?;
        }
        Some(Command::Show { id }) => {
            println!("{}", serde_json::to_string_pretty(&store.find(&id)?)?)
        }
        Some(Command::Undo) => println!("已撤销 {}", store.undo()?),
        Some(Command::Archive {
            days,
            list,
            restore,
        }) => {
            if let Some(id) = restore {
                println!("已恢复 {}", store.restore(&id)?.id);
            } else if list {
                for value in store.archived()? {
                    println!("{}", serde_json::to_string(&value)?);
                }
            } else {
                println!("已归档 {} 条", store.archive(days)?);
            }
        }
        Some(Command::Restore { id }) => println!("已恢复 {}", store.restore(&id)?.id),
        Some(Command::Sync) => println!("{}", atd::sync::sync(&store)?),
        Some(Command::Watch {
            install,
            uninstall,
            once,
        }) => {
            if install || uninstall {
                println!("{}", atd::watch::install(uninstall));
            } else if once {
                println!("触发 {} 条", atd::watch::once(&store)?);
            } else {
                atd::watch::run(store)?;
            }
        }
        Some(Command::Hooks) => {
            for hook in atd::watch::hook_names(&store)? {
                println!("{hook}");
            }
        }
        Some(Command::Snooze { id, when }) => println!(
            "已稍后提醒 {}",
            atd::watch::snooze(&store, &id, &joined(when)?)?.id
        ),
        Some(Command::Config { path, key, value }) => {
            if path {
                println!("{}", store.dir.join("config.toml").display());
                return Ok(());
            }
            let config = atd::config::load(&store.dir);
            match (key, value) {
                (None, None) => println!("{}", toml::to_string_pretty(&config)?),
                (Some(key), None) => println!(
                    "{}",
                    config_get(&config, &key).ok_or_else(|| anyhow::anyhow!("未知配置项"))?
                ),
                (Some(key), Some(value)) => {
                    atd::config::set(&store.dir, &key, &value)?;
                    println!("已更新 {key}");
                }
                (None, Some(_)) => anyhow::bail!("配置值缺少键"),
            }
        }
        Some(Command::Preview { text }) => println!(
            "{}",
            preview(&parse(
                joined(text)?.as_str(),
                chrono::Utc::now(),
                levels(&store).as_slice()
            ))
        ),
    }
    Ok(())
}

fn levels(store: &Store) -> Vec<String> {
    atd::config::levels(&store.dir)
}

fn config_get<'a>(config: &'a toml::Value, dotted: &str) -> Option<&'a toml::Value> {
    dotted
        .split('.')
        .try_fold(config, |value, key| value.get(key))
}

fn update_many<F: Fn(&mut Task)>(store: &Store, ids: Vec<String>, update: F) -> anyhow::Result<()> {
    if ids.is_empty() {
        anyhow::bail!("至少需要一个任务 ID");
    }
    for id in ids {
        let mut task = store.find(&id)?;
        let before = Some(task.clone());
        update(&mut task);
        store.save(task, before, true)?;
    }
    Ok(())
}
