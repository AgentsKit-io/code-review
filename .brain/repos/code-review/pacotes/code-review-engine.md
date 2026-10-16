---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "análise estática do código em 5580f8b; doc-bridge 1.12.0 (`ak-docs index` + `ak-docs query package code-review --agent`) usado para editRoot `.`, startHere e checks; nada de revisão real, teste ou provedor foi executado. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - src/cli.ts
  - src/index.ts
  - src/review-config.ts
  - src/public-config.ts
  - src/review-policy.ts
  - src/budget.ts
  - src/batch-mode.ts
  - src/batch-coverage.ts
  - agents/code-review/agent.ts
  - agents/code-review/sources.ts
  - agents/code-review/risk.ts
  - agents/code-review/lenses.ts
  - agents/code-review/reporters.ts
  - src/campaign-preflight.ts
  - package.json
  - docs/for-agents/code-review.md
  - docs/OPERATIONS.md
  - README.md
  - AGENTS.md
  - GOVERNANCE.md
  - action.yml
  - docs/adr/0009-layered-language-rules.md
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-engine

> [!tldr] Em linguagem comum
> É o revisor propriamente dito: pega o que mudou (um diff, um PR, arquivos ou um trecho colado), monta pacotes pequenos de contexto, pede a uma IA uma análise em várias dimensões, manda outras chamadas "céticas" tentarem derrubar cada suspeita e só mostra o que sobrou — dizendo claramente quando a revisão ficou incompleta.

← [[00 Hub - code-review]]

## O que faz e por que existe

É a raiz do pacote `@agentskit/code-review` (não é um pacote npm separado; a nota agrupa a CLI `src/cli.ts` e o agente vendorizado `agents/code-review/`). Responsabilidades:

- **CLI `agentskit-review`** (`package.json:8`): lê flags, resolve configuração confiável, escolhe a fonte e o provedor, monta reporters e decide o código de saída (`src/cli.ts:177`).
- **Agente de revisão** `createCodeReviewAgent` (`agents/code-review/agent.ts:430`): vendorizado do [[00 Hub - agentskit-registry]] (`README.md:251`); dono do pipeline plano → pacotes → análise → verificação → limiares → consolidação.
- **Fontes** (`agents/code-review/sources.ts:466`): git diff, PR via SCM, caminhos, stdin e snapshot isolado, com negação de caminhos sensíveis e redação de segredos.
- **Risco determinístico** (`agents/code-review/risk.ts:21`): classifica cada pacote como `low|normal|high|critical` e acrescenta uma análise especializada para `high`/`critical`.
- **Orçamentos hierárquicos e lotes** (`src/budget.ts:150`, `src/batch-mode.ts:9`, `src/batch-coverage.ts:95`).
- **Reporters** Markdown, SARIF e publicação via SCM (`agents/code-review/reporters.ts:84`, `agents/code-review/reporters.ts:147`, `agents/code-review/reporters.ts:211`).
- **Hook pre-commit** opcional: `.pre-commit-hooks.yaml:1` registra `agentskit-review` (estágio `manual`, `always_run`, sem `pass_filenames`) para rodar a CLI sobre o diff do repositório.

Limites: não escolhe nem implementa modelos (isso é [[code-review-providers]] sobre [[agentskit-adapters]]); não fala HTTP com o GitHub diretamente (isso é [[code-review-scm]]); não orquestra vários PRs ([[code-review-campaign]]).

O problema que resolve: revisão por IA barulhenta e não confiável. A resposta do código é (1) contexto diff-first limitado, (2) saída estruturada validada por Zod, (3) verificação adversarial, (4) nunca tratar ausência de evidência como aprovação (`incomplete` força `COMMENT`, `agents/code-review/agent.ts:1262`).

## API e contratos

