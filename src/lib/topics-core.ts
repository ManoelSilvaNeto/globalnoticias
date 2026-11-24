// Lógica PURA das páginas-tema (extração de candidatos, validação anti-spam,
// montagem dos hubs). Sem dependência de import.meta.glob / data.ts — por isso o
// PIPELINE (Node/tsx) pode importar daqui sem puxar o carregamento de edições do
// site. O src/lib/topics.ts re-exporta tudo isto + faz o binding com allStories.
//
// Cuidado anti-spam: páginas-tema rasas/genéricas PIORAM o SEO. Por isso:
//   - só viram tema assuntos que aparecem em >= MIN_STORIES histórias distintas;
//   - termos genéricos (Brasil, Governo, dias da semana, meses...) são bloqueados;
//   - temas ainda rasos saem como noindex (ver INDEX_MIN) até ganharem volume.

import type { Story } from './types';
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
  // Numerais por extenso (abrem muita manchete: "Dois presos…", "Três dicas…")
  'um', 'uma', 'dois', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito',
  'nove', 'dez', 'cem', 'mil', 'dezenas', 'centenas', 'milhares',
  // Substantivos comuns que abrem manchete e não são assunto em si
  'estudo', 'estudos', 'pesquisa', 'pesquisas', 'serie', 'series', 'video', 'videos',
  'foto', 'fotos', 'homem', 'mulher', 'jovem', 'casal', 'familia', 'crianca',
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

const cleanTok = (t: string): string => t.replace(/[.,;:!?()"“”]+$/g, '').replace(/^["“”(]+/g, '');

// Palavras que aparecem capitalizadas FORA da 1ª posição do título — evidência de
// nome próprio (manchetes são sentence case: "Estudo aponta alta em São Paulo" → só
// "São Paulo" prova que é nome próprio; "Estudo" está maiúsculo só por abrir a frase).
export function midSentenceProperWords(titles: string[]): Set<string> {
  const out = new Set<string>();
  for (const title of titles) {
    const tokens = title.split(/\s+/).filter(Boolean);
    for (let i = 1; i < tokens.length; i++) {
      const tok = cleanTok(tokens[i]);
      if (isProper(tok)) out.add(norm(tok));
    }
  }
  return out;
}

// Extrai frases-nome próprias do título (runs de palavras capitalizadas, permitindo
// conectores em minúsculas no meio). Ex.: "Supremo Tribunal Federal", "Copa do Mundo".
// Se `provenProper` vier, um run de UMA palavra que abre o título só vale se essa
// palavra aparece capitalizada no meio de algum título (senão é só sentence case).
// Runs multi-palavra no início ("Copa do Mundo", "Banco Central") seguem valendo.
export function candidatesFrom(title: string, provenProper?: Set<string>): string[] {
  const tokens = title.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let run: string[] = [];
  let runStart = 0;
  const flush = () => {
    while (run.length && CONNECTORS.has(norm(run[run.length - 1]))) run.pop(); // tira conector no fim
    const sentenceCaseOnly = provenProper && runStart === 0 && run.length === 1 && !provenProper.has(norm(run[0]));
    if (run.length && !sentenceCaseOnly) out.push(run.join(' '));
    run = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = cleanTok(tokens[i]);
    if (isProper(tok)) {
      if (!run.length) runStart = i;
      run.push(tok);
    } else if (CONNECTORS.has(norm(tok)) && run.length && isProper(cleanTok(tokens[i + 1] ?? ''))) {
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
  const provenProper = midSentenceProperWords(stories.map((s) => s.titulo));
  for (const story of stories) {
    const seenInStory = new Set<string>();
    for (const cand of candidatesFrom(story.titulo, provenProper)) {
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
