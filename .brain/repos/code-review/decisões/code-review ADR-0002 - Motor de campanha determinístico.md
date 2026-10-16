---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "leitura do ADR e conferência estática dos chamadores com git grep em 5580f8b."
fontes:
  - docs/adr/0002-deterministic-campaign-engine.md
  - src/campaign-reducer.ts
  - src/campaign-store.ts
  - src/campaign-runner.ts
  - src/fault-injection.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0002 - Motor de campanha determinístico

> [!tldr] Em linguagem comum
> Quem decide em que pé está cada PR de uma campanha é um código simples e previsível, não a IA. A IA só lê o código e opina; guardar o andamento, retomar e repetir com segurança são regras fixas.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-08 (072bae3). Contexto: PRD #137, issue #138.

## A decisão em linguagem comum

O motor fica dentro do pacote. Um **reducer puro** é a única autoridade das transições de campanha e de PR. Efeitos, persistência atômica, leases, checkpoints e replay ficam separados. A automação (Orca) chama um único comando.

## Contexto

Alternativas rejeitadas: deixar a orquestração com um LLM externo (estado e retentativas não determinísticos) e adotar framework de workflow/event sourcing agora (o pacote resolve com reducer e registros locais atômicos).

## Consequências

- O ciclo procedural é substituído **incrementalmente** (`docs/adr/0002-deterministic-campaign-engine.md:20`); todo PR descoberto precisa terminar em estado terminal explícito e trabalho concluído sobrevive à retomada.
- Estado atual do código: o reducer `transitionCampaign` (`src/campaign-reducer.ts:43`) e o checkpoint de eventos (`src/campaign-store.ts:245`) existem e são testados, mas o executor usado pelo comando de campanha (`src/campaign-runner.ts:75`) mantém seu próprio relatório selado e não chama o reducer. Só `src/fault-injection.ts` e os testes usam o motor de eventos. A substituição incremental, portanto, não está completa.

## Pacotes afetados

[[code-review-campaign]], [[code-review-quality]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0002-deterministic-campaign-engine.md`
