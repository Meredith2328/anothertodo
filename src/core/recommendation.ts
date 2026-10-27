import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import type { Config, Task } from '../contracts.js';
import { compareTuple, sortKey, urgency } from './priority.js';
import { executableTasks } from './projects.js';
import { localNow } from './task.js';

export const recommendationTemplates = {
  current: 'function recommend(tasks, context) {\n  return context.orders[context.mode];\n}\n',
  levels: 'function recommend(tasks, context) {\n  return context.orders.levels;\n}\n',
  urgency: 'function recommend(tasks, context) {\n  return context.orders.urgency;\n}\n',
  random: 'function recommend(tasks, context) {\n  const ids = tasks.map(task => task.id);\n  for (let i = ids.length - 1; i > 0; i--) {\n    const j = Math.floor(Math.random() * (i + 1));\n    [ids[i], ids[j]] = [ids[j], ids[i]];\n  }\n  return ids;\n}\n',
};

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export type RecommendOptions = { previous?: string[]; now?: string; list?: boolean; mode?: 'levels' | 'urgency' };

export const runRecommendation = async (source: string, tasks: Task[], catalog: Task[], config: Config, options: RecommendOptions = {}): Promise<Task[]> => {
  const now = options.now ?? localNow();
  const candidates = options.list ? tasks : executableTasks(tasks, catalog, now);
  const order = (mode: 'levels' | 'urgency'): string[] => [...candidates].sort((a, b) => compareTuple(sortKey(a, mode, config, now), sortKey(b, mode, config, now))).map(task => task.id);
  const context = { version: 1, now, mode: options.mode ?? config.priority.mode, view: options.list ? 'list' : 'focus', limit: options.list ? candidates.length : config.focus.count, previous: options.previous ?? [], orders: { levels: order('levels'), urgency: order('urgency') }, all: catalog };
  const input = { tasks: candidates.map(task => ({ ...task, urgency: urgency(task, config, now) })), context };
  const quickjs = await (engine ??= newQuickJSWASMModuleFromVariant(variant));
  using vm = quickjs.newContext();
  vm.runtime.setMemoryLimit(32 * 1024 * 1024);
  vm.runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 1000;
  vm.runtime.setInterruptHandler(() => Date.now() > deadline);
  const payload = vm.newString(JSON.stringify(input));
  vm.setProp(vm.global, '__atd_input', payload); payload.dispose();
  const result = vm.evalCode(`"use strict";\n${source}\n;const input = JSON.parse(__atd_input);\nconst output = recommend(input.tasks, input.context);\nif (!Array.isArray(output) || output.some(id => typeof id !== 'string')) throw new Error('recommend 必须返回任务编号数组');\nJSON.stringify(output);`, 'recommendation.js');
  if (result.error) {
    const error = vm.dump(result.error) as { message?: string };
    result.error.dispose();
    throw new Error(`推荐脚本执行失败：${error.message ?? '执行中断'}`);
  }
  const ids = JSON.parse(vm.getString(result.value)) as string[]; result.value.dispose();
  const byId = new Map(candidates.map(task => [task.id, task]));
  if (new Set(ids).size !== ids.length) throw new Error('推荐脚本返回重复任务编号');
  if (ids.some(id => !byId.has(id))) throw new Error('推荐脚本返回未知或不可执行的任务编号');
  const retained = options.list ? [] : (options.previous ?? []).filter(id => ids.includes(id));
  const ordered = [...retained, ...ids.filter(id => !retained.includes(id))];
  return (options.list ? ordered : ordered.slice(0, config.focus.count)).map(id => byId.get(id)!);
};
