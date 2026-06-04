// Intro ORIGINAL das páginas-tema (/tema/<slug>): um parágrafo de abertura,
// evergreen, gerado pela IA a partir das notícias do próprio tema. Transforma o hub
// — hoje agregação fina (só a lista de matérias) — em página com conteúdo PRÓPRIO:
// ganho de SEO de longo prazo (ranqueia pra buscas amplas do assunto) e blindagem
// contra o risco "scraped content" do AdSense.
//
// Roda DENTRO do pipeline principal (passo best-effort, depois da gravação): se a IA
// falhar, nada é gravado e a página-tema renderiza como hoje (sem intro). Nunca
// derruba a run. Reusa a infra de IA (completeJson + fallback Groq→Cerebras) e a
// trava anti-alucinação TOLERANTE do editorial.
//
// Cota: o intro é EVERGREEN (descreve o assunto, não as manchetes do dia), então é
// gerado UMA vez por tema e fica em cache (data/tema-intros.json). Por run gera no
// máximo TEMA_INTROS_MAX_NEW novos (default 3) — backfill gradual ~grátis. Só temas
// INDEXÁVEIS (>= INDEX_MIN histórias) ganham intro; os rasos (noindex) não gastam IA.
// Default baixo de propósito: quando o Groq estoura o TPD, estes caem pro Cerebras
// (conta compartilhada com o Radar) — o backfill é transitório e some após cobrir os
// temas existentes; depois a geração é ~zero (só temas novos).
//
// Envs (variables do repo, não secrets):
//   TEMA_INTROS_MAX_NEW   nº máx. de intros novos por run (default 3)
//   TEMA_INTROS_FORCE=1   regenera mesmo os já em cache (re-trabalho deliberado)
//   TEMA_INTROS_DRY_RUN=1 compõe e loga, NÃO grava (teste; dispensa chave de IA)

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Edition, Story, TemaIntro, TemaIntrosFile } from '../src/lib/types';
import { storySlug } from '../src/lib/story';
import { buildTopics, type Topic } from '../src/lib/topics-core';
import { editorialCorpus, editorialUnknownEntities } from './editorial';
import { isQuotaError, providersFromEnv, type OpenAICompatSummarizer } from './summarize';

// Bump invalida TODO o cache (regenera com o prompt novo). Subir só em mudança real.
export const PROMPT_VERSION = 1;

type RawTemaIntro = { intro?: string };

export const TEMA_INTRO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { intro: { type: 'string' } },
  required: ['intro'],
} as const;

const SYSTEM_INSTRUCTION = [
  'Você é editor de um portal de NOTÍCIAS GERAIS do Brasil e do mundo.',
  'Sua tarefa é escrever o PARÁGRAFO DE ABERTURA de uma página que reúne toda a',
  'cobertura sobre um assunto recorrente, em português do Brasil.',
  'Regras invioláveis:',
  '1. Use APENAS o material fornecido. NÃO introduza nenhum fato, número, estatística',
  '   ou data que não esteja explicitamente nas notícias dadas.',
  '2. Apresente o assunto de forma ENXUTA e ATEMPORAL: o que é, por que é relevante e o',
  '   que conecta as notícias do tema. NÃO narre cada notícia uma a uma, NÃO cite datas',
  '   nem "hoje/ontem" (a página é evergreen e atualiza sozinha).',
  '3. Tom sóbrio, factual e neutro: sem opinião, sem juízo de valor, sem conselho.',
  '4. Escreva com SUAS palavras; nunca copie frases das fontes.',
  '5. Cite nomes próprios APENAS como aparecem no material; na dúvida, descreva',
  '   ("o governo", "a empresa"). NÃO complete nem invente nomes.',
  '6. Um único parágrafo de 2 a 4 frases. SEM markdown, SEM listas, SEM título.',
].join('\n');

