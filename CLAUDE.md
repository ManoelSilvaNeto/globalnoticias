# Contexto do projeto — leitura obrigatória pro Claude Code

Este arquivo resume o estado atual do projeto e garante continuidade entre sessões.
Leia antes de qualquer mudança.

## O que é o projeto

**GlobalNotícias** (`https://noticias.globalnote.com.br`) — agregador automático
de notícias em PT-BR. Coleta RSS de portais brasileiros, agrupa matérias da mesma
história, resume com IA neutra (Groq `openai/gpt-oss-20b`), publica como site
Astro estático no Cloudflare Pages via GitHub Actions cron a cada 4h.

**Stack:** Astro 6 + Tailwind 4 (site) · TypeScript/Node 22 (pipeline) · Vitest ·
Groq (IA) · Cloudflare Pages.

**Princípios não-negociáveis:**
- Custo R$0 — sem embeddings pagos, banco, servidor sempre-ligado.
- Modelo Google News — nunca copiar texto da fonte, sempre creditar e linkar.
- Build nunca quebra por causa da IA — fallback obrigatório.

## Estado atual (atualizado em 2026-05-28)

### Sprint do BRIEF — concluído ✓

As 5 melhorias priorizadas no `BRIEF.md` foram entregues em 2026-05-27:

| Item | O que mudou |
|---|---|
| #1 cluster + IDF | `pipeline/cluster.ts`: IDF nos vetores, gate de entidades nomeadas (regex de runs capitalizados ignorando a primeira palavra), `DEFAULT_THRESHOLD` 0.22 → 0.25. Resolveu o caso "ebola na Copa do Mundo". |
| #2 anti-alucinação | `pipeline/summarize.ts`: `validateSummary` exige que entidades do título apareçam nas fontes; retry com hint; fallback se persistir. Nova métrica `SummarizeStats.hallucinationRejected`. |
| #3 integration test | `pipeline/integration.test.ts` + 4 fixtures RSS em `__fixtures__/feeds/`. Mocka `fetch` global, cobre composição inteira. |
| #4 limpeza | `dist/`, `goo11.png` já estavam no `.gitignore`. Sem mudança em código. |
| #5 cobertura adicional | +32 testes em `topics.test.ts`, `seo.test.ts`, `social.test.ts`. Refatorações mínimas (exportar utils + guard `NODE_ENV!=='test'` em `social.ts`). |

**Suite atual: 80/80 verde em ~285ms.** Build do Astro: 547 páginas em ~1.1s.

### Habilitação do Google AdSense ✓

Conta `pub-7077758294476082` em onboarding. Trabalho aplicado no commit que
adicionou este arquivo:

- `public/ads.txt` — uma linha: `google.com, pub-7077758294476082, DIRECT, f08c47fec0942fa0`
- `src/layouts/Layout.astro` — meta `google-adsense-account` no `<head>` + `<CookieBanner />` antes de `</body>`
- `src/components/CookieBanner.astro` — consentimento LGPD (localStorage `gn-consent`, evento `gn:consent`)
- `src/pages/sobre.astro`, `src/pages/contato.astro`, `src/pages/privacidade.astro` — páginas obrigatórias do AdSense
- `src/components/Footer.astro` — links Sobre/Contato/Privacidade/RSS + email

`AdSlot.astro` segue **desabilitado** (`const enabled = false`). Só ligar quando
a aprovação do AdSense sair — antes disso, exibir `<ins class="adsbygoogle">` é
policy violation.

## Email do projeto (configurado em 2026-05-28)

O domínio `globalnote.com.br` é compartilhado entre 3 projetos
(`globalnote.com.br` = Agenda Global; `noticias.globalnote.com.br` =
GlobalNotícias; `radar.globalnote.com.br` = GlobalRadar). Email é único
e cobre os 3 via catch-all.

**Endereço usado pelo site:** `noticias@globalnote.com.br`. Aparece em
`/contato`, `/sobre`, `/privacidade` e no footer.

**Stack de recebimento:**

- **Provedor:** ImprovMX (free tier) — forwarding-only, sem custo.
- **DNS:** 2 MX records no apex do `globalnote.com.br` no registro.br:
  `10 mx1.improvmx.com` e `20 mx2.improvmx.com`.
- **Catch-all ativo:** qualquer endereço `@globalnote.com.br` (incluindo
  `noticias@`, `contato@`, `radar@`, `admin@`, `lgpd@` e futuros) é
  encaminhado pro Gmail operacional do dono. Não precisa criar alias
  específico no painel ImprovMX.
- **Painel:** `app.improvmx.com` (login via Google com o Gmail destino).

**Stack de envio (separado, independente):**

- **Resend** já está configurado pro domínio (DKIM em `resend._domainkey`
  no DNS). Pra ENVIAR como `noticias@globalnote.com.br` (resposta a
  AdSense/LGPD), configurar "Send mail as" no Gmail apontando pro SMTP
  do Resend (`smtp.resend.com:587`, user `resend`, password = API key).
  Free tier do Resend: 3000 emails/mês, 100/dia. Não é urgente: enquanto
  isso, responder do Gmail pessoal assinando "Equipe GlobalNotícias" é
  aceito.
- **Amazon SES** também está configurado no domínio (subdomínio `send.`
  com MX próprio pra bounces + SPF). Usado pelo GlobalNote (Agenda),
  não pelo GlobalNotícias. Não tocar nesses registros.

**Atenção ao DNS compartilhado:**

