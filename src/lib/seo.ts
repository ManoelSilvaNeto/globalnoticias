// Geradores de JSON-LD. Como o site é um agregador (não autor das matérias),
// usamos WebSite + ItemList — estrutura honesta para uma página de curadoria.

import type { Story } from './types';
import { SITE } from './site';

export function websiteJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    description: SITE.description,
    url: siteUrl,
  };
}

export function itemListJsonLd(stories: Story[], pageUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: pageUrl,
    numberOfItems: stories.length,
    itemListElement: stories.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.titulo,
      url: s.sources[0]?.url ?? pageUrl,
    })),
  };
}
