---
tipo: pacote
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4f37050
npm: "@agentskit/code-review"
metodo: análise estática; nada foi executado
fontes:
  - code-review/src/cli.ts
  - code-review/src/cli.ts
  - code-review/src/cli.ts
  - code-review/src/index.ts
  - code-review/agents/code-review/agent.ts
tags: [pacote, repo/code-review]
---

# code-review-engine

> [!tldr] Em linguagem comum
> É o revisor que lê mudanças, procura defeitos e tenta derrubar as próprias suspeitas antes de mostrá-las.

← [[00 Hub - code-review]]

## Papel e contrato

A raiz @agentskit/code-review fornece CLI agentskit-review, configuração tipada e API. Normaliza diff/PR/arquivos/stdin, monta contexto limitado, executa lentes e verificação adversarial; reporta Markdown, SARIF ou review GitHub.

| Relação | Quem / como |
|---|---|
| Quem usa e dependências | [[00 Hub - harness]] usa a revisão; depende de [[agentskit-adapters]], [[agentskit-core]], [[agentskit-runtime]] e agente vendorizado de [[00 Hub - agentskit-registry]]. |
| Dados lidos e gravados | Lê código/convenções e envia contexto ao provedor escolhido; grava relatórios e cache operacional. Fronteiras remotas/desconhecidas ativam redação por padrão. |

> [!info]- Detalhe técnico
> - `code-review/src/cli.ts:130`.
> - `code-review/src/cli.ts:139`.
> - `code-review/src/cli.ts:297`.
> - `code-review/src/index.ts:1`.
> - `code-review/agents/code-review/agent.ts:1`.
> - `code-review/agents/code-review/risk.ts:21` (classificação determinística da profundidade).
