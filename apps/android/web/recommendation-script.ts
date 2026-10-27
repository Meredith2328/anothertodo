import type { Config } from '../../../src/contracts.js';

export const loadRecommendationScript = async (config: Config): Promise<string> => {
  const file = config.focus.files.find(file => file.name === config.focus.script);
  if (!file) throw new Error(`请导入推荐脚本文件：${config.focus.script}`);
  return file.source;
};