export function buildTemaPrompt(topic: Topic): string {
  const fontes = topic.stories
    .slice(0, 10)
    .map((s, i) => {
      const pq = s.porQueImporta?.trim() ? ` Por que importa: ${s.porQueImporta.trim()}` : '';
      return `[${i + 1}] ${s.titulo}\n${s.resumo}${pq}`;
    })
    .join('\n\n');
  return [
    `Assunto da página: "${topic.label}".`,
    '',
    'Notícias já resumidas que compõem o tema:',
    '',
    fontes,
    '',
    `Escreva o parágrafo de abertura da página sobre "${topic.label}". Responda APENAS`,
    'com um único objeto JSON válido { "intro": "..." }, sem texto antes ou depois e',
    'sem blocos de código markdown.',
  ].join('\n');
}

// ── Validação ────────────────────────────────────────────────────────────────
const INTRO_MIN = 80;
const INTRO_MAX = 600;
const DEFAULT_MAX_UNKNOWN = 4; // tema é estreito: menos tolerância que o editorial

export type TemaIntroValidation =
  | { ok: true; intro: string; unknownEntities: string[] }
  | { ok: false; reason: string; unknownEntities: string[] };

export function validateTemaIntro(raw: RawTemaIntro, topic: Topic, maxUnknown: number): TemaIntroValidation {
  let intro = (raw.intro ?? '').replace(/\s+/g, ' ').trim();
  const unknownEntities = intro ? editorialUnknownEntities('', [intro], editorialCorpus(topic.stories)) : [];

  if (intro.length < INTRO_MIN) return { ok: false, reason: `intro curto/ausente (${intro.length})`, unknownEntities };
  // já normalizamos \s+→espaço acima; resta barrar bullet/heading no início.
  if (/^[-*•#>]/.test(intro)) return { ok: false, reason: 'formato inválido (markdown/lista)', unknownEntities };
  if (intro.length > INTRO_MAX) intro = intro.slice(0, INTRO_MAX).replace(/\s+\S*$/, '') + '…';
  if (unknownEntities.length > maxUnknown) {
    return { ok: false, reason: `muitas entidades fora do material (${unknownEntities.length}): ${unknownEntities.slice(0, 8).join(', ')}`, unknownEntities };
  }
  return { ok: true, intro, unknownEntities };
}

// ── Geração (1 tema, com fallback de provedor) ────────────────────────────────
const MAX_TOKENS = 2000;
const TEMPERATURE = 0.4;

export async function generateTemaIntro(
  topic: Topic,
  providers: OpenAICompatSummarizer[],
  now: Date,
  maxUnknown: number,
  diag: string[] = [],
): Promise<TemaIntro | null> {
  const prompt = buildTemaPrompt(topic);
  for (const p of providers) {
    try {
      const raw = await p.completeJson<RawTemaIntro>(SYSTEM_INSTRUCTION, prompt, {
        schema: TEMA_INTRO_SCHEMA,
        schemaName: 'tema_intro',
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      });
      const v = validateTemaIntro(raw, topic, maxUnknown);
      if (!v.ok) {
        diag.push(`${topic.slug}: reprovado — ${v.reason}`);
        continue;
      }
      diag.push(`${topic.slug}: ok${v.unknownEntities.length ? ` (toleradas: ${v.unknownEntities.join(', ')})` : ''}`);
      return { slug: topic.slug, label: topic.label, intro: v.intro, generatedAt: now.toISOString() };
    } catch (err) {
      const tag = isQuotaError(err) ? 'sem cota (429)' : String(err).slice(0, 80);
      diag.push(`${topic.slug}: erro — ${tag}`);
    }
  }
  return null;
}

// ── Cache em data/tema-intros.json ────────────────────────────────────────────
const EMPTY: TemaIntrosFile = { v: PROMPT_VERSION, updatedAt: '', intros: {} };

export async function readTemaIntros(path: string): Promise<TemaIntrosFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as TemaIntrosFile;
    if (parsed?.v !== PROMPT_VERSION) return { ...EMPTY }; // bump do prompt → descarta cache antigo
    return { v: PROMPT_VERSION, updatedAt: parsed.updatedAt ?? '', intros: parsed.intros ?? {} };
  } catch {
    return { ...EMPTY };
  }
}

