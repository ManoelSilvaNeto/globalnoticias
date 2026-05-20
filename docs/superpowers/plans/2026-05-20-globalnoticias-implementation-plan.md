# GlobalNoticias — Plano de Implementação (MVP)

**Base:** `docs/superpowers/specs/2026-05-20-globalnoticias-design.md`
**Data:** 2026-05-20
**Estimativa total:** ~16–24h de dev (solo)

Plano em fases incrementais. Cada fase entrega algo validável. Itens marcados **[VOCÊ]** dependem de uma ação sua (criar conta / gerar chave) — eu te guio na hora.

---

## Pré-requisitos (contas, todas free) — **[VOCÊ]**, quando chegarmos lá
- **Google AI Studio** → gerar `GEMINI_API_KEY` (free tier, sem cartão).
- **Cloudflare** → conta + criar projeto Pages + gerar `CLOUDFLARE_API_TOKEN` e pegar `CLOUDFLARE_ACCOUNT_ID`.
- **GitHub** → repo `globalnoticias` (público, p/ Actions ilimitado).
- **DNS de globalnote.com.br** → eu descubro onde é gerenciado; você adiciona 1 registro CNAME quando o site estiver de pé.

> Nenhuma dessas é necessária pra começar — dá pra desenvolver e validar tudo localmente até a Fase 6.

---

## Fase 0 — Scaffold do projeto
**Objetivo:** esqueleto rodando local.
- `pnpm create astro` em `~/Projetos/GlobalNoticias` (template mínimo) + integração Tailwind.
- TypeScript estrito; Vitest configurado.
- Criar a estrutura de pastas da spec (§5): `src/`, `data/`, `pipeline/`.
- `package.json` scripts: `dev` (astro), `build`, `pipeline` (`tsx pipeline/index.ts`), `test`.
- `git init` local (sem remote ainda). `.gitignore` (node_modules, dist, .env, etc).
- `.env.example` com `GEMINI_API_KEY=`.
**Validação:** `pnpm dev` sobe a home placeholder; `pnpm test` roda (vazio); `pnpm build` gera `dist/`.

## Fase 1 — Fontes + coleta
**Objetivo:** transformar feeds reais em `Article[]` normalizado.
- `pipeline/sources.ts`: lista curada de feeds RSS por categoria (G1 por editoria, Folha, UOL, CNN Brasil, BBC Brasil, Poder360, Estadão + **Agência Brasil/EBC**). Tipos `Category` e `Source`.
- `pipeline/fetch.ts`: busca cada feed com **timeout por feed** + try/catch (feed morto não derruba o run), parser RSS/Atom (`rss-parser`), normaliza pro tipo `Article` (§6.2) com `id` = hash da URL.
- Testes Vitest: normalização (dado um item de feed → `Article` correto), dedup por URL.
**Validação:** rodar `fetch` real e inspecionar contagem de artigos por fonte/categoria; nenhum feed quebra o processo.

## Fase 2 — Clustering + ranking
**Objetivo:** agrupar a mesma história e ordenar por importância.
- `pipeline/cluster.ts`: normalização de texto PT (lowercase, sem acento, stopwords), vetorização bag-of-words/TF-IDF, agrupamento por cosseno acima de limiar (config). Janela de 48h.
- `pipeline/rank.ts`: `score = w1*nº_fontes + w2*recência` (pesos em config). Seleção top home (~10) e por categoria (~8).
- Testes Vitest: similaridade (2 títulos parecidos clusterizam; diferentes não), ranking (mais fontes → score maior).
**Validação:** rodar sobre coleta real e revisar manualmente os clusters/topo — afinar limiar e pesos.

## Fase 3 — Resumo com IA (Gemini Flash) — depende de `GEMINI_API_KEY` **[VOCÊ]**
**Objetivo:** resumo original + "por que importa" pros clusters do topo.
- `pipeline/summarize.ts`: cliente Gemini atrás de uma **interface `Summarizer`** (trocável p/ Groq/Claude depois). Saída JSON estruturada `Summary` (§6.5). **Prompt de tom neutro** (§6.5).
- **Cache** por hash das URLs do cluster, persistido em `state.json` — não re-chama IA pra cluster já resumido.
- **Fallback:** falha/quota → usa descrição do RSS truncada. Build nunca quebra.
- Testes Vitest: chave de cache estável; fallback acionado quando o cliente lança erro (cliente mockado).
**Validação:** resumir top real; conferir qualidade/tom em PT-BR; confirmar que 2º run usa cache (0 chamadas novas).

