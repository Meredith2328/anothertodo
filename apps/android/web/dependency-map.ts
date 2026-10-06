import type { Task } from '../../../src/contracts.js';
import { dependencyMap, type MapNode, type MapState } from '../../../src/core/dependency-map.js';
import { startLayout, type MapGeometry } from './map-layout.js';

export type MapViewState = { route?: string | undefined; selected?: string | undefined; zoom: number; showIndependent: boolean; left?: number | undefined; top?: number | undefined };
type Options = { catalog: Task[]; today: string; state: MapViewState; english: boolean; archived: Set<string>; open: (id: string) => void; complete: (id: string) => void; list: () => void };
let cached: { key: string; geometry: MapGeometry } | undefined;
const words: Record<string, string> = {
  '依赖路线': 'Route', '显示独立任务': 'Include independent tasks', '没有依赖路线': 'No dependency routes',
  '在任务详情中添加前置任务，即可形成关卡路线。': 'Add prerequisites in task details to create a route.', '任务列表': 'Task list',
  '正在绘制路线': 'Drawing route', '重新加载地图': 'Reload map', '已完成': 'Completed', '可以执行': 'Ready',
  '等待前置任务': 'Locked', '等待日期': 'Deferred', '已取消': 'Cancelled', '自定义状态': 'Custom state', '依赖记录缺失': 'Missing prerequisite',
  '定位可执行': 'Find ready task', '定位选中': 'Find selection', '地图全貌': 'Fit map', '缩小地图': 'Zoom out', '放大地图': 'Zoom in',
  '从下方起点沿道路向上推进；点击节点查看任务。': 'Follow the paths upward from the start. Tap a node for details.',
  '前置任务': 'Prerequisites', '后续任务': 'Next tasks', '没有前置任务': 'No prerequisites', '没有后续任务': 'No next tasks',
  '查看任务': 'Open task', '查看归档任务': 'Open archived task', '完成任务': 'Complete task', '当前可执行': 'Ready now', '路线已完成': 'Route completed',
  '当前没有可执行任务，请查看等待节点。': 'No tasks are ready. Check the waiting nodes.',
  '这个依赖的记录已经缺失。请在后续任务详情中修正依赖，或者从备份中恢复记录。': 'This prerequisite record is missing. Correct the dependency in the next task, or restore the record from a backup.',
};
const stateLabels: Record<MapState, string> = { done: '已完成', ready: '可以执行', locked: '等待前置任务', deferred: '等待日期', cancelled: '已取消', inactive: '自定义状态', missing: '依赖记录缺失' };