// Temas indexáveis que ainda não têm intro (ou todos, se force). A ordem segue
// buildTopics (mais histórias primeiro) — backfill prioriza os temas mais fortes.
export function selectPending(topics: Topic[], cache: TemaIntrosFile, force: boolean): Topic[] {
  return topics.filter((t) => t.indexable && (force || !cache.intros[t.slug]));
}

// Stories de UMA edição (home ∪ categorias), deduplicadas por slug.
export function editionStories(edition: Edition): Story[] {
  const seen = new Set<string>();
  const out: Story[] = [];
  for (const s of [...edition.home, ...Object.values(edition.categorias).flat()]) {
    const key = storySlug(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Catálogo amplo (edição atual + arquivo data/edicoes/*.json), deduplicado por slug.
// Espelha o allStories do site (src/lib/data.ts) — ESSENCIAL p/ os temas do pipeline
// baterem com os do site: um tema só é indexável com >= INDEX_MIN histórias, e esse
// volume vem do acúmulo entre edições, não de uma só. A atual tem precedência.
export async function loadAllStories(current: Edition, dataDir: string): Promise<Story[]> {
  const seen = new Map<string, Story>();
  for (const s of editionStories(current)) seen.set(storySlug(s), s);

  const dir = join(dataDir, 'edicoes');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = []; // sem arquivo ainda → só a edição atual
  }
  for (const f of files) {
    try {
      const ed = JSON.parse(await readFile(join(dir, f), 'utf-8')) as Edition;
      for (const s of editionStories(ed)) {
        const key = storySlug(s);
        if (!seen.has(key)) seen.set(key, s);
      }
    } catch {
      // edição corrompida/parcial — ignora, não derruba a geração
    }
  }
  return [...seen.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Ponto de entrada chamado pelo pipeline (best-effort, nunca derruba a run).
export async function maybeWriteTemaIntros(edition: Edition, dataDir: string, now: Date): Promise<void> {
  const path = join(dataDir, 'tema-intros.json');
  const dryRun = !!process.env.TEMA_INTROS_DRY_RUN;
  const force = !!process.env.TEMA_INTROS_FORCE;
  const maxNew = Math.max(0, Number(process.env.TEMA_INTROS_MAX_NEW ?? 3));
  const maxUnknown = Number(process.env.TEMA_INTROS_MAX_UNKNOWN ?? DEFAULT_MAX_UNKNOWN);

  const topics = buildTopics(await loadAllStories(edition, dataDir));
  const cache = await readTemaIntros(path);
  const pending = selectPending(topics, cache, force).slice(0, maxNew);

  if (pending.length === 0) {
    console.log(`[tema-intros] nada a gerar (indexáveis=${topics.filter((t) => t.indexable).length}, em cache=${Object.keys(cache.intros).length}).`);
    return;
  }

  const providers = providersFromEnv();
  if (providers.length === 0 && !dryRun) {
    console.log('[tema-intros] sem chave de IA — pulando.');
    return;
  }

  const diag: string[] = [];
  let written = 0;
  for (const topic of pending) {
    if (dryRun) {
      console.log(`[tema-intros DRY RUN] geraria "${topic.label}" (${topic.stories.length} histórias)`);
      continue;
    }
    const intro = await generateTemaIntro(topic, providers, now, maxUnknown, diag);
    if (intro) {
      cache.intros[topic.slug] = intro;
      written++;
    }
  }

  if (dryRun || written === 0) {
    if (diag.length) console.log(`[tema-intros] ${diag.join(' | ')}`);
    if (!dryRun) console.warn('[tema-intros] nenhum intro novo gerado (IA fora ou validação reprovou) — re-tenta no próximo run.');
    return;
  }

  cache.v = PROMPT_VERSION;
  cache.updatedAt = now.toISOString();
  await writeFile(path, JSON.stringify(cache, null, 2) + '\n');
  console.log(`[tema-intros] +${written} intro(s) gravado(s) (total=${Object.keys(cache.intros).length}). ${diag.join(' | ')}`);
}
