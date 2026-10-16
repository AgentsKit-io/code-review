---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "análise estática do código em 5580f8b; doc-bridge 1.12.0 (`ak-docs list knowledge`) listou os módulos; nenhuma chamada ao GitHub foi feita. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - src/scm-contract.ts
  - src/github-scm-adapter.ts
  - src/github-api-client.ts
  - src/github-review-state.ts
  - src/index.ts
  - src/cli.ts
  - src/campaign-preflight.ts
  - scripts/review-cycle.mjs
  - agents/code-review/sources.ts
  - agents/code-review/reporters.ts
  - src/public-config.ts
  - docs/for-agents/code-review.md
  - docs/adr/0003-model-and-scm-adapter-boundaries.md
  - docs/OPERATIONS.md
  - examples/pull-request.yml
  - scripts/review-campaign.mjs
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-scm

> [!tldr] Em linguagem comum
> É a peça que conversa com o lugar onde ficam os pull requests (hoje só o GitHub): lista PRs, baixa o que mudou, lembra se aquela versão exata já foi revisada, publica o parecer sem duplicar comentários e, quando autorizado, faz o merge.

← [[00 Hub - code-review]]

## O que faz e por que existe

Isola tudo que é específico de SCM atrás de um contrato neutro, para que o motor determinístico não carregue payloads do GitHub ([[code-review ADR-0003 - Fronteiras de modelo e SCM]]). `src/github-scm-adapter.ts` é declarado "o único caminho migrado que pode conter payloads do GitHub ou comandos de merge" (`docs/for-agents/code-review.md:31`). GitLab aparece no enum de configuração (`src/public-config.ts:25`) mas não tem implementação; a campanha bloqueia qualquer provider diferente de `github` (`scripts/review-campaign.mjs:73`).

## API e contratos

| Símbolo | Tipo | Para que serve | Onde |
|---|---|---|---|
| `ScmAdapter` | interface | `discover`, `metadata`, `diff`, `fileContent`, `reviewState`, `publishReview`, `mergeReadiness`, `merge` | `src/scm-contract.ts:131` |
| `ScmCapabilitySchema`, `requireScmCapability`, `UnsupportedScmCapabilityError` | schema/função/classe | Capacidades explícitas; chamar algo não suportado lança erro tipado | `src/scm-contract.ts:6`, `src/scm-contract.ts:151`, `src/scm-contract.ts:144` |
| `ChangeRequestRefSchema`, `ChangeRequestDiffSchema`, `ChangeRequestMetadataSchema`, `ScmReviewStateSchema`, `ScmReviewPublicationSchema`, `ScmMergeReadinessSchema`, `ScmCheckPolicySchema`, `ScmMergeRequestSchema` | Zod | Contratos de dados | `src/scm-contract.ts:14`, `src/scm-contract.ts:44`, `src/scm-contract.ts:27`, `src/scm-contract.ts:73`, `src/scm-contract.ts:81`, `src/scm-contract.ts:100`, `src/scm-contract.ts:58`, `src/scm-contract.ts:108` |
| `createGithubScmAdapter(options)` | fábrica | Implementação GitHub (REST + `gh` para merge admin) | `src/github-scm-adapter.ts:46` |
| `GithubScmAdapterOptions` | tipo | `token`, `fetch?`, `command?`, `reviewStateChannel?` | `src/github-scm-adapter.ts:25` |

Exportados em `src/index.ts:85` e `src/index.ts:89`. `src/github-api-client.ts` e `src/github-review-state.ts` são internos (não exportados na raiz).

**Exemplo real** — a CLI cria o adaptador e consulta o estado de revisão pela fingerprint da política (`src/cli.ts:252`, `src/cli.ts:267`):

```ts
const githubAdapter = source.kind === 'github-pr' ? createGithubScmAdapter({ token: source.token, reviewStateChannel: reviewConfig.comments.summary ? 'summary' : 'review' }) : undefined
...
? await githubAdapter!.reviewState(githubRef!, policyFingerprint)
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Consumidor | [[code-review-engine]] — fonte `github-pr`/`scm` (`agents/code-review/sources.ts:314`) e `scmReviewReporter` (`agents/code-review/reporters.ts:211`) |
| Consumidor | [[code-review-campaign]] — `discover`, `metadata`, `reviewState`, `diff` no preflight (`src/campaign-preflight.ts:56`, `src/campaign-preflight.ts:93`) |
| Consumidor | [[code-review-quality]] — `metadata`, `reviewState`, `mergeReadiness`, `merge` no ciclo (`scripts/review-cycle.mjs:177`, `scripts/review-cycle.mjs:419`, `scripts/review-cycle.mjs:421`) |
| Depende | [[agentskit-net]] — `fetchWithRetry`, `readJson`, `readText`, `retry` (`src/github-api-client.ts:1`) |
| Externo | API REST do GitHub `https://api.github.com`, versão `2022-11-28` (`src/github-api-client.ts:3`, `src/github-api-client.ts:4`); CLI `gh` para merge com `--admin` (`src/github-scm-adapter.ts:259`) |

