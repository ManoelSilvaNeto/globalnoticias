# GlobalNotícias

Site agregador/curador **automático** de notícias em PT-BR. Coleta feeds RSS de
veículos brasileiros, agrupa as matérias que contam a mesma história, ranqueia por
cobertura + recência, resume com IA (tom neutro) e publica um site estático,
organizado por categorias — sempre com crédito e link para a fonte.

> _As notícias que importaram hoje, resumidas e sem enrolação — com link pra fonte._

## Como funciona (custo R$0, 100% off-VPS)

```
cron 4h ─> GitHub Actions ─> pipeline (coleta → cluster → rank → resume)
                                   │
                                   ├─ escreve data/*.json e commita (histórico no Git)
                                   ├─ astro build → dist/
                                   └─ deploy no Cloudflare Pages
```

- **Sem servidor sempre-ligado e sem banco**: a persistência é JSON versionado no
  próprio repositório (`data/`).
- **IA atrás de uma interface trocável** (`Summarizer`): hoje Gemini Flash; dá pra
  trocar por Groq/Claude. Sem `GEMINI_API_KEY`, cai num resumo de fallback (descrição
  do RSS) e o build nunca quebra.

## Stack

Astro + Tailwind (site) · TypeScript/Node (pipeline) · Vitest (testes) ·
GitHub Actions (cron) · Cloudflare Pages (hospedagem) · Gemini Flash (resumo).

## Estrutura

```
src/          site Astro (pages, components, layouts, lib compartilhada)
data/         persistência gerada pelo pipeline (current.json, state.json, edicoes/)
pipeline/     ingestão: sources, fetch, cluster, rank, summarize, build-data, index
.github/      workflow de cron + build + deploy
```

## Comandos

| Comando        | O que faz                                                  |
| -------------- | ---------------------------------------------------------- |
| `pnpm test`    | Testes unitários (Vitest)                                  |
| `pnpm pipeline`| Roda a ingestão e gera `data/*.json`                       |
| `pnpm build`   | Build do site estático em `./dist/`                        |
| `pnpm dev`     | Dev server local (`localhost:4321`)                        |

## Segredos (GitHub Actions)

- `GEMINI_API_KEY` — Google AI Studio (free tier). Sem ela, usa fallback.
- `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` — deploy no Pages. Sem eles, o
  workflow roda tudo e só pula o passo de deploy.

## Restauração / recuperação

Como rodar localmente, voltar a uma versão antiga ou recriar a produção do zero:
veja **[docs/RESTAURAR.md](docs/RESTAURAR.md)**.

## Jurídico

Modelo Google News: resumo **original** + crédito + link. Nunca republica o texto
das fontes. Os direitos das matérias pertencem aos veículos citados.
