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
  - code-review/action.yml
tags: [pacote, repo/code-review]
---

# code-review-action

> [!tldr] Em linguagem comum
> É a integração pronta para revisar um pull request dentro do GitHub Actions e publicar o parecer.

← [[00 Hub - code-review]]

| Relação | Papel |
|---|---|
| [[code-review-engine]] | CLI que faz a revisão |
| [[00 Hub - .github]] | Workflows reutilizáveis usados pela manutenção do repo, distintos desta Action |

Action composta instala Node 22 e dependências e chama a CLI com --pr e --post. É consultiva por padrão: fail-on-block é false, acrescentando --no-fail; piso block é high. Codex CLI exige runner trusted-local já autenticado. API/modelo e permissões dependem do consumidor.

Lê diff via GitHub e contexto do provedor; publica review com GITHUB_TOKEN. Credenciais de provedor são repassadas por variáveis de ambiente da Action, não por argumentos.

> [!info]- Detalhe técnico
> - `code-review/action.yml:7`.
> - `code-review/action.yml:32`.
> - `code-review/action.yml:77`.