## Dados e efeitos

- **Leituras:** `pulls`, `pulls/{n}/files` (até 500 arquivos), `compare/{base}...{head}`, `contents/{path}?ref=` (com uma retentativa na mesma SHA em 404), `issues/{n}/comments`, `pulls/{n}/reviews`, `check-runs`, `status` (`src/github-scm-adapter.ts:69`, `src/github-scm-adapter.ts:110`, `src/github-scm-adapter.ts:105`, `src/github-scm-adapter.ts:129`, `src/github-scm-adapter.ts:219`).
- **Escritas:** comentário de resumo (POST/PATCH em `issues/comments`), review de PR (POST `pulls/{n}/reviews`, cai para `COMMENT` em 422), merge (PUT `pulls/{n}/merge` ou `gh pr merge --admin --match-head-commit`) (`src/github-scm-adapter.ts:184`, `src/github-scm-adapter.ts:191`, `src/github-scm-adapter.ts:206`, `src/github-scm-adapter.ts:209`, `src/github-scm-adapter.ts:262`).
- **Idempotência:** marcador `<!-- agentskit-code-review:v1 sha=<head> fingerprint=<política> -->` no corpo (`src/github-review-state.ts:7`, `src/github-review-state.ts:46`). Antes de postar, procura o marcador; após falha de escrita, reconcilia uma vez pelo corpo exato e nunca repete o POST às cegas (`src/github-scm-adapter.ts:162`). Histórico truncado (> 10 páginas × 100) bloqueia a publicação (`src/github-review-state.ts:182`).
- **Incremental:** se o marcador anterior aponta para uma SHA da qual o head atual está `ahead`, o escopo vira incremental a partir dela (`src/github-review-state.ts:186`).
- **Credencial:** `GITHUB_TOKEN` (ou `gh auth token` nos scripts, `scripts/review-cycle.mjs:101`). Downloads `raw.githubusercontent.com` vão sem `Authorization` e só para esse host em HTTPS (`src/github-scm-adapter.ts:139`, `src/github-scm-adapter.ts:141`). Requisições ficam presas à origem configurada (`src/github-api-client.ts:65`).
- **Permissões GitHub:** `contents: read` + `pull-requests: write` para publicar (`docs/OPERATIONS.md:449`, `examples/pull-request.yml:11`); merge exige permissão de escrita no repo (não declarada no código).

## Como mexer (para agentes)

- **Comece por:** `src/scm-contract.ts` e depois `src/github-scm-adapter.ts`.
- **Invariantes:** nenhum payload GitHub fora deste adaptador; toda operação chama `requireScmCapability` primeiro; nunca repetir POST sem reconciliar pelo marcador; `mergeReadiness` só é `ready` sem bloqueios (o schema rejeita contradição, `src/scm-contract.ts:104`).
- **Testes:** `test/scm-contract.test.mjs`, `test/github-scm-adapter.test.mjs`, `test/github-review-state.test.mjs`, `test/scm-review-reporter.test.mjs`.
- **Validação:** `npm run check`.
- **Armadilhas:** um novo SCM (ex. GitLab) só pode ser anunciado depois de passar nos mesmos testes de contrato (`docs/adr/0003-model-and-scm-adapter-boundaries.md:11`); revisão incompleta é publicada **sem** marcador, para não ser pulada na próxima execução (`agents/code-review/reporters.ts:215`).

## Decisões e história

- [[code-review ADR-0003 - Fronteiras de modelo e SCM]] e [[code-review ADR-0001 - Provedores e CLIs com contratos limitados]] (marcador estável, deadlines, reconciliação).

| Data | Commit | O quê |
|---|---|---|
| 2026-10-03 | aa8d0fb | Cliente REST endurecido: origem fixa, redirects e corpo limitados (#334) |
| 2026-10-02 | 4d56dca | Requisições via [[agentskit-net]] (#323) |
| 2026-09-27 | f7db2fb | Incompleta não vira "publicada" (#317) |
| 2026-09-10 | 4da5164 | Reconciliar publicação antes de repetir trabalho (#246) |
| 2026-09-09 | af04b40 | Política de checks SCM e idempotência de revisão (#206) |

> [!info]- Detalhe técnico
> - `mergeReadiness` bloqueia por: changes requested, draft, `mergeable !== true`, estado diferente de `clean`/`has_hooks`, política de checks e status de commit (`src/github-scm-adapter.ts:214`).
> - `isFork` = `head.repo.full_name` diferente de `base.repo.full_name` (`src/github-scm-adapter.ts:93`).
> - Descoberta para em 10 páginas de 100 PRs e lança erro se truncar (`src/github-scm-adapter.ts:78`).

> [!bug] Existe, mas ninguém usa
> - `ScmMergeRequest.method` aceita `rebase`/`merge`/`squash` e `merge.forbidForce` existe na configuração (`src/public-config.ts:104`), mas nenhum código lê `forbidForce`.
