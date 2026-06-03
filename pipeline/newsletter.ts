// Envio automático da newsletter diária por e-mail via Buttondown. Roda DEPOIS do
// deploy (links já no ar), no mesmo padrão pós-build do social.ts/indexnow.ts.
//
// Cadência: UM resumo por dia (dedup pela data da edição em data/newsletter.json),
// disparado na 1ª run a partir de NEWSLETTER_SEND_HOUR_UTC (default 12h UTC ≈ 09h
// de Brasília) — assim o digest da manhã carrega a madrugada inteira de notícias.
// As demais runs do mesmo dia são no-op.
//
// É no-op sem BUTTONDOWN_API_KEY (seguro mergear sem o secret). Falha vira warning
// e o estado é preservado: re-tenta no próximo run.
//
// ⚠️ Buttondown API (versão 2026-04-01): o default de status virou `draft`; para
// disparar o envio imediato é preciso status=about_to_send MAIS os headers de
// confirmação (X-API-Version + X-Buttondown-Live-Dangerously) — sem eles a API
// rejeita com 400 sending_requires_confirmation.
//
// Secret (GitHub → Settings → Secrets and variables → Actions):
//   BUTTONDOWN_API_KEY        (Buttondown → API → Keys, em buttondown.com/keys;
//                              permissões Emails Read&write + Sending Enabled)
// Envs opcionais (variables do repo, não secrets):
//   NEWSLETTER_SEND_HOUR_UTC  janela mínima de envio (default 12)
//   NEWSLETTER_MAX_STORIES    nº de destaques no e-mail (default 8)
//   NEWSLETTER_FORCE=1        ignora janela + dedup (1º envio / envio manual real)
//   NEWSLETTER_DRY_RUN=1      compõe e loga, NÃO envia (teste; dispensa o secret)
//   BUTTONDOWN_API_BASE       override do endpoint da API

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATEGORY_LABELS } from '../src/lib/categories';
import type { ArticleCategory } from '../src/lib/categories';

const SITE_URL = (process.env.SITE_URL ?? 'https://noticias.globalnote.com.br').replace(/\/$/, '');
const SITE_NAME = 'GlobalNotícias';
const TAGLINE = 'as notícias que importaram hoje, resumidas com link pra fonte';
const STATE_PATH = resolve(process.cwd(), 'data/newsletter.json');
const API_BASE = (process.env.BUTTONDOWN_API_BASE ?? 'https://api.buttondown.com/v1').replace(/\/$/, '');

const LABELS = CATEGORY_LABELS as Record<string, string>;

export type Story = {
  clusterId: string;
  slug?: string;
  titulo: string;
  resumo: string;
  porQueImporta?: string;
  category?: ArticleCategory;
};
export type Edition = { date: string; home: Story[] };
export type NewsletterState = { updatedAt: string; lastSentDate: string; sent: string[] };

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const slugOf = (s: Story): string => s.slug ?? s.clusterId;
const urlOf = (s: Story): string => `${SITE_URL}/noticia/${slugOf(s)}/`;

// "2026-06-03" -> "3 de junho de 2026" (sem depender de Intl/locale).
export function formatDateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  return `${Number(d)} de ${MESES[Number(mo) - 1]} de ${y}`;
}

// Monta o e-mail (Markdown — o Buttondown renderiza e anexa o rodapé de descadastro
// sozinho). Prioriza o porQueImporta como corpo; cai no resumo se faltar. A categoria
// "geral" (e qualquer valor sem rótulo) é omitida do selo.
export function composeEmail(edition: Edition, maxStories: number): { subject: string; body: string } | null {
  const stories = edition.home.slice(0, Math.max(1, maxStories));
  if (stories.length === 0) return null;
  const label = formatDateLabel(edition.date);
  const subject = `${SITE_NAME} · ${label}`;
  const parts: string[] = [`Os destaques de ${label} — ${TAGLINE}.`, ''];
  for (const s of stories) {
    parts.push('---', '', `## ${s.titulo}`, '');
    const corpo = (s.porQueImporta?.trim() || s.resumo?.trim() || '').trim();
    if (corpo) parts.push(corpo, '');
    const catLabel = LABELS[s.category ?? ''];
    parts.push(`${catLabel ? `**${catLabel}** · ` : ''}[Ler no ${SITE_NAME}](${urlOf(s)})`, '');
  }
  parts.push('---', '', `[Ver todas as notícias no ${SITE_NAME}](${SITE_URL}/)`);
  return { subject, body: parts.join('\n') };
}

