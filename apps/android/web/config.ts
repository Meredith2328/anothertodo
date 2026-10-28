import * as TOML from 'smol-toml';
import { ConfigSchema, type Config } from '../../../src/contracts.js';
import { setLang } from '../../../src/core/i18n.js';

export const defaultConfig = (): Config => ConfigSchema.parse({
  priority: { mode: 'levels', levels: ['低', '中', '高'], urgency: { overdue: 12, due_today: 8, due_week_decay: 8, per_level: 3, age_per_day: .05, age_cap: 2, waiting_penalty: 3 } },
  agenda: { week_days: 7, date_format: 'auto' }, watch: { interval_seconds: 30 },
  ui: { lang: 'zh', mouse: 'click' },
  email: { host: '', port: 465, ssl: true, user: '', password: '', from: '', to: '' },
});
export const configText = (value: Config): string => TOML.stringify(value);
export const initialConfig = configText(defaultConfig());
const merge = (base: Record<string, unknown>, user: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(user)) {
    if (!(key in base)) throw new Error(`配置项不存在：${key}`);
    const current = base[key];
    base[key] = current && value && typeof current === 'object' && typeof value === 'object' && !Array.isArray(current) && !Array.isArray(value)
      ? merge({ ...current as Record<string, unknown> }, value as Record<string, unknown>) : value;
  }
  return base;
};
export const readConfig = (text: string): Config => ConfigSchema.parse(merge(defaultConfig() as unknown as Record<string, unknown>, TOML.parse(text) as Record<string, unknown>));
let provider: () => string;
export const useConfig = (read: () => string): void => { provider = read; };
export const loadConfig = async (_dir?: string): Promise<Config> => {
  const config = readConfig(provider());
  setLang(config.ui.lang === 'auto' ? (navigator.language.startsWith('en') ? 'en' : 'zh') : config.ui.lang);
  return config;
};
export const configLevels = (config: Config): string[] => [...config.priority.levels];
export const priorityMode = (config: Config): 'levels' | 'urgency' => config.priority.mode;
