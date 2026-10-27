import { ApplicationService } from '../../../src/app/service.js';
import { TaskSchema, type Task, type Reminder } from '../../../src/contracts.js';
import { groups, nestTasks, formatDate } from '../../../src/core/agenda.js';
import { parse, describeRecur, recurToInput, parseRecur, shiftDateOnly, scanDate, scanTime } from '../../../src/core/parse.js';
import { localNow, utcNow, newId, cloneTask, ACTIVE_STATES, isOverdue } from '../../../src/core/task.js';
import { filterTasks } from '../../../src/core/query.js';
import { mergeUnion } from '../../../src/sync/merge.js';
import { projectSummary, tagSummary, collectStats, exportTasks } from '../../../src/core/report.js';
import { native, request } from './bridge.js';
import { MobileStore, records, jsonl } from './store.js';
import { loadConfig, readConfig, configText } from './config.js';
import { configureSync, syncDirectory, syncStatus, type SyncSettings } from './sync.js';
import { dependencyCandidates, planDependencies, blockedDependencies, dependencyOrder, dependencyIds, extractDependencies, type DependencyRequest } from '../../../src/core/dependencies.js';
import { dateKey, weekDays, monthDays, completedByDate, quadrant } from '../../../src/core/calendar.js';
import { AutoSave } from './autosave.js';
import type { MapViewState } from './dependency-map.js';
import { recommend } from '../../../src/app/recommendation.js';
import { taskAgenda } from '../../../src/app/task-view.js';
import { projectAgenda } from '../../../src/core/projects.js';
import { recommendationTemplates, runRecommendation } from '../../../src/core/recommendation.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const result = document.getElementById(id);
  if (!result) throw new Error(`界面元素不存在：${id}`);
  return result as T;
};
const store = new MobileStore();
const service = new ApplicationService(store);
let config = await loadConfig();
let tasks = await store.tasks();
let page = 'tasks';
let taskView = config.ui.start_view === 'gtd' ? 'focus' : 'list';
let focusPrevious: string[] = [];
const mapState: MapViewState = { zoom: 1, showIndependent: false };
let disposeMap: (() => void) | undefined;
let renderRevision = 0;
let filter = 'agenda';
let selecting = false;
let selected = new Set<string>();
let query = '';
let busy = false;
let activeEditor: AutoSave | undefined;
let dependencyCatalog = await service.dependencyTasks();
let calendarMode = 'month';
let calendarDate = localNow().slice(0, 10);
let matrixSelection = 0;
let renderedTasks: Task[] = [];
let parentId: string | undefined;
let noticeTimer = 0;
const dialog = $<HTMLDialogElement>('dialog');
const paths: Record<string, string> = {
  tasks: 'M5 4h14v16H5z M8 9l1 1 2-2 M13 9h3 M8 15l1 1 2-2 M13 15h3',
  calendar: 'M4 6h16v14H4z M8 3v6 M16 3v6 M4 10h16 M8 14h2 M14 14h2',
  stats: 'M5 20V12 M12 20V4 M19 20V8', more: 'M5 6h14 M5 12h14 M5 18h14',
  plus: 'M12 5v14 M5 12h14', check: 'M4 11v3h3v3h3v-3h3v-3h3V8h3V5', undo: 'M7 4v3H4v3h3v3 M4 10h13v3h3v7H10',
  select: 'M4 4h16v16H4z M7 11v3h3v-3h3V8h3', search: 'M4 3h11v11H4z M15 14h3v3h3v4',
  sync: 'M4 9V5h13V2 M17 5h4v4 M20 15v4H7v3 M7 19H3v-4',
  folder: 'M3 6h7l2 3h9v11H3z', tag: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  archive: 'M3 4h18v5H3z M5 9v12h14V9 M9 13h6', export: 'M12 15V3 M7 8l5-5 5 5 M4 14v7h16v-7',
  map: 'M12 2l3 3-3 3-3-3z M5 10l3 3-3 3-3-3z M19 10l3 3-3 3-3-3z M12 17l3 3-3 3-3-3z M10 7l-3 4 M14 7l3 4 M7 15l3 4 M17 15l-3 4',
  import: 'M12 3v12 M7 10l5 5 5-5 M4 14v7h16v-7', settings: 'M8 5h8v3h3v8h-3v3H8v-3H5V8h3z M10 10h4v4h-4z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
  bell: 'M8 5h8v3h3v8h2v3H3v-3h2V8h3z M10 21h4', help: 'M4 4h16v16H4z M8 8h7v4h-3v3 M12 18v1',
};
const icon = (name: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] ?? paths.tasks!); svg.append(path); return svg;
};
const en: Record<string, string> = { '任务': 'Tasks', '日程': 'Schedule', '统计': 'Statistics', '更多': 'More', '今天': 'Today', '接下来': 'Upcoming', '全部任务': 'All tasks', '等待': 'Waiting', '已完成': 'Completed', '已取消': 'Cancelled', '选择任务': 'Select tasks', '撤销操作': 'Undo', '添加任务': 'Add task', '关闭': 'Close', '保存任务': 'Save task', '保存修改': 'Save changes', '一行输入': 'Quick input', '任务标题': 'Title', '备注': 'Notes', '截止时间': 'Due date', '优先级': 'Priority', '项目': 'Project', '标签': 'Tags', '父任务': 'Parent task', '等待日期': 'Waiting until', '重复规则': 'Recurrence', '提醒': 'Reminders', '状态': 'Status', '待办': 'To do', '会议': 'Meeting', '取消任务': 'Cancel task', '删除任务': 'Delete task', '重新打开': 'Reopen', '推迟提醒': 'Snooze', '添加子任务': 'Add subtask', '完成任务': 'Complete task', '确认删除': 'Delete', '连同子任务完成': 'Complete with subtasks', '仅完成父任务': 'Complete parent only', '返回待办': 'Return to todo', '等到明天': 'Defer to tomorrow', '标记会议': 'Mark as meeting', '排序：优先级': 'Sort: priority', '排序：紧急度': 'Sort: urgency', '搜索与查询': 'Search and query', '清空搜索': 'Clear search', '归档': 'Archive', '导入': 'Import', '导出': 'Export', '设置': 'Settings', '同步': 'Sync', '使用帮助': 'Help', '近七天完成': 'Completed in 7 days', '近三十天完成': 'Completed in 30 days', '未完成': 'Open', '逾期': 'Overdue', '今天到期': 'Due today', '本周到期': 'Due this week', '待发提醒': 'Pending reminders', '重复任务': 'Recurring tasks', '恢复任务': 'Restore task', '保存配置': 'Save configuration', '立即同步': 'Sync now', '保存同步设置': 'Save sync settings', '保存导出文件': 'Save export', '分享导出文件': 'Share export', '添加提醒': 'Add reminder', '删除提醒': 'Remove reminder', '逐项填写': 'Edit fields', '没有任务': 'No tasks', '可以安心休息一下': 'Enjoy a little breathing room', '取消选择': 'Clear selection', '全选当前结果': 'Select all results' };
Object.assign(en, {
  '任务列表': 'Task list', '依赖地图': 'Dependency map', '查看依赖地图': 'View dependency map',
  '完成': 'Complete', '未设置': 'Unset', '排序方式': 'Sorting', '界面语言': 'Language', '跟随系统': 'System language',
  '提醒时间': 'Reminder time', '通知方式': 'Delivery hooks', '已投递': 'Delivered', '投递失败': 'Delivery failed', '等待投递': 'Pending',
  '查看等待任务': 'Show waiting tasks', '子任务': 'Subtasks', '最紧急的任务': 'Most urgent tasks', '归档超过多少天的历史': 'Archive history older than days',
  '导入数据': 'Import data', '选择文件': 'Choose file', '导出格式': 'Export format', '导出范围': 'Export scope', '完整备份': 'Full backup', '当前查询结果': 'Current results',
  '完整配置 TOML': 'Full TOML configuration', '自定义通知方式': 'Custom delivery hooks', '开启系统通知': 'Enable notifications', '开启精确提醒': 'Enable exact alarms', '开启提醒权限': 'Enable reminder permissions',
  '仓库地址': 'Repository URL', '分支': 'Branch', 'Git 用户名': 'Git username', '访问令牌': 'Access token', '提交姓名': 'Commit author', '提交邮箱': 'Commit email', '推迟分钟': 'Snooze minutes',
  '查看所有状态的任务': 'Browse tasks in every state', '按项目查看任务与完成数量': 'Browse projects and completion counts', '按标签浏览任务': 'Browse tasks by tag',
  '整理已完成任务与恢复历史': 'Archive finished tasks and restore history', '连接你的私有 Git 仓库': 'Connect your private Git repository', '导入 JSONL、JSON 或完整备份': 'Import JSONL, JSON or a full backup',
  '备份、CSV 与 Markdown': 'Backups, CSV and Markdown', '通知、排序、语言与邮件': 'Notifications, sorting, language and email', '一行输入与查询语法': 'Quick input and query syntax',
  '日期、优先级、标签、提醒与重复规则会自动识别。': 'Dates, priorities, tags, reminders and recurrence are recognized automatically.',
  '导入时按任务编号合并，同一任务保留更新时间较新的记录。': 'Import merges task IDs and keeps the more recently modified record.',
  '自定义通知方式填写名称与 HTTPS webhook 地址；提醒中填写对应名称即可发送任务 JSON。邮件提醒使用配置中的 email。': 'Map custom hook names to HTTPS webhook URLs. Use a hook name in a reminder to send the task JSON. Email uses the email section of the configuration.',
  '手机操作': 'Phone controls', '同步与备份': 'Sync and backups', '查询语法': 'Query syntax', '提醒与等待': 'Reminders and waiting',
  '详细统计': 'Detailed statistics', '暂时等待': 'Deferred tasks', '包含备注': 'Tasks with notes', '投递失败提醒': 'Failed reminders', '最早未完成任务的天数': 'Oldest open task in days',
  '任务详情': 'Task details', '一行一个任务': 'One task per line', '检查任务': 'Review tasks', '返回修改': 'Edit input', '已经保存': 'Saved', '正在保存': 'Saving', '等待保存': 'Pending save', '保存未完成': 'Save failed',
  '项目与标签': 'Project and tags', '重复与等待': 'Recurrence and waiting', '其他操作': 'Other actions', '查找依赖任务': 'Find prerequisite', '移除依赖': 'Remove prerequisite', '放弃未保存修改': 'Discard unsaved changes',
  '日历': 'Day', '周历': 'Week', '月历': 'Month', '重要度': 'Priority', '四象限': 'Matrix', '上一段': 'Previous', '下一段': 'Next', '返回今天': 'Today',
  '重要且紧急': 'Important and urgent', '重要不紧急': 'Important, not urgent', '不重要但紧急': 'Urgent, not important', '不重要不紧急': 'Neither important nor urgent',
  '完成记录': 'Completion activity', '显示完成方块': 'Show activity squares', '完成记录范围': 'Activity period', '最近三个月': 'Last three months', '全年': 'Full year', '较少': 'Less', '较多': 'More',
  '明天 下午3点 复盘 #工作 proj:日常 很急 >>准备材料\n日期与时间支持中英文，剩余内容成为标题。': 'tomorrow 3pm Review #work proj:daily urgent >>Prepare materials\nChinese and English dates and times are supported. Remaining text becomes the title.',
  '*每天 · *每2周 · *每周三 · *每月 · *每年 · *工作日\n完成后会生成下一次任务，保留完成历史。': '*daily · *2w · *weekly:wed · *monthly · *yearly · *weekdays\nCompletion creates the next occurrence and preserves history.',
  '@18:30 · @30m · @9:00:toast,email\n@none 关闭自动提醒。~下周一 设置等待日期。': '@18:30 · @30m · @9:00:toast,email\n@none disables automatic reminders. ~next monday defers a task.',
  'due:week · due:none · wait:any · status:done\n#工作 · +高 · -低 · project:日常\nhas:notes · has:recur · parent:任务编号\n/关键字 搜索标题、项目、标签和备注。': 'due:week · due:none · wait:any · status:done\n#work · +高 · -低 · project:daily\nhas:notes · has:recur · parent:task-id\n/keyword searches titles, projects, tags and notes.',
  '点击任务查看和编辑详情；点击左侧方框完成任务。右上角选择按钮支持批量操作；撤销按钮可以撤销整次操作。': 'Tap a task to edit its details, or its checkbox to complete it. Use the selection button for batch actions. Undo reverses one whole operation.',
  '使用 HTTPS Git 仓库和访问令牌同步。令牌保存在 Android 加密存储中。完整备份包括任务、归档和配置。': 'Sync through an HTTPS Git repository and access token. Tokens use Android encrypted storage. Full backups include tasks, archives and configuration.',
});
const isEnglish = (): boolean => config.ui.lang === 'en' || (config.ui.lang === 'auto' && navigator.language.startsWith('en'));
const tr = (text: string): string => isEnglish() ? en[text] ?? text : text;
const message = (zh: string, english: string): string => isEnglish() ? english : zh;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = tr(text); if (className) node.className = className; return node;
};
const rawEl = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] => {
  const node = el(tag, undefined, className); node.textContent = text; return node;
};
const button = (text: string, action: () => void | Promise<void>, className = 'secondary'): HTMLButtonElement => {
  const node = el('button', tr(text), className); node.type = 'button'; node.onclick = () => { void action(); }; return node;
};
const rawButton = (text: string, action: () => void | Promise<void>, className = 'secondary'): HTMLButtonElement => {
  const node = button('', action, className); node.textContent = text; return node;
};
const notify = (text: string, error = false): void => {
  clearTimeout(noticeTimer); const node = $('notice'); node.textContent = text; node.classList.toggle('error', error); node.hidden = false;
  noticeTimer = window.setTimeout(() => { node.hidden = true; }, error ? 9000 : 3500);
};
const showError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  const target = document.getElementById('form-error');
  if (dialog.open && target) target.textContent = message; else notify(message, true);
};
const refresh = async (): Promise<void> => { tasks = await store.tasks(); dependencyCatalog = await service.dependencyTasks(); config = await loadConfig(); render(); };
const closeDialog = async (): Promise<void> => {
  try { await activeEditor?.flush(); activeEditor = undefined; dialog.close(); }
  catch (error) { showError(error); }
};
const act = async (operation: () => Promise<unknown>, message = '已保存', undo = true, animateId?: string): Promise<void> => {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  try {
    const outgoing = animateId ? document.querySelector<HTMLElement>(`article[data-id="${CSS.escape(animateId)}"]`) : undefined;
    const position = outgoing ? [...document.querySelectorAll('#content article[data-id]')].indexOf(outgoing) : -1;
    await store.run(operation, undo); dialog.close(); selected.clear();
    if (outgoing) {
      const title = outgoing.querySelector<HTMLElement>('.task-title')!;
      title.style.backgroundImage = 'linear-gradient(currentColor,currentColor)'; title.style.backgroundRepeat = 'no-repeat'; title.style.backgroundPosition = 'left 55%';
      await title.animate([{ backgroundSize: '0% 2px' }, { backgroundSize: '100% 2px' }], { duration: 240, fill: 'forwards', easing: 'ease-out' }).finished;
      outgoing.classList.add('completion-outgoing');
    }
    const oldHeight = outgoing?.getBoundingClientRect().height ?? 0;
    await refresh();
    await pendingView;
    if (outgoing) {
      const incoming = document.querySelectorAll<HTMLElement>('#content article[data-id]')[position];
      const container = incoming?.parentElement ?? document.querySelector('#content .task-list');
      if (container) {
        outgoing.style.height = `${oldHeight}px`; outgoing.style.overflow = 'hidden'; outgoing.setAttribute('aria-hidden', 'true'); outgoing.inert = true;
        container.insertBefore(outgoing, incoming ?? null);
        if (incoming) await incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'both' }).finished;
        await outgoing.animate([{ height: `${oldHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 300, fill: 'forwards', easing: 'cubic-bezier(.22,.8,.3,1)' }).finished;
        outgoing.remove();
      }
    }
    notify(message);
  }
  catch (error) { showError(error); store.reload(); await refresh(); }
  finally { busy = false; document.body.classList.remove('busy'); }
};
const open = (title: string): HTMLElement => {
  dialog.close(); const content = $('dialog-content'); content.replaceChildren(el('div', undefined, 'handle'));
  activeEditor = undefined;
  const header = el('div', undefined, 'dialog-header'); const close = button('', closeDialog, 'icon-button'); close.textContent = '×'; close.setAttribute('aria-label', tr('关闭')); header.append(el('h2', tr(title)), close);
  content.append(header); const error = el('div', '', 'error-box'); error.id = 'form-error'; content.append(error); dialog.showModal(); dialog.scrollTop = 0; return content;
};
const field = (container: HTMLElement, label: string, value = '', type = 'text'): HTMLInputElement => {
  const wrapper = el('label', tr(label), 'form-field'); const input = el('input'); input.type = type; input.value = value; input.setAttribute('aria-label', tr(label)); wrapper.append(input); container.append(wrapper); return input;
};
const selectField = (container: HTMLElement, label: string, values: Array<[string, string]>, current: string, translateValues = true): HTMLSelectElement => {
  const wrapper = el('label', tr(label), 'form-field'); const node = el('select'); node.setAttribute('aria-label', tr(label));
  for (const [value, name] of values) { const option = rawEl('option', translateValues ? tr(name) : name); option.value = value; node.append(option); }
  node.value = current; wrapper.append(node); container.append(wrapper); return node;
};
const textarea = (container: HTMLElement, label: string, value: string): HTMLTextAreaElement => {
  const wrapper = el('label', tr(label), 'form-field'); const node = el('textarea'); node.value = value; node.setAttribute('aria-label', tr(label)); wrapper.append(node); container.append(wrapper); return node;
};
const draft = (input: string): Task => {
  const parsed = parse(input, localNow(), config.priority.levels);
  const value = { id: newId(), title: parsed.title, status: parsed.wait && parsed.wait > localNow().slice(0, 10) ? 'waiting' : 'todo', due: parsed.due, priority: parsed.priority, project: parsed.project, parent: parentId ?? parsed.parent, wait: parsed.wait, recur: parsed.recur, tags: parsed.tags, notes: parsed.notes ?? '', reminders: parsed.reminders.map(({ relative: _relative, ...reminder }) => reminder), entry: utcNow(), modified: utcNow() };
  return TaskSchema.parse(value);
};
const addDialog = (parent?: string): void => {
  parentId = parent;
  const inputScreen = (text = ''): void => {
    const content = open('添加任务');
    if (!parent) content.append(button(message('创建项目待办', 'Create project todo'), projectDialog));
    content.append(el('p', '每一行会成为一个任务。日期、标签和依赖可以一起填写。', 'helper'));
    const input = textarea(content, '一行一个任务', text); input.rows = 6;
    input.placeholder = '整理资料\n写报告 after:整理资料 明天\n发邮件 在「写报告」之后';
    const count = el('p', '', 'status'); content.append(count);
    const update = (): void => { count.textContent = message(`${input.value.split(/\r?\n/).filter(line => line.trim()).length} 个任务`, `${input.value.split(/\r?\n/).filter(line => line.trim()).length} tasks`); }; input.oninput = update; update();
    content.append(button('检查任务', () => {
      const inputs = input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!inputs.length) { showError(new Error('请填写至少一个任务')); return; }
      const now = localNow();
      const defaultDate = page === 'calendar' && ['day', 'week', 'month'].includes(calendarMode) ? calendarDate : undefined;
      const drafts = inputs.map(line => {
        const task = draft(line);
        if (defaultDate && !task.due) task.due = `${defaultDate}T00:00:00`;
        return task;
      });
      const effectiveInputs = inputs.map(line => defaultDate && !parse(line, now, config.priority.levels).due ? `${defaultDate} ${line}` : line);
      const requests = inputs.map(line => parse(line, now, config.priority.levels).dependencies);
      const choices: (string | undefined)[][] = drafts.map(() => []);
      const content = open('检查任务'); content.append(el('p', '确认任务内容和执行顺序，然后统一添加。', 'helper'));
      const rows = el('div', undefined, 'batch-review'); content.append(rows);
      const save = button(`添加 ${inputs.length} 个任务`, () => act(() => service.addBatch(effectiveInputs, now, choices, parent, drafts.map(task => task.id)), `已经添加 ${inputs.length} 个任务`), 'primary');
      const renderReview = (): void => {
        rows.replaceChildren(); $('form-error').textContent = ''; let unresolved = false;
        for (const [index, task] of drafts.entries()) {
          const row = el('section', undefined, 'review-row'); row.append(el('div', `${index + 1}. ${task.title || '标题需要填写'}`, 'review-title'));
          row.append(el('p', [task.due?.replace('T', ' ').slice(0, 16), task.priority, task.project, ...task.tags.map(tag => `#${tag}`)].filter(Boolean).join(' · '), 'task-meta'));
          if (task.notes) row.append(rawEl('p', task.notes, 'review-notes'));
          if (!task.title) unresolved = true;
          for (const [requestIndex, dependency] of requests[index]!.entries()) {
            row.append(el('p', `${dependency.direction === 'after' ? '需要先完成' : '先于'}：${dependency.reference}`, 'dependency-label'));
            const candidates = dependencyCandidates(dependency.reference, [...dependencyCatalog, ...drafts]);
            if (!choices[index]![requestIndex] && candidates.length === 1) choices[index]![requestIndex] = candidates[0]!.task.id;
            if (!candidates.length) { row.append(el('p', '没有匹配任务，请返回修改名称或添加相应任务。', 'error-box')); unresolved = true; }
            else for (const candidate of candidates) {
              const chosen = choices[index]![requestIndex] === candidate.task.id;
              const option = button('', () => { choices[index]![requestIndex] = candidate.task.id; renderReview(); }, `dependency-option${chosen ? ' active' : ''}`);
              option.setAttribute('aria-label', `选择依赖 ${candidate.task.id} ${candidate.task.title}`); option.setAttribute('aria-pressed', String(chosen));
              option.append(rawEl('span', candidate.task.title), el('small', `${candidate.task.id} · ${tr(statusName(candidate.task.status))}${chosen ? ' · 已选择' : ''}`)); row.append(option);
            }
            if (!choices[index]![requestIndex]) unresolved = true;
          }
          rows.append(row);
        }
        try { if (!unresolved) planDependencies(drafts, requests, dependencyCatalog, choices); }
        catch (error) { showError(error); unresolved = true; }
        save.disabled = unresolved;
      };
      content.append(button('返回修改', () => inputScreen(input.value)), save); renderReview();
    }, 'primary'));
    input.focus();
  };
  inputScreen();
};
const projectDialog = (): void => {
  const content = open(message('创建项目待办', 'Create project todo'));
  const title = field(content, message('项目标题', 'Project title'));
  title.placeholder = '学习信息物理系统';
  const steps = textarea(content, message('项目步骤，每行一个', 'Project steps, one per line'), ''); steps.rows = 7;
  steps.placeholder = '学习第1章\n学习第2章\n学习第3章\n学习第4章\n学习第5章';
  content.append(el('p', message('步骤按填写顺序建立前置依赖。列表展示项目和当前步骤；完成项目会同时完成剩余步骤。', 'Steps run in order. The list shows the project and its current step. Completing the project completes its remaining steps.'), 'helper'));
  content.append(button(message('创建项目', 'Create project'), () => act(() => service.addProject(title.value, steps.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)), message('已经创建项目', 'Project created')), 'primary'));
};
const complete = async (ids: string[]): Promise<void> => {
  if (busy) return;
  if (ids.length === 1 && tasks.find(task => task.id === ids[0])?.kind === 'project') {
    await act(() => service.complete(ids[0]!), '已完成项目', true, ids[0]); return;
  }
  const children = tasks.filter(task => task.parent && ids.includes(task.parent) && ACTIVE_STATES.has(task.status) && !ids.includes(task.id));
  const execute = (cascade: boolean) => act(async () => {
    const queue = new Set(ids);
    if (cascade) {
      let size = -1;
      while (size !== queue.size) { size = queue.size; for (const task of tasks) if (task.parent && queue.has(task.parent) && ACTIVE_STATES.has(task.status)) queue.add(task.id); }
    }
    const ordered = dependencyOrder((await store.tasks()).filter(task => queue.has(task.id)));
    for (const task of ordered) if (ACTIVE_STATES.has(task.status)) await service.complete(task.id);
  }, '已完成任务', true, ids.length === 1 ? ids[0] : undefined);
  if (children.length) {
    const content = open('完成任务'); content.append(el('p', message(`还有 ${children.length} 个未完成的子任务。`, `${children.length} subtasks are still open.`), 'helper'), button('连同子任务完成', () => execute(true), 'primary'), button('仅完成父任务', () => execute(false)));
  } else await execute(false);
};
const deleteTasks = (ids: string[]): void => {
  const content = open('删除任务'); const children = tasks.filter(task => task.parent && ids.includes(task.parent) && !ids.includes(task.id));
  const dependent = tasks.filter(task => !ids.includes(task.id) && dependencyIds(task).some(id => ids.includes(id)));
  content.append(el('p', `删除 ${ids.length} 个任务。${children.length ? ` ${children.length} 个子任务会保留。` : ''}${dependent.length ? ` ${dependent.length} 个任务将需要重新选择依赖。` : ''}`, 'helper'), button('确认删除', () => act(async () => { for (const id of ids) await service.remove(id); }, '已删除任务'), 'primary danger'));
};
const editDialog = (task: Task): void => {
  let base = cloneTask(task); const content = open('任务详情');
  const savedStatus = el('p', '已经保存', 'save-status'); savedStatus.setAttribute('role', 'status'); content.append(savedStatus);
  const discard = button('放弃未保存修改', () => { activeEditor?.discard(); activeEditor = undefined; dialog.close(); }); discard.hidden = true; content.append(discard);
  const title = textarea(content, '任务标题', task.title); title.rows = 2;
  const titleRelations = el('div'); content.append(titleRelations);
  let titleChoices: (string | undefined)[] = [], titleSignature = '';
  const titleInput = () => title.value === base.title ? { source: title.value, dependencies: [] as DependencyRequest[] } : extractDependencies(title.value, reference => {
    const date = scanDate(reference, localNow().slice(0, 10)), time = scanTime(reference);
    return !!date && date.start === 0 && date.end === reference.length || !!time && time.start === 0 && time.end === reference.length;
  });
  const renderTitleRelations = (): void => {
    const parsed = titleInput(), signature = JSON.stringify(parsed.dependencies);
    if (titleSignature !== signature) { titleChoices = []; titleSignature = signature; }
    titleRelations.replaceChildren();
    for (const [index, dependency] of parsed.dependencies.entries()) {
      titleRelations.append(el('p', `${dependency.direction === 'after' ? '需要先完成' : '先于'}：${dependency.reference}`, 'dependency-label'));
      const matches = dependencyCandidates(dependency.reference, dependencyCatalog);
      if (matches.length === 1) titleChoices[index] = matches[0]!.task.id;
      for (const candidate of matches) {
        const option = button('', () => { titleChoices[index] = candidate.task.id; renderTitleRelations(); autosave.changed(); }, `dependency-option${titleChoices[index] === candidate.task.id ? ' active' : ''}`);
        option.setAttribute('aria-label', `选择依赖 ${candidate.task.id} ${candidate.task.title}`); option.append(rawEl('span', candidate.task.title), el('small', `${candidate.task.id} · ${tr(statusName(candidate.task.status))}`)); titleRelations.append(option);
      }
    }
  };
  title.addEventListener('input', renderTitleRelations);
  const due = field(content, '截止时间', task.due?.slice(0, 16) ?? '', 'datetime-local');
  const priority = selectField(content, '优先级', [['', tr('未设置')], ...config.priority.levels.map(level => [level, level] as [string, string])], task.priority ?? '', false);
  const notes = textarea(content, '备注', task.notes);
  const section = (label: string): HTMLDetailsElement => { const node = el('details'); node.append(el('summary', label)); content.append(node); return node; };
  const projectSection = section('项目与标签');
  const project = field(projectSection, '项目', task.project ?? '');
  const tags = field(projectSection, '标签', task.tags.join(' '));
  const scheduling = section('重复与等待');
  const recur = field(scheduling, '重复规则', task.recur ? recurToInput(task.recur).replace(/^\*/, '') : ''); recur.placeholder = '每天 / 每2周 / 每月 / 工作日';
  const wait = field(scheduling, '等待日期', task.wait ?? '', 'date');
  const status = selectField(scheduling, '状态', ['todo', 'waiting', 'meeting', 'done', 'cancelled', ...(!['todo', 'waiting', 'meeting', 'done', 'cancelled'].includes(task.status) ? [task.status] : [])].map(value => [value, statusName(value)]), task.status);
  const relations = section(`执行顺序 · ${dependencyIds(task).length}`);
  const parent = selectField(relations, '父任务', [['', tr('未设置')], ...tasks.filter(item => item.id !== task.id).map(item => [item.id, item.title] as [string, string]), ...(task.parent && !tasks.some(item => item.id === task.parent) ? [[task.parent, `${task.parent}（父任务已归档或删除）`] as [string, string]] : [])], task.parent ?? '', false);
  let dependencies = dependencyIds(task);
  const dependencyRows = el('div'); relations.append(dependencyRows);
  const search = field(relations, '查找依赖任务'); search.autocomplete = 'off'; const candidates = el('div'); relations.append(candidates);
  const renderDependencies = (): void => {
    dependencyRows.replaceChildren();
    relations.querySelector('summary')!.textContent = `执行顺序 · ${dependencies.length}`;
    for (const id of dependencies) {
      const prerequisite = dependencyCatalog.find(item => item.id === id);
      const row = el('div', undefined, 'dependency-row'); row.append(rawEl('span', prerequisite?.title ?? `任务 ${id} 已移除`), el('small', prerequisite ? tr(statusName(prerequisite.status)) : '需要重新选择'));
      row.append(button('移除依赖', () => { dependencies = dependencies.filter(value => value !== id); renderDependencies(); autosave.changed(); })); dependencyRows.append(row);
    }
    for (const follower of tasks.filter(item => dependencyIds(item).includes(task.id))) dependencyRows.append(button(`后续任务：${follower.title}`, async () => { try { await autosave.flush(); activeEditor = undefined; editDialog(follower); } catch (error) { showError(error); } }, 'dependency-option'));
  };
  search.oninput = () => {
    candidates.replaceChildren();
    for (const candidate of dependencyCandidates(search.value, dependencyCatalog).filter(item => item.task.id !== task.id && !dependencies.includes(item.task.id))) {
      const option = button('', () => { dependencies.push(candidate.task.id); search.value = ''; candidates.replaceChildren(); renderDependencies(); autosave.changed(); }, 'dependency-option');
      option.append(rawEl('span', candidate.task.title), el('small', `${candidate.task.id} · ${tr(statusName(candidate.task.status))}`));
      option.setAttribute('aria-label', `添加依赖 ${candidate.task.id} ${candidate.task.title}`); candidates.append(option);
    }
  };
  renderDependencies();
  const reminderSection = el('details'); reminderSection.append(el('summary', `${tr('提醒')} · ${task.reminders.length}`)); content.append(reminderSection);
  const reminders: Array<{ reminder: Reminder; at: HTMLInputElement; hooks: HTMLInputElement; row: HTMLElement }> = [];
  const addReminder = (reminder: Reminder): void => {
    const row = el('div', undefined, 'reminder-row'); reminderSection.append(row);
    const at = field(row, '提醒时间', reminder.at.slice(0, 16), 'datetime-local'); const hooks = field(row, '通知方式', reminder.hooks.join(','));
    row.append(el('p', reminder.fired ? '已投递' : reminder.dead ? '投递失败' : '等待投递', 'helper'), button('删除提醒', () => { row.remove(); reminders.splice(reminders.findIndex(item => item.row === row), 1); autosave.changed(); }));
    at.addEventListener('input', () => autosave.changed()); hooks.addEventListener('input', () => autosave.changed());
    reminders.push({ reminder, at, hooks, row });
  };
  for (const reminder of task.reminders) addReminder(reminder);
  reminderSection.append(button('添加提醒', () => { addReminder({ id: `rem-${crypto.randomUUID()}`, at: due.value || `${shiftDateOnly(localNow().slice(0, 10), 1)}T09:00`, hooks: ['toast'], fired: false, dead: false }); autosave.changed(); }));
  const group = `editor-${task.id}-${crypto.randomUUID()}`;
  const autosave = new AutoSave(async () => {
    if (!title.value.trim()) throw new Error('标题不能为空');
    const originalTitle = title.value, parsedTitle = titleInput(), originalDependencies = JSON.stringify(dependencies), choices = [...titleChoices];
    const rule = recur.value.trim() ? parseRecur(recur.value.trim().replace(/^\*/, '')) : undefined;
    if (recur.value.trim() && !rule) throw new Error('重复规则无法识别');
    if (status.value === 'done' && base.status !== 'done') {
      throw new Error('请使用完成任务按钮处理重复任务与子任务');
    }
    let saved: Task | undefined;
    await store.run(async () => {
      const current = await store.find(base.id);
      const updated = TaskSchema.parse({ ...base, title: (parsedTitle.dependencies.length ? parsedTitle.source : title.value).trim().replace(/\s+/gu, ' '), due: due.value === (base.due?.slice(0, 16) ?? '') ? base.due : due.value || undefined, priority: priority.value || undefined, project: project.value.trim() || undefined, tags: tags.value.split(/[\s,，]+/).filter(Boolean).map(tag => tag.replace(/^#/, '')), parent: parent.value || undefined, wait: wait.value || undefined, status: status.value, recur: rule, notes: notes.value, dependsOn: dependencies, reminders: reminders.map(item => {
        if (!item.at.value || !item.hooks.value.trim()) throw new Error('请填写提醒时间和通知方式');
        const changed = item.at.value !== item.reminder.at.slice(0, 16) || item.hooks.value !== item.reminder.hooks.join(',');
        const runtime = current?.reminders.find(reminder => reminder.id === item.reminder.id);
        return !changed && runtime ? runtime : { ...item.reminder, at: item.at.value, hooks: item.hooks.value.split(',').map(value => value.trim()).filter(Boolean), fired: false, dead: false, attempts: 0, leaseOwner: undefined, leaseUntil: undefined };
      }), end: status.value === 'cancelled' ? (base.end ?? utcNow()) : status.value === 'done' ? base.end : undefined });
      if (!updated.title) throw new Error('请保留任务标题');
      delete updated.deps;
      if (parsedTitle.dependencies.length) {
        const existing = await store.tasks(); const changed = planDependencies([updated], [parsedTitle.dependencies], await service.dependencyTasks(), [choices]);
        if (changed.some(item => !existing.some(before => before.id === item.id))) throw new Error('归档中的任务不能新增依赖，请先恢复任务');
        const savedTasks = await store.saveMany(changed.map(value => ({ task: value, before: value.id === base.id ? base : existing.find(item => item.id === value.id)! })));
        saved = savedTasks.find(item => item.id === base.id)!;
      } else saved = await store.save(updated, base);
    }, true, group);
    base = saved!;
    for (const item of reminders) {
      const persisted = base.reminders.find(reminder => reminder.id === item.reminder.id);
      if (persisted && item.at.value === persisted.at.slice(0, 16) && item.hooks.value === persisted.hooks.join(',')) item.reminder = persisted;
    }
    await refresh();
    if (title.value === originalTitle && parsedTitle.dependencies.length) { title.value = base.title; renderTitleRelations(); }
    if (JSON.stringify(dependencies) === originalDependencies) dependencies = dependencyIds(base);
    renderDependencies();
  }, (state, error) => {
    savedStatus.textContent = tr({ pending: '等待保存', saving: '正在保存', saved: '已经保存', error: '保存未完成' }[state]); savedStatus.dataset.state = state;
    const primaryAction = content.querySelector<HTMLButtonElement>('[data-primary-task-action]');
    if (state === 'saved' && primaryAction) primaryAction.textContent = tr(ACTIVE_STATES.has(base.status) ? '完成任务' : '重新打开');
    discard.hidden = state !== 'error';
    if (error) showError(error); else $('form-error').textContent = '';
  });
  activeEditor = autosave;
  for (const input of [title, due, priority, notes, project, tags, recur, wait, status, parent]) {
    input.addEventListener('input', () => autosave.changed()); input.addEventListener('change', () => { void autosave.flush().catch(showError); });
  }
  const guarded = async (action: () => void | Promise<void>): Promise<void> => { try { await autosave.flush(); activeEditor = undefined; await action(); } catch (error) { showError(error); } };
  content.append(button('查看依赖地图', () => guarded(() => { dialog.close(); showMap(base.id); })));
  const footer = el('div', undefined, 'editor-footer'); content.append(footer);
  const primaryAction = button(ACTIVE_STATES.has(base.status) ? '完成任务' : '重新打开', () => guarded(() => ACTIVE_STATES.has(base.status) ? complete([base.id]) : act(() => service.reopen(base.id))), 'primary'); primaryAction.dataset.primaryTaskAction = ''; footer.append(primaryAction);
  const actions = section('其他操作'); actions.className = 'editor-actions';
  actions.append(button('等到明天', () => guarded(() => act(() => service.deferUntilTomorrow(task.id)))), button('标记会议', () => guarded(() => act(() => service.setStatus(task.id, 'meeting')))), button('取消任务', () => guarded(() => act(() => service.setStatus(task.id, 'cancelled')))));
  actions.append(button('返回待办', () => guarded(() => act(() => service.setStatus(task.id, 'todo')))), button('推迟提醒', () => guarded(() => snoozeDialog([task.id]))), button('添加子任务', () => guarded(() => addDialog(task.id))), button('删除任务', () => guarded(() => deleteTasks([task.id])), 'secondary danger'));
  const relatives = tasks.filter(item => item.parent === task.id);
  if (relatives.length) { content.append(el('p', '子任务', 'section-title')); for (const child of relatives) content.append(rawButton(child.title, () => guarded(() => editDialog(child)))); }
  content.append(el('p', `${task.id} · ${task.entry.replace('T', ' ').slice(0, 16)} UTC`, 'status'));
};
const snoozeDialog = (ids: string[]): void => {
  const content = open('推迟提醒'); const minutes = field(content, '推迟分钟', '10', 'number');
  content.append(button('保存修改', () => act(async () => { for (const id of ids) await service.snooze(id, Number(minutes.value)); }), 'primary'));
};
const statusName = (value: string): string => ({ todo: '待办', waiting: '等待', meeting: '会议', done: '已完成', cancelled: '已取消' }[value] ?? value);
const visible = (): Task[] => {
  const all = filterTasks(tasks, query, localNow().slice(0, 10), config.priority.levels);
  const today = localNow().slice(0, 10);
  if (filter === 'all') return all;
  if (filter === 'done') return all.filter(task => task.status === 'done' || task.status === 'cancelled');
  if (filter === 'waiting') return all.filter(task => task.status === 'waiting' || (task.wait && task.wait > today));
  if (filter === 'today') return all.filter(task => ACTIVE_STATES.has(task.status) && (!task.wait || task.wait <= today) && (task.due?.slice(0, 10) === today || isOverdue(task, today)));
  if (filter === 'upcoming') return all.filter(task => ACTIVE_STATES.has(task.status) && (!task.wait || task.wait <= today) && task.due && task.due.slice(0, 10) > today);
  return all;
};
const taskRow = (task: Task, depth = 0, archived = false): HTMLElement => {
  const row = el('article', undefined, `task-card${selected.has(task.id) ? ' selected' : ''}${!ACTIVE_STATES.has(task.status) ? ' finished' : ''}`); row.dataset.id = task.id;
  if (depth) row.style.marginLeft = `${Math.min(depth, 4) * 12}px`;
  const check = button('', () => selecting ? toggle(task.id) : ACTIVE_STATES.has(task.status) ? complete([task.id]) : act(() => service.reopen(task.id)), 'task-check');
  check.setAttribute('aria-label', selecting ? `${tr('选择任务')} ${task.title}` : `${tr(ACTIVE_STATES.has(task.status) ? '完成' : '重新打开')} ${task.title}`);
  const circle = el('span', undefined, `circle${selected.has(task.id) || task.status === 'done' ? ' checked' : ''}`);
  if (selected.has(task.id) || task.status === 'done') circle.append(icon('check')); check.append(circle);
  const body = button('', () => selecting ? toggle(task.id) : archived ? restoreDialog(task.id) : editDialog(task), 'task-body');
  const projectChild = depth > 0 && dependencyCatalog.some(parent => parent.id === task.parent && parent.kind === 'project');
  body.append(rawEl('span', `${projectChild ? '- ' : ''}${task.title}`, 'task-title')); const meta = el('span', undefined, 'task-meta'); body.append(meta);
  if (task.kind === 'project') {
    const steps = dependencyCatalog.filter(child => child.parent === task.id);
    meta.append(rawEl('span', message(`项目 · ${steps.filter(child => child.status === 'done').length}/${steps.length} 步骤`, `Project · ${steps.filter(child => child.status === 'done').length}/${steps.length} steps`), 'project-progress'));
  }
  if (taskView === 'focus' && task.parent) {
    const parent = dependencyCatalog.find(item => item.id === task.parent);
    if (parent) body.prepend(rawEl('span', parent.title, 'focus-project'));
  }
  if (task.due) meta.append(el('span', `${formatDate(task, localNow().slice(0, 10), config.agenda.date_format)} ${task.due.slice(11, 16) !== '00:00' ? task.due.slice(11, 16) : ''}`, `task-date${isOverdue(task, localNow().slice(0, 10)) ? ' late' : ''}`));
  if (task.priority) meta.append(rawEl('span', task.priority, `pill ${config.priority.levels.indexOf(task.priority) === config.priority.levels.length - 1 ? 'high' : config.priority.levels.indexOf(task.priority) === 0 ? 'low' : 'medium'}`));
  if (task.project) meta.append(rawEl('span', task.project));
  for (const tag of task.tags.slice(0, 3)) meta.append(el('span', `#${tag}`));
  if (task.recur) meta.append(el('span', `↻ ${describeRecur(task.recur)}`));
  if (task.status !== 'todo') meta.append(el('span', tr(statusName(task.status))));
  if (task.wait) meta.append(el('span', `~${task.wait}`));
  if (task.notes.trim()) meta.append(icon('tasks'));
  if (task.reminders.some(reminder => !reminder.fired && !reminder.dead)) meta.append(icon('bell'));
  const blocked = blockedDependencies(task, dependencyCatalog);
  if (blocked.length && ACTIVE_STATES.has(task.status)) meta.append(el('span', `等待 ${blocked.length} 个依赖`, 'blocked-mark'));
  if (!archived) row.append(check); row.append(body); return row;
};
const toggle = (id: string): void => { if (selected.has(id)) selected.delete(id); else selected.add(id); render(); };
const showMap = (id?: string): void => {
  page = 'tasks'; taskView = 'map'; selecting = false; selected.clear();
  if (id) { mapState.selected = id; mapState.route = undefined; mapState.left = undefined; mapState.top = undefined; mapState.zoom = 1; }
  render(); window.scrollTo(0, 0);
};
let pendingView: Promise<void> = Promise.resolve();
const render = (): void => {
  disposeMap?.(); disposeMap = undefined;
  const revision = ++renderRevision;
  $('heading').textContent = page === 'tasks' && taskView === 'focus' ? 'GTD / Flashcard' : tr(page === 'tasks' && taskView === 'map' ? '依赖地图' : { tasks: '任务', calendar: '日程', stats: '统计', more: '更多' }[page]!);
  $('subtitle').textContent = new Intl.DateTimeFormat(isEnglish() ? 'en' : 'zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  for (const [id, label] of [['undo', '撤销操作'], ['select', '选择任务'], ['add', '添加任务'], ['search', '搜索与查询'], ['clear-search', '清空搜索']]) $(id!).setAttribute('aria-label', tr(label!));
  $<HTMLInputElement>('search').placeholder = message('搜索任务，或输入 due:week #标签', 'Search tasks, or use due:week #tag');
  $('task-controls').hidden = page !== 'tasks'; $('add').hidden = page === 'more' || page === 'stats' || selecting || (page === 'tasks' && taskView === 'map');
  $('select').hidden = page !== 'tasks' || taskView !== 'list'; $('undo').hidden = page === 'more' || page === 'stats';
  $('list-controls').hidden = taskView !== 'list';
  const taskViews = $('task-views'); taskViews.replaceChildren();
  for (const [view, name] of [['list', '任务列表'], ['focus', 'GTD'], ['map', '依赖地图']]) {
    const choice = button(name!, () => { taskView = view!; selecting = false; selected.clear(); render(); }, taskView === view ? 'active' : '');
    choice.setAttribute('aria-pressed', String(taskView === view)); taskViews.append(choice);
  }
  const nav = $('navigation'); nav.replaceChildren();
  for (const [key, name] of [['tasks', '任务'], ['calendar', '日程'], ['stats', '统计'], ['more', '更多']]) {
    const item = button('', () => { page = key!; selecting = false; selected.clear(); if (page === 'calendar') filter = 'agenda'; render(); window.scrollTo(0, 0); }, page === key ? 'active' : ''); item.setAttribute('aria-label', tr(name!)); const mark = el('span', undefined, 'nav-icon'); mark.append(icon(key!)); item.append(mark, el('span', tr(name!))); nav.append(item);
  }
  const chips = $('filters'); chips.replaceChildren();
  for (const [key, name] of [['agenda', '待办'], ['today', '今天'], ['upcoming', '接下来'], ['waiting', '等待'], ['done', '已完成']]) chips.append(button(name!, () => { filter = key!; selected.clear(); render(); }, `chip${filter === key ? ' active' : ''}`));
  $('sort').textContent = tr(config.priority.mode === 'levels' ? '排序：优先级' : '排序：紧急度');
  const content = $('content'); content.replaceChildren();
  if (page === 'stats') renderStats(content);
  else if (page === 'more') renderMore(content);
  else if (page === 'calendar') renderCalendar(content);
  else if (taskView === 'focus') {
    pendingView = renderFocus(content, revision);
    void pendingView.catch(error => { if (revision === renderRevision) content.replaceChildren(el('p', String(error), 'error-box'), button('设置', settingsDialog)); });
  }
  else if (taskView === 'map') {
    content.append(el('p', message('正在加载地图', 'Loading map'), 'status'));
    void import('./dependency-map.js').then(({ mountMap }) => {
      if (revision !== renderRevision) return;
      disposeMap = mountMap(content, { catalog: dependencyCatalog, today: localNow().slice(0, 10), state: mapState, english: isEnglish(),
        archived: new Set(dependencyCatalog.filter(task => !tasks.some(item => item.id === task.id)).map(task => task.id)),
        open: id => { const task = tasks.find(task => task.id === id); if (task) editDialog(task); else restoreDialog(id); },
        complete: id => { mapState.selected = undefined; mapState.left = undefined; mapState.top = undefined; mapState.zoom = 1; void complete([id]); }, list: () => { taskView = 'list'; render(); } });
    }).catch(error => { if (revision === renderRevision) { content.replaceChildren(el('p', error instanceof Error ? error.message : String(error), 'error-box'), button(message('重新加载地图', 'Reload map'), render)); } });
  }
  else {
    const permissions = native<{ notifications: boolean; exact: boolean }>('permissions');
    const needsReminder = tasks.some(task => ACTIVE_STATES.has(task.status) && task.reminders.some(reminder => !reminder.fired && !reminder.dead));
    if (needsReminder && (!permissions.exact || !permissions.notifications)) content.append(button('开启提醒权限', settingsDialog, 'menu-item'));
    try {
      const list = visible();
      const agenda = projectAgenda(groups(list, config, config.priority.mode, localNow(), query, dependencyCatalog), dependencyCatalog);
      renderedTasks = filter === 'agenda' ? agenda.flatMap(group => group.tasks) : list;
      $('count').textContent = message(`${renderedTasks.length} 个任务${selected.size ? ` · ${selected.size} 已选择` : ''}`, `${renderedTasks.length} tasks${selected.size ? ` · ${selected.size} selected` : ''}`);
      if (filter === 'agenda' || page === 'calendar') {
        let shown = 0;
        for (const group of agenda) {
          if (group.key === 'hidden') { content.append(button('查看等待任务', () => { filter = 'waiting'; page = 'tasks'; render(); })); continue; }
          const heading = el('h2', group.name, `group-title ${group.key}`); heading.append(el('span', String(group.tasks.length))); content.append(heading); const section = el('div', undefined, 'task-list'); content.append(section);
          for (const item of nestTasks(group.tasks)) { section.append(taskRow(item.task, item.depth)); shown++; }
        }
        if (!shown) empty(content);
      } else { const section = el('div', undefined, 'task-list'); content.append(section); for (const item of nestTasks(list)) section.append(taskRow(item.task, item.depth)); if (!list.length) empty(content); }
      if (config.focus.list) {
        content.replaceChildren(el('p', message('正在排列任务', 'Ordering tasks'), 'status'));
        pendingView = taskAgenda(list, dependencyCatalog, config, query).then(ordered => {
          if (revision !== renderRevision) return;
          content.replaceChildren(); renderedTasks = ordered.flatMap(group => group.tasks);
          for (const group of ordered) {
            if (!group.tasks.length) continue;
            content.append(el('h2', group.name, 'group-title'));
            const section = el('div', undefined, 'task-list');
            for (const item of nestTasks(group.tasks)) section.append(taskRow(item.task, item.depth));
            content.append(section);
          }
        });
        void pendingView.catch(error => { if (revision === renderRevision) content.replaceChildren(el('p', String(error), 'error-box')); });
      } else pendingView = Promise.resolve();
    } catch (error) { content.append(el('p', error instanceof Error ? error.message : String(error), 'error-box')); }
  }
  const batch = $('batch'); batch.replaceChildren(); batch.hidden = !selecting;
  if (selecting) {
    batch.append(button('全选当前结果', () => { selected = new Set(renderedTasks.map(task => task.id)); render(); }), button('完成任务', () => complete([...selected])), button('等到明天', () => act(async () => { for (const id of selected) await service.deferUntilTomorrow(id); })), button('取消任务', () => act(async () => { for (const id of selected) await service.setStatus(id, 'cancelled'); })), button('重新打开', () => act(async () => { for (const id of selected) await service.reopen(id); })), button('推迟提醒', () => snoozeDialog([...selected])), button('删除任务', () => deleteTasks([...selected]), 'danger'), button('取消选择', () => { selecting = false; selected.clear(); render(); }));
  }
};
const renderFocus = async (content: HTMLElement, revision: number): Promise<void> => {
  content.append(el('p', message('正在推荐当前可以执行的事项', 'Finding available actions'), 'status'));
  const cards = await recommend(tasks, dependencyCatalog, config, { previous: focusPrevious });
  if (revision !== renderRevision) return;
  focusPrevious = cards.map(task => task.id); renderedTasks = cards;
  content.replaceChildren();
  const toolbar = el('div', undefined, 'focus-toolbar');
  const templateLabel = { current: message('跟随当前排序', 'Current sorting'), levels: message('优先级', 'Priority'), urgency: message('紧急度', 'Urgency'), random: message('随机', 'Random'), custom: config.focus.script }[config.focus.template];
  toolbar.append(el('p', message(`当前最多 ${config.focus.count} 件 · ${templateLabel}`, `Up to ${config.focus.count} actions · ${templateLabel}`), 'helper'), button('设置', settingsDialog));
  if (config.focus.template === 'random') toolbar.append(button(message('重新推荐', 'Refresh recommendations'), () => { focusPrevious = []; render(); }));
  content.append(toolbar);
  const list = el('div', undefined, 'task-list focus-list'); content.append(list);
  for (const task of cards) list.append(taskRow(task));
  if (!cards.length) empty(content);
};
const empty = (content: HTMLElement): void => { const block = el('div', undefined, 'empty'); block.append(icon('tasks'), el('h2', tr('没有任务')), el('p', tr('可以安心休息一下'))); content.append(block); };
const renderCalendar = (content: HTMLElement): void => {
  const modes = el('div', undefined, 'view-switch'); modes.setAttribute('aria-label', '日程视图'); content.append(modes);
  for (const [mode, name] of [['day', '日历'], ['week', '周历'], ['month', '月历'], ['priority', '重要度'], ['matrix', '四象限']]) {
    const choice = button(name!, () => { calendarMode = mode!; render(); }, calendarMode === mode ? 'active' : ''); choice.setAttribute('aria-pressed', String(calendarMode === mode)); modes.append(choice);
  }
  const all = tasks.filter(task => ACTIVE_STATES.has(task.status));
  const byDate = new Map<string, Task[]>();
  for (const task of all) if (task.due) { const day = task.due.slice(0, 10); byDate.set(day, [...byDate.get(day) ?? [], task]); }
  const list = (target: HTMLElement, items: Task[]): void => {
    const rows = el('div', undefined, 'task-list'); target.append(rows);
    for (const item of [...items].sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || a.title.localeCompare(b.title))) rows.append(taskRow(item));
  };
  if (calendarMode === 'matrix') {
    content.append(el('p', `重要：${config.priority.levels.at(-1)}优先级 · 紧急：今天到期或已经逾期`, 'helper'));
    const names = ['重要且紧急', '重要不紧急', '不重要但紧急', '不重要不紧急'];
    const overview = el('div', undefined, 'matrix-overview'); content.append(overview);
    for (const [index, name] of names.entries()) {
      const items = all.filter(task => quadrant(task, config.priority.levels, localNow().slice(0, 10)) === index);
      const option = button('', () => { matrixSelection = index; render(); }, index === matrixSelection ? 'active' : ''); option.setAttribute('aria-label', `查看${name}`);
      option.setAttribute('aria-pressed', String(index === matrixSelection)); option.append(el('span', name), el('strong', String(items.length))); overview.append(option);
    }
    const grid = el('div', undefined, 'quadrants'); content.append(grid);
    for (const [index, name] of names.entries()) {
      const section = el('section', undefined, `quadrant q${index}${index === matrixSelection ? ' selected' : ''}`); const items = all.filter(task => quadrant(task, config.priority.levels, localNow().slice(0, 10)) === index);
      section.append(el('h2', `${name} · ${items.length}`, 'group-title')); if (items.length) list(section, items); else section.append(el('p', '没有待办任务', 'helper')); grid.append(section);
    }
    return;
  }
  if (calendarMode === 'priority') {
    content.append(el('p', '按优先级查看，未设置优先级的任务放在末尾。', 'helper'));
    for (const level of [...config.priority.levels].reverse().concat('未设置')) {
      const items = all.filter(task => (task.priority ?? '未设置') === level); const section = el('section'); section.append(el('h2', `${level} · ${items.length}`, 'group-title'));
      if (items.length) list(section, items); else section.append(el('p', '没有待办任务', 'helper')); content.append(section);
    }
    return;
  }
  const move = (direction: number): void => {
    if (calendarMode === 'month') {
      const date = new Date(`${calendarDate}T12:00:00`), day = date.getDate(); date.setDate(1); date.setMonth(date.getMonth() + direction); date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())); calendarDate = dateKey(date);
    } else calendarDate = shiftDateOnly(calendarDate, direction * (calendarMode === 'week' ? 7 : 1));
    render();
  };
  const toolbar = el('div', undefined, 'calendar-toolbar');
  toolbar.append(button(calendarMode === 'month' ? '上个月' : calendarMode === 'week' ? '上一周' : '上一天', () => move(-1)), el('h2', calendarMode === 'month' ? calendarDate.slice(0, 7) : calendarMode === 'week' ? `${weekDays(calendarDate)[0]} — ${weekDays(calendarDate)[6]}` : calendarDate), button(calendarMode === 'month' ? '下个月' : calendarMode === 'week' ? '下一周' : '下一天', () => move(1))); content.append(toolbar);
  content.append(button('返回今天', () => { calendarDate = localNow().slice(0, 10); render(); }, 'text-button'));
  if (calendarMode === 'month') {
    const grid = el('div', undefined, 'month-grid'); grid.setAttribute('aria-label', '月历日期'); content.append(grid);
    for (const weekday of ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']) grid.append(el('span', weekday.slice(-1), 'weekday'));
    for (const day of monthDays(calendarDate)) {
      const count = byDate.get(day)?.length ?? 0;
      const cell = button('', () => { calendarDate = day; render(); }, `calendar-day${day === calendarDate ? ' selected' : ''}${day === localNow().slice(0, 10) ? ' today' : ''}${day.slice(0, 7) !== calendarDate.slice(0, 7) ? ' outside' : ''}`);
      cell.setAttribute('aria-label', `${day}，${count} 个待办`); cell.append(el('span', String(Number(day.slice(8)))), el('small', count ? String(count) : '')); grid.append(cell);
    }
  }
  const daySection = (day: string, section: HTMLElement): void => {
    const items = byDate.get(day) ?? []; const title = el('h2', `${day} · ${items.length} 个任务`, 'group-title'); section.append(title);
    if (items.length) list(section, items); else section.append(el('p', '这一天没有安排，可以使用右下角添加任务。', 'helper'));
  };
  if (calendarMode === 'week') {
    const strip = el('div', undefined, 'week-strip'); content.append(strip);
    for (const day of weekDays(calendarDate)) {
      const cell = button(day.slice(5), () => { calendarDate = day; render(); }, day === calendarDate ? 'active' : ''); cell.setAttribute('aria-label', `选择日期 ${day}`); cell.append(el('small', `${byDate.get(day)?.length ?? 0}`)); strip.append(cell);
    }
    const scroll = el('div', undefined, 'week-scroll'); const week = el('div', undefined, 'week-agenda'); scroll.append(week); content.append(scroll);
    for (const day of weekDays(calendarDate)) { const section = el('section'); section.dataset.date = day; daySection(day, section); week.append(section); }
    requestAnimationFrame(() => { scroll.scrollLeft = weekDays(calendarDate).indexOf(calendarDate) * 228; });
  } else daySection(calendarDate, content);
  const undated = all.filter(task => !task.due);
  if (undated.length) { const details = el('details'); details.append(el('summary', `没有日期 · ${undated.length}`)); list(details, undated); content.append(details); }
};

