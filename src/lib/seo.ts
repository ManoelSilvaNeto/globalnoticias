// Geradores de JSON-LD. Como o site é um agregador (não autor das matérias),
// usamos WebSite + ItemList — estrutura honesta para uma página de curadoria.

import type { Editorial, Story } from './types';
import { SITE } from './site';
import { CATEGORY_LABELS, isCategory } from './categories';

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

// Marca a página de uma história como NewsArticle. Honesto: o resumo É original
// (escrito pela IA, neutro), então autoria/publisher = a Organização; as matérias
// originais entram como `citation`/`isBasedOn`. Habilita elegibilidade a Top Stories.
export function newsArticleJsonLd(
  story: Story,
  pageUrl: string,
  siteUrl: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: story.titulo.slice(0, 110), // Google ignora headline > 110 chars
    description: story.resumo,
    inLanguage: 'pt-BR',
    datePublished: story.updatedAt,
    dateModified: story.updatedAt,
    ...(isCategory(story.category) ? { articleSection: CATEGORY_LABELS[story.category] } : {}),
    ...(story.imageUrl ? { image: [story.imageUrl] } : {}),
    url: pageUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    author: { '@type': 'Organization', name: SITE.name, url: siteUrl },
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      url: siteUrl,
      logo: { '@type': 'ImageObject', url: `${siteUrl}/logo.png` },
    },
    citation: story.sources.map((s) => ({ '@type': 'CreativeWork', name: s.name, url: s.url })),
    isBasedOn: story.sources.map((s) => s.url),
  };
}

// Marca a peça editorial como Article. Diferente das notícias (NewsArticle de
// curadoria), o "Panorama do dia" É conteúdo ORIGINAL autoral da Organização —
// análise sintetizada, não republicação. articleBody dá o texto cheio ao robô.
export function editorialJsonLd(
  editorial: Editorial,
  pageUrl: string,
  siteUrl: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: editorial.titulo.slice(0, 110),
    description: editorial.linhaFina,
    articleBody: editorial.paragrafos.join('\n\n'),
    inLanguage: 'pt-BR',
    datePublished: editorial.generatedAt,
    dateModified: editorial.generatedAt,
    articleSection: 'Editorial',
    url: pageUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    author: { '@type': 'Organization', name: SITE.name, url: siteUrl },
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      url: siteUrl,
      logo: { '@type': 'ImageObject', url: `${siteUrl}/logo.png` },
    },
  };
}

// Trilha de navegação (Home › Categoria › Notícia) — rich result + contexto p/ o robô.
export function breadcrumbJsonLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}
