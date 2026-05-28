# Brief para Claude Code — Próximas melhorias no GlobalNoticias

> **Como usar:** abra este projeto no Claude Code e mande:
>
> `Leia BRIEF.md, monte um plano de execução para o Item #1 (cluster + IDF) usando plan mode, e me mostre antes de começar. Não toque em código sem aprovação.`
>
> Trabalhe **um item por vez**. Depois de cada um: commit + `pnpm test` verde + revisão visual de `data/current.json`.

---

## Contexto do projeto (resumo, pra orientar o Claude Code)

- **Produto:** agregador de notícias PT-BR — coleta RSS de portais brasileiros, agrupa matérias da mesma história, resume com IA neutra (Groq `openai/gpt-oss-20b`), publica site Astro estático.
- **Deploy:** GitHub Actions cron a cada 4h → commit dos JSON em `data/` → `astro build` → Cloudflare Pages.
- **URL pública:** `https://noticias.globalnote.com.br`.
- **Stack:** Astro 6 + Tailwind 4 (site) · TypeScript/Node 22 (pipeline) · Vitest (testes) · Groq (IA) · Cloudflare Pages (hospedagem).
- **Princípios não-negociáveis:**
  - Custo R$0 — não introduzir embeddings pagos, banco, servidor sempre-ligado.
  - Modelo Google News — nunca copiar texto da fonte, sempre creditar e linkar.
  - O build nunca quebra por causa da IA — fallback obrigatório em toda chamada externa.

## Estado do projeto (auditoria de 27/05/2026)

Estrutura sólida, sem bugs críticos. Pipeline com bom isolamento de responsabilidades, testes unitários cobrindo o core (5 arquivos, ~30 casos), CI já rodando `pnpm test` antes do build. SEO bem cuidado (JSON-LD honesto, sitemap, RSS, IndexNow, breadcrumbs). Imagens com `onerror="this.remove()"` defensivo. Concorrência do GH Actions tratada com `concurrency.group: pipeline` + `cancel-in-progress: false` + `git push` resiliente.

**O que precisa melhorar é refinamento de qualidade do conteúdo gerado**, não arquitetura.

---

## Item #1 — CRÍTICO: clustering junta histórias diferentes

**Arquivos:** `pipeline/cluster.ts` (raiz) · `pipeline/cluster.test.ts` (cobertura) · indireto: `pipeline/summarize.ts` (vítima)

**Sintoma reconfirmado em `data/current.json` da edição 2026-05-27:** história da home com título *"México, EUA e Canadá reforçam protocolos sanitários contra ebola para a Copa do Mundo"*, mas as 4 fontes clusterizadas falam de coisas distintas (Athletico-PR receber dinheiro por convocação, quem ganhou seguidores, Palmeiras nas oitavas, teste físico da bola). A IA inventou "ebola" pra reconciliar o cluster errado.

**Raiz técnica:**
- `DEFAULT_THRESHOLD = 0.22` em `cluster.ts:10` é baixo demais.
- Vetor é TF puro (linhas 40–48), sem IDF — palavras frequentes ("Copa", "Mundo", "Brasil", "morto") pesam igual a entidades raras.
- Greedy de uma passada agrupa pelo primeiro grupo que passa do threshold, sem reconsiderar.
- Janela de 48h é ampla pra editorias com eventos frequentes do mesmo tema (Copa, eleição).

**O que mudar (uma coisa de cada vez, com teste pra cada):**

1. **Aplicar IDF** aos vetores. Calcular IDF sobre o corpus do run em `clusterArticles` antes do loop e multiplicar `tf * idf` no `termFreq` (ou pós-processar). Termos como "Brasil" e "ano" perdem peso automaticamente.
2. **Subir `DEFAULT_THRESHOLD`** pra 0.40 (testar com fixtures reais; ajustar entre 0.35 e 0.50). Provavelmente vai ter que subir depois do IDF (o cosseno fica mais alto pra histórias realmente iguais).
3. **Gate de entidades nomeadas** antes de aceitar a união: extrair palavras com inicial maiúscula no meio do título (locais, nomes próprios, números) e exigir pelo menos 1 coincidência entre o artigo candidato e o cluster. Regex simples basta: `/\b[A-ZÀ-Ý][a-zà-ÿ]+/g`.
4. **Estreitar janela pra 24h** (`DEFAULT_WINDOW_HOURS`) — opcional, testar depois.

