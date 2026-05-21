# Como restaurar o GlobalNotícias

Guia de recuperação (cold-start e disaster-recovery). Nenhum segredo está aqui —
os valores sensíveis ficam nos *Secrets* do GitHub e no seu gerenciador de senhas.

---

## O que está garantido no Git × o que vive fora

| Item | Onde está | Recuperável só com `git clone`? |
|---|---|---|
| Código (site + pipeline + testes + workflow) | repositório | ✅ sim |
| Conteúdo e **histórico** de edições (`data/`) | repositório (commitado a cada run) | ✅ sim |
| Spec, plano e este guia (`docs/`) | repositório | ✅ sim |
| Chaves/secrets (Gemini, Cloudflare) | GitHub → Secrets (write-only) | ❌ regenerar |
| Projeto Cloudflare Pages + domínio | conta Cloudflare | ❌ recriar (auto + 1 passo) |
| DNS `noticias` | registro.br | ❌ continua lá; recriar se mudar de domínio |
| `node_modules`, `dist` | gerados | ✅ `pnpm install` / `pnpm build` |

---

## A. Rodar numa máquina nova

Pré-requisitos: **Node 22+**, **pnpm 10**, **git**.

```bash
git clone https://github.com/ManoelSilvaNeto/globalnoticias.git
cd globalnoticias
pnpm install

pnpm test                 # roda os testes
GEMINI_API_KEY=xxxx pnpm pipeline   # gera data/*.json (sem a chave, usa fallback)
pnpm build                # gera dist/
pnpm dev                  # preview local em http://localhost:4321
```

> O site lê `data/current.json` e `data/edicoes/*.json`. Esses arquivos já vêm no
> repo, então `pnpm build` funciona mesmo sem rodar o pipeline.

---

## B. Voltar a uma versão anterior (algo quebrou)

```bash
git log --oneline                 # acha o commit bom
git revert <hash>                 # desfaz um commit específico (seguro)
# ou, para inspecionar um estado antigo sem alterar a história:
git checkout <hash> -- caminho/do/arquivo
```

Cada edição publicada é um commit, então dá pra recuperar qualquer dia/versão.

---

## C. Recriar a PRODUÇÃO do zero (conta nova / repo novo)

1. **Repositório** (público = Actions ilimitado):
   ```bash
   gh repo create globalnoticias --public --source=. --remote=origin --push
   ```
   > Push de arquivos em `.github/workflows/` exige o escopo `workflow` no `gh`:
   > `gh auth refresh -h github.com -s workflow`.

2. **Secrets** (GitHub → Settings → Secrets and variables → Actions):
   - `GEMINI_API_KEY` — gerar em https://aistudio.google.com/apikey (free).
   - `CLOUDFLARE_API_TOKEN` — em https://dash.cloudflare.com/profile/api-tokens →
     Create Custom Token → permissão **Account › Cloudflare Pages › Edit**.
   - `CLOUDFLARE_ACCOUNT_ID` — no painel Cloudflare → Workers & Pages → "Account ID".

   Via CLI: `gh secret set NOME` (cola o valor quando pedir).

3. **Deploy**: dê `git push` (ou rode o workflow manualmente). O workflow
   `Atualizar e publicar` cria o projeto Pages `globalnoticias` no 1º deploy e publica.
   Sem os secrets do Cloudflare, ele roda tudo e só pula o deploy.

4. **Domínio** `noticias.globalnote.com.br`:
   - No **registro.br** (DNS): adicionar `CNAME` `noticias` → `globalnoticias.pages.dev.`
   - No **Cloudflare Pages**: adicionar o domínio custom no projeto (painel
     "Custom domains", ou via API `POST /accounts/{id}/pages/projects/globalnoticias/domains`).
   - SSL é emitido automático em alguns minutos.

5. **SEO**:
   - A tag de verificação do Google Search Console já está no `src/layouts/Layout.astro`.
   - No Search Console, verificar a propriedade e enviar `sitemap-index.xml`.
   - IndexNow (Bing/Yandex) já roda sozinho no workflow (chave em `public/`).

---

## D. Referência rápida

- **Hospedagem:** Cloudflare Pages, projeto `globalnoticias` (produção = branch `main`).
- **Cron:** `.github/workflows/update.yml`, a cada 4h (UTC) + push + manual.
- **IA:** modelo `gemini-2.5-flash` (o `gemini-2.0-flash` **não** tem cota free nessa
  chave). Trocar via variável `GEMINI_MODEL`. Ritmo: var `GEMINI_THROTTLE_MS` (padrão 6s).
- **Fontes:** `pipeline/sources.ts`.
- **URL canônica/sitemap:** `astro.config.mjs` (`site`, sobrescrevível por `SITE_URL`).

---

## E. Guarde fora do Git (seu cofre / gerenciador de senhas)

O GitHub **não devolve** o valor dos secrets depois de salvos. Mantenha em local seguro:

- valor da **`GEMINI_API_KEY`**
- valor do **`CLOUDFLARE_API_TOKEN`**
- (o `CLOUDFLARE_ACCOUNT_ID` está visível no painel da Cloudflare, não precisa decorar)
