---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "análise estática do código em 5580f8b; doc-bridge 1.12.0 (`ak-docs list knowledge`) listou os módulos de campanha; chamadores conferidos com `git grep`; nenhuma campanha foi executada."
fontes:
  - src/campaign-runner.ts
  - src/campaign-store.ts
  - src/campaign-reducer.ts
  - src/campaign-preflight.ts
  - src/domain-contracts.ts
  - src/fault-injection.ts
  - src/index.ts
  - scripts/review-campaign.mjs
  - src/public-config.ts
  - package.json
  - README.md
  - docs/OPERATIONS.md
  - docs/for-agents/code-review.md
  - docs/adr/0002-deterministic-campaign-engine.md
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-campaign

> [!tldr] Em linguagem comum
> Coordena a revisão de todos os pull requests abertos de um repositório: primeiro decide, sem chamar IA, quais podem ser revisados; depois revisa um de cada vez (ou poucos em paralelo), guardando o andamento em disco para continuar do ponto certo se o processo cair, e no fim diz para cada PR se foi aprovado, pediu mudanças, foi pulado, bloqueado ou cancelado.

← [[00 Hub - code-review]]

## O que faz e por que existe

Tira da IA a responsabilidade pelo estado da orquestração: estado e retomada são determinísticos, modelos só fazem análise semântica ([[code-review ADR-0002 - Motor de campanha determinístico]]). Há **duas camadas** no código, e convém não confundi-las:

1. **Executor em produção** — `executeCampaign` (`src/campaign-runner.ts:75`), usado pelo comando `agentskit-review-campaign` (`scripts/review-campaign.mjs:85`). Guarda um `CampaignExecutionReport` selado por fingerprint em `campaigns/<sha256(campaignId)>/execution.json` (`src/campaign-runner.ts:54`), com lease da campanha e lease por PR renovados por heartbeat.
2. **Motor de eventos** — contratos (`src/domain-contracts.ts`), reducer puro `transitionCampaign`/`replayCampaign` (`src/campaign-reducer.ts:43`, `src/campaign-reducer.ts:113`) e checkpoint com log de eventos e chaves de efeito externo (`src/campaign-store.ts:11`). Exportado na API pública e exercitado por testes e pelo harness de falhas (`src/fault-injection.ts:6`), mas **não chamado** pelo executor nem pelos scripts.

Preflight (`preflightCampaign`, `src/campaign-preflight.ts:37`) é comum: valida config, saúde do provedor e capacidades SCM, descobre PRs, aplica elegibilidade e planeja cada PR sem modelo (`modelCalls: 0`, `src/campaign-preflight.ts:26`).

## API e contratos

| Símbolo | Tipo | Para que serve | Onde |
|---|---|---|---|
| `preflightCampaign(input)` | função async → `CampaignPreflightReport` | Descoberta + elegibilidade + plano por PR | `src/campaign-preflight.ts:37` |
| `blockedCampaignPreflightReport`, `CampaignPreflightReportSchema`, `CampaignPreflightEntrySchema` | função/schemas | Relatório bloqueado e contratos | `src/campaign-preflight.ts:33`, `src/campaign-preflight.ts:24`, `src/campaign-preflight.ts:17` |
| `executeCampaign(input)` | função async → `CampaignExecutionReport` | Fila limitada (1–16), leases, retomada, desfecho determinístico | `src/campaign-runner.ts:75`, `src/campaign-runner.ts:91` |
| `CampaignExecutionReportSchema`, `campaignReportDeliveryFailed` | schema/função | Relatório selado; marcar falha de entrega | `src/campaign-runner.ts:34`, `src/campaign-runner.ts:71` |
| `acquireCampaignLease`, `renewCampaignLease`, `releaseCampaignLease`, `writeLeasedJson`, `writeAtomicJson` | funções | Exclusão mútua por diretório + escrita atômica com fsync | `src/campaign-store.ts:136`, `src/campaign-store.ts:202`, `src/campaign-store.ts:185`, `src/campaign-store.ts:213`, `src/campaign-store.ts:51` |
| `createCampaignCheckpoint`, `loadCampaignCheckpoint`, `saveCampaignCheckpoint`, `appendCampaignEvent`, `recordExternalEffect`, `shouldApplyExternalEffect`, `pendingReviewUnitIds` | funções | Checkpoint de eventos (camada 2) | `src/campaign-store.ts:222`, `src/campaign-store.ts:226`, `src/campaign-store.ts:234`, `src/campaign-store.ts:245`, `src/campaign-store.ts:251`, `src/campaign-store.ts:262`, `src/campaign-store.ts:258` |
| `transitionCampaign`, `replayCampaign`, `createCampaignEngineState`, `CampaignEngineStateSchema` | reducer | Única autoridade de transição na camada 2 | `src/campaign-reducer.ts:43`, `src/campaign-reducer.ts:113`, `src/campaign-reducer.ts:26`, `src/campaign-reducer.ts:14` |
| `ReviewIdentitySchema`, `reviewIdentityFingerprint`, `CampaignContractSchema`, `PullRequestRunContractSchema`, `ReviewUnitContractSchema`, `CampaignEventSchema`, `DomainFailureSchema`, `BudgetEnvelopeSchema` | Zod v1 | Contratos de domínio | `src/domain-contracts.ts:12`, `src/domain-contracts.ts:123`, `src/domain-contracts.ts:51`, `src/domain-contracts.ts:63`, `src/domain-contracts.ts:75`, `src/domain-contracts.ts:102`, `src/domain-contracts.ts:44`, `src/domain-contracts.ts:31` |
| CLI `agentskit-review-campaign` | binário | `--config`, `--output`, `--quality-output`, `--pull`, `--mode`, `--post`, `--merge`, `--preflight-only`, `--automation-id` | `package.json:9`, `scripts/review-campaign.mjs:20` |

