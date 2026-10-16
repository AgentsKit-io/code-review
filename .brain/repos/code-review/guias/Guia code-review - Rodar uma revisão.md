---
tipo: guia
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "comandos tirados de src/cli.ts (HELP), action.yml, examples/, package.json e docs/OPERATIONS.md em 5580f8b; nenhuma revisão foi executada. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - src/cli.ts
  - action.yml
  - examples/pull-request.yml
  - examples/pull-request-selfhosted.yml
  - package.json
  - docs/OPERATIONS.md
  - scripts/review-campaign.mjs
  - src/public-config.ts
tags: [guia, repo/code-review, camada/ferramenta]
---

# Guia code-review - Rodar uma revisão

> [!tldr] Em linguagem comum
> Três jeitos de usar o revisor: no seu computador sobre o seu branch, automaticamente em cada pull request pelo GitHub Actions, ou em lote sobre todos os PRs abertos de um repositório num horário agendado.

← [[00 Hub - code-review]]

## Quando usar

- **Local:** antes de abrir PR.
- **Action:** revisão consultiva em todo PR.
- **Campanha:** operação agendada (Orca ou runner local) sobre todos os PRs, opcionalmente publicando e fazendo merge.

## Pré-requisitos

- Um provedor: CLI local logada (`codex`, `claude`, `grok`, `opencode`), Ollama ou chave de API em `LLM_API_KEY`/`<PROVIDER>_API_KEY`.
- Para PR: `GITHUB_TOKEN` com `contents: read` e `pull-requests: write`.

## Passos

**Local** (`src/cli.ts:52`):

```bash
npx --yes github:AgentsKit-io/code-review doctor --provider codex-cli
npx --yes github:AgentsKit-io/code-review --provider codex-cli --plan       # sem chamar modelo
npx --yes github:AgentsKit-io/code-review --provider codex-cli --base main --no-fail
npx --yes github:AgentsKit-io/code-review --provider ollama --model qwen2.5-coder:7b --base-url http://localhost:11434 --max-files 10 --concurrency 1 --no-fail
```

(Ollama: `docs/OPERATIONS.md:405`.) Dentro do repo: `npm run review -- --provider ...` (`package.json:96`).

**Action:** copie `examples/pull-request.yml` (API) ou `examples/pull-request-selfhosted.yml` (CLI logada em runner próprio, `mode: 'trusted-local'`). Para bloquear merges, `fail-on-block: 'true'` e `block: 'high'|'blocker'` (`examples/pull-request.yml:24`).

**Campanha:**

```bash
agentskit-review-campaign --config /caminho/absoluto/code-review.config.ts --preflight-only --output /privado/preflight.json
agentskit-review-campaign --config /caminho/absoluto/code-review.config.ts --output /privado/campaign-report.json
# com mutações, só se merge.enabled e após validação:
agentskit-review-campaign --config /caminho/absoluto/code-review.config.ts --output /privado/campaign-report.json --post --merge
```

(`docs/OPERATIONS.md:313`, `scripts/review-campaign.mjs:85`.) A config pública começa por `defineConfig` / `presets.standard()` (`src/public-config.ts:142`, `src/public-config.ts:193`); schema: `agentskit-review --config-schema`.

## Como validar

- Local/Action: leia a linha `Coverage: N of M file(s)` e as contagens de lentes no Markdown; exit 2 significa revisão incompleta, nunca aprovação.
- Campanha: exit 0 só com desfecho `COMPLETE`; confira `quality-matrix.json` e o `cycle-summary.json` de cada PR.

## Erros comuns

- `codex-cli` na Action sem `mode: trusted-local` → erro imediato (`action.yml:99`).
- PR de fork com `--post` → `SKIPPED` e exit 2 (`src/cli.ts:270`).
- `--stdin` com um patch unificado é tratado como um arquivo só, não como diff (`docs/OPERATIONS.md:415`).
- Mesma SHA e política já revisadas → `SKIPPED ... already reviewed` (`src/cli.ts:276`).
- Timeout de CLI local: ajuste `AGENTSKIT_REVIEW_SUBPROCESS_TIMEOUT_MS` (`docs/OPERATIONS.md:611`).

## Notas relacionadas

[[Code Review - Da mudança ao parecer]], [[Code Review - Ciclo completo de um PR]], [[Code Review - Retomar campanha e aprender]], [[code-review-action]].
