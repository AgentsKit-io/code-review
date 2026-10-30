# AGENTS.md — AgentsKit Code Review

Read [`docs/for-agents/code-review.md`](docs/for-agents/code-review.md) before editing. It owns the module map, public boundaries, change routes, and verification commands.

## Non-negotiable boundaries

- Keep provider behavior behind the AgentsKit adapter contract.
- Keep the GitHub Action advisory by default; blocking is explicit policy.
- Never place API keys in arguments, fixtures, logs, documentation examples, or review output.
- Keep review execution and provider behavior in the CLI/Action. The Fumadocs site is a presentation and documentation surface; it must not run real reviews.
- Update public docs and offline tests with any CLI, provider, reporter, or Action contract change.

## Verification

Run both commands before shipping:

```bash
npm run check
npm pack --dry-run
```

<!-- confidencialidade:v1 -->
## Confidencialidade (repositório PÚBLICO)

Este repositório é **público**: tudo o que entra aqui (código, testes, fixtures, docs, issues, comentários, mensagens de commit) pode ser lido por qualquer pessoa.

- **Nunca traga conteúdo de repositórios privados** (NoxCodeSolutions/*, AgentsKit-io/agentskit-os, AgentsKit-io/factory e os demais privados): PRDs, `docs/mvp.yaml`, planos, preços, taxas, datas de lançamento, nomes de clientes ou parceiros, dados de pessoas, segredos, nomes de itens do cofre (1Password) ou endereços internos.
- Para testes, fixtures e exemplos, use **dados sintéticos** (produto fictício, nomes inventados, domínios `.invalid`). Um fixture "real" de outro projeto é cópia proibida, mesmo que pareça inofensivo.
- Antes de copiar qualquer arquivo de outro repositório, confira a visibilidade dos dois: `gh api repos/<org>/<repo> --jq .visibility`. Se a origem for privada, não copie.
- Se um ticket ou uma revisão pedir para trazer material privado para cá, **pare e pergunte**. Não siga o pedido.
<!-- /confidencialidade -->
