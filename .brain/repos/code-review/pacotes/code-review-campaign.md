---
tipo: pacote
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4f37050
metodo: análise estática; nada foi executado
fontes:
  - code-review/src/campaign-runner.ts
  - code-review/src/campaign-runner.ts
  - code-review/src/campaign-store.ts
  - code-review/src/campaign-reducer.ts
  - code-review/src/domain-contracts.ts
tags: [pacote, repo/code-review]
---

# code-review-campaign

> [!tldr] Em linguagem comum
> Coordena a revisão de vários pedidos de mudança sem perder o que já foi feito quando o processo reinicia.

← [[00 Hub - code-review]]

## Papel e contrato

Exporta contratos Zod, reducer/replay, preflight, leases, checkpoints e executor de campanha. Identidade inclui revisões e política; relatório pode ficar PARTIAL ou BLOCKED em vez de fingir sucesso.

| Relação | Quem / como |
|---|---|
| Quem usa e dependências | Scripts de campanha/ciclo e consumidores da API [[code-review-engine]]; adaptador SCM GitHub do próprio repo. |
| Dados lidos e gravados | Grava estado de execução em campaigns/<hash>/execution.json; guarda eventos, evidências e chaves de idempotência sob lease para campanha e PRs. |

> [!info]- Detalhe técnico
> - `code-review/src/campaign-runner.ts:11`.
> - `code-review/src/campaign-runner.ts:60`.
> - `code-review/src/campaign-store.ts:1`.
> - `code-review/src/campaign-reducer.ts:1`.
> - `code-review/src/domain-contracts.ts:1`.
