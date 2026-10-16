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
  - code-review/src/file-memory.ts
  - code-review/src/review-learning.ts
  - code-review/src/review-feedback.ts
  - code-review/src/review-rules.ts
  - code-review/src/review-stores.ts
tags: [pacote, repo/code-review]
---

# code-review-memory

> [!tldr] Em linguagem comum
> Guarda aprendizados aprovados para reduzir erros repetidos sem transformar toda conversa com IA em memória permanente.

← [[00 Hub - code-review]]

## Papel e contrato

Separa estado/cache operacional, feedback e regras aprovadas; reconcilia feedback em candidatos inativos. Só regras explicitamente aprovadas entram na recuperação por repositório, caminho, linguagem e categoria.

| Relação | Quem / como |
|---|---|
| Quem usa e dependências | [[code-review-engine]] usa contexto recuperado; campanha e avaliação usam [[code-review-campaign]]. Depende do contrato Retriever de [[agentskit-core]]. |
| Dados lidos e gravados | Lê/grava stores locais com substituição atômica; conhecimento não deve receber prompts, fonte completa, transcrições ou segredos. |

> [!info]- Detalhe técnico
> - `code-review/src/file-memory.ts:1`.
> - `code-review/src/review-learning.ts:1`.
> - `code-review/src/review-feedback.ts:1`.
> - `code-review/src/review-rules.ts:1`.
> - `code-review/src/review-stores.ts:1`.
