import { describe, it, expect, vi } from 'vitest';
import { cacheKey, fallbackSummary, summarizeClusters, validateSummary, type Summarizer, type SummarizeInput } from './summarize';
import type { Article, Cluster, CachedSummary, Summary } from '../src/lib/types';

function article(url: string, source: string, title = 'Título', description = 'Descrição longa do artigo.'): Article {
  return {
    id: url,
    url,
    source,
    title,
    description,
    publishedAt: '2026-05-20T11:00:00.000Z',
    category: 'politica',
    fetchedAt: '2026-05-20T12:00:00.000Z',
  };
}

function cluster(id: string, articles: Article[]): Cluster {
  return { id, articles, category: 'politica', latestAt: '2026-05-20T11:00:00.000Z', sourceCount: new Set(articles.map((a) => a.source)).size };
}

const SUMMARY: Summary = { titulo: 'Resumo IA', resumo: 'Frase um. Frase dois.', porQueImporta: 'Importa porque sim.' };
const NOW = new Date('2026-05-20T12:00:00.000Z');

describe('cacheKey', () => {
  it('independe de ordem e de rastreamento na URL', () => {
    const a = cacheKey(cluster('x', [article('https://a.com/1?utm_source=rss', 'G1'), article('https://b.com/2', 'CNN Brasil')]));
    const b = cacheKey(cluster('y', [article('https://www.b.com/2#x', 'CNN Brasil'), article('https://a.com/1', 'G1')]));
    expect(a).toBe(b);
  });

  it('mantém a chave quando um novo membro entra na mesma história', () => {
    const seed = article('https://a.com/1', 'G1'); // o mais antigo = âncora
    const newer = { ...article('https://c.com/3', 'Veja'), publishedAt: '2026-05-20T13:00:00.000Z' };
    const a = cacheKey(cluster('x', [seed]));
    const b = cacheKey(cluster('x', [seed, newer]));
    expect(a).toBe(b);
  });

  it('muda quando a história-âncora é outra', () => {
    const a = cacheKey(cluster('x', [article('https://a.com/1', 'G1')]));
    const b = cacheKey(cluster('y', [article('https://z.com/9', 'CNN Brasil')]));
    expect(a).not.toBe(b);
  });
});

describe('validateSummary', () => {
  const mkInput = (texts: string[]): SummarizeInput => ({
    artigos: texts.map((t, i) => ({ source: `S${i}`, title: t, description: t })),
  });

  it('aceita quando todas as entidades do título aparecem nas fontes', () => {
    const s: Summary = { titulo: 'Lula apresenta pacote contra inflação', resumo: 'x', porQueImporta: 'y' };
    const inp = mkInput(['Lula anuncia novo pacote econômico para conter a inflação']);
    expect(validateSummary(s, inp)).toEqual({ ok: true });
  });

  it('rejeita entidade que não aparece em nenhuma fonte', () => {
    // Alucinação típica: entidade aparece no meio do título (fora da posição-1,
    // onde maiúscula seria convenção gramatical).
    const s: Summary = { titulo: 'Pacote de Lula é criticado por Bolsonaro', resumo: 'x', porQueImporta: 'y' };
    const inp = mkInput(['Lula anuncia novo pacote econômico para conter a inflação']);
    const res = validateSummary(s, inp);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.missing).toContain('Bolsonaro');
  });

  it('ignora a primeira palavra do título (capitalizada por convenção)', () => {
    // "Governo" capitalizada só porque é início de frase, não como entidade nomeada.
    const s: Summary = { titulo: 'Governo anuncia pacote', resumo: 'x', porQueImporta: 'y' };
    const inp = mkInput(['Equipe econômica anunciou novo pacote']);
    expect(validateSummary(s, inp)).toEqual({ ok: true });
  });

  it('é tolerante a acento e maiúscula/minúscula', () => {
    const s: Summary = { titulo: 'Pacote contra Inflação anunciado', resumo: 'x', porQueImporta: 'y' };
    const inp = mkInput(['equipe anuncia pacote contra inflacao']); // sem acento na fonte
    expect(validateSummary(s, inp)).toEqual({ ok: true });
  });

  it('aceita títulos sem entidades capitalizadas (nada a verificar)', () => {
    const s: Summary = { titulo: 'pacote contra inflação anunciado', resumo: 'x', porQueImporta: 'y' };
    const inp = mkInput(['algum texto']);
    expect(validateSummary(s, inp)).toEqual({ ok: true });
  });
});