// Decide se manda agora: 1 por edição (dedup) + janela horária; force ignora ambos.
export function decideSend(opts: {
  state: NewsletterState;
  editionDate: string;
  hourUtc: number;
  sendHour: number;
  force: boolean;
}): { send: boolean; reason: string } {
  const { state, editionDate, hourUtc, sendHour, force } = opts;
  if (force) return { send: true, reason: 'forçado (NEWSLETTER_FORCE/DRY_RUN)' };
  if (state.lastSentDate === editionDate) return { send: false, reason: `edição ${editionDate} já enviada` };
  if (hourUtc < sendHour) return { send: false, reason: `fora da janela (${hourUtc}h < ${sendHour}h UTC)` };
  return { send: true, reason: 'janela ok + edição nova' };
}

async function readState(): Promise<NewsletterState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8')) as NewsletterState;
  } catch {
    return { updatedAt: '', lastSentDate: '', sent: [] };
  }
}

async function sendViaButtondown(apiKey: string, email: { subject: string; body: string }): Promise<boolean> {
  const res = await fetch(`${API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
      'X-API-Version': '2026-04-01',
      'X-Buttondown-Live-Dangerously': 'true',
    },
    body: JSON.stringify({ subject: email.subject, body: email.body, status: 'about_to_send' }),
  });
  console.log(`Buttondown: HTTP ${res.status}`);
  if (!res.ok) console.warn(`Buttondown rejeitou: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}

export async function main(): Promise<void> {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  const dryRun = !!process.env.NEWSLETTER_DRY_RUN;
  if (!apiKey && !dryRun) {
    console.log('Newsletter: sem BUTTONDOWN_API_KEY — pulando.');
    return;
  }

  const edition = JSON.parse(await readFile(resolve(process.cwd(), 'data/current.json'), 'utf-8')) as Edition;
  const state = await readState();
  const sendHour = Number(process.env.NEWSLETTER_SEND_HOUR_UTC ?? 12);
  const maxStories = Number(process.env.NEWSLETTER_MAX_STORIES ?? 8);
  const force = !!process.env.NEWSLETTER_FORCE || dryRun;

  const decision = decideSend({
    state,
    editionDate: edition.date,
    hourUtc: new Date().getUTCHours(),
    sendHour,
    force,
  });
  if (!decision.send) {
    console.log(`Newsletter: ${decision.reason} — nada a enviar.`);
    return;
  }

  const email = composeEmail(edition, maxStories);
  if (!email) {
    console.log('Newsletter: edição sem histórias — nada a enviar.');
    return;
  }

  if (dryRun) {
    console.log(`Newsletter [DRY RUN] assunto: ${email.subject}\n\n${email.body}`);
    return;
  }

  const ok = await sendViaButtondown(apiKey as string, email);
  if (!ok) {
    console.log('Newsletter: envio falhou — estado preservado (re-tenta no próximo run).');
    return;
  }

  const sent = [...state.sent, edition.date].slice(-90);
  await writeFile(
    STATE_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), lastSentDate: edition.date, sent }, null, 2)}\n`,
  );
  console.log(`Newsletter: edição ${edition.date} enviada (${email.subject}).`);
}

// Só auto-executa quando rodado direto (pnpm tsx pipeline/newsletter.ts); sob o
// vitest o módulo é só importado, então main() não dispara.
const isDirect = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((err) => {
    console.warn('Newsletter falhou (não crítico):', String(err).slice(0, 140));
  });
}
