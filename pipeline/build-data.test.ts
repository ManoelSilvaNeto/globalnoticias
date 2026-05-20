import { describe, it, expect } from 'vitest';
import { toStory, buildEdition, pruneCache, brDate, type Selection } from './build-data';
import { CATEGORIES, type Category } from '../src/lib/categories';
import type { Article, Cluster, CachedSummary, Summary } from '../src/lib/types';

function article(url: string, source: string, imageUrl?: string): Article {
  return {
    id: url,
    url,
    source,
    title: `Título de ${source}`,
    description: 'Descrição.',
    ...(imageUrl ? { imageUrl } : {}),
    publishedAt: '2026-05-20T11:00:00.000Z',
    category: 'politica',
    fetchedAt: '2026-05-20T12:00:00.000Z',
  };
}

function cluster(id: string, articles: Article[], category: Category = 'politica'): Cluster {
  return { id, articles, category, latestAt: '2026-05-20T11:00:00.000Z', sourceCount: new Set(articles.map((a) => a.source)).size };
}

const SUMMARY: Summary = { titulo: 'T', resumo: 'R', porQueImporta: 'P' };

function emptyCategorias(): Record<Category, Cluster[]> {
  const r = {} as Record<Category, Cluster[]>;
  for (const c of CATEGORIES) r[c] = [];
  return r;
}

describe('toStory', () => {
  it('mapeia o resumo, deduplica fontes e pega a primeira imagem', () => {
    const c = cluster('c1', [
      article('https://a.com/1', 'G1', 'https://img/x.jpg'),
      article('https://b.com/2', 'G1'), // mesma fonte → não duplica
      article('https://c.com/3', 'CNN Brasil'),
    ]);
    const story = toStory(c, SUMMARY);
    expect(story.titulo).toBe('T');
    expect(story.sources).toEqual([
      { name: 'G1', url: 'https://a.com/1' },
      { name: 'CNN Brasil', url: 'https://c.com/3' },
    ]);
    expect(story.imageUrl).toBe('https://img/x.jpg');
  });
});

describe('buildEdition', () => {
  it('monta home + categorias e usa fallback quando falta resumo', () => {
    const c1 = cluster('c1', [article('https://a.com/1', 'G1')], 'economia');
    const categorias = emptyCategorias();
    categorias.economia = [c1];
    const selection: Selection = { home: [c1], categorias };
    const summaries = new Map<string, Summary>(); // vazio → fallback

    const edition = buildEdition(selection, summaries, new Date('2026-05-20T15:00:00.000Z'));
    expect(edition.home).toHaveLength(1);
    expect(edition.categorias.economia).toHaveLength(1);
    expect(edition.categorias.politica).toHaveLength(0);
    expect(edition.home[0]!.titulo).toBe('Título de G1'); // fallback usa o título do artigo
    expect(Object.keys(edition.categorias).sort()).toEqual([...CATEGORIES].sort());
  });
});

describe('pruneCache', () => {
  it('remove resumos mais velhos que a janela', () => {
    const now = new Date('2026-05-20T12:00:00.000Z');
    const fresh: CachedSummary = { ...SUMMARY, cachedAt: '2026-05-20T06:00:00.000Z' };
    const old: CachedSummary = { ...SUMMARY, cachedAt: '2026-05-10T06:00:00.000Z' };
    const out = pruneCache({ a: fresh, b: old }, now);
    expect(out).toHaveProperty('a');
    expect(out).not.toHaveProperty('b');
  });
});

describe('brDate', () => {
  it('formata no fuso de Brasília (AAAA-MM-DD)', () => {
    // 2026-05-21T02:00Z = 2026-05-20 23:00 em Brasília (UTC-3)
    expect(brDate(new Date('2026-05-21T02:00:00.000Z'))).toBe('2026-05-20');
  });
});
