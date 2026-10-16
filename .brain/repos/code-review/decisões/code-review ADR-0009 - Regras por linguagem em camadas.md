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
  - docs/adr/0009-layered-language-rules.md
  - agents/code-review/rules.ts
  - src/review-rules.ts
  - agents/code-review/agent.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0009 - Regras por linguagem em camadas

> [!tldr] Em linguagem comum
> O revisor pode receber uma lista de verificação específica para cada tipo de arquivo (TypeScript, Python, Terraform…), com regras do projeto valendo mais que as globais e estas mais que as embutidas. Como isso muda o custo de toda revisão, vem desligado e só pode ser ligado pela API.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-12 (539c825), corrigindo uma lacuna do #254.

## A decisão em linguagem comum

`SYSTEM_RULES` traz checklists embutidos como constantes TypeScript; `src/review-rules.ts` resolve por glob com camadas projeto (`.agentskit-review/rules.json`) › global (`~/.agentskit-review/rules.json`) › sistema, mesclando com o embutido salvo `mergeSystemRule: false`. Sem dependência nova para glob (matcher próprio de ~35 linhas). Desligado por padrão (`rules.enabled = false`).

## Contexto

Antes havia só um texto livre de `conventions`, igual para todos os arquivos e truncado em 6000 caracteres. O `alibaba/open-code-review` resolve checklists por arquivo com ~55 embutidos.

## Consequências

- Conjunto embutido cobre ts-js, python, go, rust, java/kotlin, terraform, github-workflows, yaml, json e default; acrescentar é só adicionar entrada.
- Não há superfície em `.agentskit-review.json` nem flag de CLI para `rules.*` — é opção de `createCodeReviewAgent`, como `verification.posture` e `context.grouping`.
- No código: `agents/code-review/rules.ts:81`, `src/review-rules.ts:90`, `src/review-rules.ts:109`, padrão desligado em `agents/code-review/agent.ts:476`.

## Pacotes afetados

[[code-review-memory]], [[code-review-engine]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0009-layered-language-rules.md`
