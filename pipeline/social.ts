// Divulgação automática nas redes (Telegram, Bluesky, Mastodon) a cada edição.
// Roda DEPOIS do deploy (links já no ar). Cada rede só dispara se os secrets dela
// existirem — sem secret, é no-op. Nada aqui é crítico: falha vira warning e segue.
//
// Anti-spam: só posta histórias da home AINDA NÃO postadas (dedup em data/social.json).
// Se não há novidade, não posta nada. Rodando de 4 em 4h, no máx ~poucos posts/dia.
//
// Secrets (GitHub → Settings → Secrets and variables → Actions):
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   (canal: @BotFather cria o bot; chat_id do canal)
//   BLUESKY_HANDLE + BLUESKY_APP_PASSWORD   (app password em bsky.app → Settings → App Passwords)
//   MASTODON_INSTANCE + MASTODON_TOKEN      (instância ex.: https://mastodon.social; token em Preferences → Development)

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SITE = (process.env.SITE_URL ?? 'https://noticias.globalnote.com.br').replace(/\/$/, '');
const SITE_NAME = 'GlobalNotícias';
const MAX_PER_RUN = 5; // teto de histórias por execução
const STATE_PATH = resolve(process.cwd(), 'data/social.json');

type Story = { clusterId: string; slug?: string; titulo: string; resumo: string; category?: string };
type Edition = { home: Story[] };
type SocialState = { updatedAt: string; posted: string[] };

const slugOf = (s: Story): string => s.slug ?? s.clusterId;
const urlOf = (s: Story): string => `${SITE}/noticia/${slugOf(s)}/`;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const CATEGORY_TAG: Record<string, string> = {
  politica: 'politica', economia: 'economia', mundo: 'mundo', tecnologia: 'tecnologia',
  ciencia: 'ciencia', saude: 'saude', esportes: 'esportes', entretenimento: 'entretenimento',
};

// Hashtags p/ alcançar quem NÃO segue (feeds de hashtag do Bluesky/Mastodon).
function hashtagsFor(story: Story): string[] {
  const tags = ['noticias', 'brasil'];
  const c = story.category ? CATEGORY_TAG[story.category] : undefined;
  if (c && !tags.includes(c)) tags.push(c);
  return tags;
}

// Facets do Bluesky: marca cada #tag com offset em BYTES (UTF-8) p/ virar hashtag
// clicável/indexada — sem facet o "#" fica só como texto morto.
function tagFacets(text: string, tags: string[]): Record<string, unknown>[] {
  const enc = new TextEncoder();
  const facets: Record<string, unknown>[] = [];
  let from = 0;
  for (const tag of tags) {
    const needle = `#${tag}`;
    const idx = text.indexOf(needle, from);
    if (idx < 0) continue;
    facets.push({
      index: {
        byteStart: enc.encode(text.slice(0, idx)).length,
        byteEnd: enc.encode(text.slice(0, idx + needle.length)).length,
      },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
    from = idx + needle.length;
  }
  return facets;
}

async function readState(): Promise<SocialState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8')) as SocialState;
  } catch {
    return { updatedAt: '', posted: [] };
  }
}

// --- Telegram: digest com os destaques novos ---------------------------------
async function postTelegram(stories: Story[]): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const lines = stories.map((s) => `• ${s.titulo}\n${urlOf(s)}`).join('\n\n');
  const text = `📰 ${SITE_NAME} — destaques\n\n${lines}\n\n🔗 ${SITE}`;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false }),
  });
  console.log(`Telegram: HTTP ${res.status}`);
  return res.ok;
}

// --- Bluesky (AT Protocol): post da história principal com card -------------
async function postBluesky(story: Story): Promise<boolean> {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) return false;
  const base = 'https://bsky.social/xrpc';
  const session = await fetch(`${base}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!session.ok) {
    console.warn(`Bluesky login falhou: HTTP ${session.status}`);
    return false;
  }
  const { accessJwt, did } = (await session.json()) as { accessJwt: string; did: string };
  const tags = hashtagsFor(story);
  const tagLine = tags.map((t) => `#${t}`).join(' ');
  const text = `${clip(story.titulo, 295 - tagLine.length)}\n\n${tagLine}`; // limite 300 graphemes
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['pt-BR'],
    facets: tagFacets(text, tags),
    embed: {
      $type: 'app.bsky.embed.external',
      external: { uri: urlOf(story), title: clip(story.titulo, 200), description: clip(story.resumo, 280) },
    },
  };
  const res = await fetch(`${base}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessJwt}` },
    body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
  });
  console.log(`Bluesky: HTTP ${res.status}`);
  return res.ok;
}

// --- Mastodon: status simples da história principal --------------------------
async function postMastodon(story: Story): Promise<boolean> {
  const instance = process.env.MASTODON_INSTANCE?.replace(/\/$/, '');
  const token = process.env.MASTODON_TOKEN;
  if (!instance || !token) return false;
  const tagLine = hashtagsFor(story).map((t) => `#${t}`).join(' ');
  const status = `${clip(story.titulo, 380)}\n\n${urlOf(story)}\n\n${tagLine}`; // limite 500
  const res = await fetch(`${instance}/api/v1/statuses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, language: 'pt', visibility: 'public' }),
  });
  console.log(`Mastodon: HTTP ${res.status}`);
  return res.ok;
}

async function safe(label: string, fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`${label} falhou (não crítico):`, String(err).slice(0, 140));
    return false;
  }
}

async function main(): Promise<void> {
  const edition = JSON.parse(await readFile(resolve(process.cwd(), 'data/current.json'), 'utf-8')) as Edition;
  const state = await readState();
  const already = new Set(state.posted);

  const fresh = edition.home.filter((s) => !already.has(slugOf(s))).slice(0, MAX_PER_RUN);
  if (fresh.length === 0) {
    console.log('Social: nada novo p/ postar.');
    return;
  }

  const anyConfigured =
    !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) ||
    !!(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD) ||
    !!(process.env.MASTODON_INSTANCE && process.env.MASTODON_TOKEN);
  if (!anyConfigured) {
    console.log('Social: nenhuma rede configurada (sem secrets) — pulando.');
    return;
  }

  const top = fresh[0];
  const results = await Promise.all([
    safe('Telegram', () => postTelegram(fresh)),
    safe('Bluesky', () => postBluesky(top)),
    safe('Mastodon', () => postMastodon(top)),
  ]);

  if (!results.some(Boolean)) {
    console.log('Social: nada postado (nenhuma rede aceitou) — estado preservado.');
    return;
  }

  // Marca as histórias desta leva como postadas (mantém só as últimas 500).
  const posted = [...state.posted, ...fresh.map(slugOf)].slice(-500);
  await writeFile(STATE_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), posted }, null, 2)}\n`);
  console.log(`Social: ${fresh.length} história(s) marcada(s) como postadas.`);
}

main().catch((err) => {
  console.warn('Social falhou (não crítico):', String(err).slice(0, 140));
});