**Aceite:**
- Novo teste em `cluster.test.ts` com fixtures das 4 manchetes da Copa do Mundo acima — devem cair em 3+ clusters distintos.
- Manter o teste atual `agrupa títulos parecidos e separa os diferentes` verde (não regredir o caso feliz: ex.: 3 manchetes sobre o mesmo escândalo político devem continuar juntas).
- Rodar o pipeline com `data/state.json` limpo (`echo '{}' > /tmp/state.bak && mv data/state.json /tmp/state.bak && pnpm pipeline`) e revisar `data/current.json` na mão: ≥80% dos clusters da home têm fontes coerentes entre si.

**Atenção:** este item invalida resumos cacheados em `data/state.json`. Esperar 24-48h pro cache rolar OU limpar `state.json` no commit do fix (documentar no commit message).

---

## Item #2 — Validador anti-alucinação no resumo

**Arquivos:** `pipeline/summarize.ts` · `pipeline/summarize.test.ts`

**Justificativa:** mesmo com o Item #1 melhorando o clustering, ainda vai acontecer da IA introduzir entidades não-mencionadas. O system prompt já diz *"Não invente fatos, nomes ou números"* (linha 71), mas não há verificação automática.

**O que adicionar:**

1. Função `validateSummary(summary, input)` em `summarize.ts`:
   - Extrai palavras com inicial maiúscula (≥4 chars) do `summary.titulo`.
   - Verifica que cada uma aparece literalmente em pelo menos uma `input.artigos[].title` ou `.description`.
   - Retorna `{ ok: true }` ou `{ ok: false, missing: [...] }`.
2. No loop de `summarizeClusters` (linhas 272+):
   - Após gerar, validar.
   - Se inválido, **regerar uma vez** com um `prompt+` adicional explicando o erro: *"Você usou as seguintes entidades que não aparecem nas fontes: X, Y. Reescreva sem elas."*
   - Se a segunda tentativa também falhar, cair no `fallbackSummary` e logar.
3. Métrica nova em `SummarizeStats`: `hallucinationRejected: number`.

**Aceite:**
- Teste em `summarize.test.ts` que injeta um `Summarizer` mock retornando título com entidade inventada — espera-se: 2 chamadas ao mock, depois fallback.
- Stat `hallucinationRejected` registrada e logada no `index.ts:48` junto com as outras.

---

## Item #3 — Teste de integração end-to-end do pipeline

**Arquivos novos:** `pipeline/integration.test.ts` · `pipeline/__fixtures__/feeds/*.xml`

**Justificativa:** os testes unitários são bons mas não pegam regressões na composição (alguém muda o `toStory`, o tipo permanece compatível, o JSON final fica errado). Especialmente importante depois dos Itens #1 e #2.

**O que fazer:**

