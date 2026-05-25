// Agrupa artigos que contam a mesma história, por similaridade léxica:
// bag-of-words ponderado (título conta mais) + cosseno acima de um limiar.
// Sem API de embeddings: custo zero. Greedy de uma passada, com os artigos
// mais recentes virando sementes dos clusters.

import { createHash } from 'node:crypto';
import type { Article, ArticleCategory, Cluster } from '../src/lib/types';
import { CATEGORIES } from '../src/lib/categories';

export const DEFAULT_THRESHOLD = 0.22; // cosseno mínimo p/ juntar (ajustável)
export const DEFAULT_WINDOW_HOURS = 48;
const TITLE_WEIGHT = 3; // título conta mais que a descrição

// Stopwords PT-BR (pronomes, preposições, artigos, verbos auxiliares comuns).
const STOPWORDS = new Set(
  ('a o e de da do das dos em no na nos nas um uma uns umas para por com sem sob ' +
    'que se ao aos as os como mais menos muito pouco ja nao sim ou mas porem entao ' +
    'sua seu suas seus meu minha nossa nosso este esta isso isto esse essa aquilo ' +
    'ele ela eles elas voce vocês nos eu tu teu apos ate entre desde sobre cada ' +
    'foi sao ser sera tem tinha havia estao esta estava pelo pela pelos pelas ' +
    'dia ano anos hoje ontem apos contra durante segundo ainda apenas tambem ' +
    'quando onde quem qual quais cujo cuja toda todo todos todas outro outra').split(
    /\s+/,
  ),
);

// Normaliza texto PT em tokens: minúsculas, sem acento, sem pontuação, sem stopword.
export function normalizePt(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

type Vec = Map<string, number>;

function termFreq(article: Article): Vec {
  const tf: Vec = new Map();
  const add = (tokens: string[], weight: number) => {
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + weight);
  };
  add(normalizePt(article.title), TITLE_WEIGHT);
  add(normalizePt(article.description), 1);
  return tf;
}

function cosine(a: Vec, b: Vec): number {
  // itera o menor mapa
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const o = large.get(term);
    if (o) dot += w * o;
  }
  if (dot === 0) return 0;
  let na = 0;
  for (const w of a.values()) na += w * w;
  let nb = 0;
  for (const w of b.values()) nb += w * w;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function addInto(target: Vec, src: Vec): void {
  for (const [term, w] of src) target.set(term, (target.get(term) ?? 0) + w);
}

// Categoria do cluster: a categoria específica que for PLURALIDADE ÚNICA entre
// os artigos (ex.: 1 economia + N geral → economia, pois economia é a única
// específica). Se NENHUMA específica aparece, ou se há EMPATE entre específicas
// distintas (cluster que cruza editorias — ex.: 1 mundo + 1 economia), cai em
// 'geral': fica só na home, fora das páginas de categoria. Isso evita que uma
// notícia transversal/ambígua, justamente a que junta mais fontes e pontua alto,
// apareça como #1 numa editoria à qual não pertence.
function dominantCategory(articles: Article[]): ArticleCategory {
  const counts = new Map<ArticleCategory, number>();
  for (const a of articles) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  let max = 0;
  for (const c of CATEGORIES) max = Math.max(max, counts.get(c) ?? 0);
  if (max === 0) return 'geral';
  const leaders = CATEGORIES.filter((c) => (counts.get(c) ?? 0) === max);
  return leaders.length === 1 ? leaders[0]! : 'geral';
}

function clusterId(articles: Article[]): string {
  const ids = articles.map((a) => a.id).sort();
  return createHash('sha1').update(ids.join('|')).digest('hex').slice(0, 16);
}

type Group = { sum: Vec; vecs: Vec[]; members: Article[] };

export type ClusterOptions = {
  threshold?: number;
  windowHours?: number;
  now?: Date;
};

// Agrupa os artigos. Considera só a janela recente; ordena por recência pra que
// o artigo mais novo seja a semente do cluster.
export function clusterArticles(articles: Article[], opts: ClusterOptions = {}): Cluster[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - windowHours * 3600_000;

  const recent = articles
    .filter((a) => {
      const t = new Date(a.publishedAt).getTime();
      return Number.isFinite(t) && t >= cutoff && t <= now.getTime() + 3600_000;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const groups: Group[] = [];
  for (const article of recent) {
    const vec = termFreq(article);
    if (vec.size === 0) continue;
    let best: Group | null = null;
    let bestSim = threshold;
    for (const g of groups) {
      const sim = cosine(vec, g.sum);
      if (sim >= bestSim) {
        bestSim = sim;
        best = g;
      }
    }
    if (best) {
      best.members.push(article);
      best.vecs.push(vec);
      addInto(best.sum, vec);
    } else {
      groups.push({ sum: new Map(vec), vecs: [vec], members: [article] });
    }
  }

  return groups.map((g) => {
    const latestAt = g.members
      .map((a) => a.publishedAt)
      .reduce((max, d) => (d > max ? d : max), g.members[0]!.publishedAt);
    const sourceCount = new Set(g.members.map((a) => a.source)).size;
    return {
      id: clusterId(g.members),
      articles: g.members,
      category: dominantCategory(g.members),
      latestAt,
      sourceCount,
    } satisfies Cluster;
  });
}