Desfechos: PR `SKIPPED|BLOCKED|APPROVED|CHANGES_REQUESTED|MERGE_BLOCKED|MERGED|CANCELLED`; campanha `COMPLETE|PARTIAL|BLOCKED|CANCELLED` (`src/domain-contracts.ts:8`, `src/domain-contracts.ts:9`).

**Exemplo real** — o comando de campanha (`scripts/review-campaign.mjs:85`):

```js
report = process.argv.includes('--preflight-only') ? preflight : await executeCampaign({
  preflight, stateRoot, campaignId, concurrency: config.execution.maxConcurrentPullRequests,
  continueAfterPerPrFailure: config.execution.continueAfterPerPrFailure, resume: config.execution.resumeIncompleteRuns,
  signal: campaignAbort.signal, pullRequestLeaseTtlMs: Math.min(workerTimeoutMs + 60_000, 120_000),
  ...
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Usa | [[code-review-engine]] — `createCodeReviewAgent(...).plan()` e `planReviewBatches` no preflight (`src/campaign-preflight.ts:108`, `src/campaign-preflight.ts:120`) |
| Usa | [[code-review-scm]] — `discover`/`metadata`/`reviewState`/`diff` (`src/campaign-preflight.ts:56`) |
| Usa | [[code-review-providers]] — `diagnoseProvider` estático (`scripts/review-campaign.mjs:70`) |
| Delegação por PR | [[code-review-quality]] — cada PR roda `scripts/review-cycle.mjs` como processo filho (`scripts/review-campaign.mjs:103`) |
| Agrega qualidade | `evaluateCampaignQuality` ([[code-review-quality]], `scripts/review-campaign.mjs:139`) |
| Consumidor externo | Automação Orca do time (`ORCA_AUTOMATION_ID`, `scripts/review-campaign.mjs:24`; ver [[00 Hub - fleet]]) |

## Dados e efeitos

- **Estado em disco** sob `execution.statePath` (padrão `.agentskit/review-state`, `src/public-config.ts:111`), relativo ao arquivo de config (`scripts/review-campaign.mjs:80`):
  - `campaigns/<hash>/execution.json` — relatório selado do executor (`src/campaign-runner.ts:54`).
  - `leases/<hash(chave)>/lease.json` com guarda `.guard` por PID (`src/campaign-store.ts:40`, `src/campaign-store.ts:84`).
  - `runs/<owner-repo>-<pr>-<runId16>/` com `cycle-summary.json`, `quality-report.json`, `orca-evidence.json` (`scripts/review-campaign.mjs:96`).
  - `campaigns/<id>/quality-matrix.json` quando `--quality-output` não é dado (`scripts/review-campaign.mjs:140`).
  - (camada 2) `campaigns/<hash>/checkpoint.json` (`src/campaign-store.ts:39`).
- **Variáveis:** `GITHUB_TOKEN` ou `gh auth token` (`scripts/review-campaign.mjs:71`), repassada ao filho (`scripts/review-campaign.mjs:105`); `ORCA_AUTOMATION_ID` opcional. Segredos do ambiente (chaves com TOKEN/KEY/SECRET/…) são redigidos dos erros (`scripts/review-campaign.mjs:19`, `scripts/review-campaign.mjs:108`).
- **Rede/efeitos:** só através do ciclo filho; `--post` e `--merge` precisam ser passados explicitamente e são repassados a cada PR (`scripts/review-campaign.mjs:21`, `scripts/review-campaign.mjs:103`).
- **Saída:** JSON no stdout; exit 0 só com `COMPLETE` (ou preflight `ready`), senão 2 (`scripts/review-campaign.mjs:149`).

## Como mexer (para agentes)

- **Comece por:** `scripts/review-campaign.mjs` → `src/campaign-runner.ts`; para o motor de eventos, `src/campaign-reducer.ts` e `src/campaign-store.ts` juntos (`docs/for-agents/code-review.md:57`).
- **Invariantes:**
  - Todo PR descoberto termina em exatamente um desfecho; entradas `running` de execução interrompida voltam a `pending` na retomada (`src/campaign-runner.ts:114`).
  - Identidade da campanha inclui versão do pacote e o preflight sem `generatedAt`; checkpoint de outra identidade ou manifesto de PRs diferente é recusado (`src/campaign-runner.ts:102`, `src/campaign-runner.ts:103`).
  - Falha de persistência devolve `state: 'running'` com `error`, nunca um terminal falso (`src/campaign-runner.ts:192`).
  - Elegibilidade: aberto, não draft, não fork, base = `target.baseBranch`, não Dependabot, autor permitido (`src/campaign-preflight.ts:77`).
  - No reducer: sequência estrita, estado terminal imutável, desfecho de sucesso só com todas as unidades `COMPLETED` (`src/campaign-reducer.ts:48`, `src/campaign-reducer.ts:89`).
- **Testes:** `test/campaign-preflight.test.mjs`, `test/campaign-runner.test.mjs`, `test/campaign-store.test.mjs`, `test/campaign-reducer.test.mjs`, `test/domain-contracts.test.mjs`, `test/fault-injection.test.mjs`.
- **Validação:** `npm run check`; para o harness de falhas, `npm run harness:faults` (`package.json:105`).
- **Armadilhas:**
  - O campo `partial` do resumo de campanha é fixado em 0 (`scripts/review-campaign.mjs:130`).
  - `--merge` sem `merge.enabled` bloqueia no preflight do ciclo, não na campanha.
  - Uma execução reaproveitada lê `cycle-summary.json` com `decision: 'COMPLETE'` e não revisa de novo (`scripts/review-campaign.mjs:100`).

## Decisões e história

- [[code-review ADR-0002 - Motor de campanha determinístico]] — reducer puro como autoridade; "o ciclo procedural atual é substituído incrementalmente" (`docs/adr/0002-deterministic-campaign-engine.md:20`).
- [[code-review ADR-0003 - Fronteiras de modelo e SCM]], [[code-review ADR-0007 - Contabilidade do ciclo inteiro]].

| Data | Commit | O quê |
|---|---|---|
| 2026-09-27 | 1946c9e | Processos via cross-platform (#318) |
| 2026-09-13 | 7aba7df | Zod 4 (#284) |
| 2026-09-10 | 4da5164, 70d20dc, 4c00bc8 | Reconciliar publicação; ciclos limitados e medidos (#246, #235, #231) |
| 2026-09-10 | 955953c, 16459cd, 5848b22, 604ebf2, 66eba5f | Recuperar leases de PR, respeitar lotes no preflight, rodar checkpoints obsoletos, gates de evidência, prazos configuráveis |
| 2026-09-09 | 294512f, db8748a, 10b67fb, d0bab4f, 0ba0311 | Modo propagado, comando dono das mutações, matrizes de qualidade, campanhas retomáveis, preflight determinístico |

> [!info]- Detalhe técnico
> - Lease: diretório criado com `mkdir` exclusivo; lease expirado é reciclado; guarda abandonada (PID morto ou > 30 s) é recuperada com `.reclaim` (`src/campaign-store.ts:84`, `src/campaign-store.ts:97`).
> - Heartbeat a cada TTL/3; falha de renovação aborta a execução (`src/campaign-runner.ts:132`).
> - TTL da lease de PR ≤ 120 s na CLI de campanha (`scripts/review-campaign.mjs:89`).
> - Checkpoint de eventos é validado refazendo o replay e comparando fingerprints (`src/campaign-store.ts:44`).

> [!bug] Existe, mas ninguém usa
> - O motor de eventos (`transitionCampaign`, `replayCampaign`, `appendCampaignEvent`, `saveCampaignCheckpoint`, `recordExternalEffect`, `shouldApplyExternalEffect`, `pendingReviewUnitIds`) só tem chamadores em testes e em `src/fault-injection.ts`; o executor de produção usa outro formato de estado.
> - Os desfechos `MERGED` e `MERGE_BLOCKED` existem no contrato (`src/domain-contracts.ts:9`), mas o comando de campanha só devolve `APPROVED` ou `CHANGES_REQUESTED` para PRs executados, mesmo quando o ciclo fez merge (`scripts/review-campaign.mjs:109`). `docs/OPERATIONS.md:328` promete os dois.
> - `execution.cleanupTemporaryArtifacts` e `report.format`/`report.includeEveryDiscoveredPullRequest`/`report.redactSecrets` são aceitos na config (`src/public-config.ts:110`, `src/public-config.ts:113`) e não lidos por nenhum código.
