// Avisa os buscadores que suportam IndexNow (Bing, Yandex, Seznam...) que as
// páginas mudaram — indexação em minutos, grátis. O Google NÃO usa IndexNow
// (pro Google valem sitemap + Search Console). Não-crítico: falha não derruba o run.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CATEGORIES } from '../src/lib/categories';

const SITE = (process.env.SITE_URL ?? 'https://noticias.globalnote.com.br').replace(/\/$/, '');
const KEY = 'f6f94c3148c77edce5f54376289d731b';

async function main(): Promise<void> {
  const raw = await readFile(resolve(process.cwd(), 'data/current.json'), 'utf-8');
  const edition = JSON.parse(raw) as { date: string };

  const urlList = [
    `${SITE}/`,
    `${SITE}/rss.xml`,
    ...CATEGORIES.map((c) => `${SITE}/${c}/`),
    `${SITE}/edicao/${edition.date}/`,
  ];

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(SITE).host,
      key: KEY,
      keyLocation: `${SITE}/${KEY}.txt`,
      urlList,
    }),
  });
  console.log(`IndexNow: HTTP ${res.status} — ${urlList.length} URLs enviadas`);
}

main().catch((err) => {
  console.warn('IndexNow falhou (não crítico):', String(err).slice(0, 140));
});
