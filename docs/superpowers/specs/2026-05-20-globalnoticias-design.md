# GlobalNoticias — Spec de Design (MVP)

**Data:** 2026-05-20
**Autor:** Manoel Silva Neto (solo dev) + Claude
**Status:** aprovado pra virar plano de implementação

---

## 1. Visão

Site agregador/curador **automático** de notícias em PT-BR. Apresenta as **principais notícias do dia/semana**, resumidas, organizadas por categorias. O internauta entra pra se atualizar rápido. **O conteúdo vem da internet** (curadoria + resumo de notícias existentes) — o site não produz jornalismo original, ele resume e linka.

**Promessa:** *"As notícias que importaram hoje, resumidas e sem enrolação — com link pra fonte."*

**Diferença vs. globalnote:** projeto independente, sem relação de código/infra; só compartilha o dono e (opcionalmente) o subdomínio.

**Restrição-mãe:** **custo zero / sem investimento** nesta fase. Tudo roda em free tiers.

## 2. Princípios e restrições

- **Custo R$0/mês.** Free tiers do GitHub Actions, Cloudflare Pages e Gemini Flash.
- **Não tocar a VPS do globalnote.** A VPS está apertada (1.8GB RAM livre, 3.9GB disco). O GlobalNoticias roda 100% off-VPS.
- **MVP simples > polido.** Sem abstração pra futuro hipotético; sem feature flags.
- **Jurídico seguro:** modelo Google News — resumo original + crédito + link; nunca copiar texto da fonte.
- **PT-BR** em tudo (site e código/commits seguindo o estilo do dono).

## 3. Arquitetura

Pipeline serverless agendado, site estático em CDN. Sem servidor sempre-ligado, sem banco de dados — persistência é **JSON versionado no próprio repo Git**.

```
cron (3–6h)
   │
   ▼
GitHub Actions (runner descartável)
   ├─ roda o pipeline (Node/TS): coleta → cluster → rank → resume (Gemini Flash)
   ├─ escreve data/*.json e comita de volta (histórico de edições no Git)
   ├─ astro build  →  dist/
   └─ deploy dist/ no Cloudflare Pages (wrangler)
                         │
                         ▼
              Cloudflare Pages (CDN global, HTTPS grátis)
                         ▲
        noticias.globalnote.com.br ──CNAME──┘   (só um registro DNS; não toca a VPS)
```

**Por que esse desenho:**
- Site de leitura → estático é o ideal (SEO, velocidade, custo, resiliência).
- Job agendado num runner descartável → não consome recurso quando ocioso; sem limite de tempo de execução (ao contrário de Workers).
- JSON-on-Git como persistência → zero infra de banco, diffs legíveis, histórico de edições grátis.

## 4. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Gerador estático | **Astro** | feito pra conteúdo, ~zero JS, build rápido, output pequeno, SEO pronto |
| Linguagem pipeline | **TypeScript** (Node 24, rodado via `tsx`) | familiaridade do dev; tipos |
| IA (resumo) | **Gemini 2.x Flash (free tier)** | grátis (1.500 req/dia, 1M TPM), boa qualidade PT-BR |
| Cron + build | **GitHub Actions** | ambiente Node completo, sem limite de tempo, free (repo público = ilimitado) |
| Hospedagem | **Cloudflare Pages** | banda ilimitada no free, CDN rápido, custom domain + HTTPS automático |
| Persistência | **JSON no repo Git** | sem banco; histórico versionado de graça |
| Testes | **Vitest** | leve, rápido |
| Estilização | **Tailwind** (via Astro) | familiaridade do dev (globalnote) |

**Sem SQLite, sem Postgres, sem Redis, sem Docker.** YAGNI pro modelo serverless.

## 5. Estrutura do repositório

```
globalnoticias/
  src/                            # site Astro
    pages/
      index.astro                 # home = edição atual
      [categoria].astro           # /politica, /economia, /mundo, /tecnologia,
                                  #   /ciencia, /saude, /esportes, /entretenimento
      edicao/[data].astro         # permalink da edição do dia (arquivo)
    components/                   # Card, ListaHistorias, SeletorTema, etc.
    layouts/                      # layout base + <head> SEO
    styles/
  data/                           # persistência versionada (gerada pelo pipeline)
    current.json                  # edição atual (home + categorias)
    state.json                    # janela 48–72h: dedup + cache de resumos
    edicoes/
      2026-05-20.json             # snapshot diário
  pipeline/                       # o job de ingestão (TypeScript)
    sources.ts                    # lista curada de feeds por categoria
    fetch.ts                      # coleta + normalização dos feeds
    cluster.ts                    # agrupamento por similaridade léxica
    rank.ts                       # score e seleção do top
    summarize.ts                  # chamada Gemini + cache + fallback
    build-data.ts                 # monta current.json / edicoes / state.json
    index.ts                      # orquestra o pipeline inteiro
  .github/workflows/
    update.yml                    # cron + pipeline + commit + build + deploy
  astro.config.mjs
  package.json
  tsconfig.json
```

