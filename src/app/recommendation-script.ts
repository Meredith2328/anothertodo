import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../contracts.js';
import { dataDir } from '../core/config.js';

export const loadRecommendationScript = async (config: Config, dir = dataDir()): Promise<string> => {
  if (!config.focus.script) throw new Error('请设置 focus.script 指向推荐脚本文件');
  return readFile(resolve(dir, config.focus.script), 'utf8');
};
