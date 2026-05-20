// Resumo dos clusters do topo via Gemini Flash, atrás de uma interface trocável
// (Summarizer). Cache por hash das URLs do cluster: cluster já resumido não
// chama a IA. Fallback resiliente: falha/quota → usa a descrição do RSS. O build
// nunca quebra por causa da IA.

import { createHash } from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import type { Cluster, Summary, CachedSummary } from '../src/lib/types';
import { normalizeUrl } from './url';

// ── Interface trocável (plano B: Groq, Claude Haiku, etc.) ────────────────────
export type SummarizeInput = {
  artigos: { source: string; title: string; description: string }[];
};

export interface Summarizer {
  summarize(input: SummarizeInput): Promise<Summary>;
}

// Chave de cache = hash das URLs normalizadas dos membros (estável p/ a mesma
// composição de cluster; muda se entra/sai artigo → re-resume).
export function cacheKey(cluster: Pick<Cluster, 'articles'>): string {
  const urls = cluster.articles.map((a) => normalizeUrl(a.url)).sort();
  return createHash('sha1').update(urls.join('|')).digest('hex').slice(0, 16);
}

function toInput(cluster: Cluster): SummarizeInput {
  return {
    artigos: cluster.articles.map((a) => ({
      source: a.source,
      title: a.title,
      description: a.description,
    })),
  };
}

// Resumo provisório sem IA: pega o artigo com a descrição mais rica.
export function fallbackSummary(cluster: Cluster): Summary {
  const rep = [...cluster.articles].sort(
    (a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0),
  )[0];
  return {
    titulo: rep?.title ?? 'Sem título',
    resumo: rep?.description || rep?.title || '',
    porQueImporta: '',
  };
}

function sanitize(s: Summary): Summary {
  const titulo = (s.titulo ?? '').trim();
  const resumo = (s.resumo ?? '').trim();
  if (!titulo || !resumo) throw new Error('resumo da IA incompleto');
  return { titulo, resumo, porQueImporta: (s.porQueImporta ?? '').trim() };
}

// ── Cliente Gemini ────────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = [
  'Você é um editor de notícias que escreve resumos factuais e neutros em português do Brasil.',
  'Regras invioláveis:',
  '1. Escreva com SUAS palavras; nunca copie frases das fontes.',
  '2. Tom estritamente factual: sem opinião, juízo de valor ou adjetivação editorial.',
  '3. Não invente fatos, nomes ou números — use apenas o que está nas fontes.',
  '4. Se houver incerteza ou divergência entre as fontes, sinalize isso.',
  '5. Português do Brasil, claro e direto.',
].join('\n');

function buildPrompt(input: SummarizeInput): string {
  const fontes = input.artigos
    .map((a, i) => `[${i + 1}] (${a.source}) ${a.title}\n${a.description}`)
    .join('\n\n');
  return [
    'A mesma notícia foi coberta pelas fontes abaixo. Produza UM resumo consolidado.',
    '',
    fontes,
    '',
    'Responda em JSON com:',
    '- "titulo": manchete limpa e neutra (sem ponto final);',
    '- "resumo": 2 a 4 frases originais sintetizando o fato;',
    '- "porQueImporta": 1 frase curta explicando a relevância.',
  ].join('\n');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Extrai o status HTTP de um erro do SDK (ApiError tem .status; senão lê do texto).
export function errorStatus(err: unknown): number | null {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const m = String(e?.message ?? err);
  const match = m.match(/"code":\s*(\d+)/) ?? m.match(/\b(429|500|503)\b/);
  return match ? Number(match[1]) : null;
}

export function isQuotaError(err: unknown): boolean {
  return errorStatus(err) === 429;
}

// Transientes que vale a pena re-tentar (rate-limit momentâneo / sobrecarga).
const TRANSIENT = new Set([429, 500, 503]);
const RETRY_BACKOFF_MS = [5_000, 12_000];

export class GeminiSummarizer implements Summarizer {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash') {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async summarize(input: SummarizeInput): Promise<Summary> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce(input);
      } catch (err) {
        const status = errorStatus(err);
        if (status !== null && TRANSIENT.has(status) && attempt < RETRY_BACKOFF_MS.length) {
          await sleep(RETRY_BACKOFF_MS[attempt]!);
          continue;
        }
        throw err;
      }
    }
  }

  private async callOnce(input: SummarizeInput): Promise<Summary> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: buildPrompt(input),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titulo: { type: Type.STRING },
            resumo: { type: Type.STRING },
            porQueImporta: { type: Type.STRING },
          },
          required: ['titulo', 'resumo', 'porQueImporta'],
        },
      },
    });
    const text = response.text;
    if (!text) throw new Error('resposta vazia da IA');
    return JSON.parse(text) as Summary;
  }
}

// Cria o resumidor a partir do ambiente. Sem GEMINI_API_KEY → null (usa fallback).
export function summarizerFromEnv(): Summarizer | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn('GEMINI_API_KEY ausente — resumos via fallback (descrição do RSS).');
    return null;
  }
  return new GeminiSummarizer(apiKey);
}

// ── Orquestração: cache + IA + fallback ───────────────────────────────────────
export type SummarizeStats = { fromCache: number; generated: number; fallback: number };

export type SummarizeResult = {
  summaries: Map<string, Summary>; // clusterId → resumo
  cache: Record<string, CachedSummary>; // cache atualizado (p/ state.json)
  stats: SummarizeStats;
};

// Espaçamento entre chamadas à IA p/ respeitar o RPM do free tier.
const THROTTLE_MS = Number(process.env.GEMINI_THROTTLE_MS ?? 4500);
// Após N falhas de quota (429) seguidas, desiste da IA no resto do run (fallback
// rápido) — evita um run eterno quando a cota do dia acabou.
const QUOTA_BREAKER = 4;

export async function summarizeClusters(
  clusters: Cluster[],
  summarizer: Summarizer | null,
  cache: Record<string, CachedSummary>,
  now: Date = new Date(),
  throttleMs: number = THROTTLE_MS,
): Promise<SummarizeResult> {
  const summaries = new Map<string, Summary>();
  const nextCache: Record<string, CachedSummary> = { ...cache };
  const stats: SummarizeStats = { fromCache: 0, generated: 0, fallback: 0 };

  let iaCalls = 0;
  let quotaFails = 0;
  let breakerOpen = false;

  for (const cluster of clusters) {
    const key = cacheKey(cluster);
    const cached = nextCache[key];
    if (cached) {
      const { cachedAt: _cachedAt, ...summary } = cached;
      summaries.set(cluster.id, summary);
      stats.fromCache++;
      continue;
    }

    if (summarizer && !breakerOpen) {
      if (iaCalls > 0 && throttleMs > 0) await sleep(throttleMs);
      iaCalls++;
      try {
        const summary = sanitize(await summarizer.summarize(toInput(cluster)));
        summaries.set(cluster.id, summary);
        nextCache[key] = { ...summary, cachedAt: now.toISOString() };
        stats.generated++;
        quotaFails = 0;
        continue;
      } catch (err) {
        if (isQuotaError(err)) {
          quotaFails++;
          if (quotaFails >= QUOTA_BREAKER) {
            breakerOpen = true;
            console.warn('  quota da IA esgotada — usando fallback no restante deste run.');
          }
        }
        console.warn(`  resumo IA falhou (${cluster.id}): ${String(err).slice(0, 100)} — fallback`);
      }
    }

    // Fallback NÃO é cacheado: assim o próximo run tenta a IA de novo.
    summaries.set(cluster.id, fallbackSummary(cluster));
    stats.fallback++;
  }

  return { summaries, cache: nextCache, stats };
}
