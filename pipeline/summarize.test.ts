import { describe, it, expect, vi } from 'vitest';
import { cacheKey, fallbackSummary, summarizeClusters, type Summarizer } from './summarize';
import type { Article, Cluster, CachedSummary, Summary } from '../src/lib/types';

function article(url: string, source: string, title = 'Título', description = 'Descrição longa do artigo.'): Article {
  return {
    id: url,
    url,
    source,
    title,
    description,
    publishedAt: '2026-05-20T11:00:00.000Z',
    category: 'politica',
    fetchedAt: '2026-05-20T12:00:00.000Z',
  };
}

function cluster(id: string, articles: Article[]): Cluster {
  return { id, articles, category: 'politica', latestAt: '2026-05-20T11:00:00.000Z', sourceCount: new Set(articles.map((a) => a.source)).size };
}

const SUMMARY: Summary = { titulo: 'Resumo IA', resumo: 'Frase um. Frase dois.', porQueImporta: 'Importa porque sim.' };
const NOW = new Date('2026-05-20T12:00:00.000Z');

describe('cacheKey', () => {
  it('independe de ordem e de rastreamento na URL', () => {
    const a = cacheKey(cluster('x', [article('https://a.com/1?utm_source=rss', 'G1'), article('https://b.com/2', 'CNN Brasil')]));
    const b = cacheKey(cluster('y', [article('https://www.b.com/2#x', 'CNN Brasil'), article('https://a.com/1', 'G1')]));
    expect(a).toBe(b);
  });

  it('muda quando a composição do cluster muda', () => {
    const a = cacheKey(cluster('x', [article('https://a.com/1', 'G1')]));
    const b = cacheKey(cluster('x', [article('https://a.com/1', 'G1'), article('https://c.com/3', 'Veja')]));
    expect(a).not.toBe(b);
  });
});

describe('summarizeClusters', () => {
  it('usa o cache e não chama a IA', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1')]);
    const cached: Record<string, CachedSummary> = { [cacheKey(c)]: { ...SUMMARY, cachedAt: '2026-05-19T00:00:00.000Z' } };
    const summarizer: Summarizer = { summarize: vi.fn() };

    const { summaries, stats } = await summarizeClusters([c], summarizer, cached, NOW);

    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(stats.fromCache).toBe(1);
    expect(summaries.get('c1')).toEqual(SUMMARY);
  });

  it('gera e cacheia quando não está no cache', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1')]);
    const summarizer: Summarizer = { summarize: vi.fn().mockResolvedValue(SUMMARY) };

    const { summaries, cache, stats } = await summarizeClusters([c], summarizer, {}, NOW);

    expect(summarizer.summarize).toHaveBeenCalledOnce();
    expect(stats.generated).toBe(1);
    expect(summaries.get('c1')).toEqual(SUMMARY);
    expect(cache[cacheKey(c)]).toEqual({ ...SUMMARY, cachedAt: NOW.toISOString() });
  });

  it('cai no fallback quando a IA falha e NÃO cacheia', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1', 'T', 'Descrição do RSS.')]);
    const summarizer: Summarizer = { summarize: vi.fn().mockRejectedValue(new Error('quota')) };

    const { summaries, cache, stats } = await summarizeClusters([c], summarizer, {}, NOW);

    expect(stats.fallback).toBe(1);
    expect(summaries.get('c1')).toEqual(fallbackSummary(c));
    expect(cache).toEqual({});
  });

  it('usa fallback quando não há summarizer (sem API key)', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1')]);
    const { stats } = await summarizeClusters([c], null, {}, NOW);
    expect(stats.fallback).toBe(1);
  });
});
