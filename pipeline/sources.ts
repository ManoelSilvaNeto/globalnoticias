// Lista curada de feeds RSS/Atom por categoria.
// Verificada manualmente em 2026-05-20 (status 200 + itens). Feed que morrer é
// só logado e ignorado no fetch — não derruba o run.
//
// Categoria "geral": fontes com feed único que mistura editorias. Esses artigos
// alimentam clusters/home e contam como fonte, mas não forçam página de categoria
// (a categoria de cada cluster é decidida pela maioria dos seus artigos).
//
// Fora do MVP por fragilidade (revisitar): Folha (RSS 0.91 + ISO-8859-1 +
// quebra com Accept-Encoding), UOL, Estadão.

import type { Source } from '../src/lib/types';

export const SOURCES: Source[] = [
  // ── G1 (Globo) — uma fonte, várias editorias ──────────────────────────────
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/', category: 'geral' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/politica/', category: 'politica' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/economia/', category: 'economia' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/mundo/', category: 'mundo' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/tecnologia/', category: 'tecnologia' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/ciencia-e-saude/', category: 'ciencia' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/bemestar/', category: 'saude' },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/pop-arte/', category: 'entretenimento' },
  { name: 'GE', url: 'https://ge.globo.com/rss/ge/', category: 'esportes' },

  // ── Política ──────────────────────────────────────────────────────────────
  { name: 'Poder360', url: 'https://www.poder360.com.br/feed/', category: 'politica' },
  { name: 'CartaCapital', url: 'https://www.cartacapital.com.br/feed/', category: 'politica' },

  // ── Economia ──────────────────────────────────────────────────────────────
  { name: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/', category: 'economia' },
  { name: 'Exame', url: 'https://exame.com/feed/', category: 'economia' },

  // ── Mundo ─────────────────────────────────────────────────────────────────
  { name: 'BBC Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml', category: 'mundo' },
  { name: 'DW Brasil', url: 'https://rss.dw.com/rdf/rss-br-all', category: 'mundo' },

  // ── Tecnologia ────────────────────────────────────────────────────────────
  { name: 'Olhar Digital', url: 'https://olhardigital.com.br/feed/', category: 'tecnologia' },
  { name: 'Canaltech', url: 'https://canaltech.com.br/rss/noticias/', category: 'tecnologia' },

  // ── Saúde ─────────────────────────────────────────────────────────────────
  { name: 'Drauzio Varella', url: 'https://drauziovarella.uol.com.br/feed/', category: 'saude' },

  // ── Geral (multi-editoria) ────────────────────────────────────────────────
  { name: 'CNN Brasil', url: 'https://www.cnnbrasil.com.br/feed/', category: 'geral' },
  { name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss.xml', category: 'geral' },
  { name: 'Metrópoles', url: 'https://www.metropoles.com/feed', category: 'geral' },
  { name: 'Veja', url: 'https://veja.abril.com.br/feed/', category: 'geral' },
];
