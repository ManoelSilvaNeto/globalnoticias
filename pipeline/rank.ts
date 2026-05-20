// Pontua e seleciona os clusters mais importantes.
// score = W_SOURCES * nº de fontes distintas + W_RECENCY * recência (0..1).
// Multi-fonte domina, mas notícia muito fresca ainda compete.

import type { Cluster } from '../src/lib/types';
import { CATEGORIES, type Category } from '../src/lib/categories';

export const W_SOURCES = 1.0;
export const W_RECENCY = 1.5;
const RECENCY_HALFLIFE_HOURS = 10; // recência cai pela metade a cada ~10h

export const HOME_SIZE = 10;
export const CATEGORY_SIZE = 8;

// Recência em (0..1] por decaimento exponencial sobre a idade do artigo mais novo.
export function recencyScore(cluster: Cluster, now: Date = new Date()): number {
  const ageHours = (now.getTime() - new Date(cluster.latestAt).getTime()) / 3600_000;
  if (!Number.isFinite(ageHours)) return 0;
  return Math.pow(2, -Math.max(0, ageHours) / RECENCY_HALFLIFE_HOURS);
}

export function scoreCluster(cluster: Cluster, now: Date = new Date()): number {
  return W_SOURCES * cluster.sourceCount + W_RECENCY * recencyScore(cluster, now);
}

function byScoreDesc(now: Date) {
  return (a: Cluster, b: Cluster) => scoreCluster(b, now) - scoreCluster(a, now);
}

// Top da home: melhores clusters de qualquer categoria (inclui 'geral').
export function topForHome(clusters: Cluster[], now: Date = new Date(), limit = HOME_SIZE): Cluster[] {
  return [...clusters].sort(byScoreDesc(now)).slice(0, limit);
}

// Top de uma categoria específica (nunca 'geral').
export function topForCategory(
  clusters: Cluster[],
  category: Category,
  now: Date = new Date(),
  limit = CATEGORY_SIZE,
): Cluster[] {
  return clusters
    .filter((c) => c.category === category)
    .sort(byScoreDesc(now))
    .slice(0, limit);
}

// Conveniência: top de cada uma das 8 categorias.
export function topByCategory(
  clusters: Cluster[],
  now: Date = new Date(),
  limit = CATEGORY_SIZE,
): Record<Category, Cluster[]> {
  const out = {} as Record<Category, Cluster[]>;
  for (const c of CATEGORIES) out[c] = topForCategory(clusters, c, now, limit);
  return out;
}
