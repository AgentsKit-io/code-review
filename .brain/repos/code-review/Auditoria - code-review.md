---
tipo: global
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "comparação das notas v1 (commit 4f37050) com o código em 5580f8b por leitura estática e git grep; doc-bridge 1.12.0 usado para confirmar módulos e checks. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - src/campaign-runner.ts
  - src/campaign-store.ts
  - scripts/review-campaign.mjs
  - scripts/review-cycle.mjs
  - agents/code-review/reporters.ts
  - src/cli.ts
  - src/acp-cli-adapter.ts
  - src/public-config.ts
  - apps/docs/README.md
  - apps/docs/wrangler.toml
  - action.yml
  - package.json
  - README.md
  - docs/OPERATIONS.md
  - docs/adr/README.md
  - docs/adr/0008-verification-posture.md
  - agents/code-review/lenses.ts
tags: [guia, repo/code-review, camada/ferramenta]
---

# Auditoria - code-review

> [!tldr] Em linguagem comum
> Lista do que as notas antigas deste repositório diziam de errado ou incompleto, do que a própria documentação do repo diz que não bate com o código, e das suspeitas que ainda precisam de confirmação.

← [[00 Hub - code-review]]

## Auditoria v2 — 2026-10-16

Auditor independente, contra o commit `4c442c0` (o código-fonte é idêntico ao de `5580f8b`/`4f37050`: o diff entre eles só toca `.brain/`). Método: script que extrai toda citação `` `arquivo:linha` `` e confere existência do arquivo e a linha; conferência de símbolos citados perto de cada referência; leitura do código nas linhas para as afirmações principais de cada nota; `git cat-file` em todo SHA citado; conferência de que cada comando de validação existe em `package.json`/workflow. Nada longo foi executado (nenhum teste, build ou provedor).

**Notas auditadas:** 28 (hub, 7 pacotes, 1 app, índice de decisões + 10 ADRs, 3 fluxos, 4 guias, esta auditoria).

**Referências conferidas:** 896 citações `arquivo:linha` antes das correções (941 depois, contando as citações adicionadas por esta auditoria; a re-execução do script no fim resultou em 0 inexistentes e 0 fora de faixa); 0 arquivos inexistentes e 0 linhas fora do arquivo. 72 SHAs distintos citados, todos existem no repositório. ~440 citações com símbolo em backticks por perto foram cruzadas com o conteúdo da linha; os poucos casos sem correspondência literal eram nomes de variável/flag descritos no texto (conferidos à mão).

**Referências erradas ou imprecisas corrigidas:** 6 (nenhuma quebrada). Exemplos: `agents/code-review/lenses.ts:202` (comentário diz que `DEFAULT_PROTECTED_SUBJECTS` fica em `src/review-config.ts`; a constante está em `agents/code-review/lenses.ts:204`); versão da API do GitHub citada em `src/github-api-client.ts:3` (a constante `GITHUB_API_VERSION` está em `:4`); `tsx`/`esbuild` citados em `package.json:127` (início de `dependencies`; estão em `:135`/`:136`); `createAutoCliAdapter` coberto por `src/index.ts:126` (está em `:134`); símbolos de config pública (`validateConfig`, `configFingerprint`, `toReviewConfig`, `ReviewConfigSchema`) sem linha própria.

### Afirmações corrigidas

| Nota | O que estava errado | O que é certo | Evidência |
|---|---|---|---|
| code-review-providers | "O prompt vai por stdin" para as CLIs locais | Só Codex, Claude Code e ACP usam stdin; o transporte *headless* de Grok e OpenCode passa o prompt como **argumento** | `src/grok-cli-adapter.ts:35`, `src/opencode-cli-adapter.ts:56`, `src/codex-adapter.ts:117`, `src/claude-code-adapter.ts:68` |
| code-review-providers | Prompt "pede sempre" o envelope `{"schemaVersion":1,...,"findings":[]}` | Há dois formatos: com `completedCategories`+`analysis` quando o schema da ferramenta os tem | `src/acp-cli-adapter.ts:40`–`:42` |
| code-review-providers | "Todos exportados na raiz" | `diagnoseProvider` não é exportado; os adaptadores headless estão em `src/index.ts:134` | `src/index.ts:82`–`:136` |
| code-review-scm | Versão `2022-11-28` da API citada como `src/github-api-client.ts:3` | A constante está em `:4` (`:3` é a URL base) | `src/github-api-client.ts:3`, `:4` |
| code-review-memory | Aponta só que a constante não existe em `src/review-config.ts` | Também diz onde ela está: `agents/code-review/lenses.ts:204` (comentário de `:202` desatualizado) | `agents/code-review/lenses.ts:202`, `:204` |
| code-review-quality | Telemetria "nunca leva prompts, diffs ou credenciais" sem ressalva | Só eventos de progresso; `contentLogging` inclui a nota curta de fase; entrega falha em silêncio | `src/telemetry.ts:63`–`:66`, `:99` |
| code-review-engine | Linha dos exports de config pública incompleta (`validateConfig`, `configFingerprint`, `toReviewConfig`, `ReviewConfigSchema` sem linha) | Linhas `:146`, `:150`, `:163`, `:22` de `src/public-config.ts` | `src/public-config.ts` |
| code-review-engine | `tsx`/`esbuild` em `package.json:127` | `:135`/`:136` | `package.json` |
| Code Review - Da mudança ao parecer | "Preflight do provedor: `doctor` com smoke test se `health-check=auto`" | O teste ao vivo só existe para `codex-cli`; APIs não passam por preflight | `src/cli.ts:457`, `:465`, `src/provider-registry.ts:284` |
| Code Review - Da mudança ao parecer | Síntese omitia o veredito com só `med`/`nit` | `COMMENT` | `agents/code-review/agent.ts:1262` |
| Auditoria (frontmatter) | `tipo: guia` | `tipo: global`, conforme a tarefa e `CONVENTIONS.md` | — |

