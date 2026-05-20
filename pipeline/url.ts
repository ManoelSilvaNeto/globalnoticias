// Normalização de URL e id estável — usados pela coleta (dedup) e pelo cache de
// resumos. Sem dependências, fácil de testar.

import { createHash } from 'node:crypto';

// Parâmetros de rastreamento que não identificam o conteúdo — removidos pra que
// a mesma matéria linkada por fontes diferentes gere a mesma URL canônica.
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|igshid$|mc_|ref$|ref_|spm$|_ga$|cmpid$|xtor$|s_cid$)/i;

// Forma canônica usada no id/dedup/cache (NÃO no link exibido pro leitor).
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const kept = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAM.test(k)) kept.set(k, v);
    }
    u.search = kept.toString();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

// id estável = hash da URL normalizada (64 bits em hex bastam).
export function articleId(url: string): string {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 16);
}
