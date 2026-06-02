import { describe, it, expect } from 'vitest';
import { recentNewsStories, buildNewsSitemap } from './news-sitemap';
import { SITE } from './site';
import type { Story } from './types';

const NOW = new Date('2026-06-02T12:00:00.000Z');
const SITE_URL = 'https://noticias.globalnote.com.br';

const make = (over: Partial<Story>): Story => ({
  clusterId: 'cl',
  slug: 's1',
  titulo: 'Título de teste',
  resumo: 'Resumo.',
  porQueImporta: 'Importa.',
  category: 'politica',
  sources: [{ name: 'G1', url: 'https://g1.globo.com/n/1' }],
  updatedAt: '2026-06-02T10:00:00.000Z',
  ...over,
});

describe('recentNewsStories', () => {
  it('inclui só notícias dentro da janela de 48h', () => {
    const stories = [
      make({ slug: 'fresca', updatedAt: '2026-06-02T11:00:00.000Z' }), // 1h atrás
      make({ slug: 'no-limite', updatedAt: '2026-05-31T12:30:00.000Z' }), // ~47h30 atrás
      make({ slug: 'velha', updatedAt: '2026-05-30T11:00:00.000Z' }), // ~49h atrás → fora
    ];
    const slugs = recentNewsStories(stories, NOW).map((s) => s.slug);
    expect(slugs).toEqual(['fresca', 'no-limite']);
  });

  it('ordena da mais recente p/ a mais antiga', () => {
    const stories = [
      make({ slug: 'a', updatedAt: '2026-06-02T08:00:00.000Z' }),
      make({ slug: 'b', updatedAt: '2026-06-02T11:00:00.000Z' }),
    ];
    expect(recentNewsStories(stories, NOW).map((s) => s.slug)).toEqual(['b', 'a']);
  });

  it('ignora updatedAt inválido', () => {
    const stories = [make({ slug: 'ok' }), make({ slug: 'ruim', updatedAt: 'não-é-data' })];
    expect(recentNewsStories(stories, NOW).map((s) => s.slug)).toEqual(['ok']);
  });
});

describe('buildNewsSitemap', () => {
  it('gera urlset com namespace news e os campos obrigatórios do Google News', () => {
    const xml = buildNewsSitemap([make({ slug: 'abc', titulo: 'Reforma aprovada' })], SITE_URL, NOW);
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain('<loc>https://noticias.globalnote.com.br/noticia/abc/</loc>');
    expect(xml).toContain(`<news:name>${SITE.name}</news:name>`);
    expect(xml).toContain('<news:language>pt</news:language>');
    expect(xml).toContain('<news:title>Reforma aprovada</news:title>');
  });

  it('emite publication_date em W3C sem milissegundos', () => {
    const xml = buildNewsSitemap([make({ updatedAt: '2026-06-02T10:00:00.000Z' })], SITE_URL, NOW);
    expect(xml).toContain('<news:publication_date>2026-06-02T10:00:00Z</news:publication_date>');
  });

  it('escapa XML no título', () => {
    const xml = buildNewsSitemap([make({ titulo: 'Lula & Bolsonaro <debate>' })], SITE_URL, NOW);
    expect(xml).toContain('<news:title>Lula &amp; Bolsonaro &lt;debate&gt;</news:title>');
  });

  it('omite notícias fora da janela (urlset vazio possível)', () => {
    const xml = buildNewsSitemap([make({ updatedAt: '2026-05-01T10:00:00.000Z' })], SITE_URL, NOW);
    expect(xml).not.toContain('<url>');
    expect(xml).toContain('</urlset>');
  });

  it('aceita baseUrl com barra final sem duplicar', () => {
    const xml = buildNewsSitemap([make({ slug: 'x' })], `${SITE_URL}/`, NOW);
    expect(xml).toContain('<loc>https://noticias.globalnote.com.br/noticia/x/</loc>');
  });
});
