import type { ApplicationService } from '../../../src/app/service.js';
import { cloneTask, utcNow, localNow } from '../../../src/core/task.js';
import { addLocalMinutes } from '../../../src/core/time.js';

export const snooze = async (store: ApplicationService['store'], id: string, minutes: number): Promise<void> => {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('推迟分钟需要大于零');
  const task = await store.find(id);
  if (!task) throw new Error('找不到任务');
  const before = cloneTask(task);
  const at = addLocalMinutes(localNow(), minutes);
  if (!at) throw new Error('提醒时间无效');
  const pending = task.reminders.filter(reminder => !reminder.fired && !reminder.dead);
  if (pending.length) for (const reminder of pending) { reminder.at = at; delete reminder.leaseOwner; delete reminder.leaseUntil; }
  else task.reminders.push({ id: `rem-${crypto.randomUUID()}`, at, hooks: ['toast'], fired: false, dead: false });
  task.modified = utcNow();
  await store.save(task, before);
};
