---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "leitura do ADR e conferência estática no código em 5580f8b."
fontes:
  - docs/adr/0004-diff-first-context-and-token-budgets.md
  - agents/code-review/agent.ts
  - agents/code-review/risk.ts
  - src/budget.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0004 - Contexto diff-first e orçamentos

> [!tldr] Em linguagem comum
> Em vez de mandar o repositório inteiro para a IA várias vezes, o revisor manda só os trechos alterados com um pouco de vizinhança, numa única chamada por pacote, e controla quanto cada parte da revisão pode gastar.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-08 (072bae3). Contexto: PRD #137, issue #138.

## A decisão em linguagem comum

Contexto planejado a partir dos hunks alterados, código adjacente, símbolos diretamente relacionados, testes e regras aprovadas. Um pacote normal recebe **uma** análise multidimensional; risco determinístico pode acrescentar uma análise especializada. Orçamentos cobrem campanha, PR, pacote, análise, verificação, cache, retry e memória.

## Contexto

Alternativas rejeitadas: uma chamada com o fonte completo por lente (repete contexto quase idêntico) e mandar o repositório todo ou exigir sessões persistentes (mais exposição e acoplamento).

## Consequências

- Contexto que falta é pedido explicitamente e recuperado dentro de limites; releases comparam corpus fixo e canários reais contra o baseline v0.8.0.
- No código: `batchLenses` padrão `true` (`agents/code-review/agent.ts:433`), 40 linhas adjacentes e 16 000 tokens por pacote por padrão (`agents/code-review/agent.ts:460`, `agents/code-review/agent.ts:462`), análise especializada por risco (`agents/code-review/risk.ts:48`), hierarquia de orçamento (`src/budget.ts:18`).

## Pacotes afetados

[[code-review-engine]], [[code-review-memory]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0004-diff-first-context-and-token-budgets.md`