const renderActivity = (content: HTMLElement): void => {
  const preferences = store.state.preferences ?? { activity: false, activityRange: 12 };
  const section = el('section', undefined, 'activity-section'); section.append(el('h2', '完成记录', 'group-title'));
  const label = el('label', undefined, 'switch-label'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = preferences.activity; checkbox.setAttribute('aria-label', '显示完成方块'); label.append(checkbox, el('span', '显示完成方块')); section.append(label); content.append(section);
  const preference = async (next: { activity: boolean; activityRange: number }): Promise<void> => { try { await store.run(async () => { store.state.preferences = next; }, false); await refresh(); } catch (error) { showError(error); } };
  checkbox.onchange = () => { void preference({ ...preferences, activity: checkbox.checked }); };
  if (!preferences.activity) return;
  const range = selectField(section, '完成记录范围', [['12', '最近三个月'], ['52', '全年']], String(preferences.activityRange)); range.onchange = () => { void preference({ ...preferences, activityRange: Number(range.value) }); };
  const counts = completedByDate(dependencyCatalog); const last = weekDays(localNow().slice(0, 10))[6]!;
  const start = shiftDateOnly(last, -(preferences.activityRange * 7 - 1));
  const frame = el('div', undefined, 'activity-scroll'); const grid = el('div', undefined, 'activity-grid'); grid.style.gridTemplateColumns = `repeat(${preferences.activityRange}, 26px)`; frame.append(grid); section.append(frame);
  const selected = el('p', '点击方块查看对应日期和完成数量。', 'status');
  for (let index = 0; index < preferences.activityRange * 7; index++) {
    const day = shiftDateOnly(start, index), count = counts.get(day) ?? 0;
    const level = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
    const cell = button('', () => { selected.textContent = `${day} · 完成 ${count} 个任务`; }, `activity-cell level-${level}`); cell.setAttribute('aria-label', `${day} 完成 ${count} 个任务`); cell.title = `${day} · ${count}`; cell.disabled = day > localNow().slice(0, 10); grid.append(cell);
  }
  section.append(selected); const legend = el('div', undefined, 'activity-legend'); legend.append(el('span', '较少'));
  for (let level = 0; level < 5; level++) legend.append(el('span', undefined, `activity-cell level-${level}`)); legend.append(el('span', '较多')); section.append(legend);
};

const renderStats = (content: HTMLElement): void => {
  const stats = collectStats(tasks, config, localNow()); const grid = el('div', undefined, 'stat-grid'); content.append(grid);
  for (const [label, value] of [['未完成', tasks.filter(task => ACTIVE_STATES.has(task.status)).length], ['逾期', stats.overdue], ['今天到期', stats.dueToday], ['本周到期', stats.dueThisWeek], ['近七天完成', stats.completedLast7Days], ['近三十天完成', stats.completedLast30Days], ['待发提醒', stats.pendingReminders], ['重复任务', stats.recurring]] as const) { const tile = el('div', undefined, 'stat-card'); tile.append(el('strong', String(value)), el('span', tr(label))); grid.append(tile); }
  const detail = el('details'); detail.append(el('summary', '详细统计')); content.append(detail);
  for (const [label, value] of [['全部任务', stats.total], ['暂时等待', stats.hiddenByWait], ['包含备注', stats.withNotes], ['子任务', stats.subtasks], ['投递失败提醒', stats.deadReminders], ...stats.byStatus.map(item => [statusName(item.status), item.count]), ...(stats.oldestOpenDays !== undefined ? [['最早未完成任务的天数', stats.oldestOpenDays]] : [])]) {
    const row = el('div', undefined, 'summary-row'); row.append(el('span', String(label)), el('span', String(value))); detail.append(row);
  }
  content.append(el('h2', '最紧急的任务', 'group-title'));
  for (const item of stats.topUrgent) { const row = rawButton(item.title, () => { const task = tasks.find(task => task.id === item.id); if (task) editDialog(task); }, 'menu-item'); row.append(el('small', String(item.score))); content.append(row); }
  renderActivity(content);
};
const menu = (content: HTMLElement, name: string, description: string, image: string, action: () => void): void => {
  const item = button('', action, 'menu-item'); item.setAttribute('aria-label', tr(name)); item.append(icon(image)); const text = el('span', undefined, 'menu-text'); text.append(el('strong', tr(name)), el('small', description)); item.append(text, el('span', '›', 'chevron')); content.append(item);
};
const renderMore = (content: HTMLElement): void => {
  const list = el('div', undefined, 'menu-list'); content.append(list);
  menu(list, '全部任务', '查看所有状态的任务', 'tasks', () => { page = 'tasks'; taskView = 'list'; filter = 'all'; render(); });
  menu(list, '依赖地图', message('查看前置任务、分支路线与当前进度', 'Explore prerequisites, branches and progress'), 'map', () => showMap());
  menu(list, '项目', '按项目查看任务与完成数量', 'folder', () => summaryDialog('项目'));
  menu(list, '标签', '按标签浏览任务', 'tag', () => summaryDialog('标签'));
  menu(list, '归档', '整理已完成任务与恢复历史', 'archive', archiveDialog);
  menu(list, '同步', '连接你的私有 Git 仓库', 'sync', () => { void syncDialog(); });
  menu(list, '导入', '导入 JSONL、JSON 或完整备份', 'import', () => { void importDialog(); });
  menu(list, '导出', '备份、CSV 与 Markdown', 'export', exportDialog);
  menu(list, '设置', '通知、排序、语言与邮件', 'settings', settingsDialog);
  menu(list, '使用帮助', '一行输入与查询语法', 'help', helpDialog);
};
const summaryDialog = (kind: string): void => {
  const content = open(kind); const rows = kind === '项目' ? projectSummary(tasks, localNow().slice(0, 10)) : tagSummary(tasks, localNow().slice(0, 10));
  for (const row of rows) {
    const item = button('', () => { query = kind === '项目' ? row.name === '（无项目）' ? '-has:project' : `project:${row.name}` : row.name === '（无标签）' ? '-has:tags' : `#${row.name}`; $<HTMLInputElement>('search').value = query; filter = 'all'; page = 'tasks'; taskView = 'list'; dialog.close(); render(); }, 'summary-row');
    item.append(rawEl('span', row.name), el('small', `${row.open} 未完成 · ${row.done} 已完成 · ${row.overdue} 逾期`)); content.append(item);
  }
};
const restoreDialog = (id: string): void => { const content = open('恢复任务'); content.append(button('恢复任务', () => act(() => service.restore(id), '已恢复任务'), 'primary')); };
const archiveDialog = (): void => {
  const content = open('归档'); const days = field(content, '归档超过多少天的历史', '14', 'number');
  content.append(button('归档', () => act(async () => { const value = Number(days.value); if (!Number.isInteger(value) || value < 0) throw new Error('归档天数需要为非负整数'); const count = await service.archive(value); notify(`已归档 ${count} 个任务`); }), 'primary'));
  for (const record of store.state.archive) if (!record.deleted) content.append(taskRow(TaskSchema.parse(record), 0, true));
};
const importDialog = async (): Promise<void> => {
  const content = open('导入'); content.append(el('p', '导入时按任务编号合并，同一任务保留更新时间较新的记录。', 'helper'));
  const input = textarea(content, '导入数据', '');
  content.append(button('选择文件', async () => { try { const file = await request<{ text: string }>('import', {}); input.value = file.text; } catch (error) { showError(error); } }), button('导入', () => act(async () => {
    if (!input.value.trim()) throw new Error('请选择文件或填写数据');
    if (input.value.trim().startsWith('{')) {
      const backup = JSON.parse(input.value) as { format: string; tasks: unknown; archive: unknown; config: string };
      if (backup.format !== 'anothertodo-backup-v1') throw new Error('备份格式无法识别');
      const imported = records(JSON.stringify(backup.tasks)); const archived = records(JSON.stringify(backup.archive)); readConfig(backup.config);
      store.import(jsonl(imported)); store.state.archive = mergeUnion(store.state.archive, archived); store.state.config = backup.config;
    } else store.import(input.value);
  }, '已导入数据'), 'primary'));
};
const exportDialog = (): void => {
  const content = open('导出'); const format = selectField(content, '导出格式', [['backup', '完整备份'], ['jsonl', 'JSONL'], ['json', 'JSON'], ['csv', 'CSV'], ['markdown', 'Markdown']], 'backup');
  const scope = selectField(content, '导出范围', [['all', '全部任务'], ['query', '当前查询结果']], 'all');
  const exportFile = async (share: boolean): Promise<void> => {
    const list = scope.value === 'all' ? tasks : visible();
    const text = format.value === 'backup' ? JSON.stringify({ format: 'anothertodo-backup-v1', tasks: store.state.tasks, archive: store.state.archive, config: store.state.config }, null, 2) : format.value === 'jsonl' ? jsonl(list) : exportTasks(list, format.value as 'json' | 'csv' | 'markdown');
    const extension = format.value === 'markdown' ? 'md' : format.value === 'backup' ? 'json' : format.value;
    try { await request('export', { text, filename: `anothertodo-${localNow().slice(0, 10)}.${extension}`, mime: extension === 'json' ? 'application/json' : 'text/plain', share }); notify('文件已导出'); } catch (error) { showError(error); }
  };
  content.append(button('保存导出文件', () => exportFile(false), 'primary'), button('分享导出文件', () => exportFile(true)));
};
const settingsDialog = (): void => {
  const content = open('设置'); const permissions = native<{ notifications: boolean; exact: boolean }>('permissions');
  content.append(el('p', `系统通知：${permissions.notifications ? '已允许' : '需要开启'} · 精确提醒：${permissions.exact ? '已允许' : '需要开启'}`, 'status'), button('开启系统通知', () => { native('notificationPermission'); }), button('开启精确提醒', () => { native('alarmPermission'); }));
  const mode = selectField(content, '排序方式', [['levels', '优先级'], ['urgency', '紧急度']], config.priority.mode);
  const lang = selectField(content, '界面语言', [['zh', '中文'], ['en', 'English'], ['auto', '跟随系统']], config.ui.lang);
  const startView = selectField(content, message('启动页面', 'Startup view'), [['list', message('任务列表', 'Task list')], ['gtd', 'GTD / Flashcard']], config.ui.start_view);
  const focusSection = el('section', undefined, 'focus-settings'); content.append(focusSection);
  focusSection.append(el('h3', 'GTD / Flashcard'));
  const count = field(focusSection, message('同时显示事项数量', 'Visible actions'), String(config.focus.count), 'number'); count.min = '1'; count.max = '20';
  const template = selectField(focusSection, message('推荐模板', 'Recommendation template'), [['current', '跟随当前排序'], ['levels', '优先级'], ['urgency', '紧急度'], ['random', '随机'], ['custom', '自定义脚本文件']], config.focus.template);
  const scriptName = field(focusSection, message('脚本文件名称', 'Script filename'), config.focus.script || 'recommend.js');
  let imported = config.focus.files.find(file => file.name === config.focus.script)?.source ?? '';
  const scriptStatus = el('p', imported ? message('脚本文件已经导入', 'Script file imported') : message('导入包含 function recommend(tasks, context) 的 JavaScript 文件。', 'Import a JavaScript file defining function recommend(tasks, context).'), 'helper'); focusSection.append(scriptStatus);
  focusSection.append(button(message('导入推荐脚本文件', 'Import recommendation script'), async () => {
    try {
      const file = await request<{ text: string }>('import', {});
      await runRecommendation(file.text, tasks, dependencyCatalog, config);
      imported = file.text; template.value = 'custom'; scriptStatus.textContent = message('脚本校验通过，保存配置后生效', 'Script validated. Save configuration to activate.');
    } catch (error) { showError(error); }
  }));
  focusSection.append(button(message('导出推荐模板文件', 'Export recommendation template'), async () => {
    const key = template.value === 'custom' ? 'current' : template.value as keyof typeof recommendationTemplates;
    await request('export', { text: recommendationTemplates[key], filename: `${key}.js`, mime: 'text/javascript', share: false });
  }));
  const useList = selectField(focusSection, message('同时用于普通列表', 'Apply to task list'), [['false', '关闭'], ['true', '开启']], String(config.focus.list));
  const advanced = el('details'); advanced.append(el('summary', '高级配置')); content.append(advanced);
  const raw = textarea(advanced, '完整配置 TOML', store.state.config); raw.rows = 10;
  const hooks = textarea(advanced, '自定义通知方式', native<string>('hooksText')); hooks.placeholder = '{"企业通知":"https://example.com/webhook"}';
  advanced.append(el('p', '自定义通知方式填写名称与 HTTPS webhook 地址；提醒中填写对应名称即可发送任务 JSON。邮件提醒使用配置中的 email。', 'helper'));
  content.append(button('保存配置', () => act(async () => {
    const candidate = readConfig(raw.value); candidate.priority.mode = mode.value as 'levels' | 'urgency'; candidate.ui.lang = lang.value as 'zh' | 'en' | 'auto';
    candidate.ui.start_view = startView.value as typeof candidate.ui.start_view;
    candidate.focus.count = Number(count.value); candidate.focus.template = template.value as typeof candidate.focus.template;
    candidate.focus.script = scriptName.value.trim(); candidate.focus.list = useList.value === 'true';
    if (imported) candidate.focus.files = [...candidate.focus.files.filter(file => file.name !== candidate.focus.script), { name: candidate.focus.script, source: imported }];
    await recommend(tasks, dependencyCatalog, readConfig(configText(candidate)));
    focusPrevious = [];
    const endpoints = JSON.parse(hooks.value || '{}') as Record<string, string>;
    if (typeof endpoints !== 'object' || endpoints === null || Array.isArray(endpoints)) throw new Error('通知方式需要 JSON 对象');
    for (const [name, url] of Object.entries(endpoints)) if (!name.trim() || typeof url !== 'string' || !url.startsWith('https://')) throw new Error('通知方式名称与 HTTPS 地址需要填写完整');
    native('saveHooks', { hooks: endpoints }); store.state.config = configText(candidate);
  }), 'primary'));
};
const syncDialog = async (): Promise<void> => {
  const content = open('同步'); const current = native<SyncSettings | null>('syncSettings') ?? { url: '', username: '', token: '', branch: 'main', name: '', email: '' };
  const url = field(content, '仓库地址', current.url, 'url'); url.placeholder = 'https://github.com/用户名/私有仓库.git';
  const branch = field(content, '分支', current.branch); const username = field(content, 'Git 用户名', current.username);
  const token = field(content, '访问令牌', current.token, 'password'); token.autocomplete = 'off';
  const name = field(content, '提交姓名', current.name); const email = field(content, '提交邮箱', current.email, 'email');
  const status = el('p', await syncStatus(), 'status'); content.append(status);
  const save = (): void => { configureSync({ url: url.value.trim(), branch: branch.value.trim(), username: username.value.trim(), token: token.value, name: name.value.trim(), email: email.value.trim() }); };
  content.append(button('保存同步设置', () => { try { save(); notify('同步设置已保存'); } catch (error) { showError(error); } }), button('立即同步', async () => {
    if (busy) return;
    busy = true; const controls = content.querySelectorAll('button'); controls.forEach(node => { node.disabled = true; });
    try { save(); status.textContent = '正在同步…'; const message = await syncDirectory(); store.reload(); await refresh(); status.textContent = message; notify(message); }
    catch (error) { status.textContent = '同步未完成'; showError(error); } finally { busy = false; controls.forEach(node => { node.disabled = false; }); }
  }, 'primary'));
};
const helpDialog = (): void => {
  const content = open('使用帮助');
  for (const [title, body] of [
    ['一行输入', '明天 下午3点 复盘 #工作 proj:日常 很急 >>准备材料\n日期与时间支持中英文，剩余内容成为标题。'],
    ['重复规则', '*每天 · *每2周 · *每周三 · *每月 · *每年 · *工作日\n完成后会生成下一次任务，保留完成历史。'],
    ['提醒与等待', '@18:30 · @30m · @9:00:toast,email\n@none 关闭自动提醒。~下周一 设置等待日期。'],
    ['查询语法', 'due:week · due:none · wait:any · status:done\n#工作 · +高 · -低 · project:日常\nhas:notes · has:recur · parent:任务编号\n/关键字 搜索标题、项目、标签和备注。'],
    ['手机操作', '点击任务查看和编辑详情；点击左侧方框完成任务。右上角选择按钮支持批量操作；撤销按钮可以撤销整次操作。'],
    ['同步与备份', '使用 HTTPS Git 仓库和访问令牌同步。令牌保存在 Android 加密存储中。完整备份包括任务、归档和配置。'],
  ]) { content.append(el('h3', title, 'section-title'), el('p', body, 'status')); }
};
$('undo').append(icon('undo')); $('undo').onclick = () => { void act(() => service.undo(), '已撤销操作', false); };
$('select').append(icon('select')); $('select').onclick = () => { selecting = !selecting; selected.clear(); render(); };
$('search-icon').append(icon('search')); $('add').append(icon('plus')); $('add').onclick = () => addDialog();
let searchTimer = 0;
$<HTMLInputElement>('search').oninput = event => { query = (event.target as HTMLInputElement).value; clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); };
$('clear-search').onclick = () => { query = ''; $<HTMLInputElement>('search').value = ''; render(); };
$('sort').onclick = () => { void act(async () => { config.priority.mode = config.priority.mode === 'levels' ? 'urgency' : 'levels'; store.state.config = configText(config); }); };
dialog.addEventListener('click', event => { if (event.target === dialog && event.clientY < dialog.getBoundingClientRect().top) void closeDialog(); });
dialog.addEventListener('cancel', event => { event.preventDefault(); void closeDialog(); });
window.nativeBack = () => { if (dialog.open) { void closeDialog(); return true; } if (selecting) { selecting = false; selected.clear(); render(); return true; } if (page !== 'tasks') { page = 'tasks'; render(); return true; } if (taskView === 'map') { taskView = 'list'; render(); return true; } return false; };
window.nativeRefresh = () => { if (busy) return; store.reload(); void refresh(); };
window.nativeOpenTask = (id: string) => { store.reload(); void refresh().then(() => { const task = tasks.find(item => item.id === id); if (task) editDialog(task); else notify('任务已移除'); }); };
document.addEventListener('visibilitychange', () => { if (document.hidden) void activeEditor?.flush().catch(showError); else if (!busy) window.nativeRefresh(); });
render();
window.nativeTheme = mode => { document.documentElement.dataset.theme = mode; };
window.nativeTheme(native<'dark' | 'light'>('theme'));
const launchTask = native<string | null>('launchTask');
if (launchTask) window.nativeOpenTask(launchTask);
