import type { Config, Task } from '../contracts.js';
import { recommendationTemplates, runRecommendation, type RecommendOptions } from '../core/recommendation.js';
import { loadRecommendationScript } from './recommendation-script.js';

export const recommend = async (tasks: Task[], catalog: Task[], config: Config, options: RecommendOptions = {}, dir?: string): Promise<Task[]> => {
  const source = config.focus.template === 'custom' ? await loadRecommendationScript(config, dir) : recommendationTemplates[config.focus.template];
  return runRecommendation(source, tasks, catalog, config, options);
};
