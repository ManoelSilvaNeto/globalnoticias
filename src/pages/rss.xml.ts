import type { APIRoute } from 'astro';
import { currentEdition } from '../lib/data';
import { SITE } from '../lib/site';

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'https://noticias.globalnote.com.br/').replace(/\/$/, '');
  const editionUrl = `${base}/edicao/${currentEdition.date}/`;

  const items = currentEdition.home
    .map((s) => {
      const fontes = s.sources.map((x) => x.name).join(', ');
      const desc = (s.porQueImporta ? `${s.resumo} Por que importa: ${s.porQueImporta}` : s.resumo) + ` (Fontes: ${fontes})`;
      return [
        '<item>',
        `<title>${esc(s.titulo)}</title>`,
        `<link>${esc(editionUrl)}#${s.clusterId}</link>`,
        `<guid isPermaLink="false">${s.clusterId}</guid>`,
        `<description>${esc(desc)}</description>`,
        `<pubDate>${new Date(s.updatedAt).toUTCString()}</pubDate>`,
        '</item>',
      ].join('');
    })
    .join('');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0"><channel>` +
    `<title>${esc(SITE.name)}</title>` +
    `<link>${base}/</link>` +
    `<description>${esc(SITE.description)}</description>` +
    `<language>pt-BR</language>` +
    `<lastBuildDate>${new Date(currentEdition.generatedAt).toUTCString()}</lastBuildDate>` +
    items +
    `</channel></rss>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