| Símbolo | Tipo | Para que serve | Onde |
|---|---|---|---|
| `createCodeReviewAgent(config)` | função → `{ name, run, plan, setAdapter, asHandle }` | Cria o agente; `plan()` é preflight sem provedor, `run()` executa | `agents/code-review/agent.ts:430`, `agents/code-review/agent.ts:1559` |
| `CodeReviewConfig` | interface | Fonte, lentes, votos, limiares, orçamento, contexto, `verification.posture`, `rules.*` | `agents/code-review/agent.ts:277` |
| `ReviewResult` / `ReviewEvidence` / `ReviewPlan` | interfaces | Veredito, `blocking`, `incomplete`, `coverage`, contadores de chamadas | `agents/code-review/agent.ts:213`, `agents/code-review/agent.ts:241`, `agents/code-review/agent.ts:119` |
| `Finding` | interface | Achado tipado; `verification: 'unverified'` quando o cético não chegou a veredito | `agents/code-review/agent.ts:87`, `agents/code-review/agent.ts:108` |
| `Severity` / `Category` | tipos | `blocker|high|med|nit`; 7 dimensões | `agents/code-review/agent.ts:55`, `agents/code-review/agent.ts:56` |
| `builtInLenses(enabled)` | função | Seleciona as 7 lentes embutidas (conventions tem teto `nit`) | `agents/code-review/agent.ts:425`, `agents/code-review/agent.ts:422` |
| `ReviewPreflightError`, `ReviewDeadlineError`, `ReviewExecutionError` | classes | Recusa de plano, prazo e "nenhuma lente funcionou" | `agents/code-review/agent.ts:163`, `agents/code-review/agent.ts:189`, `agents/code-review/agent.ts:197` |
| `markdownReporter`, `renderMarkdown`, `sarifReporter`, `scmReviewReporter`, `renderGithubWalkthrough` | funções | Saídas | `agents/code-review/reporters.ts:84`, `agents/code-review/reporters.ts:96`, `agents/code-review/reporters.ts:147`, `agents/code-review/reporters.ts:211`, `agents/code-review/reporters.ts:112` |
| `githubSummaryReporter`, `githubInlineReporter` | funções | Reporters de compatibilidade GitHub (o inline deduplica por IoU de linhas) | `agents/code-review/reporters.ts:239`, `agents/code-review/reporters.ts:257` |
| `defineConfig`, `validateConfig`, `loadProjectConfig`, `generateConfigSchema`, `presets`, `toReviewConfig`, `configFingerprint`, `ReviewConfigSchema` | config pública | `code-review.config.{ts,mjs,js}` versão 1; subpath `./config` | `src/public-config.ts:142` (`defineConfig`), `src/public-config.ts:146` (`validateConfig`), `src/public-config.ts:150` (`configFingerprint`), `src/public-config.ts:154` (`generateConfigSchema`), `src/public-config.ts:163` (`toReviewConfig`), `src/public-config.ts:193` (`presets`), `src/public-config.ts:246` (`loadProjectConfig`), `src/public-config.ts:22` (`ReviewConfigSchema`), `src/index.ts:1`, `package.json:16` |
| `compileReviewBudget`, `defaultReviewBudget`, `createReviewBudgetLedger`, `ReviewBudgetExceededError` | orçamento | Hierarquia campanha › PR › pacote/análise/verificação | `src/budget.ts:52`, `src/budget.ts:58`, `src/budget.ts:150`, `src/budget.ts:136` |
| CLI `agentskit-review` | binário | Flags em `HELP` | `src/cli.ts:43` |

Exit codes (CLI): `0` revisão completa sem bloqueio, `1` achado ≥ `--block` sobreviveu, `2` revisão incompleta ou falha (`src/cli.ts:401`, `src/cli.ts:542`). `--no-fail` só neutraliza o caso `1`.

**Exemplo real** — a campanha usa o agente só para planejar, sem provedor (`src/campaign-preflight.ts:108`):

