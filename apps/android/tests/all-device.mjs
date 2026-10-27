import { execFileSync } from 'node:child_process';
for (const file of ['device', 'sync-device', 'files-device', 'reminder-device', 'mail-device', 'extended-device', 'clone-device', 'workflows-device', 'calendar-device', 'dependency-reminder-device', 'map-device', 'map-data-device', 'projects-focus-device', 'startup-device']) {
  execFileSync(process.execPath, [`tests/${file}.mjs`], { stdio: 'inherit', timeout: 180000 });
}
