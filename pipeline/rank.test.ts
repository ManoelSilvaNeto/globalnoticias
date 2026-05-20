import { describe, it, expect } from 'vitest';
import { scoreCluster, recencyScore, topForHome, topForCategory } from './rank';
import type { Cluster, ArticleCategory } from '../src/lib/types';

const NOW = new Date('2026-05-20T12:00:00.000Z');

function cluster(id: string, sourceCount: number, hoursAgo: number, category: ArticleCategory = 'politica'): Cluster {
  return {
    id,
    articles: [],
    category,
    latestAt: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(),
    sourceCount,
  };
}

describe('recencyScore', () => {
  it('é 1 no instante atual e cai com o tempo', () => {
    expect(recencyScore(cluster('a', 1, 0), NOW)).toBeCloseTo(1, 5);
    expect(recencyScore(cluster('b', 1, 10), NOW)).toBeCloseTo(0.5, 2); // ~meia-vida 10h
    expect(recencyScore(cluster('c', 1, 0), NOW)).toBeGreaterThan(recencyScore(cluster('d', 1, 20), NOW));
  });
});

describe('scoreCluster', () => {
  it('mais fontes → score maior (domina sobre recência)', () => {
    const multi = cluster('multi', 3, 24);
    const fresco = cluster('fresco', 1, 0);
    expect(scoreCluster(multi, NOW)).toBeGreaterThan(scoreCluster(fresco, NOW));
  });

  it('com as mesmas fontes, o mais fresco ganha', () => {
    expect(scoreCluster(cluster('novo', 1, 0), NOW)).toBeGreaterThan(scoreCluster(cluster('velho', 1, 24), NOW));
  });
});

describe('seleção', () => {
  const clusters = [
    cluster('p1', 4, 2, 'politica'),
    cluster('p2', 1, 1, 'politica'),
    cluster('e1', 2, 1, 'economia'),
    cluster('g1', 1, 0, 'geral'),
  ];

  it('topForHome ordena por score e respeita o limite', () => {
    const top = topForHome(clusters, NOW, 2);
    expect(top).toHaveLength(2);
    expect(top[0]!.id).toBe('p1'); // 4 fontes lidera
  });

  it('topForCategory filtra pela categoria', () => {
    const pol = topForCategory(clusters, 'politica', NOW);
    expect(pol.map((c) => c.id)).toEqual(['p1', 'p2']);
    expect(topForCategory(clusters, 'economia', NOW).map((c) => c.id)).toEqual(['e1']);
  });
});
