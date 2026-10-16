---
tipo: guia
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "comparação das notas v1 (commit 4f37050) com o código em 5580f8b por leitura estática e git grep; doc-bridge 1.12.0 usado para confirmar módulos e checks."
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
