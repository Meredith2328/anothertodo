use crate::{
    model::Task,
    parse::{apply, parse},
    priority::sort_tasks,
    query::filter,
    storage::Store,
};
use crossterm::{
    cursor::Show,
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Terminal,
};
use std::io::{self, stdout};

enum InputMode {
    Add(String),
    Edit { id: String, raw: String },
    Query(String),
}
impl InputMode {
    fn prompt(&self) -> &'static str {
        match self {
            Self::Add(_) => "添加> ",
            Self::Edit { .. } => "编辑> ",
            Self::Query(_) => "查询/搜索> ",
        }
    }
    fn value(&self) -> &str {
        match self {
            Self::Add(value) | Self::Query(value) => value,
            Self::Edit { raw, .. } => raw,
        }
    }
    fn value_mut(&mut self) -> &mut String {
        match self {
            Self::Add(value) | Self::Query(value) => value,
            Self::Edit { raw, .. } => raw,
        }
    }
}

struct TerminalGuard;
impl TerminalGuard {
    fn enter() -> io::Result<Self> {
        enable_raw_mode()?;
        if let Err(e) = execute!(stdout(), EnterAlternateScreen) {
            let _ = disable_raw_mode();
            return Err(e);
        }
        Ok(Self)
    }
}
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(stdout(), LeaveAlternateScreen, Show);
    }
}
pub fn run(store: Store) -> io::Result<()> {
    let _guard = TerminalGuard::enter()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    let mut selected = 0usize;
    let mut query = String::new();
    let mut mode = crate::config::load(&store.dir)
        .get("priority")
        .and_then(|value| value.get("mode"))
        .and_then(toml::Value::as_str)
        .unwrap_or("levels")
        .to_owned();
    let levels = crate::config::levels(&store.dir);
    let mut input: Option<InputMode> = None;
    let mut message = String::new();
    loop {
        let mut tasks: Vec<_> = store.tasks()?.into_iter().filter(Task::is_active).collect();
        if !query.is_empty() {
            tasks = filter(&tasks, &query);
        }
        let tasks = sort_tasks(tasks, &mode);
        if !tasks.is_empty() {
            selected = selected.min(tasks.len() - 1)
        }
        let mut state = ListState::default().with_selected((!tasks.is_empty()).then_some(selected));
        terminal.draw(|frame| {
            let areas = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(3), Constraint::Length(2)])
                .split(frame.area());
            let items = tasks
                .iter()
                .map(|t| {
                    ListItem::new(format!(
                        "{}  {:8}  {}",
                        t.id,
                        t.priority.as_deref().unwrap_or("-"),
                        t.title
                    ))
                })
                .collect::<Vec<_>>();
            let list = List::new(items)
                .block(Block::default().title("atd").borders(Borders::ALL))
                .highlight_symbol("› ")
                .highlight_style(
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                );
            frame.render_stateful_widget(list, areas[0], &mut state);
            frame.render_widget(
                Paragraph::new(if let Some(input) = &input {
                    format!("{}{}", input.prompt(), input.value())
                } else if !message.is_empty() {
                    message.clone()
                } else {
                    format!("a 添加  e 编辑  / 查询  u 撤销  m levels/urgency（{}）  j/k 移动  d 完成  x 删除  r 重开  q 退出", mode)
                }),
                areas[1],
            );
        })?;
        if event::poll(std::time::Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if let Some(current) = input.as_mut() {
                    match key.code {
                        KeyCode::Esc => input = None,
                        KeyCode::Backspace => {
                            current.value_mut().pop();
                        }
                        KeyCode::Char(character) => current.value_mut().push(character),
                        KeyCode::Enter => {
                            let completed = input.take().unwrap();
                            match completed {
                                InputMode::Add(raw) => {
                                    let parsed = parse(&raw, chrono::Utc::now(), &levels);
                                    if parsed.title.is_empty() {
                                        message = "无法解析出标题".into();
                                    } else {
                                        let mut task = Task::default();
                                        apply(&mut task, &parsed);
                                        store.save(task, None, true)?;
                                        message = "已添加任务".into();
                                    }
                                }
                                InputMode::Edit { id, raw } => {
                                    let mut task = store.find(&id)?;
                                    let before = Some(task.clone());
                                    let parsed = parse(&raw, chrono::Utc::now(), &levels);
                                    apply(&mut task, &parsed);
                                    store.save(task, before, true)?;
                                    message = "已编辑任务".into();
                                }
                                InputMode::Query(raw) => {
                                    query = raw;
                                    selected = 0;
                                    message = if query.is_empty() {
                                        "已清除查询".into()
                                    } else {
                                        format!("查询：{query}")
                                    };
                                }
                            }
                        }
                        _ => {}
                    }
                    continue;
                }
                match key.code {
                    KeyCode::Char('q') | KeyCode::Char('Q') | KeyCode::Esc => break,
                    KeyCode::Char('a') => {
                        input = Some(InputMode::Add(String::new()));
                    }
                    KeyCode::Char('e') => {
                        if let Some(task) = tasks.get(selected) {
                            input = Some(InputMode::Edit {
                                id: task.id.clone(),
                                raw: task.title.clone(),
                            });
                        }
                    }
                    KeyCode::Char('/') => {
                        input = Some(InputMode::Query(query.clone()));
                    }
                    KeyCode::Char('u') => {
                        message = format!("已撤销 {}", store.undo()?);
                    }
                    KeyCode::Char('m') => {
                        mode = if mode == "levels" {
                            "urgency".into()
                        } else {
                            "levels".into()
                        };
                        message = format!("排序：{mode}");
                    }
                    KeyCode::Char('j') | KeyCode::Down => {
                        if selected + 1 < tasks.len() {
                            selected += 1
                        }
                    }
                    KeyCode::Char('k') | KeyCode::Up => selected = selected.saturating_sub(1),
                    KeyCode::Char('d') => {
                        if let Some(task) = tasks.get(selected) {
                            let before = Some(task.clone());
                            let mut task = task.clone();
                            task.status = "done".into();
                            task.end = Some(crate::now_iso());
                            store.save(task, before, true)?;
                        }
                    }
                    KeyCode::Char('r') => {
                        if let Some(task) = tasks.get(selected) {
                            let mut task = task.clone();
                            let before = Some(task.clone());
                            task.status = "todo".into();
                            task.end = None;
                            store.save(task, before, true)?;
                        }
                    }
                    KeyCode::Char('x') => {
                        if let Some(task) = tasks.get(selected) {
                            store.delete(&task.id)?;
                            selected = selected.saturating_sub(1);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    terminal.show_cursor()?;
    Ok(())
}