describe('summarizeClusters', () => {
  it('usa o cache fresco (dentro do TTL) e não chama a IA', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1')]);
    // 6h antes de NOW → dentro do TTL de 24h.
    const cached: Record<string, CachedSummary> = { [cacheKey(c)]: { ...SUMMARY, cachedAt: '2026-05-20T06:00:00.000Z' } };
    const summarizer: Summarizer = { summarize: vi.fn() };

    const { summaries, stats } = await summarizeClusters([c], summarizer, cached, NOW);

    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(stats.fromCache).toBe(1);
    expect(summaries.get('c1')).toEqual(SUMMARY);
  });

  it('reusa o resumo antigo (TTL vencido) em vez de RSS quando a IA está fora', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1', 'T', 'Descrição do RSS.')]);
    // cachedAt bem antigo → TTL vencido; a IA falha → deve cair no resumo antigo, não no RSS.
    const stale: Record<string, CachedSummary> = { [cacheKey(c)]: { ...SUMMARY, cachedAt: '2026-05-18T00:00:00.000Z' } };
    const summarizer: Summarizer = { summarize: vi.fn().mockRejectedValue(new Error('quota')) };

    const { summaries, stats } = await summarizeClusters([c], summarizer, stale, NOW);

    expect(summarizer.summarize).toHaveBeenCalledOnce();
    expect(stats.staleCache).toBe(1);
    expect(stats.fallback).toBe(0);
    expect(summaries.get('c1')).toEqual(SUMMARY);
  });

  it('gera e cacheia quando não está no cache', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1')]);
    const summarizer: Summarizer = { summarize: vi.fn().mockResolvedValue(SUMMARY) };

    const { summaries, cache, stats } = await summarizeClusters([c], summarizer, {}, NOW);

    expect(summarizer.summarize).toHaveBeenCalledOnce();
    expect(stats.generated).toBe(1);
    expect(summaries.get('c1')).toEqual(SUMMARY);
    expect(cache[cacheKey(c)]).toEqual({ ...SUMMARY, cachedAt: NOW.toISOString() });
  });

  it('cai no fallback quando a IA falha e NÃO cacheia', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1', 'T', 'Descrição do RSS.')]);
    const summarizer: Summarizer = { summarize: vi.fn().mockRejectedValue(new Error('quota')) };

    const { summaries, cache, stats } = await summarizeClusters([c], summarizer, {}, NOW);

    expect(stats.fallback).toBe(1);
    expect(summaries.get('c1')).toEqual(fallbackSummary(c));
    expect(cache).toEqual({});
  });

  it('usa fallback quando não há summarizer (sem API key)', async () => {
    const c = cluster('c1', [article('https://a.com/1', 'G1')]);
    const { stats } = await summarizeClusters([c], null, {}, NOW);
    expect(stats.fallback).toBe(1);
  });

  it('rejeita resumo com entidade inventada, regera 1x e cai pro fallback se persistir', async () => {
    // Cluster fala de Lula e inflação. Modelo "alucinador" insiste em colocar
    // "Bolsonaro" no título, que não aparece em nenhuma fonte.
    const c = cluster('c1', [
      article('https://a.com/1', 'G1', 'Lula anuncia pacote contra inflação', 'O presidente Lula anunciou hoje medidas para conter a inflação.'),
      article('https://b.com/2', 'CNN Brasil', 'Pacote do governo Lula mira inflação de alimentos', 'Lula apresentou novo plano econômico.'),
    ]);
    const hallucinated: Summary = { titulo: 'Pacote de Lula reativa rivalidade com Bolsonaro', resumo: 'Frase.', porQueImporta: 'Importa.' };
    const summarizer: Summarizer = { summarize: vi.fn().mockResolvedValue(hallucinated) };

    const { summaries, cache, stats } = await summarizeClusters([c], summarizer, {}, NOW, 0);

    expect(summarizer.summarize).toHaveBeenCalledTimes(2); // primeira + 1 retry
    expect(stats.hallucinationRejected).toBe(1);
    expect(stats.fallback).toBe(1);
    expect(stats.generated).toBe(0);
    expect(summaries.get('c1')).toEqual(fallbackSummary(c));
    expect(cache).toEqual({}); // alucinação não vai pro cache
  });

  it('aceita resumo do retry quando ele remove a entidade inventada', async () => {
    const c = cluster('c1', [
      article('https://a.com/1', 'G1', 'Lula anuncia pacote contra inflação', 'Lula apresentou medidas.'),
    ]);
    const bad: Summary = { titulo: 'Pacote enfrenta crítica de Bolsonaro', resumo: 'X.', porQueImporta: 'Y.' };
    const good: Summary = { titulo: 'Lula apresenta pacote contra inflação', resumo: 'X.', porQueImporta: 'Y.' };
    const summarizer: Summarizer = { summarize: vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good) };

    const { summaries, cache, stats } = await summarizeClusters([c], summarizer, {}, NOW, 0);

    expect(summarizer.summarize).toHaveBeenCalledTimes(2);
    expect(stats.hallucinationRejected).toBe(1);
    expect(stats.generated).toBe(1);
    expect(stats.fallback).toBe(0);
    expect(summaries.get('c1')).toEqual(good);
    expect(cache[cacheKey(c)]).toEqual({ ...good, cachedAt: NOW.toISOString() });
  });

  it('abre o disjuntor após 429 seguidos e para de chamar a IA', async () => {
    const clusters = Array.from({ length: 6 }, (_, i) => cluster(`c${i}`, [article(`https://a.com/${i}`, 'G1')]));
    const quota = Object.assign(new Error('quota'), { status: 429 });
    const summarizer: Summarizer = { summarize: vi.fn().mockRejectedValue(quota) };

    const { stats } = await summarizeClusters(clusters, summarizer, {}, NOW, 0);

    expect(summarizer.summarize).toHaveBeenCalledTimes(4); // QUOTA_BREAKER
    expect(stats.fallback).toBe(6);
    expect(stats.generated).toBe(0);
  });
});
