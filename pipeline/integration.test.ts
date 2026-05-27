// Teste de integração end-to-end do pipeline: fetch → cluster → rank →
// summarize → buildEdition. `fetch` é stubado pra servir fixtures de RSS;
// IA é substituída por null (cai no fallback). Garante que mudanças
// localizadas em um passo não quebrem a composição do todo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Source } from '../src/lib/types';
import { fetchAllSources } from './fetch';
import { clusterArticles } from './cluster';
import { topByCategory, topForHome } from './rank';
import { summarizeClusters } from './summarize';
import { buildEdition } from './build-data';

const FIXTURES_DIR = resolve(__dirname, '__fixtures__/feeds');
const fixture = (name: string) => readFileSync(resolve(FIXTURES_DIR, name), 'utf-8');

// Constrói um Response-like com o corpo passado (string ou Buffer). Espelha
// só o que o fetch.ts consome: .ok, .status, .arrayBuffer().
function makeResponse(body: string | Buffer, ok = true, status = 200) {
  const buf =
    typeof body === 'string' ? new TextEncoder().encode(body).buffer : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  return { ok, status, arrayBuffer: async () => buf, text: async () => String(body) };
}

describe('pipeline integration', () => {
  // NOW fixado: as fixtures usam 27/mai/2026; alinha pra cair na janela do cluster.
  const NOW = new Date('2026-05-27T16:00:00.000Z');

  // 4 fontes simuladas (1 URL por feed). 2 cobrem a mesma história política →
  // cluster multi-fonte. Mundo e tecnologia têm 2 itens cada que NÃO devem
  // clusterizar entre si (regressão do Item #1).
  const sources: Source[] = [
    { name: 'G1', url: 'https://fixtures.test/politica/feed', category: 'politica' },
    { name: 'CNN Brasil', url: 'https://fixtures.test/politica2/feed', category: 'politica' },
    { name: 'BBC Brasil', url: 'https://fixtures.test/mundo/feed', category: 'mundo' },
    { name: 'Olhar Digital', url: 'https://fixtures.test/tecnologia/feed', category: 'tecnologia' },
  ];

  beforeEach(() => {
    const map: Record<string, string> = {
      'https://fixtures.test/politica/feed': fixture('politica-coerente.xml'),
      'https://fixtures.test/politica2/feed': fixture('politica-segunda-fonte.xml'),
      'https://fixtures.test/mundo/feed': fixture('mundo-distintos.xml'),
      'https://fixtures.test/tecnologia/feed': fixture('tecnologia-com-imagens.xml'),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const xml = map[url];
        if (!xml) throw new Error(`fixture não mapeada para ${url}`);
        return makeResponse(xml);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('compõe fetch → cluster → rank → summarize → buildEdition e produz Edition válida', async () => {
    // Pipeline inteira (sem IA: Summarizer=null → fallback baseado na descrição).
    const articles = await fetchAllSources(sources);
    const clusters = clusterArticles(articles, { now: NOW });
    const home = topForHome(clusters, NOW);
    const categorias = topByCategory(clusters, NOW);
    const toSummarize = [...home, ...Object.values(categorias).flat()];
    const { summaries } = await summarizeClusters(toSummarize, null, {}, NOW, 0);
    const edition = buildEdition({ home, categorias }, summaries, NOW);

    // Shape do Edition: chaves obrigatórias e 8 categorias.
    expect(edition.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(edition.generatedAt).toMatch(/^2026-05-27T/);
    expect(Object.keys(edition.categorias).sort()).toEqual([
      'ciencia', 'economia', 'entretenimento', 'esportes', 'mundo', 'politica', 'saude', 'tecnologia',
    ]);
    expect(edition.home.length).toBeGreaterThan(0);
  });

  it('cluster da reforma tributária agrupa as 4 matérias e tem 2 fontes', async () => {
    const articles = await fetchAllSources(sources);
    const clusters = clusterArticles(articles, { now: NOW });
    // 3 itens da fixture G1 + 1 da fixture CNN = 4 artigos, MESMA história.
    const reforma = clusters.find((c) => c.articles.some((a) => /reforma tribut/i.test(a.title)));
    expect(reforma).toBeDefined();
    expect(reforma!.articles.length).toBe(4);
    expect(reforma!.sourceCount).toBe(2); // G1 + CNN Brasil
    expect(reforma!.category).toBe('politica');
  });

  it('NÃO clusteriza histórias diferentes que compartilham vocabulário genérico (Trump-China vs Festival da Lua)', async () => {
    const articles = await fetchAllSources(sources);
    const clusters = clusterArticles(articles, { now: NOW });
    const mundo = clusters.filter((c) => c.articles.some((a) => a.source === 'BBC Brasil'));
    // 2 itens DISTINTOS no feed mundo → 2 clusters separados, não 1.
    expect(mundo.length).toBe(2);
    for (const c of mundo) expect(c.articles.length).toBe(1);
  });

  it('extrai imageUrl de media:content e de enclosure', async () => {
    const articles = await fetchAllSources(sources);
    const chip = articles.find((a) => /chip de IA/i.test(a.title));
    const so = articles.find((a) => /sistema operacional/i.test(a.title));
    expect(chip?.imageUrl).toBe('https://fixtures.test/img/chip.jpg');
    expect(so?.imageUrl).toBe('https://fixtures.test/img/so.png');
  });

  it('decodifica feed em ISO-8859-1 preservando acentos', async () => {
    // Fixture gerada em runtime em latin1 (Windows-1252) — testa o decodeBody
    // sem precisar comitar um arquivo binário.
    const xml =
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<rss version="2.0"><channel><title>L</title><link>https://fixtures.test/l</link>' +
      '<description>L</description><item>' +
      '<title>Pesquisa em inteligência artificial avança no coração do Brasil</title>' +
      '<link>https://fixtures.test/latin1/pesquisa-ia</link>' +
      '<description>Estudo nacional bate recorde de inovação.</description>' +
      '<pubDate>Wed, 27 May 2026 12:00:00 GMT</pubDate>' +
      '</item></channel></rss>';
    const latin1Buf = Buffer.from(xml, 'latin1');
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeResponse(latin1Buf)),
    );
    const articles = await fetchAllSources([
      { name: 'TesteLatin', url: 'https://fixtures.test/latin1/feed', category: 'ciencia' },
    ]);
    expect(articles).toHaveLength(1);
    expect(articles[0]!.title).toContain('inteligência');
    expect(articles[0]!.title).toContain('coração');
  });
});
