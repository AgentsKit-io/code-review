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
  - docs/adr/0005-separated-safe-review-memory.md
  - src/review-stores.ts
  - src/review-feedback.ts
  - agents/code-review/agent.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0005 - Memória de revisão separada e segura

> [!tldr] Em linguagem comum
> O revisor guarda em lugares diferentes o andamento das execuções, os resultados reaproveitáveis, a opinião das pessoas e as regras aprovadas. Só as regras aprovadas voltam para a IA, e nada de código, segredo ou conversa é guardado como conhecimento.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-08 (072bae3). Contexto: PRD #137, issue #138.

## A decisão em linguagem comum

Estado operacional, cache reutilizável, feedback e conhecimento aprovado ficam separados; armazenamento estruturado self-hosted é o padrão. Conhecimento persistente exclui fonte bruto, segredos, prompts completos e transcrições. Regras candidatas exigem evidência de regressão e aprovação humana por padrão; a recuperação injeta só regras aprovadas, limitadas e com escopo.

## Contexto

Alternativas rejeitadas: reaproveitar transcrições de chat como conhecimento (mistura ciclo de vida, confiança e privacidade) e promoção automática ou banco vetorial obrigatório (risco evitável de envenenamento e operação).

## Consequências

- Regras mantêm proveniência, escopo, confiança, histórico de validação, expiração e metadados de rollback; recuperação vetorial fica opcional.
- No código: candidatos `active: false`/`requiresApproval: true` (`src/review-feedback.ts:27`), recuperação com escopo (`src/review-stores.ts:208`), texto seguro (`src/review-stores.ts:9`), runtime sem memória de conversa (`agents/code-review/agent.ts:663`).
- Divergência: o `ReviewKnowledgeSchema` guarda regra, escopo e data (`src/review-stores.ts:67`), mas não campos de confiança, histórico de validação ou rollback citados como consequência.

## Pacotes afetados

[[code-review-memory]], [[code-review-engine]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0005-separated-safe-review-memory.md`
