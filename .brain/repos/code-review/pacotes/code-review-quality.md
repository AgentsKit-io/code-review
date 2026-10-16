---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "análise estática do código em 5580f8b; doc-bridge 1.12.0 (`ak-docs list knowledge`) listou scripts e módulos; nenhum ciclo, benchmark ou harness foi executado. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - scripts/review-cycle.mjs
  - scripts/review-harness.mjs
  - scripts/evaluate-quality.mjs
  - scripts/capture-quality-baseline.mjs
  - scripts/run-cycle-benchmark.mjs
  - scripts/run-fault-injection.mjs
  - src/harness.ts
  - src/quality-matrix.ts
  - src/quality-baseline.ts
  - src/fault-injection.ts
  - src/telemetry.ts
  - src/batch-coverage.ts
  - src/index.ts
  - package.json
  - quality/evals/default.json
  - quality/learning/default.json
  - docs/OPERATIONS.md
  - docs/adr/0007-whole-cycle-resource-accounting.md
  - docs/adr/0008-verification-posture.md
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-quality

> [!tldr] Em linguagem comum
> É o "controle de qualidade" do revisor: um roteiro que revisa um PR do começo ao fim de forma auditável (trava a versão exata do código, testa num lote piloto, mede o revisor contra casos com resposta conhecida, compara com e sem memória), e uma matriz de notas que diz se aquela execução pode ou não publicar o parecer e fazer merge.

← [[00 Hub - code-review]]

## O que faz e por que existe

Transforma "a IA revisou" em evidência mensurável. Partes:

- **Ciclo de um PR** — `agentskit-review-cycle` = `scripts/review-cycle.mjs` (`package.json:10`). Orquestra a CLI do [[code-review-engine]] como processos filhos, com contrato travado, usage journal, retomada e quality gate antes de publicar/mergear. Fluxo detalhado em [[Code Review - Ciclo completo de um PR]].
- **Harness** — `src/harness.ts` (sweep de bloqueios, estado de canário, `validateCanary`) e o CLI `agentskit-review-harness` (`scripts/review-harness.mjs`), cujo `--replay` roda um subconjunto de testes offline (`scripts/review-harness.mjs:96`).
- **Matriz de qualidade** — 14 áreas (`src/quality-matrix.ts:1`) avaliadas por `evaluateQuality`/`evaluateCampaignQuality`, com comparação contra baseline (`src/quality-matrix.ts:183`, `src/quality-matrix.ts:287`, `src/quality-matrix.ts:313`). CLI `agentskit-quality` (`package.json:12`).
- **Baselines** — schemas sintético/real/campanha (`src/quality-baseline.ts:60`, `src/quality-baseline.ts:69`, `src/quality-baseline.ts:82`).
- **Fault injection** — 7 cenários determinísticos sem credencial (`src/fault-injection.ts:137`), `npm run harness:faults`.
- **Telemetria opt-in** — `createTelemetryObserver` exporta eventos de progresso como spans OTLP/HTTP JSON ou linhas no console (`src/telemetry.ts:72`).

## API e contratos

| Símbolo | Tipo | Para que serve | Onde |
|---|---|---|---|
| `QUALITY_AREAS` | const | coverage, detection, precision, severity, actionability, comments, security, reliability, speed, token-efficiency, batch-efficiency, memory-learning, configuration, integration | `src/quality-matrix.ts:1` |
| `evaluateQuality(input)` → `QualityReport` | função | Nota por área e decisão `PASS`/`BLOCKED` | `src/quality-matrix.ts:183` |
| `evaluateCampaignQuality`, `compareQuality`, `evaluateQualityAgainstBaseline`, `blockedQualityReport`, `parseQualityInput` | funções | Campanha, regressão e relatório bloqueado | `src/quality-matrix.ts:287`, `src/quality-matrix.ts:313`, `src/quality-matrix.ts:331`, `src/quality-matrix.ts:147`, `src/quality-matrix.ts:111` |
| `validateCanary`, `assertCanaryReady`, `runBlockerSweep`, `createHarnessRun`, `recordCanaryAttempt`, `recordBatchCompletion`, `createHarnessContract`, `fingerprint` | funções | Gates do harness | `src/harness.ts:110`, `src/harness.ts:115`, `src/harness.ts:63`, `src/harness.ts:69`, `src/harness.ts:77`, `src/harness.ts:85`, `src/harness.ts:52`, `src/harness.ts:48` |
| `QualityBaselineSchema`, `parseQualityBaseline`, `qualityBaselineIdentity`, `validateStudyOutputPath` | schema/funções | Baselines | `src/quality-baseline.ts:97`, `src/quality-baseline.ts:119`, `src/quality-baseline.ts:115`, `src/quality-baseline.ts:126` |
| `runFaultInjectionHarness`, `FaultInjectionReportSchema` | função/schema | Gate de falhas | `src/fault-injection.ts:134`, `src/fault-injection.ts:27` |
| `createTelemetryObserver(options)` | função → `Observer \| undefined` | Telemetria; `undefined` se `enabled !== true` | `src/telemetry.ts:72`, `src/telemetry.ts:73` |
| `createCycleMeter`, `scoreGroundTruth`, `runQualityCorpus`, `runCycleBatches`, `scoreCorpusCases` | exports do script | Usados por testes do ciclo | `scripts/review-cycle.mjs:577`, `scripts/review-cycle.mjs:614`, `scripts/review-cycle.mjs:642`, `scripts/review-cycle.mjs:685`, `scripts/review-cycle.mjs:701` |
| CLI `agentskit-review-cycle` | binário | `--repository --pull --config` obrigatórios; `--provider` (padrão `codex-cli`), `--batch-size` 5, `--concurrency` 8, `--max-tokens` 10 M, `--post`, `--merge`, `--admin`, `--quality-baseline`, `--orca-evidence` | `scripts/review-cycle.mjs:62` |

