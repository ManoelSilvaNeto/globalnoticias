// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// URL canônica do site (sitemap + canonical). Pode ser sobrescrita por env
// (ex.: apontar pro *.pages.dev no lançamento antes do subdomínio).
const site = process.env.SITE_URL ?? 'https://noticias.globalnote.com.br';

// https://astro.build/config
export default defineConfig({
  site,

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()]
});