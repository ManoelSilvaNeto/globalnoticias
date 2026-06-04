// "Panorama do dia": peça editorial ORIGINAL gerada automaticamente pela IA a
// partir das notícias JÁ resumidas/validadas da edição. Não republica fonte —
// sintetiza os principais fatos do dia entre as categorias (o que dominou, conexões)
// numa análise sóbria e factual. 1 por dia (dedup pela data da edição + janela
// horária), gravada em data/editorial/<date>.json e arquivada.
//
// Roda DENTRO do pipeline principal (antes do build, pois a página é estática), como
// passo best-effort: se a IA falhar, nada é gravado e a próxima run re-tenta. Reusa
// a infra de IA do summarize.ts (completeJson). Diferença vs. o resumo: NÃO barra a
// peça por nome próprio fora do material (uma análise de notícias gerais cita muitos
// políticos/países/empresas) — só registra os desconhecidos e reprova em caso
// EGREGÍGENO (muitos de uma vez), que sinaliza fabricação.
//
// Envs (variables do repo, não secrets):
//   EDITORIAL_GEN_HOUR_UTC   janela mínima de geração (default 11 ≈ 08h BRT)
//   EDITORIAL_MAX_STORIES    nº de histórias da edição alimentadas à IA (default 12)
//   EDITORIAL_DESTAQUES      nº de links internos exibidos na peça (default 6)
//   EDITORIAL_MAX_UNKNOWN    teto de entidades fora do material p/ reprovar (default 6)
//   EDITORIAL_FORCE=1        ignora janela + dedup (geração manual)
//   EDITORIAL_DRY_RUN=1      compõe e loga, NÃO grava (teste; dispensa chave de IA)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Edition, Editorial, EditorialRef, Story } from '../src/lib/types';
import { CATEGORIES, CATEGORY_LABELS, isCategory } from '../src/lib/categories';
import { isQuotaError, providersFromEnv, type OpenAICompatSummarizer } from './summarize';

// ── Saída crua da IA (antes da validação/montagem) ────────────────────────────
type RawEditorial = {
  titulo?: string;
  linhaFina?: string;
  paragrafos?: unknown;
};

// Schema enxuto (sem min/max — o modo estrito do gpt-oss não aceita esses keywords;
// as contagens são validadas em código).
export const EDITORIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titulo: { type: 'string' },
    linhaFina: { type: 'string' },
    paragrafos: { type: 'array', items: { type: 'string' } },
  },
  required: ['titulo', 'linhaFina', 'paragrafos'],
} as const;

const slugOf = (s: Story): string => s.slug ?? s.clusterId;
const labelOf = (s: Story): string => (isCategory(s.category) ? CATEGORY_LABELS[s.category] : 'Geral');

// ── Prompt ─────────────────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = [
  'Você é o editor-chefe de um portal de NOTÍCIAS GERAIS do Brasil e do mundo (política,',
  'economia, mundo, tecnologia, ciência, saúde, esportes, entretenimento).',
  'Sua tarefa é escrever o PANORAMA DO DIA: uma análise curta e original que conecta os',
  'principais fatos da edição, em português do Brasil.',
  'Regras invioláveis:',
  '1. Use APENAS o material fornecido. NÃO introduza nenhum fato, número, estatística ou',
  '   data que não esteja explicitamente nas notícias dadas.',
  '2. Sintetize o conjunto e aponte o que predominou e as conexões entre os assuntos.',
  '   NÃO repita cada notícia uma a uma.',
  '3. Tom analítico, sóbrio e estritamente factual: sem opinião político-partidária, sem',
  '   juízo de valor, sem conselhos. Equilíbrio e neutralidade.',
  '4. Escreva com SUAS palavras; nunca copie frases das fontes.',
  '5. Cite nomes próprios APENAS como aparecem no material; na dúvida, prefira descrições',
  '   ("o governo", "as autoridades", "a empresa"). NÃO complete nem invente nomes.',
  '6. NÃO invente datas nem dias da semana. Prefira referências relativas ("nesta edição",',
  '   "hoje", "ao longo do dia").',
].join('\n');

