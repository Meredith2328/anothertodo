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

After installing the Node wrapper, the `atd` command uses the Node implementation by default. Data lives in `~/.atd/`.

**Standalone executable (recommended, no runtime needed)**: download the single-file program for your platform from GitHub Releases (`node-v*` tag) — on Windows double-click `atd-windows.exe` to enter the TUI; on macOS/Linux `chmod +x` then run. Data still goes to `~/.atd`, so it's interchangeable with other installation methods.

The `~/.atd/` data directory is created automatically on first run.

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
type to add (live parse preview below)    j/k move · d done · x delete · e edit
: command (list/undo/sync/mode)           / search · ? help · q/Q/double-Esc quit
```

## The magic of one-line input

Dates, times, urgency, tags and reminders are all parsed out of a single line; whatever remains becomes the title:

```bash
atd add "next friday 14:30 meeting #work proj:daily"     # next Friday 14:30 + tag/project
atd add "tomorrow report very urgent"                    # tomorrow + high priority
atd add "8.20 review"                                    # numeric date (kept literally if past)
atd preview "day after tomorrow 2:30pm review"           # preview the parse before adding
```

| You write | Parsed as |
|---|---|
| `today` `tomorrow` `tonight` `next fri` `this weekend` | relative dates (tomorrow defaults to 10:00, next means next week) |
| `8.20` `2026-08-20` | numeric dates (past numeric dates keep their literal value) |
| `14:30` `2:30pm` `9am` `12pm` | 24-hour and 12-hour times (am/pm supported) |
| `高` `中` `低` `urgent` `no rush` | priority level names (default `低/中/高`; set your own in `config.toml`; English phrases like `urgent`/`very urgent`/`asap` map to the top level, `no rush`/`not urgent`/`someday` to the bottom) |
| `#tag` `proj:project` `^parent-id` | tag / project / subtask |
| `@18:30` `@9:00:toast,email` `@30m` | reminders (anchored to task date, multiple hooks) |
| `~next monday` | wait until a date (multi-word English dates work) |

If you don't write a reminder, tasks with a future due date get a toast automatically — 1 day ahead if the due date is more than 24 hours out, otherwise 15 minutes ahead. Write `@none`, `@off` or `no reminders` to disable.

## Reminders

```bash
atd watch --install        # auto-start the watcher (Win schtasks / Mac launchd / Linux systemd)
atd watch                  # run in foreground (scan every 30s, resend missed with [missed])
atd snooze 3fbd 10m        # delay a reminder
```

Built-in hooks: `toast` (system notifications on all three platforms), `email` (configure the `[email]` section). Custom hooks: drop a script into `~/.atd/hooks/`, then call it with `@18:00:name`.

## Sorting and querying

Two sorting modes, switchable at any time (press `1`/`2` in the TUI, or set `priority.mode` in `config.toml`): `levels` sorts by priority level, `urgency` by a weighted score (overdue/upcoming/age, coefficients tunable).

```bash
atd list due:today +urgent -低 project:study status:waiting /keyword
atd list -m urgency        # use urgency sort for this query
```

## Multi-device sync

The code is open source, but **your data stays private**: `~/.atd` is a private git repo, each device writes locally and only merges when you run `atd sync`.

```bash
cd ~/.atd && git remote add origin <your-private-repo>
atd sync          # commit + fetch + rebase + push
```

Conflict rules: same task takes the newer edit, deletion wins over an old edit, different tasks are unioned (verified with real multi-device scenarios).

## Data and commands

```
~/.atd/tasks.jsonl    task data (single source of truth)      ~/.atd/archive.jsonl  archive
~/.atd/config.toml    configuration                          atd archive list/restore  view/restore history
```

All commands: `add list done rm edit show undo reopen archive sync watch snooze hooks config preview`

## Development and packaging

```bash
npm test                 # run the test suite
npm run typecheck        # type-check with tsc
npm run build            # build to dist-node
npm run build:sea        # build a standalone SEA executable
```

Release artifacts are built by GitHub Actions: push a `node-v*` tag to ship standalone executables for all three platforms. See [docs/node-usage.md](docs/node-usage.md) and [docs/ts-migration-plan.md](docs/ts-migration-plan.md) for the implementation details and compatibility rules.