## Fase 4 — Montagem dos dados + orquestração
**Objetivo:** pipeline ponta-a-ponta gerando os JSON do site.
- `pipeline/build-data.ts`: monta `current.json` (home + categorias, cada história = `Story` §6.7), grava/atualiza `edicoes/<hoje>.json`, atualiza e poda `state.json`.
- `pipeline/index.ts`: orquestra coleta → cluster → rank → resume → build-data, com logs.
- Testes Vitest: montagem do `current.json` a partir de clusters+summaries fixos.
**Validação:** `pnpm pipeline` gera `data/current.json` + `data/edicoes/AAAA-MM-DD.json` coerentes.

## Fase 5 — Site Astro (frontend + SEO)
**Objetivo:** site lendo os JSON, no estilo "leitura".
- Layout base + `<head>` SEO (title/desc por página, OG, JSON-LD `NewsArticle`/`ItemList`).
- Componentes: `Card`/`Story`, `ListaHistorias`, `SeletorTema` (dark mode), bloco de categoria, **slot de anúncio reservado** (vazio).
- Páginas: `index.astro` (edição atual), `[categoria].astro` (8 categorias), `edicao/[data].astro` (de `data/edicoes/*.json`).
- `@astrojs/sitemap`; URLs limpas; canonical por edição.
- Tailwind: tipografia boa, mobile-first, dark mode.
- **Mockups antes de codar o visual** (skill `frontend-design`) pra você comparar.
**Validação:** `astro dev` mostrando dados reais; Lighthouse/SEO ok; dark mode funciona; `astro build` limpo.

## Fase 6 — CI/CD (GitHub Actions + Cloudflare Pages) — **[VOCÊ]** cria contas/secrets
**Objetivo:** automação cron → build → deploy.
- Criar repo GitHub `globalnoticias` (público) e dar push.
- Criar projeto no Cloudflare Pages; gerar token + account id.
- Cadastrar Secrets: `GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- `.github/workflows/update.yml`: `schedule` (cron a cada 4h, UTC) + `workflow_dispatch`; `concurrency`; passos install → pipeline → commit `data/` se mudou → `astro build` → deploy `dist/` via `wrangler pages deploy`; pula deploy se sem novidade.
**Validação:** disparo manual (`workflow_dispatch`) builda e publica no `*.pages.dev`; commit de `data/` aparece; run agendado dispara sozinho.

## Fase 7 — Domínio + lançamento — **[VOCÊ]** adiciona o CNAME
**Objetivo:** `noticias.globalnote.com.br` no ar.
- Eu identifico onde o DNS de globalnote.com.br é gerenciado.
- Você adiciona CNAME `noticias` → `<projeto>.pages.dev`; configurar custom domain no Pages (HTTPS automático).
- Verificar SSL + redirect + render em mobile real.
- (Opcional) enviar sitemap ao Google Search Console.
**Validação:** site abre no subdomínio com HTTPS; páginas e edições acessíveis.

## Fase 8 — Polish + afinação em produção
**Objetivo:** estabilizar e melhorar qualidade.
- Acompanhar as primeiras edições reais; afinar limiar de clustering e pesos do ranking.
- Revisar qualidade/neutralidade dos resumos; ajustar prompt se preciso.
- Conferir consumo de quota do Gemini; validar resiliência (simular feed fora/IA fora).
- README de cold-start (como rodar local e como o deploy funciona).
**Validação:** algumas edições seguidas saindo limpas, sem intervenção.

---

## Ordem de dependências
`F0 → F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8`
F3 precisa do `GEMINI_API_KEY`; F6 precisa de GitHub+Cloudflare; F7 precisa do CNAME. F0–F5 são 100% locais (dá pra ir longe antes de pedir qualquer conta).

## Riscos / pontos de atenção (da spec §14)
- Qualidade do clustering léxico (afinável; embeddings locais é o próximo nível).
- Tráfego orgânico demora (SEO).
- Mudança de free tier (resumidor atrás de interface mitiga).
- Scheduled workflow do GitHub desabilita após 60d sem atividade (commit de `data/` mantém vivo).
