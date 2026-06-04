// Páginas-tema âncora (/tema/<slug>): hubs evergreen que juntam toda a cobertura
// de um assunto recorrente. SEO de longo prazo — ranqueiam pra buscas amplas e
// não morrem quando a notícia sai da home.
//
// A lógica PURA (extração/validação/montagem) mora em ./topics-core, p/ o pipeline
// poder importá-la sem puxar o carregamento de edições (import.meta.glob). Aqui só
// fazemos o binding com allStories e os helpers que dependem dele.

import type { Story } from './types';
import { allStories } from './data';
import { storySlug } from './story';
import { buildTopics, type Topic } from './topics-core';

export {
  MIN_STORIES,
  INDEX_MIN,
  slugifyTopic,
  candidatesFrom,
  isValidTopic,
  buildTopics,
} from './topics-core';
export type { Topic } from './topics-core';

export const topics: Topic[] = buildTopics(allStories);

const bySlug = new Map(topics.map((t) => [t.slug, t]));
export const topicBySlug = (slug: string): Topic | undefined => bySlug.get(slug);

// Temas a que uma história pertence (p/ os chips na página da notícia).
export function topicsForStory(story: Story): Topic[] {
  const self = storySlug(story);
  return topics.filter((t) => t.stories.some((s) => storySlug(s) === self));
}
