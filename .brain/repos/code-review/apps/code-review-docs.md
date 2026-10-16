---
tipo: app
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4f37050
metodo: análise estática; nada foi executado
fontes:
  - code-review/apps/docs/package.json
  - code-review/README.md
npm: "@agentskit/code-review-docs"
tags: [app, repo/code-review]
---

# code-review-docs

> [!tldr] Em linguagem comum
> É o site que apresenta o produto e ajuda a escolher a configuração da revisão.

← [[00 Hub - code-review]]

## Papel e contrato

Aplicação @agentskit/code-review-docs, privada como pacote, em repo público. Usa Next.js/React/Fumadocs e export estático para deploy via Wrangler. O runtime de revisão continua na CLI/Action.

| Relação | Quem / como |
|---|---|
| Quem usa e dependências | Pessoas que configuram [[code-review-engine]]; integra documentação ao ecossistema [[00 Hub - doc-bridge]]. |
| Dados lidos e gravados | Lê páginas MDX e exemplos; gera site estático. Scripts cf:build/cf:deploy existem, mas não comprovam o estado do deploy remoto. |

> [!info]- Detalhe técnico
> - `code-review/apps/docs/package.json:1`.
> - `code-review/README.md:1`.