### Afirmações removidas por não verificáveis

- code-review-engine e Hub: "o Harness declara usar o code-review como etapa de revisão". Neste repositório o README só cita o Harness como produto separado (`README.md:216`, `README.md:514`). Reescrito como "não verificável neste repo".

### Lacunas de cobertura

- Todos os workspaces têm nota: pacote raiz `@agentskit/code-review` (dividido em 7 notas de módulo) e `apps/docs` (`code-review-docs`). Os 10 arquivos `docs/adr/00NN-*.md` têm nota de ADR; `docs/adr/README.md` é coberto pelo índice de decisões. Fluxos principais existem (CLI, ciclo de PR, campanha).
- Adicionado: o hook pre-commit (`.pre-commit-hooks.yaml`) estava sem menção; entrou em code-review-engine.
- Sem nota própria (listadas, não escritas, por serem ferramentas e não pacotes): `scripts/check-public-api.mjs` + `docs/stability/public-api-v1.json` (só aparece nos guias de validação); `scripts/capture-quality-baseline.mjs`, `scripts/run-cycle-benchmark.mjs` e `docs/baseline-protocol.md` (só indiretamente em code-review-quality); `scripts/generate-llms-full.mjs`, `scripts/*readme-standard*` e `ecosystem*.json` (tooling de documentação); `docs/provider-compatibility.{json,md}` (citado em code-review-providers como coberto por teste). Sugestão: uma nota única "Contratos de estabilidade e ferramentas de documentação".
- Links `[[agentskit-core]]`, `[[00 Hub - fleet]]`, `[[00 Hub - harness]]`, `[[00 Hub - Ecossistema AgentsKit]]` etc. apontam para notas fora desta pasta do vault; não resolvíveis aqui (não foram alterados).

### Utilidade para agentes

Cada nota de pacote tem arquivo de entrada, lista de testes e comando de validação; os comandos citados existem (`npm run check`, `check:public-api`, `docs:web:build`, `harness:faults`, `benchmark:cycle`, `test:coverage`, `docs:index`, `npm pack --dry-run`). Fraqueza restante: code-review-action lista como testes `test/documentation.test.mjs`, `release-workflow` e `cli-smoke`, mas só `documentation.test.mjs` referencia `action.yml`; não há teste de contrato dedicado dos inputs da Action.

### Veredito de confiança por nota

| Nota | Confiança | Motivo |
|---|---|---|
| 00 Hub - code-review | alta | Referências e comandos conferidos; deploy ativo do site segue como dúvida declarada |
| code-review-engine | alta | Pipeline, votos, exit codes, limites e env conferidos linha a linha; uma afirmação externa removida |
| code-review-providers | média | Uma afirmação errada corrigida; dúvida do envelope ACP continua aberta; Ollama/headless só em parte lidos |
| code-review-scm | alta | Leituras, escritas, marcador e readiness conferidos |
| code-review-campaign | alta | Executor, lease, checkpoint e divergências ADR-0002 confirmados por `git grep` de chamadores |
| code-review-memory | alta | Limites, schemas e "nenhum caminho aprova candidato" confirmados |
| code-review-quality | média | `review-cycle.mjs` é grande; amostra de ~25 trechos verificada, restante por referência |
| code-review-action | alta | `action.yml` lido por inteiro; sem teste dedicado (ressalva acima) |
| code-review-docs | média | Config e deploy conferidos; páginas/componentes do site só por existência de arquivo |
| 00 Decisões - code-review | alta | Datas de `git log --diff-filter=A` conferidas |
| ADR-0001, 0008, 0010 | alta | Comparadas por inteiro com o `docs/adr` correspondente e com o código citado |
| ADR-0002 a 0007, 0009 | média | Datas, citações de código e "Consequências" conferidas; corpo dos `docs/adr` lido só em trechos |
| Fluxo - Da mudança ao parecer | alta | Uma linha corrigida; resto conferido |
| Fluxo - Ciclo completo de um PR | média | Ver code-review-quality |
| Fluxo - Retomar campanha e aprender | alta | Conferido contra runner, preflight e campanha |
| Guia - Validar uma mudança | alta | Comandos e fontes (`ci.yml`, `package.json`) conferidos |
| Guia - Publicar uma versão | alta | Conferido contra `publish.yml` e `docs/OPERATIONS.md` |
| Guia - Rodar uma revisão | média | Flags conferidas no código; comandos `npx github:` não executados |
| Guia - Adicionar um provedor | média | Passos conferidos contra `provider-registry.ts`/`cli.ts`; nenhuma adição real simulada |
| Auditoria - code-review (v1 abaixo) | alta | Itens 1–9 e divergências do repo reconferidos |

