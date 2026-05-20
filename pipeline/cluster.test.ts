import { describe, it, expect } from 'vitest';
import { normalizePt, clusterArticles } from './cluster';
import type { Article, ArticleCategory } from '../src/lib/types';

const NOW = new Date('2026-05-20T12:00:00.000Z');

function mk(id: string, title: string, source: string, category: ArticleCategory, hoursAgo = 1): Article {
  return {
    id,
    url: `https://exemplo.com/${id}`,
    source,
    title,
    description: title,
    publishedAt: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(),
    category,
    fetchedAt: NOW.toISOString(),
  };
}

describe('normalizePt', () => {
  it('remove acentos, pontuação e stopwords', () => {
    expect(normalizePt('A inflação não cai, segundo o Governo!')).toEqual(['inflacao', 'cai', 'governo']);
  });
});

describe('clusterArticles', () => {
  it('agrupa títulos parecidos e separa os diferentes', () => {
    const articles = [
      mk('a', 'Governo anuncia novo pacote econômico para conter inflação', 'G1', 'economia'),
      mk('b', 'Novo pacote econômico do governo busca conter a inflação', 'CNN Brasil', 'geral'),
      mk('c', 'Seleção brasileira vence amistoso por três a zero', 'GE', 'esportes'),
    ];
    const clusters = clusterArticles(articles, { now: NOW });
    expect(clusters).toHaveLength(2);

    const big = clusters.find((cl) => cl.articles.length === 2)!;
    expect(big.sourceCount).toBe(2);
    expect(big.category).toBe('economia'); // economia vence 'geral'

    const solo = clusters.find((cl) => cl.articles.length === 1)!;
    expect(solo.articles[0]!.id).toBe('c');
  });

  it('ignora artigos fora da janela', () => {
    const articles = [
      mk('a', 'Mesmo assunto importante hoje agora', 'G1', 'politica', 1),
      mk('b', 'Mesmo assunto importante porém antigo', 'CNN Brasil', 'geral', 200),
    ];
    const clusters = clusterArticles(articles, { now: NOW, windowHours: 48 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.articles[0]!.id).toBe('a');
  });
});
