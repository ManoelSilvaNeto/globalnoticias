// Páginas-tema âncora (/tema/<slug>): hubs evergreen que juntam toda a cobertura
// de um assunto recorrente. SEO de longo prazo — ranqueiam pra buscas amplas e
// não morrem quando a notícia sai da home.
//
// Cuidado anti-spam: páginas-tema rasas/genéricas PIORAM o SEO. Por isso:
//   - só viram tema assuntos que aparecem em >= MIN_STORIES histórias distintas;
//   - termos genéricos (Brasil, Governo, dias da semana, meses...) são bloqueados;
//   - temas ainda rasos saem como noindex (ver INDEX_MIN) até ganharem volume.

import type { Story } from './types';
import { allStories } from './data';
import { storySlug } from './story';

export const MIN_STORIES = 3; // mínimo p/ existir a página-tema
export const INDEX_MIN = 4; // mínimo p/ entrar no índice do Google (senão noindex,follow)

// Conectores: podem ligar partes de um nome próprio, mas não valem como tema sozinhos.
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'a', 'o', 'ao', 'aos']);

// Termos capitalizados comuns demais p/ virarem hub (gerariam página genérica/fina).
const GENERIC = new Set([
  'brasil', 'governo', 'pais', 'presidente', 'ministro', 'ministra', 'ministerio',
  'policia', 'justica', 'congresso', 'camara', 'senado', 'estado', 'cidade',
  'para', 'pela', 'pelo', 'pelos', 'pelas', 'ante', 'entre', 'desde', 'sem', 'sob',
  'apos', 'veja', 'entenda', 'saiba', 'como', 'onde', 'quando', 'porque', 'isso', 'isto',
  'este', 'esta', 'esse', 'essa', 'novo', 'nova', 'novos', 'novas', 'hoje', 'ontem', 'amanha',
  'mais', 'menos', 'agora', 'ainda', 'tudo', 'nada', 'sobre', 'contra', 'durante',
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro',
  'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
]);

export const slugifyTopic = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isProper = (tok: string): boolean => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+$/.test(tok);
const norm = (tok: string): string => slugifyTopic(tok);

// Extrai frases-nome próprias do título (runs de palavras capitalizadas, permitindo
// conectores em minúsculas no meio). Ex.: "Supremo Tribunal Federal", "Copa do Mundo".
export function candidatesFrom(title: string): string[] {
  const tokens = title.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    while (run.length && CONNECTORS.has(norm(run[run.length - 1]))) run.pop(); // tira conector no fim
    if (run.length) out.push(run.join(' '));
    run = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/[.,;:!?()"“”]+$/g, '').replace(/^["“”(]+/g, '');
    if (isProper(tok)) {
      run.push(tok);
    } else if (CONNECTORS.has(norm(tok)) && run.length && isProper((tokens[i + 1] ?? '').replace(/[.,;:!?()"“”]+$/g, ''))) {
      run.push(tok.toLowerCase());
    } else {
      flush();
    }
  }
  flush();
  return out;
}

export function isValidTopic(phrase: string): boolean {
  const significant = phrase.split(/\s+/).filter((w) => !CONNECTORS.has(norm(w)));
  if (significant.length === 0) return false;
  const key = slugifyTopic(phrase);
  if (!key || GENERIC.has(key)) return false;
  if (significant.length === 1) {
    const w = norm(significant[0]);
    if (w.length < 4 || GENERIC.has(w)) return false; // 1 palavra: precisa ser distintiva
  }
  return true;
}

export type Topic = { slug: string; label: string; stories: Story[]; indexable: boolean };

export function buildTopics(stories: Story[]): Topic[] {
  const acc = new Map<string, { label: string; stories: Map<string, Story> }>();
  for (const story of stories) {
    const seenInStory = new Set<string>();
    for (const cand of candidatesFrom(story.titulo)) {
      if (!isValidTopic(cand)) continue;
      const key = slugifyTopic(cand);
      if (seenInStory.has(key)) continue;
      seenInStory.add(key);
      const entry = acc.get(key) ?? { label: cand, stories: new Map<string, Story>() };
      // rótulo: prefere a forma de superfície mais longa (mais específica)
      if (cand.length > entry.label.length) entry.label = cand;
      entry.stories.set(storySlug(story), story);
      acc.set(key, entry);
    }
  }
  return [...acc.entries()]
    .map(([slug, e]) => ({
      slug,
      label: e.label,
      stories: [...e.stories.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      indexable: e.stories.size >= INDEX_MIN,
    }))
    .filter((t) => t.stories.length >= MIN_STORIES)
    .sort((a, b) => b.stories.length - a.stories.length);
}

export const topics: Topic[] = buildTopics(allStories);

const bySlug = new Map(topics.map((t) => [t.slug, t]));
export const topicBySlug = (slug: string): Topic | undefined => bySlug.get(slug);

// Temas a que uma história pertence (p/ os chips na página da notícia).
export function topicsForStory(story: Story): Topic[] {
  const self = storySlug(story);
  return topics.filter((t) => t.stories.some((s) => storySlug(s) === self));
}