## Erros e lacunas das notas v1

| # | Nota v1 | O que dizia | O que o código mostra |
|---|---|---|---|
| 1 | Code Review - Retomar campanha e aprender | "Efeitos externos usam chaves de idempotência" no executor | O executor (`src/campaign-runner.ts:75`) não chama `recordExternalEffect`/`shouldApplyExternalEffect`; só testes e `src/fault-injection.ts` usam. A idempotência real vem do marcador no GitHub e do cache/metadados do ciclo. |
| 2 | code-review-campaign | Reducer/replay apresentados como parte do executor | O executor mantém um relatório selado próprio (`src/campaign-runner.ts:34`) e não usa `transitionCampaign`. |
| 3 | code-review-campaign | "Grava estado em campaigns/<hash>/execution.json" | Correto, mas omitia leases em `leases/`, `runs/<pr>/` e o checkpoint de eventos separado (`src/campaign-store.ts:39`). |
| 4 | code-review-docs | "Export estático para deploy via Wrangler" como único caminho | Há dois caminhos: Vercel (`apps/docs/README.md:3`) e Cloudflare (`apps/docs/wrangler.toml:1`). |
| 5 | code-review-action | Não mencionava que a Action roda `tsx src/cli.ts` (sem build) | `action.yml:120`, `package.json:96`. |
| 6 | Todas | Sem o ciclo de um PR (`review-cycle.mjs`), que é quem publica e **faz merge** | `scripts/review-cycle.mjs:414`; agora em [[code-review-quality]] e [[Code Review - Ciclo completo de um PR]]. |
| 7 | Todas | Sem notas para provedores e SCM, embora sejam fronteiras de ADR | Agora [[code-review-providers]] e [[code-review-scm]]. |
| 8 | Hub v1 | "README fala em contratos de campanha como fase futura" | README diz que execução e persistência "são adicionadas por fases posteriores" (`README.md:440`), mas o próprio README já documenta checkpoints e leases logo abaixo; a lacuna real é o item 2. |
| 9 | Todas | `fontes` prefixadas com `code-review/` e repetidas | v2 usa caminhos relativos ao repo, conforme `CONVENTIONS.md` e a tarefa; o integrador deve conferir se `verify-refs` espera o prefixo. |

## Divergências na documentação do próprio repo

- Versão: README/OPERATIONS/exemplos dizem `0.31.x`/`v0.31.0` (`README.md:494`, `docs/OPERATIONS.md:620`); `package.json:3` é `0.32.2`.
- Índice de ADRs: ADR-0008 "pending a live A/B" (`docs/adr/README.md:14`) vs. padrão já promovido (`docs/adr/0008-verification-posture.md:65`).
- `docs/OPERATIONS.md:328` promete desfechos "merge blocked, merged"; o comando de campanha só devolve `APPROVED`/`CHANGES_REQUESTED` para PRs executados (`scripts/review-campaign.mjs:109`).
- `docs/OPERATIONS.md:431` descreve a deduplicação incremental do `githubInlineReporter`; a CLI publica por `scmReviewReporter` (`src/cli.ts:301`), sem essa deduplicação.
- Comentário em `agents/code-review/lenses.ts:202` manda sincronizar com `src/review-config.ts`, que não tem `DEFAULT_PROTECTED_SUBJECTS`.
- A Action e a CLI têm padrões de `--block` diferentes: `high` (`action.yml:35`) vs `blocker` (`src/cli.ts:318`) — documentado nas notas, não é bug.

## Suspeitas a confirmar

- Envelope ACP/headless rejeitaria verificação/consolidação (`src/acp-cli-adapter.ts:11`) — ver [[code-review-providers]].
- Campos da config pública sem leitor: `merge.requireCleanReview`, `requireCurrentSha`, `requireSuccessfulChecks`, `requireNoChangesRequested`, `forbidForce`, `execution.cleanupTemporaryArtifacts`, `report.format`, `report.includeEveryDiscoveredPullRequest`, `report.redactSecrets`, `feedback.learnFrom*`, `target.projectId` (`src/public-config.ts:96`, `src/public-config.ts:106`, `src/public-config.ts:113`, `src/public-config.ts:71`, `src/public-config.ts:27`). Os gates de merge acontecem de qualquer forma no ciclo, independentes desses flags.
