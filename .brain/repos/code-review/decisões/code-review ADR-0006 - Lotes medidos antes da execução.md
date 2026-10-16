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
  - docs/adr/0006-measured-batch-completion.md
  - src/batch-mode.ts
  - src/batch-coverage.ts
  - src/harness.ts
  - src/github-scm-adapter.ts
  - agents/code-review/agent.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0006 - Lotes medidos antes da execução

> [!tldr] Em linguagem comum
> Antes de mandar qualquer coisa para a IA, o revisor mede se cada lote cabe. Se não cabe, divide; se nem um pedaço mínimo cabe, avisa que está bloqueado em vez de descobrir isso no meio da revisão.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-10 (4c00bc8).

## A decisão em linguagem comum

CLI e preflight de campanha compartilham **um** planejador. Cada candidato é medido com a mesma preparação usada na execução; grupos grandes demais dividem por arquivo e, para um arquivo só, por identidade de pacote de contexto (`packIds`). Pacote que não cabe é bloqueio explícito. O planejamento reaproveita um snapshot da fonte em memória e não chama provedor. Grupos de verificação também são medidos e divididos; candidato único irrevisável fica `unverified` e não autoriza aprovação. Recuperação de conteúdo do GitHub: uma retentativa na mesma revisão imutável.

## Contexto

Lotes de tamanho fixo podiam estourar a capacidade de tokens — inclusive um único documento gerado; suprimir o erro agregado empurrava falhas determinísticas para depois do trabalho pago.

## Consequências

- Tamanho de lote é um máximo, não garantia; falhas de fonte e orçamento aparecem antes do modelo; o resultado do modelo continua sendo medido em tempo de execução.
- No código: `planReviewBatches` (`src/batch-mode.ts:9`) usado pela CLI e pelo preflight; `packIds` validados no canário (`src/harness.ts:101`); retentativa de 404 na mesma SHA (`src/github-scm-adapter.ts:129`); divisão de verificação (`agents/code-review/agent.ts:1140`).

## Pacotes afetados

[[code-review-engine]], [[code-review-campaign]], [[code-review-quality]], [[code-review-scm]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0006-measured-batch-completion.md`
