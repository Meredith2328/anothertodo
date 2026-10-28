import git, { type HttpClient } from 'isomorphic-git';
import { Buffer } from 'buffer';
import { native, request } from './bridge.js';
import { records, jsonl, MobileStore } from './store.js';
import { mergeUnion } from '../../../src/sync/merge.js';
import { readConfig } from './config.js';
import type { SyncSettings } from './sync.js';

type Stat = { size: number; mtimeMs: number; ctimeMs: number; directory: boolean; mode: number };
const call = <T>(method: string, path: string, args: object = {}): T => {
  if (typeof path !== 'string' || !path) throw new TypeError('文件操作需要提供路径');
  return native<T>('fs', { method, path, ...args });
};
const fs = { promises: {
  readFile: async (path: string, options?: unknown) => {
    const text = typeof options === 'string' || (typeof options === 'object' && options !== null && 'encoding' in options);
    const value = call<string>('readFile', path, { text }); return text ? value : Buffer.from(value, 'base64');
  },
  writeFile: async (path: string, data: string | Uint8Array) => { call('writeFile', path, typeof data === 'string' ? { text: true, data } : { text: false, data: Buffer.from(data).toString('base64') }); },
  unlink: async (path: string) => { call('unlink', path); },
  readdir: async (path: string) => call<string[]>('readdir', path),
  mkdir: async (path: string, options?: { recursive?: boolean }) => { call('mkdir', path, { recursive: options?.recursive ?? false }); },
  rmdir: async (path: string) => { call('rmdir', path); },
  stat: async (path: string) => stat(path), lstat: async (path: string) => stat(path),
  readlink: async (_path: string): Promise<string> => { throw new Error('同步目录不支持符号链接'); },
  symlink: async (_target: string, _path: string) => { throw new Error('同步目录不支持符号链接'); },
  chmod: async (path: string, mode: number) => { call('chmod', path, { mode }); },
  rename: async (path: string, dest: string) => { call('rename', path, { dest }); },
} };
const stat = (path: string) => {
  const value = call<Stat>('stat', path);
  return { ...value, dev: 0, ino: 0, uid: 0, gid: 0, mtime: new Date(value.mtimeMs), ctime: new Date(value.ctimeMs), isFile: () => !value.directory, isDirectory: () => value.directory, isSymbolicLink: () => false };
};
type HttpResponse = { url: string; statusCode: number; statusMessage: string; headers: Record<string, string>; body: string };
const http: HttpClient = { request: async ({ url, method = 'GET', headers = {}, body }) => {
  const chunks: Uint8Array[] = []; if (body) for await (const chunk of body) chunks.push(chunk);
  const response = await request<HttpResponse>('http', { url, method, headers, body: Buffer.concat(chunks).toString('base64') });
  if (response.statusCode >= 300 && response.statusCode < 400) throw new Error('仓库地址发生重定向，请使用最终 HTTPS 地址');
  return { ...response, method, body: (async function* () { yield Buffer.from(response.body, 'base64'); })() };
} };
const dir = '/repo';
const exists = async (path: string): Promise<boolean> => {
  try { await fs.promises.stat(path); return true; }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT') return false; throw error; }
};
const settings = (): SyncSettings => {
  const value = native<SyncSettings | null>('syncSettings'); if (!value?.url) throw new Error('请填写同步仓库地址'); return value;
};
const textFile = async (path: string): Promise<string> => await exists(`${dir}/${path}`) ? await fs.promises.readFile(`${dir}/${path}`, 'utf8') as string : '';
const commit = async (author: { name: string; email: string }, message: string): Promise<void> => {
  for (const filepath of ['tasks.jsonl', 'archive.jsonl', 'config.toml']) await git.add({ fs, dir, filepath });
  const matrix = await git.statusMatrix({ fs, dir });
  if (matrix.some(([, head, work]) => head !== work)) await git.commit({ fs, dir, author, message });
};
let syncing = false;
export const sync = async (): Promise<string> => {
  if (syncing) throw new Error('同步已在执行'); syncing = true;
  try {
    const cfg = settings(); const auth = () => ({ username: cfg.username || cfg.token, password: cfg.username ? cfg.token : '' });
    const author = { name: cfg.name, email: cfg.email };
    const store = new MobileStore();
    if (!await exists(dir)) await fs.promises.mkdir(dir);
    if (!await exists(`${dir}/.git`)) {
      const remote = await git.getRemoteInfo2({ http, url: cfg.url, onAuth: auth, protocolVersion: 1 });
      if (!remote.refs) throw new Error('无法读取远程引用');
      if (remote.refs.some(ref => ref.ref === `refs/heads/${cfg.branch}`)) await git.clone({ fs, http, dir, url: cfg.url, ref: cfg.branch, singleBranch: true, onAuth: auth });
      else {
        if (remote.refs.some(ref => ref.ref.startsWith('refs/heads/'))) throw new Error('远程分支不存在，请填写已有分支名称');
        await git.init({ fs, dir, defaultBranch: cfg.branch }); await git.addRemote({ fs, dir, remote: 'origin', url: cfg.url });
      }
      const incoming = records(await textFile('tasks.jsonl')); const archived = records(await textFile('archive.jsonl')); const config = await textFile('config.toml');
      await store.run(async () => { store.state.tasks = mergeUnion(store.state.tasks, incoming); store.state.archive = mergeUnion(store.state.archive, archived); if (config) { readConfig(config); store.state.config = config; } }, false);
    }
    const branch = await git.currentBranch({ fs, dir }); if (branch !== cfg.branch) throw new Error(`本地分支为 ${branch}；请使用该分支名称`);
    const remotes = await git.listRemotes({ fs, dir }); const origin = remotes.find(remote => remote.remote === 'origin');
    if (origin?.url !== cfg.url) {
      if (origin) throw new Error('已经连接其他仓库，请先导出备份后使用原有仓库地址');
      await git.addRemote({ fs, dir, remote: 'origin', url: cfg.url });
    }
    store.reload();
    await fs.promises.writeFile(`${dir}/tasks.jsonl`, jsonl(store.state.tasks));
    await fs.promises.writeFile(`${dir}/archive.jsonl`, jsonl(store.state.archive));
    await fs.promises.writeFile(`${dir}/config.toml`, store.state.config);
    await commit(author, 'Update tasks from Android');
    const info = await git.getRemoteInfo2({ http, url: cfg.url, onAuth: auth, protocolVersion: 1 });
    if (!info.refs) throw new Error('无法读取远程引用');
    if (info.refs.some(ref => ref.ref === `refs/heads/${cfg.branch}`)) {
      await git.fetch({ fs, http, dir, ref: cfg.branch, singleBranch: true, onAuth: auth });
      await git.merge({ fs, dir, ours: cfg.branch, theirs: `origin/${cfg.branch}`, author, mergeDriver: async ({ path, contents }) => {
        if (path === 'tasks.jsonl' || path === 'archive.jsonl') return { cleanMerge: true, mergedText: jsonl(mergeUnion(records(contents[1]!), records(contents[2]!))) };
        throw new Error(`文件 ${path} 同时被两端修改，请先在电脑端处理配置冲突`);
      } });
      await git.checkout({ fs, dir, ref: cfg.branch });
    }
    const incoming = records(await textFile('tasks.jsonl')); const archived = records(await textFile('archive.jsonl')); const config = await textFile('config.toml');
    readConfig(config);
    await store.run(async () => { store.state.tasks = incoming; store.state.archive = archived; store.state.config = config; store.state.undo = []; }, false);
    await git.push({ fs, http, dir, remote: 'origin', ref: cfg.branch, onAuth: auth });
    return '同步完成';
  } finally { syncing = false; }
};
export const status = async (): Promise<string> => {
  const cfg = native<SyncSettings | null>('syncSettings'); if (!cfg) return '尚未配置同步';
  if (!await exists(`${dir}/.git`)) return `${cfg.url}\n分支：${cfg.branch}\n尚未进行首次同步`;
  const branch = await git.currentBranch({ fs, dir }); const log = await git.log({ fs, dir, depth: 1 });
  return `${cfg.url}\n分支：${branch}\n最近提交：${log[0]?.oid.slice(0, 8) ?? '尚无提交'}`;
};
