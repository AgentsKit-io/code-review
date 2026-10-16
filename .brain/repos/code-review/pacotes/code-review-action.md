---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "análise estática de action.yml e dos exemplos em 5580f8b; doc-bridge 1.12.0 (`ak-docs query package code-review --agent`) confirmou os checks; a Action não foi executada."
fontes:
  - action.yml
  - examples/pull-request.yml
  - examples/pull-request-selfhosted.yml
  - package.json
  - src/cli.ts
  - src/review-config.ts
  - docs/OPERATIONS.md
  - docs/for-agents/code-review.md
  - AGENTS.md
  - README.md
  - docs/adr/0001-bounded-provider-neutral-cli-agents.md
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-action

> [!tldr] Em linguagem comum
> É o atalho pronto para o GitHub: colocando um pequeno arquivo de workflow no repositório, cada pull request é revisado automaticamente e recebe comentários. Por padrão ela só comenta e nunca impede o merge; bloquear é uma opção que precisa ser ligada.

← [[00 Hub - code-review]]

## O que faz e por que existe

Action composta (`action.yml:69`) que instala Node 22, faz `npm ci` dentro do próprio checkout da Action e chama a CLI do [[code-review-engine]] com `--pr <repo>#<n> --post` (`action.yml:72`, `action.yml:77`, `action.yml:104`). Existe para que adotar a revisão não exija escrever orquestração. É **consultiva por padrão**: `fail-on-block: 'false'` acrescenta `--no-fail` (`action.yml:39`, `action.yml:119`); essa é uma fronteira inegociável do repo (`AGENTS.md:8`).

## API e contratos

| Input | Padrão | Efeito | Onde |
|---|---|---|---|
| `provider` | — (obrigatório) | CLI local (`claude-cli`, `codex-cli`) ou fábrica de [[agentskit-adapters]] | `action.yml:8` |
| `mode` | `isolated` | `trusted-local` só em runner confiável já logado | `action.yml:11` |
| `api-key` | — | Vai para `LLM_API_KEY` no ambiente, nunca em argv | `action.yml:15`, `action.yml:81` |
| `claude-oauth-token` | — | `CLAUDE_CODE_OAUTH_TOKEN` para `claude -p` headless | `action.yml:18`, `action.yml:82` |
| `base-url`, `model` | vazio | Endpoint e modelo (modelo obrigatório para APIs) | `action.yml:21`, `action.yml:29` |
| `github-token` | `${{ github.token }}` | Ler diff e publicar | `action.yml:25` |
| `block` | `high` | Piso de severidade do gate | `action.yml:32` |
| `fail-on-block` | `false` | Liga o bloqueio | `action.yml:36` |
| `votes` | `3` | Votos adversariais | `action.yml:40` |
| `max-files` / `max-calls` / `max-findings-per-file` | `17` / `1000` / `7` | Orçamento | `action.yml:44`, `action.yml:48`, `action.yml:52` |
| `profile` | `full` | `fast` = só lentes obrigatórias | `action.yml:56` |
| `deadline-ms` | `600000` | Prazo global | `action.yml:60` |
| `health-check` | `auto` | Smoke test do provedor | `action.yml:64` |

Não há `outputs` declarados. O resultado é o review no PR, o Markdown no log e o código de saída da CLI (0/1/2).

**Exemplo real** — workflow copiável (`examples/pull-request.yml:9`):

```yaml
permissions:
  contents: read
  pull-requests: write # post inline + summary review comments
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: AgentsKit-io/code-review@v0.31.0
        with:
          provider: 'openai'
          model: 'gpt-4o'
          api-key: ${{ secrets.LLM_API_KEY }}
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Depende | [[code-review-engine]] via `npm run --silent review` = `tsx src/cli.ts` (`action.yml:120`, `package.json:96`) — roda o TypeScript direto, sem `dist/` |
| Depende | `actions/setup-node` fixado por SHA (`action.yml:72`) |
| Consumidores | Qualquer repositório que referencie `AgentsKit-io/code-review@<tag>`; dentro deste repo nenhum workflow usa a própria Action |
| Diferente de | Workflows reutilizáveis de [[00 Hub - .github]], que este repo usa para CodeQL/dependency-review/scorecard |

## Dados e efeitos

- **Lê:** diff e conteúdo do PR pela API do GitHub ([[code-review-scm]]); variáveis `INPUT_*` derivadas dos inputs (`action.yml:84`).
- **Escreve:** review no PR (inline + resumo, conforme política de comentários) com o marcador idempotente.
- **Variáveis:** `LLM_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN` (`action.yml:81`); `CI` é definido pelo GitHub e ativa as regras de CI da config (`src/cli.ts:210`).
- **Permissões do workflow chamador:** `contents: read` e `pull-requests: write` (`examples/pull-request.yml:9`).
- **Rede:** registro npm (`npm ci`), API do GitHub, provedor de IA.

## Como mexer (para agentes)

- **Comece por:** `action.yml`.
- **Invariantes:** consultiva por padrão; credenciais só por ambiente; `codex-cli` sem `trusted-local` sai com erro 2 antes de rodar (`action.yml:99`); a Action não instala CLIs de provedor (`docs/adr/0001-bounded-provider-neutral-cli-agents.md:191`).
- **Mudou um input?** Atualize juntos `action.yml`, `examples/pull-request.yml`, README e testes de contrato (`docs/for-agents/code-review.md:59`).
- **Testes:** `test/documentation.test.mjs`, `test/release-workflow.test.mjs`, `test/cli-smoke.test.mjs`.
- **Validação:** `npm run check` e `npm pack --dry-run` (o tarball inclui `action.yml` e `examples/pull-request.yml`, `package.json:25`).
- **Armadilhas:**
  - Em fork, a CLI imprime `SKIPPED` e sai com **2** mesmo com `--no-fail` (`src/cli.ts:270`) — o job falha.
  - Em CI a config de projeto não pode definir provider/model/transport etc. (`src/review-config.ts:158`); tudo isso vem dos inputs.
  - Os exemplos fixam `@v0.31.0` (`examples/pull-request.yml:17`) enquanto o pacote está em `0.32.2` (`package.json:3`).

## Decisões e história

- [[code-review ADR-0001 - Provedores e CLIs com contratos limitados]] — fronteira segura de `pull_request`, nunca `pull_request_target`; fork sem credencial é `SKIPPED/INCOMPLETE`, nunca aprovação.

| Data | Commit | O quê |
|---|---|---|
| 2026-09-12 | 7fc218e | Referências de versão alinhadas com 0.31.x (#281) |
| 2026-09-05 | 99a0dd1 | Cobertura completa de PR em lotes; release 0.4.0 |
| 2026-08-30 | 618b2eb, 60e5793 | Execução endurecida; falha rápida em erro de autenticação |
| 2026-08-29 | 9c2ea8e | Action e estado GitHub endurecidos (0.2.2) |
| 2026-06-18 | 45022de, 8ebc057, 249addf, c991634 | OAuth do Claude headless; `--provider` agnóstico; runner self-hosted; Action composta consultiva |

> [!info]- Detalhe técnico
> - Montagem dos argumentos em array bash; `--model`/`--base-url` só se não vazios (`action.yml:103`, `action.yml:117`).
> - `examples/pull-request-selfhosted.yml` cobre runner próprio com CLI logada.
