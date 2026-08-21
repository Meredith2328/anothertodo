# anothertodo (`atd`)

![atd TUI](.assets/TUI.png)

**[中文版 README](README.md)** · **English README**

A lightweight todo list: add tasks with a single line of fuzzy input, manage them in a command-line TUI, get reminded via hooks, and sync across devices with git. Data is plain-text JSONL stored in `~/.atd/`.

> For the full feature guide and examples, see the **[VitePress docs site](https://meredith2328.github.io/anothertodo/)**. This README is a quick reference.

## Installation

**Node.js**: requires Node.js 22+, install from source:

```bash
npm ci
npm run build
npm link
```

**Standalone executable (recommended, no runtime needed)**: download the single-file program for your platform from GitHub Releases (`node-v*` tag) — on Windows double-click `atd-windows.exe` to enter the TUI; on macOS/Linux `chmod +x` then run. Data still goes to `~/.atd` — plain-text JSONL with a stable format, shared by both installation methods; the data directory is created automatically on first run.

## Quick start

**Command line**:

```bash
atd add "tomorrow 2:30pm buy milk urgent @18:30"   # one line: date/priority/reminder all parsed
atd list                          # grouped: overdue/today/upcoming/waiting/no-date
atd done 3fbd                     # complete a task (first few id chars suffice)
atd undo                          # undo the last change
```

**TUI** (run `atd` with no arguments):

```
type to add (live parse preview below)   j/k move · PgUp/PgDn page · g/G first/last
d done · x delete (asks first) · c cancel · o reopen · e edit · w wait until tomorrow · s snooze 10 min
l / → detail overlay (notes, reminders, parent/child; j/k moves, e edits inside)
space marks · Ctrl+A marks all on screen · with marks d x c w o s run in batch · Esc clears marks, then arms exit
: list/undo/sync/mode/archive/cancel/meeting/todo/wait <date>/snooze <min>
/ search · ? help · u undo · 1/2 switch sorting · t cycle date column · q or double-Esc quits
```

Sub-tasks recorded with `^parent-id` appear indented under their parent in lists and the TUI (multiple levels supported). Completing a parent names its still-open children, and deleting a parent warns which children become orphans.

## The magic of one-line input

Dates, times, urgency, tags and reminders are all parsed out of a single line; whatever remains becomes the title:

```bash
atd add "next friday 14:30 meeting #work proj:daily"     # next Friday 14:30 + tag/project
atd add "buy a gift tomorrow >>she wants that notebook, don't get the wrong one"   # everything after >> is the note
atd add "take out the trash *daily 8pm"                  # repeats every day
atd add "pay rent *monthly"                              # repeats monthly
atd add "await reply ~next monday 高"                     # hidden until next Monday + priority
atd preview "day after tomorrow 2:30pm review"           # preview the parse before adding
```

| You write | Parsed as |
|---|---|
| `today` `tomorrow` `tonight` `next fri` `this weekend` | relative dates (tomorrow defaults to 10:00, next means next week) |
| `8.20` `2026-08-20` | numeric dates (past numeric dates keep their literal value) |
| `14:30` `2:30pm` `9am` `12pm` | 24-hour and 12-hour times (am/pm supported) |
| `高` `中` `低` `urgent` `no rush` | priority level names (default `低/中/高`; set your own in `config.toml`; English phrases like `urgent`/`very urgent`/`asap` map to the top level, `no rush`/`not urgent`/`someday` to the bottom) |
| `#tag` `proj:project` `^parent-id` `~next monday` | tag / project / subtask / wait (multi-word English dates work) |
| `@18:30` `@9:00:toast,email` `@30m` | reminders (anchored to task date, multiple hooks) |
| `>>note text` | everything after `>>` to the end of the line is the note; `#` `@` `proj:` and dates inside it are not parsed; a bare `>>` clears the note |

| Syntax (Chinese and English both work) | Meaning |
|---|---|
| `*每天` / `*daily` / `*1d` | every day |
| `*每2周` / `*2w` | every two weeks |
| `*每周三` / `*weekly:wed` | every Wednesday |
| `*每月` / `*monthly` | every month |
| `*每年` / `*yearly` | every year |
| `*工作日` / `*weekdays` | every workday (weekends skipped) |

Completing a recurring task spawns a new task (new id) with the due date, wait date and reminder times shifted forward; the original stays in history. Monthly recurrences clamp to the end of short months (Jan 31 → Feb 28), never rolling into the next month.

`edit` accepts the same one-line input and can now clear fields (it used to only overwrite them, so a wrong date couldn't be removed), e.g. `atd edit a1b2 "-due -#tag"`:

| Syntax | Meaning |
|---|---|
| `-due` | clear the due date |
| `-proj` | clear the project |
| `-tags` | clear all tags |
| `-#tag` | remove just this one tag |
| `-priority` | clear the priority |
| `-wait` | clear the wait date |
| `-parent` | clear the parent link |
| `-notes` or a bare `>>` | clear the notes |
| `-recur` | clear the recurrence rule |
| `-reminders` / `@none` | clear reminders |

Chinese aliases work too (`-日期` `-项目` `-标签` `-优先级` `-等待` `-备注` `-重复` `-提醒`).

If you don't write a reminder, tasks with a future due date get a toast automatically — 1 day ahead if the due date is more than 24 hours out, otherwise 15 minutes ahead. Write `@none`, `@off` or `no reminders` to disable.

## Reminders

```bash
atd watch --install        # auto-start the watcher (Win schtasks / Mac launchd / Linux systemd)
atd watch                  # run in foreground (scan every 30s, resend missed with [missed])
atd snooze 3fbd 10m        # delay a reminder
```

Built-in hooks: `toast` (system notifications on all three platforms), `email` (configure the `[email]` section). Custom hooks: drop a script into `~/.atd/hooks/`, then call it with `@18:00:name`.

Failed deliveries retry with exponential backoff and are marked as given up after three attempts; `atd show <id>` shows each reminder's delivery status.

## Sorting and querying

Two sorting modes, switchable at any time (press `1`/`2` in the TUI, or set `priority.mode` in `config.toml`): `levels` sorts by priority level, `urgency` by a weighted score (overdue/upcoming/age, coefficients tunable).

```bash
atd list due:week -低 has:notes    # due this week, not low priority, with notes
atd list parent:a1b2               # subtasks of a1b2
```

Query syntax:

- `+高` / `-低` / `!高` filter by priority level (`+高` used to always match tags; `!` means the same as `-` and is not taken as a command-line flag)
- `wait:week` `wait:any` `wait:none` `wait:after:2026-09-01` (the range form of `wait:` used to match every task without a wait date); `due:none` `due:any` `due:month` `due:nextweek`
- `parent:<id-prefix>` finds a task's subtasks, plus `parent:none` / `parent:any`; `has:notes` `has:recur` `has:due` `has:reminder` `has:parent` `has:tags` `has:time`, prefix with `-` to negate
- negated filters like `-status:waiting` `-project:reading` `-#tag` `-/keyword`; `/keyword` now also searches project names and notes, not just titles and tags
- when a query contains a `wait:` condition, tasks waiting for a future date are no longer folded away; queries starting with `-` like `atd list -低` are no longer rejected as unknown options

## Multi-device sync

The code is open source, but **your data stays private**: `~/.atd` is a private git repo, each device writes locally and only merges when you run `atd sync`.

```bash
atd sync --setup <your-private-repo-url>    # configure the origin remote on first setup (raw git remote add also works)
atd sync                                    # commit + fetch + rebase + push
```

Conflict rules: same task takes the newer edit, deletion wins over an old edit, different tasks are unioned (verified with real multi-device scenarios). `atd sync-status` prints the branch, remote URL, uncommitted changes, commits ahead/behind and the last commit, with no network access.

## Data and commands

```
~/.atd/tasks.jsonl    task data (single source of truth)      ~/.atd/archive.jsonl  archive
~/.atd/config.toml    configuration                          atd archive list/restore  view/restore history
```

All commands: `add list done rm edit show undo reopen archive cancel meeting todo wait projects tags stats export sync sync-status watch snooze hooks config preview`. `atd --help` describes every command, and the top-level help also includes the one-line input syntax, the query syntax and examples.

| Command | What it does |
|---|---|
| `atd cancel <ids...>` | cancel tasks (kept as a record, unlike delete) |
| `atd meeting <ids...>` | mark as a meeting; counts as overdue after its time |
| `atd todo <ids...>` | back to todo, clearing the wait date |
| `atd wait <ids...> --until next monday` | defer to a date (without `--until` it defers to tomorrow) |
| `atd done <ids...> --with-subtasks` | complete together with open subtasks |
| `atd projects` | per-project counts of open / done / overdue |
| `atd tags` | per-tag counts |
| `atd stats` | overall status: per-state counts, overdue, due today and this week, recurring, notes, subtasks, pending reminders, completions in the last 7/30 days, the five most urgent |
| `atd export [query] -f json\|csv\|markdown -o file` | export, optionally filtered by a query |
| `atd sync --setup <url>` | configure the origin remote directly, no manual git remote add |
| `atd config get <key>` | read a single config key |
| `atd show <id>` | prints a human-readable field table by default (notes, reminder delivery status, parent/children); `--json` for the raw JSON |

`atd config set` accepts keys at any depth, e.g. `atd config set priority.urgency.overdue 20`; a misspelled key or a value of the wrong type is rejected on the spot and never corrupts the config file. The UI language is set with `[ui] lang`: `auto` (default; follows `ATD_LANG` / `LC_ALL` / `LANG`, falls back to Chinese when unrecognized), `zh`, or `en` — `atd config set ui.lang en` switches. With `en`, agenda group names, the date column, recurrence descriptions and field-name tables are all in English; the one-line input and query syntax stay identical in both languages.

## Development and packaging

```bash
npm test                 # run the test suite
npm run typecheck        # type-check with tsc
npm run build            # build to dist-node
npm run build:sea        # build a standalone SEA executable
```

Release artifacts are built by GitHub Actions: push a `node-v*` tag to ship standalone executables for all three platforms. See the [development guide](https://meredith2328.github.io/anothertodo/guide/development) for implementation details.
