// Resumo dos clusters do topo via Groq (Llama), atrás de uma interface trocável
// (Summarizer). Cache pela IDENTIDADE da história (URL do artigo-âncora, o mais
// antigo): a história mantém a chave mesmo ganhando novos membros, então um resumo
// já feito é reaproveitado entre runs e a cobertura de IA acumula. Resiliente: IA
// fora/cota esgotada → reusa o resumo antigo do cache; sem cache → descrição do
// RSS. O build nunca quebra por causa da IA.

import { createHash } from 'node:crypto';
import type { Cluster, Summary, CachedSummary } from '../src/lib/types';
import { normalizeUrl } from './url';

// ── Interface trocável (plano B: Gemini, Claude Haiku, etc.) ──────────────────
export type SummarizeInput = {
  artigos: { source: string; title: string; description: string }[];
};

export interface Summarizer {
  summarize(input: SummarizeInput): Promise<Summary>;
}

// Chave de cache = identidade da história: a URL normalizada do artigo-âncora (o
// mais antigo = origem da história). Estável enquanto a história se desenvolve e
// ganha novos membros, então o resumo já feito é reaproveitado entre runs em vez
// de re-resumir a cada coleta. Empate de data (ou sem data) → menor URL.
export function cacheKey(cluster: Pick<Cluster, 'articles'>): string {
  const anchor = [...cluster.articles].sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || Number.POSITIVE_INFINITY;
    const tb = Date.parse(b.publishedAt) || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return normalizeUrl(a.url).localeCompare(normalizeUrl(b.url));
  })[0];
  const anchorUrl = anchor ? normalizeUrl(anchor.url) : '';
  return createHash('sha1').update(anchorUrl).digest('hex').slice(0, 16);
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

// ── Cliente Groq (API compatível com OpenAI) ─────────────────────────────────
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
    '',
    'Responda APENAS com um único objeto JSON válido (as 3 chaves acima), sem nenhum',
    'texto antes ou depois e sem blocos de código markdown.',
  ].join('\n');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Extrai o status HTTP de um erro (a resposta da API traz .status; senão lê do texto).
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

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Modelos da Groq com structured outputs ESTRITOS: o JSON é garantido pelo schema
// (constrained decoding) → o modelo não consegue devolver JSON inválido. Os demais
// caem no json_object (best-effort) + parse tolerante.
const STRICT_SCHEMA_MODELS = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);

const RESUMO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titulo: { type: 'string' },
    resumo: { type: 'string' },
    porQueImporta: { type: 'string' },
  },
  required: ['titulo', 'resumo', 'porQueImporta'],
} as const;

// Parse tolerante: tira cercas markdown e recorta do 1º "{" ao último "}" antes do
// JSON.parse (cobre o caso de o modelo embrulhar o objeto em texto/```json).
export function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice);
}

export class GroqSummarizer implements Summarizer {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b') {
    this.apiKey = apiKey;
    this.model = model;
  }

  // Structured outputs estritos quando o modelo suporta; senão json_object.
  private responseFormat(): Record<string, unknown> {
    if (STRICT_SCHEMA_MODELS.has(this.model)) {
      return {
        type: 'json_schema',
        json_schema: { name: 'resumo', strict: true, schema: RESUMO_SCHEMA },
      };
    }
    return { type: 'json_object' };
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
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: 0.3,
      // Folga p/ o JSON. Em modelos de reasoning (gpt-oss) os tokens de raciocínio
      // contam aqui; com max baixo o JSON era truncado → 400 "Failed to generate JSON".
      max_completion_tokens: 4096,
      response_format: this.responseFormat(),
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: buildPrompt(input) },
      ],
    };
    // Resumir não exige raciocínio pesado: 'low' reduz tokens de reasoning (mais
    // rápido e deixa espaço pro JSON). Só os gpt-oss aceitam este parâmetro.
    if (STRICT_SCHEMA_MODELS.has(this.model)) body.reasoning_effort = 'low';

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // Propaga o status HTTP p/ a lógica de retry/disjuntor (429/500/503).
      throw Object.assign(new Error(`Groq ${res.status}: ${errBody.slice(0, 200)}`), {
        status: res.status,
      });
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('resposta vazia da IA');
    return parseJsonObject(text) as Summary;
  }
}

