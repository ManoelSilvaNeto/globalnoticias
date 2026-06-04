// Orquestra o pipeline inteiro: coleta → cluster → rank → resume → grava JSON.
// Rodado pelo GitHub Actions (e local via `pnpm pipeline`).

import { resolve } from 'node:path';
import type { Cluster } from '../src/lib/types';
import { fetchAllSources } from './fetch';
import { clusterArticles } from './cluster';
import { topByCategory, topForHome } from './rank';
import { summarizeClusters, summarizerFromEnv } from './summarize';
import { buildEdition, pruneCache, readState, writeData } from './build-data';
import { maybeWriteEditorial } from './editorial';
import { maybeWriteTemaIntros } from './tema-intros';

const DATA_DIR = resolve(process.cwd(), 'data');

function dedupeClusters(clusters: Cluster[]): Cluster[] {
  const seen = new Set<string>();
  const out: Cluster[] = [];
  for (const c of clusters) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

async function main(): Promise<void> {
  const now = new Date();
  console.log(`[pipeline] início ${now.toISOString()}`);

  // 1. coleta
  const articles = await fetchAllSources();

  // 2. clustering
  const clusters = clusterArticles(articles, { now });
  console.log(`clusters: ${clusters.length}`);

  // 3. ranking + seleção (home ∪ categorias)
  const home = topForHome(clusters, now);
  const categorias = topByCategory(clusters, now);
  const toSummarize = dedupeClusters([...home, ...Object.values(categorias).flat()]);
  console.log(`selecionados p/ resumo: ${toSummarize.length}`);

  // 4. resumo (cache + IA + fallback)
  const state = await readState(DATA_DIR);
  const summarizer = summarizerFromEnv();
  const { summaries, cache, stats } = await summarizeClusters(toSummarize, summarizer, state.summaries, now);
  console.log(
    `resumos: cache=${stats.fromCache} IA=${stats.generated} reuso=${stats.staleCache} fallback=${stats.fallback} rejeitados=${stats.hallucinationRejected}`,
  );

  // 5. montagem
  const edition = buildEdition({ home, categorias }, summaries, now);
  if (edition.home.length === 0) {
    console.warn('edição vazia (nenhum artigo coletado?) — mantendo a última edição. Nada gravado.');
    return;
  }

  // 6. gravação (current + snapshot do dia + state com cache podado)
  await writeData(edition, { updatedAt: now.toISOString(), summaries: pruneCache(cache, now) }, DATA_DIR);

  // 7. editorial "Panorama do dia" (best-effort, 1x/dia, ancorado na edição).
  // Roda APÓS a gravação (que é o conteúdo crítico): se a IA falhar, a edição já
  // está salva e o editorial re-tenta no próximo run. Nunca derruba a run.
  try {
    await maybeWriteEditorial(edition, DATA_DIR, now);
  } catch (err) {
    console.warn('[editorial] falhou (não crítico):', String(err).slice(0, 140));
  }

  // 8. intros originais das páginas-tema (best-effort, evergreen, backfill gradual).
  // Mesma filosofia do editorial: conteúdo próprio p/ SEO/AdSense, nunca derruba a run.
  try {
    await maybeWriteTemaIntros(edition, DATA_DIR, now);
  } catch (err) {
    console.warn('[tema-intros] falhou (não crítico):', String(err).slice(0, 140));
  }

  console.log(`[pipeline] fim — edição ${edition.date}, home: ${edition.home.length} histórias`);
}

main().catch((err) => {
  console.error('[pipeline] erro fatal:', err);
  process.exit(1);
});
