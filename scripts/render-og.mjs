// Gera o card OG de marca (public/og-default.png) a partir de scripts/og-default.svg.
// Roda LOCALMENTE e raramente (só quando o SVG muda) — o PNG é commitado como asset
// estático, então o build da Cloudflare NUNCA depende de rasterização/fontes. Por
// isso fica em scripts/ e não no pipeline.
//
// Uso:  pnpm tsx scripts/render-og.mjs
//
// sharp não é dep direta (vem transitivo do Astro, sob node_modules/.pnpm) — por isso
// resolvemos o caminho dinamicamente, sem fixar versão.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function resolveSharp() {
  const base = 'node_modules/.pnpm';
  const dir = (await readdir(base)).find((d) => /^sharp@/.test(d));
  if (!dir) throw new Error('sharp não encontrado em node_modules/.pnpm — rode pnpm install.');
  const entry = join(process.cwd(), base, dir, 'node_modules/sharp/lib/index.js');
  return (await import(pathToFileURL(entry).href)).default;
}

const sharp = await resolveSharp();
const svg = await readFile('scripts/og-default.svg');
const png = await sharp(svg, { density: 144 }).resize(1200, 630, { fit: 'fill' }).png().toBuffer();
await writeFile('public/og-default.png', png);
console.log(`public/og-default.png gerado (${png.length} bytes).`);