// Distribuição por categoria (rótulo + volume na edição), texto p/ ancorar o "o que
// dominou o dia" sem o modelo precisar contar.
export function categoriaDistribution(edition: Edition): string {
  return CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} (${edition.categorias[c]?.length ?? 0})`)
    .filter((s) => !s.endsWith('(0)'))
    .join(', ');
}

export function buildEditorialPrompt(stories: Story[], edition: Edition): string {
  const fontes = stories
    .map((s, i) => {
      const pq = s.porQueImporta?.trim() ? ` Por que importa: ${s.porQueImporta.trim()}` : '';
      return `[${i + 1}] (${labelOf(s)}) ${s.titulo}\n${s.resumo}${pq}`;
    })
    .join('\n\n');
  return [
    `Edição de ${edition.date}. Distribuição por categoria: ${categoriaDistribution(edition)}.`,
    '',
    'Principais notícias da edição (já resumidas):',
    '',
    fontes,
    '',
    'Escreva o panorama do dia. Responda em JSON com:',
    '- "titulo": manchete analítica e neutra do conjunto (sem ponto final, sem aspas);',
    '- "linhaFina": 1 frase-resumo (o "dek") do que a análise mostra;',
    '- "paragrafos": array de 3 a 4 parágrafos originais (cada um com 2 a 4 frases)',
    '  conectando os principais fatos do dia. NÃO use markdown nem listas nos parágrafos.',
    '',
    'Responda APENAS com um único objeto JSON válido (as 3 chaves acima), sem texto',
    'antes ou depois e sem blocos de código markdown.',
  ].join('\n');
}

// ── Validação ────────────────────────────────────────────────────────────────
const TITULO_MIN = 12;
const LINHA_FINA_MIN = 15;
const PARAGRAFO_MIN = 40;
const PARAGRAFOS_MIN = 2;
const PARAGRAFOS_MAX = 6;

// Palavras comuns / institucionais / geográficas que NÃO contam como nome próprio
// "fabricado" numa análise de notícias gerais. Lista deliberadamente ampla — a trava
// aqui é tolerante (ver editorialUnknownEntities); serve só pra reduzir ruído.
const COMMON = new Set([
  // estado/governo/instituições
  'brasil', 'governo', 'pais', 'presidente', 'presidenta', 'ministro', 'ministra',
  'ministerio', 'policia', 'justica', 'congresso', 'camara', 'senado', 'estado',
  'cidade', 'federal', 'estadual', 'municipal', 'nacional', 'supremo', 'tribunal',
  'banco', 'central', 'republica', 'planalto', 'prefeitura', 'governador', 'prefeito',
  'autoridades', 'oposicao', 'base', 'parlamento', 'executivo', 'legislativo', 'judiciario',
  // marcadores / conectores comuns capitalizados em início de frase
  'apos', 'ante', 'entre', 'desde', 'durante', 'contra', 'sobre', 'para', 'pela', 'pelo',
  'veja', 'entenda', 'saiba', 'isso', 'esse', 'esta', 'este', 'essa', 'novo', 'nova',
  'hoje', 'ontem', 'amanha', 'agora', 'ainda', 'mais', 'menos', 'tambem', 'ja',
  // datas
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro',
  'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
  // direções/regiões
  'norte', 'sul', 'leste', 'oeste', 'nordeste', 'noroeste', 'sudeste', 'sudoeste',
  'regiao', 'mundo', 'pais', 'paises', 'capital', 'interior',
  // UFs/regiões do Brasil (conjunto fechado)
  'acre', 'alagoas', 'amapa', 'amazonas', 'bahia', 'ceara', 'espirito', 'santo',
  'goias', 'maranhao', 'mato', 'grosso', 'minas', 'gerais', 'paraiba',
  'parana', 'pernambuco', 'piaui', 'grande', 'santa', 'catarina', 'paulo',
  'rondonia', 'roraima', 'tocantins', 'sergipe', 'distrito', 'brasilia',
]);

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Entidades "próprias" do texto: palavras capitalizadas com 4+ letras (pula a 1ª
// palavra de cada frase, capitalizada por convenção). Sem dígitos (códigos/números
// não são nome inventado).
const WORD_RE = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*/g;
const SENTENCE_SPLIT_RE = /[.!?]\s+/;
function properEntities(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(SENTENCE_SPLIT_RE)) {
    const words = sentence.match(WORD_RE) ?? [];
    words.forEach((w, i) => {
      if (i === 0) return; // 1ª palavra da frase: maiúscula por convenção
      if (!/^[A-ZÀ-Ý]/.test(w)) return;
      if (w.length < 4) return;
      out.push(norm(w));
    });
  }
  return out;
}

// Entidades próprias citadas na peça que NÃO aparecem no corpus da edição nem na
// lista COMMON. Numa análise geral é normal haver ALGUMAS (estados, países, pessoas
// citadas em agregado) — por isso a trava só reprova acima de um teto (egrégio).
export function editorialUnknownEntities(titulo: string, paragrafos: string[], corpus: string): string[] {
  const seen = new Set<string>();
  for (const text of [titulo, ...paragrafos]) {
    for (const ent of properEntities(text)) {
      if (corpus.includes(ent) || COMMON.has(ent)) continue;
      seen.add(ent);
    }
  }
  return [...seen];
}

export function editorialCorpus(stories: Story[]): string {
  return norm(
    stories
      .map((s) => `${s.titulo} ${s.resumo} ${s.porQueImporta} ${s.sources.map((x) => x.name).join(' ')}`)
      .join(' '),
  );
}

export type EditorialValidation =
  | { ok: true; titulo: string; linhaFina: string; paragrafos: string[]; unknownEntities: string[] }
  | { ok: false; reason: string; unknownEntities: string[] };

// Valida o output cru da IA: campos/tamanhos, contagem de parágrafos e — de forma
// TOLERANTE — entidades fora do material (reprova só acima de `maxUnknown`).
export function validateEditorial(
  raw: RawEditorial,
  stories: Story[],
  maxUnknown: number,
): EditorialValidation {
  const titulo = (raw.titulo ?? '').trim();
  const linhaFina = (raw.linhaFina ?? '').trim();
  const paragrafos = Array.isArray(raw.paragrafos)
    ? raw.paragrafos.map((p) => String(p ?? '').trim()).filter((p) => p.length >= PARAGRAFO_MIN)
    : [];

  const unknownEntities =
    titulo || paragrafos.length
      ? editorialUnknownEntities(titulo, paragrafos, editorialCorpus(stories))
      : [];

  if (titulo.length < TITULO_MIN) return { ok: false, reason: `título curto/ausente (${titulo.length})`, unknownEntities };
  if (linhaFina.length < LINHA_FINA_MIN) return { ok: false, reason: `linha-fina curta/ausente (${linhaFina.length})`, unknownEntities };
  if (paragrafos.length < PARAGRAFOS_MIN) return { ok: false, reason: `poucos parágrafos (${paragrafos.length})`, unknownEntities };
  const trimmed = paragrafos.slice(0, PARAGRAFOS_MAX);

  if (unknownEntities.length > maxUnknown) {
    return { ok: false, reason: `muitas entidades fora do material (${unknownEntities.length}): ${unknownEntities.slice(0, 8).join(', ')}`, unknownEntities };
  }

  return { ok: true, titulo, linhaFina, paragrafos: trimmed, unknownEntities };
}

// Notícias citadas (links internos): os primeiros N destaques da edição.
export function composeDestaques(stories: Story[], limit: number): EditorialRef[] {
  return stories.slice(0, limit).map((s) => ({ slug: slugOf(s), titulo: s.titulo, categoria: labelOf(s) }));
}

// ── Geração (chamada à IA com fallback de provedor) ───────────────────────────
const MAX_TOKENS = 6000; // folga p/ ~4 parágrafos + tokens de reasoning (gpt-oss)
const TEMPERATURE = 0.4;

export async function generateEditorial(
  edition: Edition,
  providers: OpenAICompatSummarizer[],
  now: Date,
  maxStories: number,
  destaquesLimit: number,
  maxUnknown: number,
  diag: string[] = [],
): Promise<Editorial | null> {
  const stories = edition.home.slice(0, Math.max(1, maxStories));
  if (stories.length === 0) {
    diag.push('edição sem histórias');
    return null;
  }

  const prompt = buildEditorialPrompt(stories, edition);
  for (const p of providers) {
    try {
      const raw = await p.completeJson<RawEditorial>(SYSTEM_INSTRUCTION, prompt, {
        schema: EDITORIAL_SCHEMA,
        schemaName: 'editorial',
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      });
      const v = validateEditorial(raw, stories, maxUnknown);
      if (!v.ok) {
        console.warn(`  ⚠ editorial reprovado: ${v.reason}`);
        diag.push(`reprovado — ${v.reason}`);
        continue;
      }
      if (v.unknownEntities.length > 0) {
        diag.push(`ok (entidades fora do material toleradas: ${v.unknownEntities.join(', ')})`);
      } else {
        diag.push('ok');
      }
      return {
        date: edition.date,
        generatedAt: now.toISOString(),
        titulo: v.titulo,
        linhaFina: v.linhaFina,
        paragrafos: v.paragrafos,
        destaques: composeDestaques(stories, destaquesLimit),
      };
    } catch (err) {
      const tag = isQuotaError(err) ? 'sem cota (429)' : String(err).slice(0, 120);
      console.warn(`  editorial: IA falhou (${tag}).`);
      diag.push(`erro — ${tag}`);
    }
  }
  return null;
}

// ── Gate (1/dia + janela) ──────────────────────────────────────────────────────
export function decideGenerate(opts: {
  exists: boolean;
  hourUtc: number;
  genHour: number;
  force: boolean;
}): { generate: boolean; reason: string } {
  const { exists, hourUtc, genHour, force } = opts;
  if (force) return { generate: true, reason: 'forçado (EDITORIAL_FORCE/DRY_RUN)' };
  if (exists) return { generate: false, reason: 'editorial do dia já existe' };
  if (hourUtc < genHour) return { generate: false, reason: `fora da janela (${hourUtc}h < ${genHour}h UTC)` };
  return { generate: true, reason: 'janela ok + sem editorial hoje' };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// Status da última tentativa (observabilidade): gravado SEMPRE, fora do dir
// data/editorial/ (p/ o glob *.json do site não tratá-lo como peça).
type EditorialStatus = {
  ranAt: string;
  editionDate: string;
  hourUtc: number;
  outcome: 'generated' | 'skipped' | 'no-providers' | 'not-generated';
  reason: string;
  attempts: string[];
};

async function writeStatus(dataDir: string, status: EditorialStatus): Promise<void> {
  await writeFile(join(dataDir, 'editorial-status.json'), JSON.stringify(status, null, 2) + '\n');
}

// Ponto de entrada chamado pelo pipeline (best-effort, nunca derruba a run).
export async function maybeWriteEditorial(edition: Edition, dataDir: string, now: Date): Promise<void> {
  const dir = join(dataDir, 'editorial');
  const path = join(dir, `${edition.date}.json`);
  const dryRun = !!process.env.EDITORIAL_DRY_RUN;
  const force = !!process.env.EDITORIAL_FORCE || dryRun;
  const genHour = Number(process.env.EDITORIAL_GEN_HOUR_UTC ?? 11);
  const maxStories = Number(process.env.EDITORIAL_MAX_STORIES ?? 12);
  const destaques = Number(process.env.EDITORIAL_DESTAQUES ?? 6);
  const maxUnknown = Number(process.env.EDITORIAL_MAX_UNKNOWN ?? 6);
  const hourUtc = now.getUTCHours();
  const base = { ranAt: now.toISOString(), editionDate: edition.date, hourUtc };

  const decision = decideGenerate({ exists: await fileExists(path), hourUtc, genHour, force });
  if (!decision.generate) {
    console.log(`[editorial] ${decision.reason} — pulando.`);
    if (!decision.reason.includes('já existe')) {
      await writeStatus(dataDir, { ...base, outcome: 'skipped', reason: decision.reason, attempts: [] });
    }
    return;
  }

  const providers = providersFromEnv();
  if (providers.length === 0) {
    console.log('[editorial] sem chave de IA — pulando.');
    await writeStatus(dataDir, { ...base, outcome: 'no-providers', reason: 'sem GROQ_API_KEY', attempts: [] });
    return;
  }

  const attempts: string[] = [];
  const editorial = await generateEditorial(edition, providers, now, maxStories, destaques, maxUnknown, attempts);
  if (!editorial) {
    console.warn('[editorial] não gerado (IA fora ou validação reprovou) — re-tenta no próximo run.');
    await writeStatus(dataDir, { ...base, outcome: 'not-generated', reason: 'IA fora ou validação reprovou', attempts });
    return;
  }

  if (dryRun) {
    console.log(`[editorial DRY RUN] ${editorial.titulo}\n${editorial.linhaFina}\n\n${editorial.paragrafos.join('\n\n')}`);
    return;
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(editorial, null, 2) + '\n');
  await writeStatus(dataDir, {
    ...base,
    outcome: 'generated',
    reason: `"${editorial.titulo}" (${editorial.paragrafos.length} parágrafos)`,
    attempts,
  });
  console.log(`[editorial] gravado: ${edition.date} — "${editorial.titulo}" (${editorial.paragrafos.length} parágrafos)`);
}