## 6. Pipeline de ingestão (detalhe)

Orquestrado por `pipeline/index.ts`, rodado pelo Action (e local via `pnpm pipeline`).

### 6.1 Coleta (`fetch.ts`)
- Lê `sources.ts` (feeds por categoria).
- Busca cada feed com **timeout individual** (ex: 10s) e try/catch — feed morto é logado e ignorado, não derruba o run.
- Parser de RSS/Atom (ex: `rss-parser`).

### 6.2 Normalização
Cada item vira um objeto canônico:
```ts
type Article = {
  id: string;            // hash estável da URL
  url: string;
  source: string;        // "G1", "Agência Brasil", ...
  title: string;
  description: string;   // texto do feed (não republicado como conteúdo final)
  imageUrl?: string;     // imagem do feed, se houver
  publishedAt: string;   // ISO
  category: Category;    // do feed; fallback "geral"
  fetchedAt: string;     // ISO
};
```

### 6.3 Clustering (`cluster.ts`) — sem custo
- Considera artigos da janela recente (ex: últimas 48h).
- Similaridade **léxica**: normaliza `title + description` (lowercase, remove acentos/stopwords PT), vetoriza (bag-of-words / TF-IDF) e agrupa por **cosseno acima de um limiar**.
- Resultado: clusters; cada cluster = uma história com 1..N artigos de fontes distintas.
- Sem API de embeddings (custo zero). Melhoria futura possível: embeddings locais (Transformers.js) — fora do MVP.