```ts
const review = createCodeReviewAgent({
  source: { kind: 'scm', adapter: input.adapter, ref, diff, collectErrors: true, redact: true, limits: { maxFiles: 500, maxBytes: 25 * 1024 * 1024, maxFileBytes: 1024 * 1024 } },
  reporters: [], lenses: builtInLenses(...),
  ...
})
const planned = await review.plan()
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Usa provedores | [[code-review-providers]] — `buildAdapter` (`src/cli.ts:409`) |
| Usa SCM | [[code-review-scm]] — `createGithubScmAdapter` (`src/cli.ts:252`), `loadScmTargets` (`agents/code-review/sources.ts:314`) |
| Usa memória | [[code-review-memory]] — `loadApprovedReviewRules` e regras por linguagem (`agents/code-review/agent.ts:718`, `agents/code-review/agent.ts:723`) |
| Consumido por | [[code-review-action]] (`action.yml:120`), [[code-review-quality]] (o `review-cycle` invoca a CLI, `scripts/review-cycle.mjs:269`), [[code-review-campaign]] (preflight, `src/campaign-preflight.ts:108`) |
| Consumido fora do repo | O pacote é a API pública (`src/index.ts:113`). Que [[00 Hub - harness]] use a revisão não é verificável neste repo (o README só cita o Harness como produto separado, `README.md:216`) |
| Dependência AgentsKit | [[agentskit-core]] (`compileBudget`, `buildMessage`, `agents/code-review/agent.ts:1`; `redactSecrets`, `agents/code-review/sources.ts:6`), [[agentskit-runtime]] (`createRuntime`, `agents/code-review/agent.ts:663`), [[agentskit-tools]] (`defineZodTool`, `agents/code-review/agent.ts:3`), [[agentskit-ink]] (`createProgressObserver`, `src/cli.ts:17`), [[agentskit-cross-platform]] (`toPosix`, `agents/code-review/sources.ts:5`) |
| Externas relevantes | `zod` 4, `esbuild` (carregar `code-review.config.ts`, `src/public-config.ts:221`), `tsx` (Action) (`package.json:135`, `package.json:136`) |

## Dados e efeitos

- **Lê:** `git diff --unified=0 base...HEAD` no cwd (`agents/code-review/sources.ts:303`); arquivos do disco em `--paths`/snapshot com negação de `.git`, `node_modules`, `dist`, `.env*`, chaves e certificados (`agents/code-review/sources.ts:43`, `agents/code-review/sources.ts:44`); `.agentskit-review.json` (`src/review-config.ts:241`) ou `--config` (`src/cli.ts:207`); convenções automáticas `CONVENTIONS.md`/`CONTRIBUTING.md`/`.cursorrules`/`AGENTS.md`, truncadas em 6000 caracteres (`src/cli.ts:525`).
- **Grava:** `--sarif <file>`, `--result <file>` (modo `0600`), `--batch-manifest`, `--consolidate-manifest` (`src/cli.ts:298`, `src/cli.ts:397`, `src/cli.ts:357`, `src/cli.ts:202`). Nada é persistido como memória de conversa: `memory: undefined` no runtime (`agents/code-review/agent.ts:663`).
- **Variáveis de ambiente:** `GITHUB_TOKEN` (obrigatória com `--pr`, `src/cli.ts:153`), `CI` (ativa regras de CI, `src/cli.ts:210`), `LLM_API_KEY` e `<PROVIDER>_API_KEY` (`src/cli.ts:448`), `CLAUDE_CODE_OAUTH_TOKEN`, `XAI_API_KEY`, `OPENCODE_API_KEY` (`src/cli.ts:415`, `src/cli.ts:418`, `src/cli.ts:429`). Depois de resolver a fonte, a CLI **apaga** `GITHUB_TOKEN`, `GH_TOKEN` e `GITLAB_TOKEN` do ambiente para que nenhum provedor os herde (`src/cli.ts:257`).
- **Rede:** provedor de IA; GitHub API via [[code-review-scm]].
- **Redação:** obrigatória quando a fronteira do provedor é `remote` ou `unknown`, salvo `--allow-unredacted` local (`src/cli.ts:127`); proibida em CI (`src/review-config.ts:173`).
- **Delimitação anti-injeção:** fonte e achados vão entre marcadores aleatórios por execução `CR-DATA-<hex>` (`agents/code-review/agent.ts:500`).

## Como mexer (para agentes)

- **Comece por:** `docs/for-agents/code-review.md` (startHere do doc-bridge), depois `src/cli.ts` (flags/saída) ou `agents/code-review/agent.ts` (lógica).
- **Invariantes:**
  - Uma chamada estruturada por pacote normal; `maxSteps` = 1 (`agents/code-review/agent.ts:455`) — ver [[code-review ADR-0010 - Chamadas de passo único]].
  - Achado precisa estar em linha alterada quando há diff; senão é rejeitado pelo schema (`agents/code-review/agent.ts:964`).
  - `incomplete` sempre que há arquivo `UNREVIEWED`, lente obrigatória ausente, prazo estourado ou achado `unverified` (`agents/code-review/agent.ts:1548`); prazo estourado também liga `blocking` (`agents/code-review/agent.ts:1265`).
  - Tokens checados com `compileBudget` antes de qualquer chamada (`agents/code-review/agent.ts:593`).
  - Lentes obrigatórias padrão: correctness, security, tests (`agents/code-review/agent.ts:438`); não podem ser desligadas sem `incompleteProfile` (`src/review-config.ts:170`).
  - Config de projeto não pode definir provider/model/transport/context/trustMode/redaction/permissions em CI (`src/review-config.ts:130`, `src/review-config.ts:158`).
- **Testes por parte:** pipeline e votos `test/adaptive-verification.test.mjs`, `test/multidimensional-analysis.test.mjs`, `test/risk-depth.test.mjs`; fontes `test/sources.test.mjs`, `test/sources-context.test.mjs`, `test/context-packs.test.mjs`; orçamento `test/budget.test.mjs`, `test/budget-lookahead-and-deadline-salvage.test.mjs`; lotes `test/batch-mode.test.mjs`, `test/batch-coverage.test.mjs`; config `test/review-config.test.mjs`; reporters `test/reporters.test.mjs`, `test/scm-review-reporter.test.mjs`; CLI fim a fim offline `test/cli-smoke.test.mjs`; superfície `test/public-api-surface.test.mjs`; ordem de campos `test/tool-schema-order.test.mjs`.
- **Validação:** `npm run check` (inclui typecheck, build, testes, gates doc-bridge, typecheck do site, `check:public-api`, `--help`, README standard — `package.json:116`) e `npm pack --dry-run` (`AGENTS.md:15`). Mudou export? `npm run check:public-api:update` e commite o snapshot (`package.json:110`).
- **Armadilhas:**
  - Mudança de flag/reporter/Action exige atualizar README, `docs/OPERATIONS.md` e testes juntos (`AGENTS.md:11`).
  - `--post` em lote parcial é proibido (`src/cli.ts:365`); só `--publish-result` publica o consolidado, e reconfere SHA e fingerprint (`src/cli.ts:285`).
  - O padrão de `--block` na CLI é `blocker` (`src/cli.ts:318`), na Action é `high` (`action.yml:35`).
  - `verification.posture`, `rules.*` e `context.grouping` não têm flag de CLI nem chave em `.agentskit-review.json`; só via API (`docs/adr/0009-layered-language-rules.md:47`).
  - Entrada do ciclo precisa continuar livre de efeitos colaterais no import (`docs/for-agents/code-review.md:53`).
- **Quem revisa:** não há CODEOWNERS no repo; ver `GOVERNANCE.md`.

## Decisões e história

- [[code-review ADR-0001 - Provedores e CLIs com contratos limitados]] — trust modes, limites de entrada, exit codes, marcador GitHub.
- [[code-review ADR-0004 - Contexto diff-first e orçamentos]] — pacotes limitados e uma análise multidimensional.
- [[code-review ADR-0006 - Lotes medidos antes da execução]] — `planReviewBatches` divide por arquivo e depois por pacote.
- [[code-review ADR-0007 - Contabilidade do ciclo inteiro]] — tetos `--run-token-ceiling`/`--run-call-ceiling` (`src/cli.ts:333`).
- [[code-review ADR-0008 - Postura de verificação conservadora]] — `conservative` é o padrão (`agents/code-review/agent.ts:472`).
- [[code-review ADR-0009 - Regras por linguagem em camadas]] — `rules.enabled` falso por padrão (`agents/code-review/agent.ts:476`).
- [[code-review ADR-0010 - Chamadas de passo único]].

Mudanças recentes (`git log --oneline -15` nos arquivos do motor):

| Data | Commit | O quê |
|---|---|---|
| 2026-10-03 | aa8d0fb | Cliente REST do GitHub endurecido (#334) |
| 2026-10-02 | 5db8225 | Redação passa a usar `redactSecrets` do core (#327) |
| 2026-10-02 | 4d56dca | Requisições GitHub via [[agentskit-net]] (#323) |
| 2026-09-27 | 1946c9e | Portabilidade de processos/caminhos via cross-platform (#318) |
| 2026-09-27 | f7db2fb | Revisão incompleta não recebe marcador de publicada (#317) |
| 2026-09-13 | 7aba7df | Migração para Zod 4 e `z.toJSONSchema` (#284) |
| 2026-09-12 | 3ad2dde | Postura `conservative` vira padrão após A/B (#280) |
| 2026-09-12 | ddd45be, d1d12df, c84f640, 2f24d47, 41587b6, 0c98986, 96c1f3a, a792ed7 | Release 0.31: lookahead de orçamento, postagem incremental, SARIF com fingerprints, agrupamento semântico, regras por linguagem, manifesto selado, cético assimétrico, `analysis` antes do veredito |

> [!info]- Detalhe técnico
> - Pipeline `review()`: preparo `agents/code-review/agent.ts:1428`, lookahead de orçamento `agents/code-review/agent.ts:1463`, análise `agents/code-review/agent.ts:1476`, verificação `agents/code-review/agent.ts:1520`, limiares `agents/code-review/agent.ts:1528`, consolidação `agents/code-review/agent.ts:1533`.
> - Votos: rodada 1 para todos; rodada 2 para `high`+ ou `med` com confiança < 0,9; rodada 3 só se as duas primeiras divergirem (`agents/code-review/agent.ts:1181`, `agents/code-review/agent.ts:1185`). Sobrevive quem tem refutações × 2 ≤ votos — empate sobrevive (`agents/code-review/agent.ts:1200`).
> - Verificação grande demais: divide o lote ao meio; candidato único reduz linhas vizinhas pela metade até 0 (`agents/code-review/agent.ts:1140`).
> - Arquivo grande demais vira pacotes por bisseção de linhas (`agents/code-review/agent.ts:939`).
> - Risco: `critical` = security/credentials/migration ⇒ análise extra de correctness+security; `high` = contrato público/IO/controle do repo ⇒ correctness (`agents/code-review/risk.ts:44`, `agents/code-review/risk.ts:48`).
> - PR: por padrão 40 arquivos, metadados até 500, 1 MiB por arquivo na CLI (`agents/code-review/sources.ts:18`, `agents/code-review/sources.ts:19`, `src/cli.ts:163`); HTML alterado puxa até 4 CSS não alterados como contexto (`agents/code-review/sources.ts:385`).
> - Falha de autenticação do provedor é terminal para a execução inteira (`agents/code-review/agent.ts:691`).
> - Fork com `--post`: imprime `SKIPPED` e sai com 2 (`src/cli.ts:270`).
> - Política de fingerprint exclui só `concurrency` (`src/review-policy.ts:15`).

> [!bug] Existe, mas ninguém usa
> - `jsonReporter` (`agents/code-review/reporters.ts:202`) não é exportado em `src/index.ts` nem chamado no repo.
> - `asHandle()` (`agents/code-review/agent.ts:1565`) não tem chamador no repo.
> - `githubInlineReporter` com deduplicação por sobreposição de linhas (`agents/code-review/reporters.ts:257`) é exportado, mas a CLI publica com `scmReviewReporter` (`src/cli.ts:301`), que não faz essa deduplicação — o recurso descrito em `docs/OPERATIONS.md:431` só vale para quem usa a API.
> - O CLI nunca liga `rules`, `verification.posture` explícito, `context.grouping: 'semantic'` nem telemetria; tudo isso só via API.
