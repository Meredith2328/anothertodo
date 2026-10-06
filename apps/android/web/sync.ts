import { native } from './bridge.js';

export type SyncSettings = { url: string; username: string; token: string; branch: string; name: string; email: string };
export const configureSync = (settings: SyncSettings): void => {
  const debug = native<{ debug: boolean }>('permissions').debug;
  if (!settings.url.startsWith('https://') && !(debug && /^http:\/\/(127\.0\.0\.1|10\.0\.2\.2):/.test(settings.url))) throw new Error('请输入 HTTPS 仓库地址');
  if (!settings.branch || !settings.name || !settings.email) throw new Error('请填写分支、提交姓名和邮箱');
  if (settings.url.includes('@')) throw new Error('请在用户名和访问令牌输入框填写凭据');
  native('saveSyncSettings', settings);
};
export const syncDirectory = async (_dir?: string, _push?: boolean, _unused?: unknown, _events?: unknown): Promise<string> => (await import('./git-engine.js')).sync();
export const syncStatus = async (): Promise<string> => (await import('./git-engine.js')).status();
