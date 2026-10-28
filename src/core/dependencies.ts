import Fuse from 'fuse.js';
import type { Task } from '../contracts.js';
import { cloneTask, ACTIVE_STATES } from './task.js';

export type DependencyRequest = { direction: 'before' | 'after'; reference: string };
export type DependencyCandidate = { task: Task; exact: boolean; score: number };
const unquote = (value: string): string => value.trim().replace(/^["'「『“]|["'」』”]$/gu, '').trim();
const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s，,。.!！?？:：;；_-]+/gu, '');
const REF = '(?:"[^"]+"|\'[^\']+\'|「[^」]+」|『[^』]+』|“[^”]+”)';

export const extractDependencies = (input: string, isDate: (reference: string) => boolean): { source: string; dependencies: DependencyRequest[] } => {
  let source = input.trim().replace(/\s+/gu, ' '); const dependencies: DependencyRequest[] = [];
  source = source.replace(new RegExp(`(?:^|\\s)(after|before|depends|依赖|先于)[:：](${REF}|[^\\s]+)`, 'giu'), (_whole, direction: string, raw: string) => {
    dependencies.push({ direction: /before|先于/iu.test(direction) ? 'before' : 'after', reference: unquote(raw) }); return ' ';
  }).trim();
  const record = (reference: string, direction: 'before' | 'after', current: string): void => {
    const value = unquote(reference).replace(/(?:完成|结束)$/u, '').trim();
    if (!value) throw new Error('依赖任务名称不能为空');
    source = isDate(value) ? `${current} ${value}` : current;
    if (!isDate(value)) dependencies.push({ direction, reference: value });
  };
  const englishPrefix = new RegExp(`^(after|before|following|once)\\s+(?:finishing\\s+|completing\\s+)?(${REF}|.+?)(?:\\s+is\\s+done)?\\s*[,，]\\s*(.+)$`, 'iu').exec(source);
  if (englishPrefix) record(englishPrefix[2]!, /before/iu.test(englishPrefix[1]!) ? 'before' : 'after', englishPrefix[3]!);
  else {
    const quotedPrefix = new RegExp(`^(after|before|following)\\s+(${REF})\\s+(.+)$`, 'iu').exec(source);
    const english = /^(.*?)\s+(?<!\bday\s)(after|before|following|depends\s+on|subsequent\s+to|prior\s+to)\s+(.+)$/iu.exec(source);
    if (quotedPrefix) record(quotedPrefix[2]!, /before/iu.test(quotedPrefix[1]!) ? 'before' : 'after', quotedPrefix[3]!);
    else if (english) {
      const quoted = new RegExp(`^(${REF})(.*)$`, 'u').exec(english[3]!);
      record(quoted?.[1] ?? english[3]!, /before|prior/iu.test(english[2]!) ? 'before' : 'after', `${english[1]} ${quoted?.[2] ?? ''}`.trim());
    }
    else {
      const chinese = /^(.*?)((?:之前|之后|以前|以后|完成后|结束后|做完后|后再|前再|(?<=[」』”"'])后|(?<=[」』”"'])前|后(?=$|做|写|发|提交|整理|检查|开始)|前(?=$|做|写|发|提交|整理|检查|先)))\s*[,，]?\s*(.*)$/u.exec(source);
      if (chinese) {
        const left = chinese[1]!.trim(), right = chinese[3]!.trim();
        const direction = /之前|以前|^前/u.test(chinese[2]!) ? 'before' : 'after';
        const located = /^(.*?)\s*在\s*(.+)$/u.exec(left);
        if (located) record(located[2]!, direction, `${located[1]} ${right}`.trim());
        else if (right) record(left.replace(/^(?:等|待)/u, ''), direction, right);
        else {
          const split = new RegExp(`^(.*?)\\s+(${REF}|[^\\s]+)$`, 'u').exec(left);
          if (split) record(split[2]!, direction, split[1]!);
        }
      }
    }
  }
  return { source: source.replace(/\s+/gu, ' ').trim(), dependencies };
};

export const dependencyCandidates = (reference: string, tasks: readonly Task[]): DependencyCandidate[] => {
  const key = normalize(unquote(reference)); if (!key) return [];
  const exact = tasks.filter(task => task.id === reference || normalize(task.title) === key);
  if (exact.length) {
    return [...exact].sort((a, b) => Number(ACTIVE_STATES.has(b.status)) - Number(ACTIVE_STATES.has(a.status))).map(task => ({ task, exact: true, score: 0 }));
  }
  const ids = tasks.filter(task => task.id.startsWith(reference));
  if (ids.length) return ids.map(task => ({ task, exact: true, score: 0 }));
  const index = new Fuse(tasks.map(task => ({ task, title: normalize(task.title) })), { keys: ['title'], includeScore: true, ignoreLocation: true, threshold: .35 });
  return index.search(key, { limit: 6 }).map(item => ({ task: item.item.task, score: item.score ?? 1, exact: false }));
};
export const blockedDependencies = (task: Task, catalog: readonly Task[]): string[] => {
  const states = new Map(catalog.map(item => [item.id, item.status]));
  return dependencyIds(task).filter(id => states.get(id) !== 'done');
};
export const dependencyIds = (task: Task): string[] => [...new Set([...(task.deps ?? []), ...(task.dependsOn ?? [])])];
export const validateDependencies = (catalog: readonly Task[]): void => { dependencyOrder(catalog); };
export const planDependencies = (drafts: readonly Task[], requests: readonly DependencyRequest[][], catalog: readonly Task[], selections: readonly (string | undefined)[][] = []): Task[] => {
  const all = new Map(catalog.map(task => [task.id, cloneTask(task)]));
  for (const task of drafts) all.set(task.id, cloneTask(task));
  const changed = new Set(drafts.map(task => task.id));
  for (const [index, draft] of drafts.entries()) for (const [requestIndex, request] of (requests[index] ?? []).entries()) {
    const candidates = dependencyCandidates(request.reference, [...all.values()]);
    const chosen = selections[index]?.[requestIndex];
    const match = chosen ? candidates.find(item => item.task.id === chosen) : candidates.length === 1 ? candidates[0] : undefined;
    if (!match) throw new Error(candidates.length ? `依赖「${request.reference}」匹配多个任务，请确认编号：${candidates.map(item => `${item.task.id} ${item.task.title}`).join('；')}` : `找不到依赖任务「${request.reference}」`);
    const dependent = all.get(request.direction === 'after' ? draft.id : match.task.id)!;
    const prerequisite = request.direction === 'after' ? match.task.id : draft.id;
    dependent.dependsOn = [...new Set([...(dependent.dependsOn ?? []), prerequisite])]; changed.add(dependent.id);
  }
  validateDependencies([...all.values()]);
  return [...changed].map(id => all.get(id)!);
};
export const dependencyOrder = (tasks: readonly Task[]): Task[] => {
  const byId = new Map(tasks.map(task => [task.id, task])); const degree = new Map<string, number>();
  const followers = new Map<string, string[]>();
  for (const task of byId.values()) {
    let count = 0;
    for (const id of dependencyIds(task)) {
      if (id === task.id) throw new Error('任务不能依赖自身');
      if (!byId.has(id)) continue;
      count++; followers.set(id, [...followers.get(id) ?? [], task.id]);
    }
    degree.set(task.id, count);
  }
  const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id), ordered: Task[] = [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!; ordered.push(byId.get(id)!);
    for (const child of followers.get(id) ?? []) { const count = degree.get(child)! - 1; degree.set(child, count); if (count === 0) queue.push(child); }
  }
  if (ordered.length !== byId.size) throw new Error('任务依赖形成循环');
  return ordered;
};