- O `globalnote.com.br` tem registros de 3 projetos diferentes. NUNCA
  remover um registro sem confirmar qual projeto usa.
- Os 2 MX de email (`mx1/mx2.improvmx.com`) ficam no apex; o MX do SES
  fica em `send.globalnote.com.br` — não conflitam.
- Adicionar futuro DMARC (`_dmarc.globalnote.com.br`) afeta os 3
  projetos — coordenar antes.

## Próximos passos

### Imediato (ação do humano, fora do Claude Code)

1. Abrir o painel AdSense (`adsense.google.com/onboarding`) e clicar
   **"Solicitar revisão"**. Verificação da meta tag deve ser automática.
   Ver "Quando submeter ao AdSense" abaixo antes de fazer isso.
2. Aguardar resposta do Google — pode levar de horas a algumas semanas.

### Quando submeter ao AdSense (recomendação técnica)

Análise feita em 2026-05-28: **esperar 30-60 dias antes de submeter**.

Sinais de prontidão ao 2026-05-28:
- 🔴 Idade: 8 dias desde 1º commit (`2026-05-20`) — muito jovem.
- 🟢 Volume: 495 páginas de notícia + 18 temas + categorias.
- 🟢 Compliance: ads.txt, meta tag, banner LGPD, /sobre, /contato,
  /privacidade, email funcional.
- 🟢 Qualidade de conteúdo: validador anti-alucinação (item #2 do
  BRIEF), múltiplas fontes por história, "Por que importa".
- 🔴 Tráfego: desconhecido mas baixo (site com 8 dias).
- 🟡 Categoria "agregador + IA": risco real de "scraped content";
  mitigado pelo conteúdo original e transparência, mas reviewer
  pode flagar.

Critérios pra submeter:
- Site com ≥ 30 dias (`2026-06-19+`).
- 2+ posts editoriais originais publicados (`/editorial/` ou similar
  — conteúdo 100% nosso, não-agregado). Vacina contra "scraped".
- Search Console sem erros após primeira indexação completa
  (esperar ~2-3 semanas pós-submissão do sitemap).
- Tráfego orgânico crescendo no Cloudflare Web Analytics.

### Quando a aprovação sair

1. Em `src/components/AdSlot.astro`: trocar `enabled` para `true` e adicionar o
   `<ins class="adsbygoogle" data-ad-client="ca-pub-7077758294476082"
   data-ad-slot="…">`. Slot ID vem do painel AdSense → Ads → By ad unit.
2. Carregar o script do AdSense respeitando o consentimento:
   - Escutar `window.addEventListener('gn:consent', e => ...)` no Layout.
   - Só injetar `<script async src="…/adsbygoogle.js?client=ca-pub-…">` quando
     `e.detail.value === 'all'`.
   - Re-carregar quem aceitou em visitas futuras lendo `localStorage.getItem('gn-consent')`.
3. Posicionar slots adicionais em locais de maior dwell time:
   - `/noticia/<slug>` (entre o resumo e as fontes)
   - rodapé das páginas de categoria
4. Acompanhar `Cloudflare Web Analytics` e o `Search Console` (sitemap já
   submetido) — tráfego baixo é o segundo motivo mais comum de rejeição.

### Riscos AdSense conhecidos

- **"Scraped content"** — risco real pra agregador. Defesas atuais:
  resumos originais com validador anti-alucinação (item #2 do BRIEF),
  múltiplas fontes por história, transparência sobre IA no Sobre e na
  Privacidade. Se rejeitarem por isso, o appeal foca nesses pontos +
  adicionar conteúdo só nosso (post editorial sobre o método).
- **Idade/tráfego baixo** — sem ação rápida possível, só ganho orgânico
  (IndexNow já roda; cron de 4h mantém cobertura fresca).

## Arquivos de referência neste repo

- **`README.md`** — visão geral, comandos, deploy.
- **`BRIEF.md`** — auditoria + 5 melhorias do sprint (todas entregues — vale
  como histórico do que foi feito e por quê).
- **`docs/RESTAURAR.md`** — rodar local, voltar a versão antiga, recriar do zero.
- **`perguntas-brainstorm.md`** — decisões iniciais do projeto (escopo, fontes, monetização).
- **`CLAUDE.md`** (este arquivo) — estado atual e continuidade.

## Convenções importantes

- **Categorias:** `politica, economia, mundo, tecnologia, ciencia, saude,
  esportes, entretenimento` (+ `geral` interno, aparece só na home). Fonte
  única em `src/lib/categories.ts`, compartilhada entre pipeline e site.
- **Dados em JSON versionado:** `data/current.json`, `data/state.json`,
  `data/edicoes/*.json`. Commit automático pelo workflow `update.yml`.
- **`data/state.json`** guarda o cache de resumos (chave = hash da URL do
  artigo-âncora). Apagar/zerar (`{"summaries":{}}`) força regeneração no próximo run.
- **Testes em Vitest:** `pnpm test`. CI roda antes do build. Mantenha < 5s.
- **Sem mexer em `.github/workflows/update.yml`** sem plano explícito — está
  delicado (concurrency, push resiliente, IndexNow condicional).
- **Não habilitar `AdSlot` sem aprovação confirmada** — exibir `adsbygoogle`
  sem aprovação ou sem consentimento é violação de política.

## Como pedir ajuda neste projeto

Quando me pedir mudança, prefira:

> "Leia `CLAUDE.md` (e `BRIEF.md` se for pipeline). Faça [X]. Use plan mode antes
> de tocar em código."

Trabalhe um item por vez, com commit + teste verde a cada passo.
