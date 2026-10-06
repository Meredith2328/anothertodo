import { describe, expect, it } from 'vitest';
import { monthDays, weekDays, completedByDate, quadrant } from '../src/core/calendar.js';
import { parseTask } from '../src/core/task.js';

describe('calendar and completion activity', () => {
  it('provides Monday-based weeks and complete month rows across year boundaries', () => {
    expect(weekDays('2026-01-01')).toEqual(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    const days = monthDays('2026-10-06');
    expect(days[0]).toBe('2026-09-28'); expect(days.at(-1)).toBe('2026-11-01'); expect(days).toHaveLength(35);
    expect(monthDays('2024-02-01')).toContain('2024-02-29');
  });
  it('counts completed tasks once, including archive records and local calendar dates', () => {
    const task = parseTask({ id: 'finished', status: 'done', end: '2026-10-06T10:00:00+08:00' });
    const date = new Date(task.end!); const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    expect(completedByDate([task, task]).get(key)).toBe(1);
    expect(completedByDate([parseTask({ id: 'cancelled', status: 'cancelled', end: task.end })]).size).toBe(0);
  });
  it('classifies actual priority and due fields into four quadrants', () => {
    const levels = ['低', '中', '高'];
    expect(quadrant(parseTask({ id: '1', priority: '高', due: '2026-10-06T18:00' }), levels, '2026-10-06')).toBe(0);
    expect(quadrant(parseTask({ id: '2', priority: '高', due: '2026-10-07T18:00' }), levels, '2026-10-06')).toBe(1);
    expect(quadrant(parseTask({ id: '3', priority: '低', due: '2026-10-05T18:00' }), levels, '2026-10-06')).toBe(2);
    expect(quadrant(parseTask({ id: '4' }), levels, '2026-10-06')).toBe(3);
  });
});