export const mountMap = (host: HTMLElement, options: Options): (() => void) => {
  const { state } = options;
  const tr = (text: string): string => options.english ? words[text] ?? text : text;
  const text = (zh: string, en: string): string => options.english ? en : zh;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, value?: string, className?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (value !== undefined) node.textContent = tr(value); if (className) node.className = className; return node;
  };
  const raw = <K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] => {
    const node = make(tag, undefined, className); node.textContent = value; return node;
  };
  const button = (label: string, action: () => void, className = 'secondary'): HTMLButtonElement => {
    const node = make('button', label, className); node.type = 'button'; node.onclick = action; return node;
  };
  const model = dependencyMap(options.catalog, options.today);
  let disposed = false, worker: ReturnType<typeof startLayout> | undefined, resize: ResizeObserver | undefined;
  let viewport: HTMLElement | undefined, stage: HTMLElement | undefined, spacer: HTMLElement | undefined, geometry: MapGeometry | undefined;
  let markers: { element: HTMLElement; x: number; y: number }[] = [];
  let generation = 0;
  const remember = (): void => { if (viewport && geometry) { state.left = viewport.scrollLeft; state.top = viewport.scrollTop; } };
  const routes = (): typeof model.routes => model.routes.filter(route => state.showIndependent || route.connected || route.ids.includes(state.selected ?? ''));
  const title = (node: MapNode): string => node.task?.title ?? text(`缺失记录 ${node.id}`, `Missing record ${node.id}`);
  const chosenRoute = (): typeof model.routes[number] => model.routes.find(route => route.id === state.route)!;
  const scale = (): void => {
    stage!.style.transform = `scale(${state.zoom})`; spacer!.style.width = `${geometry!.width * state.zoom}px`; spacer!.style.height = `${geometry!.height * state.zoom}px`;
    const left = Math.max(0, (viewport!.clientWidth - geometry!.width * state.zoom) / 2), top = Math.max(0, (viewport!.clientHeight - geometry!.height * state.zoom) / 2);
    stage!.style.left = `${left}px`; stage!.style.top = `${top}px`; stage!.classList.toggle('overview', state.zoom < .45);
    for (const marker of markers) {
      marker.element.hidden = state.zoom >= .45; marker.element.style.left = `${left + marker.x * state.zoom}px`; marker.element.style.top = `${top + marker.y * state.zoom}px`;
    }
  };
  const locate = (id: string): void => {
    const point = geometry?.nodes.find(node => node.id === id); if (!point || !viewport) return;
    viewport.scrollLeft = stage!.offsetLeft + point.x * state.zoom - viewport.clientWidth / 2;
    viewport.scrollTop = stage!.offsetTop + point.y * state.zoom - viewport.clientHeight / 2; remember();
  };
  const revealViewport = (force = false): void => {
    if (viewport && (force || viewport.getBoundingClientRect().top > innerHeight / 2)) {
      const bounds = viewport.getBoundingClientRect(), available = innerHeight - document.getElementById('navigation')!.getBoundingClientRect().height;
      window.scrollTo({ top: scrollY + bounds.top - Math.max(0, (available - bounds.height) / 2), behavior: 'instant' });
    }
  };
  const zoom = (next: number): void => {
    if (!geometry || !viewport) return;
    const x = (viewport.scrollLeft + viewport.clientWidth / 2 - stage!.offsetLeft) / state.zoom, y = (viewport.scrollTop + viewport.clientHeight / 2 - stage!.offsetTop) / state.zoom;
    state.zoom = Math.max(Number.EPSILON, Math.min(1.6, next)); scale();
    viewport.scrollLeft = stage!.offsetLeft + x * state.zoom - viewport.clientWidth / 2; viewport.scrollTop = stage!.offsetTop + y * state.zoom - viewport.clientHeight / 2; remember();
  };
  const related = (id: string): Set<string> => {
    const result = new Set([id]);
    for (const direction of ['previous', 'next'] as const) {
      const seen = new Set([id]), queue = [id];
      for (let index = 0; index < queue.length; index++) for (const other of model.nodes.get(queue[index]!)![direction]) {
        if (!seen.has(other)) { seen.add(other); result.add(other); queue.push(other); }
      }
    }
    return result;
  };
  const selectNode = (id: string, center = false, showDetails = false): void => {
    state.selected = id;
    const node = model.nodes.get(id)!;
    const highlighted = related(id);
    for (const element of host.querySelectorAll<HTMLElement>('.map-node')) {
      const selected = element.dataset.id === id; element.classList.toggle('selected', selected);
      if (element.getAttribute('aria-pressed') !== String(selected)) element.setAttribute('aria-pressed', String(selected));
    }
    for (const edge of host.querySelectorAll<SVGPathElement>('.map-road')) edge.classList.toggle('related', highlighted.has(edge.dataset.from!) && highlighted.has(edge.dataset.to!));
    const detail = host.querySelector<HTMLElement>('.map-detail')!; detail.replaceChildren();
    const status = make('p', stateLabels[node.state], `map-state state-${node.state}`); status.setAttribute('role', 'status');
    detail.append(status, raw('h2', title(node)), make('p', `${node.id}${options.archived.has(id) ? text(' · 已归档', ' · Archived') : ''}`, 'status'));
    if (node.state === 'missing') detail.append(make('p', '这个依赖的记录已经缺失。请在后续任务详情中修正依赖，或者从备份中恢复记录。', 'helper'));
    if (node.task?.wait && node.task.wait > options.today) detail.append(make('p', text(`等待至 ${node.task.wait}`, `Deferred until ${node.task.wait}`), 'helper'));
    if (node.task?.due) detail.append(make('p', text(`截止 ${node.task.due.replace('T', ' ')}`, `Due ${node.task.due.replace('T', ' ')}`), 'helper'));
    if (node.state === 'inactive') detail.append(raw('p', node.task!.status, 'status'));
    const actions = make('div', undefined, 'map-detail-actions'); detail.append(actions);
    if (node.task) {
      actions.append(button(options.archived.has(id) ? '查看归档任务' : '查看任务', () => options.open(id), node.state === 'ready' ? 'secondary' : 'primary'));
      if (node.state === 'ready' && !options.archived.has(id)) actions.append(button('完成任务', () => options.complete(id), 'primary'));
    }
    for (const [direction, label, prefix] of [['previous', '前置任务', '前置任务'], ['next', '后续任务', '后续任务']] as const) {
      const section = make('section', undefined, 'map-relations'); section.append(make('h3', label)); detail.append(section);
      if (!node[direction].length) section.append(make('p', direction === 'previous' ? '没有前置任务' : '没有后续任务', 'status'));
      for (const other of node[direction]) {
        const target = model.nodes.get(other)!;
        const entry = button('', () => selectNode(other, true), 'map-relation'); entry.setAttribute('aria-label', `${tr(prefix)} ${title(target)}`);
        entry.append(raw('span', title(target)), make('small', stateLabels[target.state], `state-${target.state}`)); section.append(entry);
      }
    }
    if (center) locate(id);
    if (showDetails && innerHeight < 480) window.scrollTo({ top: scrollY + detail.getBoundingClientRect().top - 8, behavior: 'instant' });
  };
  const draw = (): void => {
    if (disposed) return;
    worker?.terminate(); worker = undefined; resize?.disconnect(); resize = undefined; geometry = undefined; viewport = undefined; markers = [];
    const current = ++generation;
    host.replaceChildren();
    const availableRoutes = routes();
    if (!availableRoutes.length) {
      const empty = make('div', undefined, 'empty'); empty.append(make('h2', '没有依赖路线'), make('p', '在任务详情中添加前置任务，即可形成关卡路线。'), button('任务列表', options.list));
      if (model.routes.length) empty.append(button('显示独立任务', () => { state.showIndependent = true; draw(); })); host.append(empty); return;
    }
    const route = availableRoutes.find(route => route.id === state.route) ?? availableRoutes.find(route => route.ids.includes(state.selected ?? ''))
      ?? availableRoutes.find(route => route.ready.length) ?? availableRoutes.find(route => route.completed < route.total) ?? availableRoutes[0]!;
    state.route = route.id;
    if (!route.ids.includes(state.selected ?? '')) { state.selected = route.ready[0] ?? route.ids.find(id => model.nodes.get(id)!.state !== 'done') ?? route.ids[0]!; state.left = undefined; state.top = undefined; }
    const label = make('label', '依赖路线', 'field-label'); const choices = make('select'); choices.setAttribute('aria-label', tr('依赖路线')); label.append(choices); host.append(label);
    for (const item of availableRoutes) { const option = make('option', `${item.title} · ${item.completed}/${item.total}`); option.value = item.id; choices.append(option); }
    choices.value = route.id;
    choices.onchange = () => { remember(); state.route = choices.value; state.selected = undefined; state.left = undefined; state.top = undefined; state.zoom = 1; draw(); };
    const independent = make('label', undefined, 'switch-label map-independent'); const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = state.showIndependent;
    independent.append(checkbox, make('span', '显示独立任务')); host.append(independent);
    checkbox.onchange = () => { state.showIndependent = checkbox.checked; if (!checkbox.checked && !chosenRoute().connected) { state.selected = undefined; state.route = undefined; } draw(); };
    const progress = make('div', undefined, 'map-progress'); progress.append(make('strong', text(`已完成 ${route.completed} / ${route.total}`, `Completed ${route.completed} / ${route.total}`)), make('span', text(`${route.ready.length} 个可以执行`, `${route.ready.length} ready`))); host.append(progress);
    const meter = make('progress'); meter.max = route.total; meter.value = route.completed; meter.setAttribute('aria-label', tr('已完成')); host.append(meter);
    const legend = make('div', undefined, 'map-legend');
    for (const state of ['done', 'ready', 'locked'] as const) legend.append(make('span', stateLabels[state], `state-${state}`)); host.append(legend);
    host.append(make('p', '从下方起点沿道路向上推进；点击节点查看任务。', 'helper map-hint'));
    const controls = make('div', undefined, 'map-controls'); host.append(controls);
    const zoomControls = make('div', undefined, 'map-zoom'); controls.append(zoomControls);
    const minus = button('−', () => zoom(state.zoom / 1.25)); minus.setAttribute('aria-label', tr('缩小地图'));
    const plus = button('+', () => zoom(state.zoom * 1.25)); plus.setAttribute('aria-label', tr('放大地图')); zoomControls.append(minus, plus);
    const fit = (): void => { if (geometry && viewport) { zoom(Math.min(1, (viewport.clientWidth - 16) / geometry.width, (viewport.clientHeight - 16) / geometry.height)); viewport.scrollLeft = 0; viewport.scrollTop = 0; remember(); } };
    controls.append(button('地图全貌', fit), button('定位选中', () => { if (state.selected) { if (state.zoom < .7) zoom(1); locate(state.selected); } }));
    const readyButton = button('定位可执行', () => {
      const index = route.ready.indexOf(state.selected ?? ''), next = route.ready[(index + 1) % route.ready.length];
      if (next) { if (state.zoom < .7) zoom(1); selectNode(next, true); }
    }); readyButton.disabled = !route.ready.length; controls.append(readyButton);
    const body = make('div', undefined, 'map-body'); host.append(body);
    viewport = make('div', undefined, 'map-viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', text('依赖关卡地图，可滚动查看路线', 'Dependency level map. Scroll to explore.')); body.append(viewport);
    spacer = make('div', undefined, 'map-spacer'); stage = make('div', undefined, 'map-stage'); spacer.append(stage); viewport.append(spacer);
    const loading = make('p', '正在绘制路线', 'map-loading'); viewport.append(loading);
    const detail = make('section', undefined, 'map-detail'); body.append(detail); selectNode(state.selected!);
    if (!route.ready.length) host.append(make('p', route.completed === route.total ? '路线已完成' : '当前没有可执行任务，请查看等待节点。', 'status'));
    const ids = new Set(route.ids), edges = model.edges.filter(edge => ids.has(edge.from));
    const key = JSON.stringify([route.ids, edges]);
    const renderGeometry = (result: MapGeometry): void => {
      if (disposed || current !== generation) return;
      geometry = result; loading.remove(); stage!.style.width = `${result.width}px`; stage!.style.height = `${result.height}px`; scale();
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.style.width = `${result.width}px`; svg.style.height = `${result.height}px`; svg.setAttribute('aria-hidden', 'true'); svg.classList.add('map-roads'); stage!.append(svg);
      const positions = new Map(result.nodes.map(node => [node.id, node]));
      for (const edge of result.edges) {
        const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
        const points = [{ x: from.x, y: from.y - 17 }, ...edge.points, { x: to.x, y: to.y - 17 }];
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' '));
        path.classList.add('map-road'); path.dataset.from = edge.from; path.dataset.to = edge.to;
        if (model.nodes.get(edge.from)!.state === 'done') path.classList.add('passed'); svg.append(path);
      }
      for (const point of result.nodes) {
        const node = model.nodes.get(point.id)!; const entry = button('', () => selectNode(node.id, false, true), `map-node state-${node.state}`); entry.dataset.id = node.id;
        entry.style.left = `${point.x - 72}px`; entry.style.top = `${point.y - 68}px`; entry.setAttribute('aria-label', text(`地图节点 ${title(node)}`, `Map node ${title(node)}`)); entry.title = title(node);
        const number = route.ids.indexOf(node.id) + 1;
        const gem = make('span', undefined, 'map-gem'); gem.append(make('span', node.state === 'done' ? '✓' : String(number)));
        entry.append(make('span', node.state === 'ready' ? '当前可执行' : stateLabels[node.state], 'map-node-state'), gem, raw('span', title(node), 'map-node-title')); stage!.append(entry);
        if (node.state === 'ready') {
          const marker = make('span', undefined, 'map-frontier-marker'); marker.setAttribute('aria-hidden', 'true'); marker.title = title(node); spacer!.append(marker);
          markers.push({ element: marker, x: point.x, y: point.y - 17 });
        }
      }
      scale();
      selectNode(state.selected!);
      if (state.left !== undefined && state.top !== undefined) { viewport!.scrollLeft = state.left; viewport!.scrollTop = state.top; }
      else locate(state.selected!);
      revealViewport();
      viewport!.onscroll = remember;
      let drag: { x: number; y: number; left: number; top: number; moved: boolean } | undefined;
      viewport!.onpointerdown = event => { if (event.pointerType === 'mouse' && event.button === 0) drag = { x: event.clientX, y: event.clientY, left: viewport!.scrollLeft, top: viewport!.scrollTop, moved: false }; };
      viewport!.onpointermove = event => { if (drag) {
        if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 6) { drag.moved = true; viewport!.setPointerCapture(event.pointerId); }
        if (drag.moved) { viewport!.scrollLeft = drag.left - (event.clientX - drag.x); viewport!.scrollTop = drag.top - (event.clientY - drag.y); }
      } };
      viewport!.onpointerup = () => { if (drag?.moved) viewport!.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, { capture: true, once: true }); drag = undefined; };
      viewport!.onpointercancel = () => { drag = undefined; };
      let width = viewport!.clientWidth, height = viewport!.clientHeight;
      resize = new ResizeObserver(() => {
        if (disposed || current !== generation) return;
        if (width !== viewport!.clientWidth || height !== viewport!.clientHeight) {
          width = viewport!.clientWidth; height = viewport!.clientHeight; scale(); locate(state.selected!); revealViewport(true);
        }
      }); resize.observe(viewport!);
    };
    if (cached?.key === key) renderGeometry(cached.geometry);
    else {
      const job = startLayout(route.ids, edges); worker = job;
      void job.result.then(result => {
        if (disposed || current !== generation) return;
        cached = { key, geometry: result }; job.terminate(); worker = undefined; renderGeometry(result);
      }).catch(error => {
        if (disposed || current !== generation) return;
        job.terminate(); worker = undefined; loading.remove();
        const cause = error instanceof Error ? error.message : String(error);
        viewport!.append(make('p', text(`地图绘制失败：${cause}`, `Map layout failed: ${cause}`), 'error-box'), button('重新加载地图', draw));
      });
    }
  };
  draw();
  return () => { remember(); disposed = true; worker?.terminate(); resize?.disconnect(); };
};