Exportados na raiz: `src/index.ts:16`, `src/index.ts:18`, `src/index.ts:20`, `src/index.ts:80`, `src/index.ts:105`.

**Exemplo real** — o ciclo decide a qualidade e só então pode publicar (`scripts/review-cycle.mjs:393`, `scripts/review-cycle.mjs:409`):

```js
const quality = baselineReport ? evaluateQualityAgainstBaseline(input, baselineReport) : evaluateQuality(input)
...
if (quality.decision !== 'PASS') throw new Error('posting forbidden because the quality matrix is BLOCKED')
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Invocado por | [[code-review-campaign]] — um `review-cycle` por PR (`scripts/review-campaign.mjs:103`) |
| Invoca | [[code-review-engine]] — CLI com `--plan`, `--batch-index`, `--consolidate-manifest`, `--publish-result` (`scripts/review-cycle.mjs:192`, `scripts/review-cycle.mjs:269`, `scripts/review-cycle.mjs:362`, `scripts/review-cycle.mjs:410`) |
| Usa | [[code-review-scm]] (metadata, reviewState, mergeReadiness, merge), [[code-review-memory]] (cache, stores, reconciliação), [[code-review-providers]] (`doctor`) |
| Depende | [[agentskit-cross-platform]] — `spawnNodeChild`, `killProcessTree` (`scripts/review-cycle.mjs:3`) |
| Externos | `gh` (auth status, rate limit, release view), `npm view`, `codex login status` (`scripts/review-cycle.mjs:146`, `scripts/review-cycle.mjs:148`, `scripts/review-cycle.mjs:151`, `scripts/review-cycle.mjs:153`, `scripts/review-cycle.mjs:161`) |
| Consumidor externo | Automação Orca (`--orca-evidence`, `scripts/review-cycle.mjs:382`) |

## Dados e efeitos

- **Diretório da execução** (`--run-dir`, padrão `.agentskit/review-runs/<ts>-<pr>`, `scripts/review-cycle.mjs:65`): `preflight.json`, `contract.json`, `state.json`, `usage.json`, `batch-manifest.json`, `batches/batch-N.json(+.meta.json)`, `replay.json`, `quality-evaluation*/`, `learning-evaluation/`, `consolidated.json`, `memory-evidence.json`, `quality-report.json`, `quality/matrices/v<versão>-<runId>.json`, `cycle-summary.json` (`scripts/review-cycle.mjs:80`, `scripts/review-cycle.mjs:399`, `scripts/review-cycle.mjs:439`).
- **State dir** (`--state-dir`): cache de revisão e stores de memória ([[code-review-memory]]).
- **Variáveis:** `GITHUB_TOKEN` (ou `gh auth token`), repassada aos filhos (`scripts/review-cycle.mjs:101`); o ambiente inteiro é herdado pelos filhos (`scripts/review-cycle.mjs:102`), mas a CLI filha apaga os tokens SCM antes de chamar o provedor ([[code-review-engine]]).
- **Efeitos externos:** publicação no PR com `--post` e merge com `--merge` — só depois de quality `PASS` (`scripts/review-cycle.mjs:409`, `scripts/review-cycle.mjs:415`).
- **Telemetria:** `fetch` POST para `<otlpEndpoint>/v1/traces` quando habilitada com exporter `otlp` (`src/telemetry.ts:89`); só recebe eventos de progresso do observer, nunca prompts, diffs ou credenciais; `contentLogging` apenas inclui a nota curta de fase (`src/telemetry.ts:63`–`src/telemetry.ts:66`). Falha de entrega é ignorada (`src/telemetry.ts:99`).
- **Corpus empacotado:** `quality/evals/default.json` e `quality/learning/default.json` vão no tarball (`package.json:60`).

## Como mexer (para agentes)

- **Comece por:** `scripts/review-cycle.mjs` (`main`, `scripts/review-cycle.mjs:61`) e `src/quality-matrix.ts`. `evaluateCampaignQuality()` é obrigatório ao agregar desfechos de campanha (`docs/for-agents/code-review.md:26`).
- **Invariantes:**
  - Preflight junta **todos** os bloqueios antes de chamar provedor (`scripts/review-cycle.mjs:210`).
  - Contrato travado: retomada com qualquer campo diferente falha (`scripts/review-cycle.mjs:222`); o prazo global conta desde `createdAt` do contrato e não reinicia (`scripts/review-cycle.mjs:224`).
  - Uso desconhecido fica cobrado pela reserva inteira (`scripts/review-cycle.mjs:607`) — [[code-review ADR-0007 - Contabilidade do ciclo inteiro]].
  - Merge exige `--post`, quality `PASS`, veredito `APPROVE`, `mergeReadiness` pronto e head igual ao manifesto (`scripts/review-cycle.mjs:415`, `scripts/review-cycle.mjs:416`, `scripts/review-cycle.mjs:420`); `--merge` também exige `merge.enabled` (preflight) e, via `releasePass` na área `integration`, versão publicada no npm + GitHub Release fora de checkout de fonte (`scripts/review-cycle.mjs:166`, `scripts/review-cycle.mjs:154`, `scripts/review-cycle.mjs:388`).
  - Erro fatal de lote aborta os pares e espera a drenagem antes de escrever o resultado (`scripts/review-cycle.mjs:685`; `docs/for-agents/code-review.md:54`).
  - O entry point precisa funcionar via symlink do npm e importar sem efeitos colaterais (`scripts/review-cycle.mjs:706`).
- **Testes:** `test/review-cycle.test.mjs`, `test/harness.test.mjs`, `test/harness-preflight.test.mjs`, `test/quality-matrix.test.mjs`, `test/quality-matrix-cli.test.mjs`, `test/quality-baseline.test.mjs`, `test/quality-evals.test.mjs`, `test/fault-injection.test.mjs`, `test/telemetry.test.mjs`, `test/continuous-improvement.test.mjs`.
- **Validação:** `npm run check`; `npm run harness:faults`; benchmark offline `npm run benchmark:cycle` (`package.json:101`).
- **Armadilhas:** o A/B de memória roda o corpus duas vezes (com/sem memória) e conta no orçamento do ciclo; os resultados de qualidade dependem do provedor real — o fixture offline devolve veredito determinístico e não mede postura (`docs/adr/0008-verification-posture.md:40`).

## Decisões e história

- [[code-review ADR-0006 - Lotes medidos antes da execução]], [[code-review ADR-0007 - Contabilidade do ciclo inteiro]], [[code-review ADR-0008 - Postura de verificação conservadora]] (A/B ao vivo de 2026-09-12 com o corpus padrão).

| Data | Commit | O quê |
|---|---|---|
| 2026-09-27 | 1946c9e | Processos via cross-platform (#318) |
| 2026-09-12 | a50ffe6 | Adaptadores locais exportados; corpus recalibrado com provedor real (#278) |
| 2026-09-12 | 6605c26 | Telemetria OpenTelemetry opt-in (#271) |
| 2026-09-12 | c5b392c | Captura de baseline e corpus ampliado (#262) |
| 2026-09-10 | 8a1aa29, 4da5164, 3ab37e8, 4834e68, 70d20dc, 4c00bc8 | Evals do perfil full, reconciliação de publicação, abortar/drenar trabalhadores, entry point via symlink, ciclos limitados e medidos |
| 2026-09-09 | 8d3f98c, af04b40 | Harness de fault injection; política de checks e idempotência |

> [!info]- Detalhe técnico
> - Checks do canário: SHA, fingerprint de política, arquivos e pacotes do lote, execução completa, revisão completa, perfil `full`, lentes obrigatórias, sem prazo estourado (`src/harness.ts:93`).
> - Retentativa de lote só para falha transitória (timeout, ECONNRESET, 429, 5xx, rate limit) ou execução incompleta (`scripts/review-cycle.mjs:326`).
> - Pontuação contra gabarito: tolerância de 5 linhas, categoria e trechos de título opcionais (`scripts/review-cycle.mjs:620`).
> - Medidor de ciclo divide o restante do orçamento pelo paralelismo de lotes (`scripts/review-cycle.mjs:590`).

> [!question] Dúvida
> A "evidência Orca" exigida pela área `integration` é escrita pelo próprio comando de campanha com `status: 'passed'` antes de rodar o ciclo (`scripts/review-campaign.mjs:98`). Rodado sem a campanha, `orcaPass` só passa se alguém fornecer `--orca-evidence`. Não ficou claro se isso é a prova pretendida ou um autoatestado.

> [!bug] Existe, mas ninguém usa
> - `createTelemetryObserver` não é ligado pela CLI nem pelos scripts — só via API.
> - `createHarnessContract` e `assertCanaryReady` são exportados sem chamador interno (o ciclo usa `validateCanary`, `scripts/review-cycle.mjs:272`).