// Cria o resumidor a partir do ambiente. Sem GROQ_API_KEY → null (usa fallback).
export function summarizerFromEnv(): Summarizer | null {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.warn('GROQ_API_KEY ausente — resumos via fallback (descrição do RSS).');
    return null;
  }
  return new GroqSummarizer(apiKey);
}

// ── Orquestração: cache + IA + fallback ───────────────────────────────────────
export type SummarizeStats = {
  fromCache: number; // resumo de IA fresco reaproveitado (dentro do TTL)
  generated: number; // resumo novo gerado pela IA neste run
  staleCache: number; // IA fora → reusou resumo de IA antigo (TTL vencido) em vez de RSS
  fallback: number; // sem IA e sem cache → descrição crua do RSS
};

export type SummarizeResult = {
  summaries: Map<string, Summary>; // clusterId → resumo
  cache: Record<string, CachedSummary>; // cache atualizado (p/ state.json)
  stats: SummarizeStats;
};

// Espaçamento entre chamadas à IA p/ respeitar o RPM do free tier da Groq
// (~30 req/min → 2500ms ≈ 24/min, com margem).
const THROTTLE_MS = Number(process.env.GROQ_THROTTLE_MS ?? 2500);
// Após N falhas de quota (429) seguidas, desiste da IA no resto do run (fallback
// rápido) — evita um run eterno quando a cota do dia acabou.
const QUOTA_BREAKER = 4;
// Idade máxima de um resumo cacheado p/ servir SEM re-chamar a IA. Dentro do TTL,
// a história é um cache hit; vencido, tenta refrescar (cota permitindo) e, se a IA
// estiver fora, reusa o resumo antigo mesmo assim (melhor que RSS cru).
const TTL_HOURS = Number(process.env.SUMMARY_TTL_HOURS ?? 24);
const hoursSince = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / 3_600_000;

export async function summarizeClusters(
  clusters: Cluster[],
  summarizer: Summarizer | null,
  cache: Record<string, CachedSummary>,
  now: Date = new Date(),
  throttleMs: number = THROTTLE_MS,
): Promise<SummarizeResult> {
  const summaries = new Map<string, Summary>();
  const nextCache: Record<string, CachedSummary> = { ...cache };
  const stats: SummarizeStats = { fromCache: 0, generated: 0, staleCache: 0, fallback: 0 };

  let iaCalls = 0;
  let quotaFails = 0;
  let breakerOpen = false;

  for (const cluster of clusters) {
    const key = cacheKey(cluster);
    const cached = nextCache[key];

    // Cache hit fresco (dentro do TTL): reusa sem chamar a IA.
    if (cached && hoursSince(cached.cachedAt, now) <= TTL_HOURS) {
      const { cachedAt: _cachedAt, ...summary } = cached;
      summaries.set(cluster.id, summary);
      stats.fromCache++;
      continue;
    }

    // Sem cache fresco: tenta a IA (refresca o resumo vencido ou cria um novo).
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

    // IA fora e existe um resumo antigo (TTL vencido): mostra o resumo de IA
    // anterior em vez de regredir pra descrição crua do RSS. cachedAt fica como
    // está, então o próximo run tenta refrescá-lo de novo.
    if (cached) {
      const { cachedAt: _cachedAt, ...summary } = cached;
      summaries.set(cluster.id, summary);
      stats.staleCache++;
      continue;
    }

    // Nada em cache: fallback. NÃO é cacheado — o próximo run tenta a IA de novo.
    summaries.set(cluster.id, fallbackSummary(cluster));
    stats.fallback++;
  }

  return { summaries, cache: nextCache, stats };
}
