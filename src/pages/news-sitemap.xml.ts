import type { APIRoute } from 'astro';
import { allStories } from '../lib/data';
import { buildNewsSitemap } from '../lib/news-sitemap';

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'https://noticias.globalnote.com.br/').replace(/\/$/, '');
  const xml = buildNewsSitemap(allStories, base, new Date());
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
