import { describe, it, expect } from 'vitest';
import { websiteJsonLd, itemListJsonLd, newsArticleJsonLd, breadcrumbJsonLd } from './seo';
import { SITE } from './site';
import type { Story } from './types';

const SITE_URL = 'https://noticias.globalnote.com.br';
const story: Story = {
  clusterId: 'cl-123',
  slug: 'abc123',
  titulo: 'Senado aprova reforma tributária em segundo turno',
  resumo: 'O Senado aprovou nesta terça a reforma tributária em segundo turno por ampla maioria.',
  porQueImporta: 'Marca a maior mudança no sistema tributário em décadas.',
  category: 'politica',
  sources: [
    { name: 'G1', url: 'https://g1.globo.com/n/1' },
    { name: 'CNN Brasil', url: 'https://cnnbrasil.com.br/n/2' },
  ],
  imageUrl: 'https://example.com/img.jpg',
  updatedAt: '2026-05-27T15:00:00.000Z',
};

describe('websiteJsonLd', () => {
  it('produz WebSite com nome, descrição e URL', () => {
    expect(websiteJsonLd(SITE_URL)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE.name,
      description: SITE.description,
      url: SITE_URL,
    });
  });
});

describe('itemListJsonLd', () => {
  it('numera os items a partir de 1 e usa a URL da fonte primária', () => {
    const stories = [story, { ...story, clusterId: 'cl-2', titulo: 'Outra história', sources: [] }];
    const list = itemListJsonLd(stories, `${SITE_URL}/`) as {
      itemListElement: Array<{ position: number; url: string; name: string }>;
      numberOfItems: number;
    };
    expect(list.numberOfItems).toBe(2);
    expect(list.itemListElement[0]).toMatchObject({ position: 1, url: 'https://g1.globo.com/n/1', name: story.titulo });
    // story 2 não tem fontes → cai pra pageUrl.
    expect(list.itemListElement[1]).toMatchObject({ position: 2, url: `${SITE_URL}/` });
  });
});

describe('newsArticleJsonLd', () => {
  it('produz NewsArticle com headline truncado em 110 chars e citation/isBasedOn das fontes', () => {
    const pageUrl = `${SITE_URL}/noticia/${story.slug}/`;
    const ld = newsArticleJsonLd(story, pageUrl, SITE_URL) as Record<string, unknown> & {
      headline: string;
      author: { name: string };
      publisher: { name: string; logo: { url: string } };
      citation: Array<{ name: string; url: string }>;
      isBasedOn: string[];
      image?: string[];
    };
    expect(ld['@type']).toBe('NewsArticle');
    expect(ld.headline.length).toBeLessThanOrEqual(110);
    expect(ld.author.name).toBe(SITE.name);
    expect(ld.publisher.name).toBe(SITE.name);
    expect(ld.publisher.logo.url).toBe(`${SITE_URL}/logo.png`);
    expect(ld.citation).toEqual([
      { '@type': 'CreativeWork', name: 'G1', url: 'https://g1.globo.com/n/1' },
      { '@type': 'CreativeWork', name: 'CNN Brasil', url: 'https://cnnbrasil.com.br/n/2' },
    ]);
    expect(ld.isBasedOn).toEqual(['https://g1.globo.com/n/1', 'https://cnnbrasil.com.br/n/2']);
    expect(ld.image).toEqual(['https://example.com/img.jpg']);
  });

  it('omite image quando a story não tem imageUrl', () => {
    const { imageUrl: _unused, ...withoutImage } = story;
    const ld = newsArticleJsonLd(withoutImage as Story, `${SITE_URL}/n/x/`, SITE_URL) as Record<string, unknown>;
    expect('image' in ld).toBe(false);
  });

  it('trunca títulos muito longos preservando os 110 primeiros chars', () => {
    const long = { ...story, titulo: 'a'.repeat(150) };
    const ld = newsArticleJsonLd(long, `${SITE_URL}/n/x/`, SITE_URL) as { headline: string };
    expect(ld.headline).toBe('a'.repeat(110));
  });
});

describe('breadcrumbJsonLd', () => {
  it('numera os items na ordem fornecida', () => {
    const ld = breadcrumbJsonLd([
      { name: 'Home', url: SITE_URL },
      { name: 'Política', url: `${SITE_URL}/politica/` },
      { name: story.titulo, url: `${SITE_URL}/noticia/${story.slug}/` },
    ]) as { itemListElement: Array<{ position: number; name: string; item: string }> };
    expect(ld.itemListElement.map((it) => it.position)).toEqual([1, 2, 3]);
    expect(ld.itemListElement[1]!.name).toBe('Política');
    expect(ld.itemListElement[2]!.item).toBe(`${SITE_URL}/noticia/${story.slug}/`);
  });
});