### 6.4 Ranking (`rank.ts`)
- `score = w1 * nº_de_fontes_distintas + w2 * recência` (pesos ajustáveis em config).
- **Home:** top ~10 clusters por score (todas as categorias).
- **Por categoria:** top ~8 clusters cuja categoria dominante = a categoria.
- Dedup (sugestão #11): um cluster aparece **uma vez por lista** (sai naturalmente do clustering).

### 6.5 Resumo com IA (`summarize.ts`) — Gemini Flash
- Só pros clusters que entraram no top (home ∪ categorias).
- **Cache:** chave = hash das URLs dos membros do cluster. Se já existe resumo em `state.json` pra essa chave → reutiliza, **não chama a IA**. Só clusters novos/alterados consomem quota.
- Entrada pro modelo: títulos + descrições dos artigos do cluster.
- Saída (JSON estruturado):
  ```ts
  type Summary = {
    titulo: string;        // título limpo/neutro
    resumo: string;        // 2–4 frases originais, PT-BR
    porQueImporta: string; // 1 linha (sugestão #2)
  };
  ```
- **Tom neutro forçado** (sugestão #4): instrução de sistema exige factual, sem opinião/editorialização, sem inventar fatos, sinalizar incerteza quando houver.
- **Fallback / resiliência:** se a chamada falhar ou estourar quota, usa a descrição do RSS (truncada) como resumo provisório + link. O build **nunca** quebra por causa da IA.

### 6.6 Montagem dos dados (`build-data.ts`)
- Gera `current.json` (estrutura da home + listas por categoria, cada história com fontes/links).
- Atualiza/grava `edicoes/<hoje>.json` (snapshot do dia; congela quando o dia passa).
- Atualiza `state.json` (janela recente + cache de resumos), podando o que saiu da janela.

### 6.7 Formato de "história" renderizável
```ts
type Story = {
  clusterId: string;
  titulo: string;
  resumo: string;
  porQueImporta: string;
  category: Category;
  sources: { name: string; url: string }[];   // multi-fonte (sugestão #3)
  imageUrl?: string;
  updatedAt: string;
};
```

## 7. Categorias

`politica | economia | mundo | tecnologia | ciencia | saude | esportes | entretenimento`
(definidas como enum/const compartilhado entre pipeline e site).

## 8. Site (Astro)

### 8.1 Páginas
- **`/`** — edição atual: ~10 manchetes top + blocos resumidos por categoria.
- **`/[categoria]`** — top ~8 histórias da categoria.
- **`/edicao/[data]`** — permalink congelado da edição daquele dia (sugestão #6; cobre "as duas coisas" da decisão A3 = home contínua + arquivo diário). Geradas a partir de `data/edicoes/*.json`.

### 8.2 Componente de história
Título → resumo → **"Por que importa"** → linha de fontes com links → horário. Imagem da fonte quando houver; senão, texto-first.

### 8.3 SEO (prioridade — tráfego orgânico é o jogo)
- `@astrojs/sitemap` (sitemap.xml).
- `<head>`: title/description por página, Open Graph, Twitter card.
- JSON-LD `NewsArticle` por história e `ItemList` nas listas.
- URLs limpas; `<link rel="canonical">` por edição.

### 8.4 UX
- Estilo "leitura" limpo (referência Google News / Techmeme): cards, tipografia boa, foco no texto, **mobile-first**.
- **Dark mode** com toggle (JS client mínimo, respeita `prefers-color-scheme`).
- **Espaço de anúncio reservado** no layout, **AdSense desativado** no MVP (ativa quando houver tráfego).
- Mockups visuais serão definidos na fase de implementação do frontend (skill frontend-design).

## 9. CI/CD e DNS

### 9.1 `.github/workflows/update.yml`
- Gatilhos: `schedule` (cron **a cada 4h**, em UTC — dentro da faixa 3–6h aprovada; ajustável) + `workflow_dispatch` (manual).
- `concurrency` pra evitar runs sobrepostos.
- Passos: checkout → setup Node + pnpm → install → **roda pipeline** (`GEMINI_API_KEY` via Secrets) → **commit de `data/`** se houver mudança → `astro build` → **deploy** do `dist/` no Cloudflare Pages (`wrangler`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` via Secrets).
- Se o pipeline não gerar novidade → pula o deploy (mantém o último site bom).
- **Repo público** → minutos de Actions ilimitados; nenhum segredo no código (só em Secrets). (Se o dono preferir privado: ~500 min/mês de uso, dentro dos 2000 grátis.)

### 9.2 DNS
- `noticias.globalnote.com.br` → **CNAME** pro domínio do projeto no Cloudflare Pages (`<projeto>.pages.dev`).
- A definir na implementação: **onde o DNS de globalnote.com.br é gerenciado** (registro.br / Cloudflare / HostGator). Adicionar o CNAME **não toca a VPS**.
- Lançamento faseável: subir primeiro no `*.pages.dev` grátis; plugar o subdomínio depois.

### 9.3 Segredos necessários (GitHub Secrets)
- `GEMINI_API_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 10. Resiliência e erros

| Falha | Comportamento |
|---|---|
| Um feed fora do ar / lento | timeout + skip; run continua com os demais |
| Gemini falha / estoura quota | fallback pra descrição do RSS + link; build não quebra |
| Pipeline sem novidade | não faz deploy; mantém último site publicado |
| Cron atrasa (carga GitHub) | aceitável; conteúdo só atualiza um pouco mais tarde |
| Site estático | sempre no ar, independente da saúde do pipeline |

## 11. Testes

- **Unitários (Vitest)** nas funções puras: similaridade/clustering, ranking, normalização de RSS, geração da chave de cache do resumo, montagem do `current.json`.
- **Manual:** `pnpm pipeline` contra feeds reais + `astro dev` pra validação visual antes de publicar.
- MVP enxuto — não mockar tudo; focar lógica pura.

## 12. Escopo

**No MVP:**
- Fontes: RSS de portais BR + Agência Brasil/EBC (CC) — sugestão #1.
- Clustering + ranking por cobertura/recência.
- Resumos via Gemini Flash com tom neutro (#4), "por que importa" (#2) e multi-fonte (#3).
- Home + 8 categorias + edições-permalink (#6).
- Dedup visual (#11).
- SEO sério.
- Design limpo + dark mode.
- Espaço de anúncio reservado (AdSense off).

**Depois (não no MVP):**
- Newsletter "Resumo do dia" (#5).
- PWA + push (#7).
- Modo áudio/TTS (#8).
- Busca (#9).
- Ativar AdSense.
- Domínio próprio (se sair do subdomínio).

**Fora de escopo:**
- Indicador de viés/espectro das fontes (#10).
- Auto-hospedagem de imagens.
- Cadastro/login de usuário.
- Scraping direto e APIs pagas de notícias.

## 13. Sanidade de custo

- Gemini free: 1.500 req/dia, 1M TPM. Uso estimado: ~30–60 clusters novos por run × ~6 runs/dia ≈ **360 req/dia** (menos com cache). Folga grande.
- GitHub Actions: repo público = ilimitado.
- Cloudflare Pages: banda ilimitada no free.
- **Total: R$0/mês.**

## 14. Riscos conhecidos

- **Tráfego orgânico demora** (SEO leva semanas/meses). Expectativa honesta.
- **Qualidade do clustering léxico** pode agrupar/separar errado em casos difíceis; ajustável via limiar; embeddings locais é o próximo nível se necessário.
- **Mudança de free tier** (Gemini/Cloudflare/GitHub) é possível; arquitetura mantém o resumidor atrás de uma interface pra trocar de provedor (ex: Groq, Claude Haiku) com facilidade.
- **Scheduled workflow do GitHub** pode ser desabilitado após 60 dias sem atividade no repo — o commit de `data/` a cada run conta como atividade, mantendo vivo.
