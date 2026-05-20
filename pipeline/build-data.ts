// Monta os JSON do site a partir dos clusters rankeados + resumos, e cuida da
// persistência: data/current.json (edição atual), data/edicoes/<data>.json
// (snapshot do dia) e data/state.json (cache de resumos da janela recente).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cluster, Edition, State, Story, Summary, CachedSummary } from '../src/lib/types';
import { CATEGORIES, type Category } from '../src/lib/categories';
import { fallbackSummary } from './summarize';

const CACHE_WINDOW_HOURS = 72;

// Data da edição no fuso de Brasília (en-CA formata como AAAA-MM-DD).
export function brDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Fontes da história: uma entrada por fonte distinta, na ordem dos artigos
// (o mais recente primeiro, já que o cluster é semeado pela recência).
function storySources(cluster: Cluster): { name: string; url: string }[] {
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];
  for (const a of cluster.articles) {
    if (seen.has(a.source)) continue;
    seen.add(a.source);
    out.push({ name: a.source, url: a.url });
  }
  return out;
}

export function toStory(cluster: Cluster, summary: Summary): Story {
  const story: Story = {
    clusterId: cluster.id,
    titulo: summary.titulo,
    resumo: summary.resumo,
    porQueImporta: summary.porQueImporta,
    category: cluster.category,
    sources: storySources(cluster),
    updatedAt: cluster.latestAt,
  };
  const imageUrl = cluster.articles.find((a) => a.imageUrl)?.imageUrl;
  if (imageUrl) story.imageUrl = imageUrl;
  return story;
}

export type Selection = {
  home: Cluster[];
  categorias: Record<Category, Cluster[]>;
};

// Monta a edição. Se faltar resumo de algum cluster, usa fallback (defensivo).
export function buildEdition(selection: Selection, summaries: Map<string, Summary>, now: Date): Edition {
  const story = (c: Cluster) => toStory(c, summaries.get(c.id) ?? fallbackSummary(c));
  const categorias = {} as Record<Category, Story[]>;
  for (const c of CATEGORIES) categorias[c] = selection.categorias[c].map(story);
  return {
    date: brDate(now),
    generatedAt: now.toISOString(),
    home: selection.home.map(story),
    categorias,
  };
}

// Remove do cache os resumos mais velhos que a janela (poda o state.json).
export function pruneCache(cache: Record<string, CachedSummary>, now: Date): Record<string, CachedSummary> {
  const cutoff = now.getTime() - CACHE_WINDOW_HOURS * 3600_000;
  const out: Record<string, CachedSummary> = {};
  for (const [key, summary] of Object.entries(cache)) {
    const t = new Date(summary.cachedAt).getTime();
    if (Number.isFinite(t) && t >= cutoff) out[key] = summary;
  }
  return out;
}

// ── Persistência ──────────────────────────────────────────────────────────────
const PRETTY = 2;

export async function readState(dataDir: string): Promise<State> {
  try {
    const raw = await readFile(join(dataDir, 'state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<State>;
    return { updatedAt: parsed.updatedAt ?? '', summaries: parsed.summaries ?? {} };
  } catch {
    return { updatedAt: '', summaries: {} };
  }
}

export async function writeData(edition: Edition, state: State, dataDir: string): Promise<void> {
  await mkdir(join(dataDir, 'edicoes'), { recursive: true });
  await writeFile(join(dataDir, 'current.json'), JSON.stringify(edition, null, PRETTY) + '\n');
  await writeFile(join(dataDir, 'edicoes', `${edition.date}.json`), JSON.stringify(edition, null, PRETTY) + '\n');
  await writeFile(join(dataDir, 'state.json'), JSON.stringify(state, null, PRETTY) + '\n');
}
