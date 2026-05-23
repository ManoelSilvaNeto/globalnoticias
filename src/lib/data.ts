// Carrega os dados gerados pelo pipeline (JSON-on-Git) em tempo de build.

import type { Edition, Story } from './types';
import { storySlug } from './story';
import currentJson from '../../data/current.json';

export const currentEdition = currentJson as unknown as Edition;

// Todas as edições arquivadas (data/edicoes/*.json), da mais nova p/ a mais antiga.
const editionModules = import.meta.glob<{ default: Edition }>('../../data/edicoes/*.json', { eager: true });

export const editions: Edition[] = Object.values(editionModules)
  .map((m) => m.default)
  .sort((a, b) => b.date.localeCompare(a.date));

export function editionByDate(date: string): Edition | undefined {
  return editions.find((e) => e.date === date);
}

export function hasContent(edition: Edition): boolean {
  return edition.home.length > 0;
}

const editionStories = (ed: Edition): Story[] => [...ed.home, ...Object.values(ed.categorias).flat()];

// Catálogo único de histórias (atual + arquivo), deduplicado por slug estável,
// da mais recente p/ a mais antiga. Base p/ "leia também", páginas-tema e afins.
export const allStories: Story[] = (() => {
  const seen = new Map<string, Story>();
  for (const ed of [currentEdition, ...editions]) {
    for (const s of editionStories(ed)) {
      const slug = storySlug(s);
      if (!seen.has(slug)) seen.set(slug, s);
    }
  }
  return [...seen.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
})();

// Histórias relacionadas a uma dada história: mesma categoria, mais recentes,
// excluindo ela mesma. Para links internos (rastreio + páginas vistas).
export function relatedStories(story: Story, limit = 6): Story[] {
  const self = storySlug(story);
  return allStories
    .filter((s) => storySlug(s) !== self && s.category === story.category)
    .slice(0, limit);
}
