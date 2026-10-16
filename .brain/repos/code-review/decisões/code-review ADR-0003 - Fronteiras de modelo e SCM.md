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
  - docs/adr/0003-model-and-scm-adapter-boundaries.md
  - src/scm-contract.ts
  - src/github-scm-adapter.ts
  - src/public-config.ts
  - scripts/review-campaign.mjs
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0003 - Fronteiras de modelo e SCM

> [!tldr] Em linguagem comum
> Há uma única "tomada" para modelos de IA (a do AgentsKit) e uma única "tomada" para plataformas de código (hoje só GitHub). Nada específico de um fornecedor pode vazar para o motor.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-08 (072bae3). Contexto: PRD #137, issue #138.

## A decisão em linguagem comum

`AdapterFactory` continua sendo a fronteira de modelo, com confiabilidade e capacidades acrescentadas em volta. Um contrato SCM interno cobre descoberta, diff, estado de revisão, publicação, prontidão e merge. GitHub é a primeira implementação; GitLab só será anunciado depois de passar nos mesmos testes de contrato.

## Contexto

Alternativas rejeitadas: segunda abstração de modelo (duplica o AgentsKit) e pacotes separados para provedores/SCM (um pacote com fronteiras internas basta).

## Consequências

- Contrato em `src/scm-contract.ts:131`; implementação GitHub em `src/github-scm-adapter.ts:46`.
- `gitlab` já existe no enum da config (`src/public-config.ts:25`), mas a campanha recusa qualquer SCM diferente de `github` (`scripts/review-campaign.mjs:73`) — coerente com "não anunciar até passar nos testes".

## Pacotes afetados

[[code-review-scm]], [[code-review-providers]], [[code-review-engine]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0003-model-and-scm-adapter-boundaries.md`
