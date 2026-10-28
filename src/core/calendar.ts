import type { Task } from '../contracts.js';

export const dateKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const weekDays = (selected: string): string[] => {
  const date = new Date(`${selected}T12:00:00`); date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, offset) => { const item = new Date(date); item.setDate(date.getDate() + offset); return dateKey(item); });
};
export const monthDays = (selected: string): string[] => {
  const first = `${selected.slice(0, 7)}-01`; const start = weekDays(first)[0]!;
  const date = new Date(`${start}T12:00:00`);
  const last = new Date(`${selected.slice(0, 7)}-01T12:00:00`); last.setMonth(last.getMonth() + 1); last.setDate(0);
  const total = (Date.parse(`${weekDays(dateKey(last))[6]}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  return Array.from({ length: total }, (_, offset) => { const item = new Date(date); item.setDate(date.getDate() + offset); return dateKey(item); });
};
export const completedByDate = (tasks: readonly Task[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const task of new Map(tasks.map(item => [item.id, item])).values()) {
    if (task.status !== 'done' || !task.end) continue;
    const date = new Date(task.end); if (!Number.isFinite(date.getTime())) continue;
    const key = dateKey(date); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
export const quadrant = (task: Task, levels: readonly string[], today: string): number => {
  const important = task.priority === levels.at(-1);
  const urgent = !!task.due && task.due.slice(0, 10) <= today;
  return important ? urgent ? 0 : 1 : urgent ? 2 : 3;
};
