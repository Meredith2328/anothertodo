# Platform acceptance checklist

The automated suite verifies command generation and uses isolated mocks for
external services. These checks require the target platform/account and must
be run manually before a project-level default switch:

## Windows

1. Run `npm run build` and `node bin/atd.mjs watch --install`.
2. Verify `schtasks /Query /TN anothertodo-atd-watch`.
3. Run `node bin/atd.mjs watch --uninstall` and verify the task is absent.
4. With Windows notifications enabled, create a due task using a real `toast`
   hook and confirm a notification appears; then repeat with notifications
   disabled and confirm the watcher logs a failed hook and applies retry/dead-letter semantics.

## macOS / Linux / WSL

Run the equivalent launchd/systemd registration lifecycle and a real `osascript`
or `notify-send` toast check. The Node artifact is a portable package requiring
Node.js 22+, not a native executable.

## SMTP

Use temporary credentials supplied through `ATD_EMAIL_PASSWORD` and a temporary
private mailbox. Remove the credentials after the test and do not put them in
config fixtures or Git.
