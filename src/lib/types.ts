// Tipos canônicos do GlobalNoticias — compartilhados entre o pipeline (ingestão)
// e o site (Astro). Tipos somem em runtime; só `import type` aqui.

import type { ArticleCategory, Category } from './categories';

// Uma fonte de RSS curada (pipeline/sources.ts).
export type Source = {
  name: string; // rótulo exibido, ex.: "G1", "Agência Brasil"
  url: string; // URL do feed RSS/Atom
  category: ArticleCategory;
};

// Item de feed já normalizado (pipeline/fetch.ts).
export type Article = {
  id: string; // hash estável da URL
  url: string;
  source: string; // nome da fonte
  title: string;
  description: string; // texto do feed (NÃO republicado como conteúdo final)
  imageUrl?: string;
  publishedAt: string; // ISO 8601
  category: ArticleCategory;
  fetchedAt: string; // ISO 8601
};

// Um agrupamento de artigos que contam a mesma história (pipeline/cluster.ts).
export type Cluster = {
  id: string; // hash estável das URLs dos membros
  articles: Article[];
  category: ArticleCategory; // categoria dominante ('geral' = só na home)
  latestAt: string; // publishedAt mais recente entre os membros (ISO)
  sourceCount: number; // nº de fontes distintas
};

// Resumo gerado pela IA (pipeline/summarize.ts).
export type Summary = {
  titulo: string; // título limpo/neutro
  resumo: string; // 2–4 frases originais, PT-BR
  porQueImporta: string; // 1 linha
};

// História renderizável no site (pipeline/build-data.ts → data/*.json).
export type Story = {
  clusterId: string; // âncora interna (id do cluster; muda entre runs)
  slug?: string; // id ESTÁVEL p/ a URL /noticia/<slug> (hash da URL do artigo-âncora)
  titulo: string;
  resumo: string;
  porQueImporta: string;
  category: ArticleCategory; // 'geral' aparece só na home
  sources: { name: string; url: string }[];
  imageUrl?: string;
  updatedAt: string; // ISO 8601
};

// Edição = um snapshot do site (data/current.json e data/edicoes/<data>.json).
export type Edition = {
  date: string; // AAAA-MM-DD
  generatedAt: string; // ISO 8601
  home: Story[];
  categorias: Record<Category, Story[]>;
};

// Referência interna a uma história citada por uma peça editorial (link p/ /noticia/<slug>).
export type EditorialRef = {
  slug: string;
  titulo: string;
  categoria: string; // rótulo legível (CATEGORY_LABELS[...] ou 'Geral')
};

// Peça editorial "Panorama do dia": análise original gerada pela IA a partir das
// notícias JÁ resumidas/validadas da edição (não republica fonte; sintetiza os
// principais fatos do dia entre as categorias). 1 por dia — `date` é também o slug
// da rota /editorial/<date>. Persistida em data/editorial/<date>.json e arquivada.
export type Editorial = {
  date: string; // AAAA-MM-DD (= slug da rota)
  generatedAt: string; // ISO 8601
  titulo: string;
  linhaFina: string; // "dek"/subtítulo de 1 frase
  paragrafos: string[]; // corpo da análise (parágrafos originais, PT-BR)
  destaques: EditorialRef[]; // notícias da edição citadas (links internos)
};

// Resumo em cache, com carimbo de quando entrou (pra poda da janela).
export type CachedSummary = Summary & { cachedAt: string };

// Estado persistido entre runs (data/state.json): cache de resumos da janela 48–72h.
export type State = {
  updatedAt: string; // ISO 8601
  summaries: Record<string, CachedSummary>; // cacheKey (hash da URL do artigo-âncora) -> resumo
};