1. Criar 3-5 fixtures de RSS em `pipeline/__fixtures__/feeds/`: um com matérias claramente da mesma história, um com matérias parecidas-mas-diferentes (caso de regressão do Item #1), um com mídia/imagens em formatos variados, um com encoding latin1.
2. Mockar `fetch` (Vitest tem `vi.stubGlobal`) pra servir as fixtures pra `fetchAllSources`.
3. Mockar `Summarizer` com respostas determinísticas (ou usar fallback) pra testar sem depender de Groq.
4. Rodar o pipeline inteiro (`fetch → cluster → rank → summarize → buildEdition`) e validar o `Edition` resultante:
   - Tem o número certo de stories na home.
   - Cada story tem fontes coerentes (todas vieram de matérias com termos sobrepostos).
   - JSON final é válido contra o schema do tipo `Edition`.

**Aceite:**
- Novo teste passa.
- Tempo total da suíte continua < 5s.

---

## Item #4 — Limpeza do repositório

**Arquivos:** `.gitignore` · `dist/` (remover do tracking) · `goo11.png` (deletar) · `docs/RESTAURAR.md` (revisar)

**O que fazer:**

1. Confirmar que `dist/` está no `.gitignore`. Se está mas foi commitado antes:
   ```
   git rm -r --cached dist/
   git commit -m "chore: remover dist/ do tracking (build é regenerado no CI)"
   ```
2. Remover `goo11.png` da raiz (2 MB de captura/wireframe perdido):
   ```
   git rm goo11.png
   ```
3. Verificar se `docs/RESTAURAR.md` ainda está atualizado com os passos atuais.

**Aceite:**
- `git status` limpo após os fixes.
- `git ls-files | grep -E "^(dist|goo11)"` não retorna nada.

---

## Item #5 — Cobertura de teste pra arquivos sem teste

**Arquivos sem cobertura:**
- `src/lib/topics.ts` — NER por título, slugify, validação de tema. Lógica não-trivial, afeta URLs públicas.
- `src/lib/seo.ts` — JSON-LD gerado. Afeta tráfego orgânico.
- `pipeline/social.ts` — não-crítico (cai silenciosamente), mas o `hashtagsFor`, `tagFacets` (offset em bytes UTF-8!) e `clip` são lógica que regride fácil.
- `pipeline/indexnow.ts` — trivial, pode ficar sem teste.

**O que fazer:** arquivos `*.test.ts` correspondentes com pelo menos os casos:

- `topics.test.ts`: `slugifyTopic` (acento, espaço, símbolo); `candidatesFrom` (extração de runs capitalizados com conectores); `isValidTopic` (rejeita GENERIC, rejeita 1 palavra curta, aceita "Copa do Mundo"); o pipeline `topics` filtra por `MIN_STORIES` e marca `indexable` por `INDEX_MIN`.
- `seo.test.ts`: snapshot de `websiteJsonLd`, `itemListJsonLd`, `newsArticleJsonLd`, `breadcrumbJsonLd` com uma fixture de Story.
- `social.test.ts`: `hashtagsFor` (categoria conhecida vs. desconhecida); `tagFacets` (offset em bytes pra texto com emoji/acentos); `clip` (corta no limite, adiciona reticência).

**Aceite:**
- Cobertura nova entra na suíte e passa.
- `pnpm test` continua < 5s.

---

## Critérios transversais

- **Cada item:** um commit por mudança lógica, mensagem clara, teste novo ou ajuste de teste existente.
- **CI verde antes do merge:** `pnpm test` precisa passar.
- **Não regredir:** rodar `pnpm pipeline` localmente e diffar `data/current.json` antes/depois. Mudanças no clustering vão mudar resumos — confirmar que o que mudou faz sentido.
- **Sem custo novo:** nada de dependência paga, nada de chamada extra à IA fora do que já existe.
- **Sem mexer no Cloudflare/GitHub Actions** sem aviso — o workflow está delicado (push resiliente, concurrency, IndexNow condicional). Mudanças ali só com plano explícito.

## Itens NÃO priorizados (decisão consciente)

- **Pré-processar imagens próprias** (baixar e servir do Cloudflare) — trade-off ruim no MVP (custo + complexidade). O `onerror="this.remove()"` já mitiga.
- **Fontes RSS faltando em Saúde/Esportes** — adicionar fonte é trivial mas afeta clustering; fazer depois do Item #1.
- **Refazer a paleta/UX** — não há demanda.
- **Newsletter (Buttondown)** — já tem o componente; só falta criar conta e configurar `NEWSLETTER.buttondownUser`. Não é trabalho de Claude Code.

## Onde começar

Atacar na ordem 1 → 2 → 3 → 4 → 5. Os itens #1 e #2 melhoram a qualidade percebida do site. #3 dá rede de segurança pros próximos. #4 e #5 são higiene.

**Pergunte ao usuário antes de começar o Item #1:** *"Posso limpar `data/state.json` no mesmo commit do fix de clustering (pra forçar regeneração imediata dos resumos com a lógica nova)?"* — sem essa permissão, o resultado só aparece depois de 24-48h conforme o cache rola.
