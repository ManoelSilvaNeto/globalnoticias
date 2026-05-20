import { describe, it, expect } from 'vitest';
import { normalizeUrl, articleId, stripHtml, toArticle, dedupeByUrl } from './fetch';
import type { Article, Source } from '../src/lib/types';

const source: Source = { name: 'G1', url: 'https://g1.globo.com/rss/g1/', category: 'politica' };

describe('normalizeUrl', () => {
  it('remove parâmetros de rastreamento, www, fragmento e barra final', () => {
    const a = normalizeUrl('http://www.g1.globo.com/noticia/?utm_source=x&fbclid=y#topo');
    expect(a).toBe('https://g1.globo.com/noticia');
  });

  it('preserva query relevante', () => {
    expect(normalizeUrl('https://site.com/n?id=42&utm_medium=rss')).toBe('https://site.com/n?id=42');
  });

  it('é idempotente e devolve a entrada quando não é URL', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('articleId', () => {
  it('mesma matéria com rastreamento diferente → mesmo id', () => {
    const a = articleId('https://g1.globo.com/noticia/?utm_source=rss');
    const b = articleId('https://www.g1.globo.com/noticia#x');
    expect(a).toBe(b);
  });

  it('URLs diferentes → ids diferentes', () => {
    expect(articleId('https://a.com/1')).not.toBe(articleId('https://a.com/2'));
  });
});

describe('stripHtml', () => {
  it('remove tags, scripts e decodifica entidades', () => {
    const out = stripHtml('<p>Caf&eacute; &amp; <b>p&atilde;o</b></p><script>x()</script>');
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('&');
    expect(out).not.toContain('x()');
  });
});

describe('toArticle', () => {
  const fetchedAt = '2026-05-20T12:00:00.000Z';

  it('mapeia os campos e gera id pela URL', () => {
    const article = toArticle(
      { title: 'Título <b>X</b>', link: 'https://g1.globo.com/n/1', isoDate: '2026-05-20T10:00:00.000Z', contentSnippet: 'Resumo do feed.' },
      source,
      fetchedAt,
    );
    expect(article).not.toBeNull();
    expect(article!.title).toBe('Título X');
    expect(article!.description).toBe('Resumo do feed.');
    expect(article!.source).toBe('G1');
    expect(article!.category).toBe('politica');
    expect(article!.publishedAt).toBe('2026-05-20T10:00:00.000Z');
    expect(article!.id).toBe(articleId('https://g1.globo.com/n/1'));
  });

  it('retorna null sem link ou sem título', () => {
    expect(toArticle({ title: 'Só título' }, source, fetchedAt)).toBeNull();
    expect(toArticle({ link: 'https://x.com/só-link' }, source, fetchedAt)).toBeNull();
  });

  it('cai pro fetchedAt quando a data é inválida/ausente', () => {
    const article = toArticle({ title: 'T', link: 'https://x.com/a', pubDate: 'data-zoada' }, source, fetchedAt);
    expect(article!.publishedAt).toBe(fetchedAt);
  });

  it('extrai imagem de media:content', () => {
    const article = toArticle(
      { title: 'T', link: 'https://x.com/b', mediaContent: [{ $: { url: 'https://img/x.jpg', medium: 'image' } }] },
      source,
      fetchedAt,
    );
    expect(article!.imageUrl).toBe('https://img/x.jpg');
  });
});

describe('dedupeByUrl', () => {
  it('mantém o primeiro artigo por id', () => {
    const mk = (url: string, source: string): Article => ({
      id: articleId(url),
      url,
      source,
      title: 't',
      description: 'd',
      publishedAt: '2026-05-20T10:00:00.000Z',
      category: 'politica',
      fetchedAt: '2026-05-20T12:00:00.000Z',
    });
    const out = dedupeByUrl([
      mk('https://a.com/1?utm_source=rss', 'G1'),
      mk('https://www.a.com/1', 'CNN Brasil'),
      mk('https://a.com/2', 'G1'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.source).toBe('G1');
  });
});
