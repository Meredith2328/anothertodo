# Node.js implementation

The migrated implementation is built from `src/cli.ts` and uses the same
`ATD_HOME`/`~/.atd` data directory as Python:

```powershell
npm ci
npm run build
npm link
atd add "明天 采购复盘 很急 #工作"
atd list
```

For a one-off invocation without linking:

```powershell
node dist-node/cli.js add "明天 采购复盘"
node dist-node/cli.js list
```

The Python package remains available during the compatibility period. Do not
run Python and Node writers against the same data directory concurrently;
choose one implementation per active data directory. Node uses the existing
`tasks.jsonl`, `undo.jsonl`, `archive.jsonl`, `config.toml`, and `hooks/` paths.

The npm-installed `atd` wrapper defaults to Node. During the compatibility
period, explicitly selecting the legacy implementation is possible with
`ATD_ENGINE=python atd ...` (and optionally `ATD_PYTHON` to choose the Python
executable).

Before promoting Node as the only executable, complete the Windows Terminal,
macOS, Linux/WSL, real notification, and Git bare-remote checks listed in
`DESIGN.md` section 20. Python removal is deliberately a later release step.

Node releases use `node-v*` tags; legacy Python compatibility releases use
`legacy-v*` tags so the two workflows never race to publish the same Release.

## Standalone executables (Node SEA)

Each `node-v*` release also ships platform-specific standalone executables
built with Node's Single Executable Application pipeline:

- `atd-windows.exe` — double-click (or run in a terminal) to open the TUI; no
  Node.js installation required.
- `atd-macos` — `chmod +x atd-macos && ./atd-macos`.
- `atd-linux` — `chmod +x atd-linux && ./atd-linux`.

They read and write the same `~/.atd` data directory (override with
`ATD_HOME`), so they interoperate with the npm wrapper and the Python
implementation. Building locally:

```bash
npm run build:sea                                  # dist-sea/sea-entry.cjs
node --experimental-sea-config sea-config.json    # dist-sea/sea-prep.blob
cp "$(command -v node)" atd.exe                    # macOS/Linux: remove the
npx postject atd.exe NODE_SEA_BLOB dist-sea/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

On macOS, run `codesign --remove-signature` on the copied binary before
injection and `codesign --sign -` afterwards (CI does this automatically).
The portable `atd-node-*.tar.gz` artifacts remain available for environments
that already run Node 22+.

## TUI parity with the Python version

The Ink TUI (`src/tui/`) reproduces the Python Textual layout: rainbow ASCII
banner with a right-aligned status line (filter / sort mode / `!overdue ●today
∑active` / clock), the round-bordered five-column table (date / TODO /
priority / status / tags+reminders) with per-cell colors, group separators
(`╾─ 逾期 2 ──────────`), the live parse-preview line, the input bar with
placeholder, the four-key footer, and the `?` help and first-run welcome
modals. Keybindings match `fixtures/tui-shortcuts.md`.
