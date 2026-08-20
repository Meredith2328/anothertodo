# TypeScript / Node.js migration status

This file is the working checklist for the migration described in
`DESIGN.md`. Python remains in the repository until the Node implementation
has passed a stable compatibility period.

| Stage | Status | Evidence |
| --- | --- | --- |
| 0. Freeze Python behavior | Complete | `fixtures/*.json`, `fixtures/tui-shortcuts.md`, fixture loader tests |
| 1. TypeScript project and contracts | Complete | strict `tsconfig.json`, Zod schemas, `npm run typecheck`, `npm test` |
| 2. Task/config/JSONL/lock | Complete | `src/core/task.ts`, `src/core/config.ts`, `src/storage/`, storage tests |
| 3. Parser/query/priority/agenda | Complete | `src/core/parse.ts`, `src/core/query.ts`, `src/core/priority.ts`, `src/core/agenda.ts`, frozen parser tests |
| 4. CLI | Complete | `src/cli.ts`, temporary-directory CLI end-to-end test |
| 5. Git sync | Complete | `src/sync/`, merge fixtures and sync smoke |
| 6. Reminders/hooks | Complete | `src/reminders/`, watcher and snooze tests |
| 7. TUI | Implemented; platform sign-off pending | Ink app/application service, reducer/keymap and real Ink interaction tests; Windows Terminal/macOS/Linux manual pass remains |
| 8. Build/release | Implemented; CI sign-off pending | Node matrix workflow, npm package metadata, package smoke; platform artifact runs remain CI-only |
| 9. Default implementation | Node wrapper ready; release promotion pending | `bin/atd.mjs` defaults to Node; `ATD_ENGINE=python` is the explicit rollback switch |
| 10. Remove Python | Pending | Requires at least one stable Node release |

## Compatibility rules

- `~/.atd` / `%USERPROFILE%\\.atd` and the JSONL filenames remain unchanged.
- `due` and reminder `at` values are timezone-free local ISO datetimes.
- `entry`, `modified`, and `end` are UTC ISO metadata timestamps.
- Duplicate task IDs are canonicalized to the last record; tombstones remain
  authoritative during sync.
- Reminder `fired` updates use `Store.save(..., recordUndo = false)`.

## Verification gate

Run the following before advancing a stage:

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
```

Python tests remain a separate compatibility check. If the local Python
environment does not have the development dependency installed, install the
project's test extras and run `python -m pytest tests/ -q` before switching the
default executable.
