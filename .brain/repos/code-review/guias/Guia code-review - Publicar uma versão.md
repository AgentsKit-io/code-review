---
tipo: guia
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "passos tirados de docs/OPERATIONS.md, .changeset/config.json, package.json e dos workflows release/publish em 5580f8b; nada foi executado. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - docs/OPERATIONS.md
  - .changeset/config.json
  - package.json
  - .github/workflows/release.yml
  - .github/workflows/publish.yml
tags: [guia, repo/code-review, camada/ferramenta]
---

# Guia code-review - Publicar uma versão

> [!tldr] Em linguagem comum
> Como uma mudança vira uma nova versão no npm: cada PR descreve o que mudou num arquivinho; um robô junta tudo num PR de versão; quando uma pessoa aprova e faz o merge desse PR, o GitHub publica sozinho, sem nenhuma senha guardada.

← [[00 Hub - code-review]]

## Quando usar

Toda mudança que afeta o produto publicado `@agentskit/code-review`.

## Pré-requisitos

- Trusted Publisher configurado no npm para `AgentsKit-io/code-review`, workflow `publish.yml` (`docs/OPERATIONS.md:639`).
- Imutabilidade de releases ligada no repositório (`docs/OPERATIONS.md:637`).
- Proteção de branch exigindo revisão humana (`docs/OPERATIONS.md:645`).

## Passos

1. No PR da mudança, crie o changeset:
   ```bash
   npx changeset          # escolha @agentskit/code-review e patch|minor|major
   # ou, para docs/test/CI sem release:
   npx changeset --empty
   ```
   (`docs/OPERATIONS.md:631`; configuração em `.changeset/config.json:1`).
2. Faça merge do PR em `main`. `release.yml` cria/atualiza o PR `chore: version packages` no branch `changeset-release/main` rodando `npm run version-packages` (`.github/workflows/release.yml:39`, `package.json:115`).
3. O mesmo workflow aprova a **execução** (não o merge) de CI, CodeQL e dependency-review do PR de versão, esperando até ~1 min (`.github/workflows/release.yml:49`).
4. Uma pessoa revisa e faz merge do PR de versão.
5. `publish.yml` dispara só se o PR mergeado tiver o título exato, branch `changeset-release/main`, autor `github-actions[bot]` e for do próprio repo (`.github/workflows/publish.yml:13`); roda `npm run check`, `npm pack --dry-run`, `npm publish --access public --provenance` e cria a GitHub Release `v<versão>` imutável (`.github/workflows/publish.yml:73`, `.github/workflows/publish.yml:95`, `.github/workflows/publish.yml:97`).

## Como validar

- `npm view @agentskit/code-review version` mostra a nova versão.
- `gh release view v<versão>` existe e a API informa `immutable: true` (o workflow falha caso contrário, `.github/workflows/publish.yml:110`).

## Erros comuns

- **Rodar `npm publish` localmente:** proibido (`docs/OPERATIONS.md:645`).
- **Versão já publicada:** o workflow pula só o publish e ainda cria a release faltante (`.github/workflows/publish.yml:78`).
- **Token npm no workflow:** há um passo que falha se aparecer `NODE_AUTH_TOKEN`/`NPM_TOKEN` (`.github/workflows/publish.yml:47`).
- **Release interrompida:** corrija com um novo PR de versão revisado; não há dispatch manual (`docs/OPERATIONS.md:647`).
- **Documentação de versão:** README/OPERATIONS/exemplos ainda citam `0.31.x`; atualize junto com a release se for o caso.

## Notas relacionadas

[[00 Hub - code-review]], [[Guia code-review - Validar uma mudança]], [[00 Hub - .github]].
