---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "leitura do ADR e conferência estática no código em 5580f8b; os números do A/B vêm do próprio ADR e não foram reproduzidos. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - docs/adr/0008-verification-posture.md
  - docs/adr/README.md
  - agents/code-review/lenses.ts
  - agents/code-review/agent.ts
  - agents/code-review/reporters.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0008 - Postura de verificação conservadora

> [!tldr] Em linguagem comum
> O "advogado do diabo" que tenta derrubar cada suspeita passou a ser mais cauteloso: só descarta um achado quando há prova direta de que está errado, e nunca descarta, sem prova inequívoca, assuntos sensíveis como concorrência ou mudança de comportamento. Se ele não conseguiu decidir, o achado aparece marcado como "não verificado" em vez de sumir.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-12 (96c1f3a) como opção aditiva; no mesmo dia (3ad2dde) `conservative` foi promovido a padrão após A/B ao vivo.

## A decisão em linguagem comum

Postura `conservative` ao lado da antiga, agora chamada `strict`, selecionada por `verification.posture`. `conservative` só refuta se (A) o código descrito não está no local citado ou (B) uma linha específica contradiz a afirmação; assuntos protegidos (`memory-safety`, `concurrency`, `behavioral-change`, `unused-parameter`, `linkage-consistency`) têm veto antes de avaliar correção. Independente da postura, achado sem veredito (prazo, orçamento, saída inválida) é mostrado como `verification: 'unverified'`, e `incomplete` fica verdadeiro.

## Contexto

O cético antigo refutava por padrão salvo se o achado "claramente se sustentasse", e juntava "não consegui verificar" com "refutado" — ambos sumiam. Inspiração: o fact-checker do `alibaba/open-code-review`. A/B de 2026-09-12 com os 20 casos de `quality/evals/default.json` num `codex-cli` real: detecção 75,0 % → 83,3 %, precisão 42,9 % → 41,7 %, zero falso positivo em casos limpos em ambas (`docs/adr/0008-verification-posture.md:47`). Critério de promoção (queda de precisão ≤ 3 pts e ganho de detecção ≥ 5 pts) atendido.

## Consequências

- Quem fixa `posture: 'strict'` mantém o comportamento anterior; quem não define recebe `conservative`. Achados não verificados podem aumentar a contagem de achados em execuções que batem no prazo.
- No código: padrão em `agents/code-review/agent.ts:472`; prompts em `agents/code-review/lenses.ts:208` e `agents/code-review/lenses.ts:238`; tag no Markdown em `agents/code-review/reporters.ts:70`. O export legado `skeptic` continua sendo `strict` (`agents/code-review/lenses.ts:293`).
- O índice `docs/adr/README.md:14` está desatualizado (diz "default unchanged").
- A CLI não expõe `verification.posture`; só a API.

## Pacotes afetados

[[code-review-engine]], [[code-review-quality]].

## Substitui / substituído por

Nenhum (o próprio ADR foi atualizado; não há ADR novo).

## Fonte

`docs/adr/0008-verification-posture.md`
