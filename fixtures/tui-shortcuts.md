# TUI frozen shortcut contract

The migration must preserve these keys and their mode boundaries:

- Navigation: `j`, `k`, `↑`, `↓`, `g`, `G`, `Enter`
- Mutations: `d`, `x`, `e`, `w`, `u`, `r`
- Views and input: `1`, `2`, `t`, `i`, `Tab`, `/`, `:`
- Help and search: `?`, `F1`, `Ctrl+F`
- Sync and undo: `Ctrl+S`, `Ctrl+Z`
- Exit: `Esc`, `Q`, `Ctrl+Q`

In add/edit/search/command input modes, ordinary characters such as `d`, `x`,
`e`, and `u` are text and must not invoke list-mode shortcuts. `Tab` completes
only in input mode. `Esc` first returns to the list or cancels the current input;
two list-mode presses retain the existing quit behavior.
