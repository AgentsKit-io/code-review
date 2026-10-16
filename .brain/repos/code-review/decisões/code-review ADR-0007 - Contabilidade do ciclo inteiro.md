---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "leitura do ADR e conferência estática no código em 5580f8b. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - docs/adr/0007-whole-cycle-resource-accounting.md
  - scripts/review-cycle.mjs
  - src/cli.ts
  - src/budget.ts
  - agents/code-review/agent.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0007 - Contabilidade do ciclo inteiro

> [!tldr] Em linguagem comum
> O limite de gasto vale para o ciclo inteiro de um PR — lotes, tentativas que falharam, avaliações e o teste com e sem memória — e não só para cada chamada isolada. Se o gasto real não for conhecido, ele é contado pelo valor máximo reservado.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-10 (70d20dc).

## A decisão em linguagem comum

Reaproveitar o runner do ciclo e seus artefatos atômicos privados. Reservar tokens e chamadas compartilhados antes de cada filho que usa modelo; passar tetos que só apertam, sem mudar a identidade semântica da revisão. Reconciliar entrada e saída informadas; uso desconhecido continua cobrado; nunca somar duas vezes entrada em cache ou raciocínio. Para um candidato de verificação grande demais, reduzir as linhas vizinhas preservando o intervalo citado; se ainda não couber, falhar fechado.

## Contexto

Limites por invocação não limitavam a soma de lotes, falhas, avaliação de qualidade e A/B de aprendizado; campos opcionais ausentes desligavam a aplicação de contagens conhecidas; declarações geradas densas esgotavam o contexto da verificação.

## Consequências

- Ciclos expõem uso por tentativa e do artefato final; reuso não é gasto novo; uso acima da estimativa é registrado como violação e bloqueia trabalho adicional; limites de token não garantem a conta final do provedor.
- No código: `createCycleMeter` (`scripts/review-cycle.mjs:577`), tetos `--run-token-ceiling`/`--run-call-ceiling` (`scripts/review-cycle.mjs:262`, `src/cli.ts:333`), `tightenReviewBudget` (`src/budget.ts:111`), cobrança conservadora no ledger (`src/budget.ts:204`), redução de vizinhança (`agents/code-review/agent.ts:1141`).

## Pacotes afetados

[[code-review-quality]], [[code-review-engine]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0007-whole-cycle-resource-accounting.md`
