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

  it('cluster que cruza editorias (empate entre específicas) vira "geral"', () => {
    // Mesma notícia transversal pega por feeds de editorias diferentes: sem
    // pluralidade única, não deve ser forçada a uma categoria (cai na home).
    const articles = [
      mk('a', 'Tiroteio perto da Casa Branca deixa um morto', 'BBC Brasil', 'mundo'),
      mk('b', 'Tiroteio perto da Casa Branca deixa um morto', 'InfoMoney', 'economia'),
      mk('c', 'Tiroteio perto da Casa Branca deixa um morto', 'CNN Brasil', 'geral'),
    ];
    const clusters = clusterArticles(articles, { now: NOW });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.articles).toHaveLength(3);
    expect(clusters[0]!.category).toBe('geral'); // empate mundo×economia → geral
  });

  it('separa histórias diferentes que compartilham só vocabulário genérico ("Copa do Mundo")', () => {
    // Caso real reportado na edição 2026-05-27: 4 manchetes que falam de
    // assuntos distintos do contexto Copa do Mundo colaram num cluster só, e
    // a IA inventou "ebola" pra reconciliar. Com IDF + gate de entidades, devem
    // virar clusters separados (≥3).
    const articles = [
      mk('a', 'Athletico-PR vai receber dinheiro por convocação para Copa do Mundo', 'GE', 'esportes'),
      mk('b', 'Quem ganhou mais seguidores depois da Copa do Mundo', 'CNN Brasil', 'entretenimento'),
      mk('c', 'Palmeiras avança às oitavas da Copa do Mundo', 'UOL', 'esportes'),
      mk('d', 'FIFA divulga teste físico da bola oficial da Copa do Mundo', 'G1', 'esportes'),
    ];
    const clusters = clusterArticles(articles, { now: NOW });
    expect(clusters.length).toBeGreaterThanOrEqual(3);
  });

  it('agrupa quando uma entidade rara coincide entre títulos', () => {
    // Sanidade: o gate de entidades não pode ser estrito demais. Três manchetes
    // sobre o mesmo evento devem colar mesmo com pequenas variações de redação.
    const articles = [
      mk('a', 'Tiroteio perto da Casa Branca deixa um morto e três feridos', 'BBC Brasil', 'mundo'),
      mk('b', 'Casa Branca confirma tiroteio com um morto na região central', 'CNN Brasil', 'mundo'),
      mk('c', 'Polícia investiga tiroteio próximo à Casa Branca', 'G1', 'mundo'),
    ];
    const clusters = clusterArticles(articles, { now: NOW });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.articles).toHaveLength(3);
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
