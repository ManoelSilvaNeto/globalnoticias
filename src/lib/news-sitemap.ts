// Sitemap de notícias no padrão Google News (namespace sitemap-news/0.9).
// Diferente do sitemap normal (@astrojs/sitemap, todas as páginas), este lista
// SÓ as notícias das últimas 48h — o Google News ignora itens mais antigos e
// aceita no máximo 1000 URLs. É submetido à parte no Search Console e serve
// para descoberta rápida de conteúdo fresco (Top Stories / aba Notícias).

import type { Story } from './types';
import { storySlug } from './story';
import { SITE } from './site';

const WINDOW_MS = 48 * 60 * 60 * 1000; // janela do Google News
const MAX_URLS = 1000; // teto do Google News por sitemap

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

// ISO 8601 sem milissegundos (W3C/RFC 3339), formato que o Google News espera.
function w3c(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Notícias publicadas/atualizadas dentro da janela de 48h relativa a `now`,
// das mais recentes p/ as mais antigas, limitadas ao teto do Google News.
export function recentNewsStories(stories: Story[], now: Date): Story[] {
  const cutoff = now.getTime() - WINDOW_MS;
  return stories
    .filter((s) => {
      const t = new Date(s.updatedAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_URLS);
}

// XML completo do news sitemap. `baseUrl` sem barra final (ex.: https://noticias.globalnote.com.br).
export function buildNewsSitemap(stories: Story[], baseUrl: string, now: Date): string {
  const base = baseUrl.replace(/\/$/, '');
  const urls = recentNewsStories(stories, now)
    .map((s) => {
      const loc = `${base}/noticia/${storySlug(s)}/`;
      return [
        '<url>',
        `<loc>${esc(loc)}</loc>`,
        '<news:news>',
        '<news:publication>',
        `<news:name>${esc(SITE.name)}</news:name>`,
        '<news:language>pt</news:language>',
        '</news:publication>',
        `<news:publication_date>${w3c(s.updatedAt)}</news:publication_date>`,
        `<news:title>${esc(s.titulo)}</news:title>`,
        '</news:news>',
        '</url>',
      ].join('');
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">` +
    urls +
    `</urlset>`
  );
}
