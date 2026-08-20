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
