---
tipo: guia
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "comandos tirados de AGENTS.md, CONTRIBUTING.md, package.json, ci.yml e do índice doc-bridge (checks de ownership) em 5580f8b; os comandos não foram executados nesta análise. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - AGENTS.md
  - CONTRIBUTING.md
  - package.json
  - .github/workflows/ci.yml
  - doc-bridge.config.json
  - docs/for-agents/code-review.md
tags: [guia, repo/code-review, camada/ferramenta]
---

# Guia code-review - Validar uma mudança

> [!tldr] Em linguagem comum
> A receita para provar que uma alteração neste repositório não quebrou nada antes de abrir o pull request — os mesmos passos que o CI vai repetir.

← [[00 Hub - code-review]]

## Quando usar

Qualquer mudança em `src/`, `agents/`, `scripts/`, `action.yml`, `docs/` ou `apps/docs/`.

## Pré-requisitos

- Node.js ≥ 20; `test:coverage` exige Node ≥ 22.8 (`CONTRIBUTING.md:13`). O CI usa Node 22 (`.github/workflows/ci.yml:25`).
- npm (o repo usa `package-lock.json`; `apps/docs` tem lock próprio).
- Nenhuma credencial: os testes são offline, com fixtures em `test/fixtures/bin/`.

## Passos

```bash
npm ci
npm ci --prefix apps/docs
npm run docs:index            # regenera .doc-bridge/ e llms-full.txt
git diff --exit-code -- doc-bridge.config.json .doc-bridge llms-full.txt
npm run check:public-api
npm run check
npm run test:coverage
npm pack --dry-run
npm run docs:web:build        # check extra exigido pelo doc-bridge
```

Origem: `.github/workflows/ci.yml:30` a `.github/workflows/ci.yml:40`, `AGENTS.md:18`, `doc-bridge.config.json:35`.

`npm run check` = cross-platform → typecheck → build + testes → gates doc-bridge → typecheck do site → `check:public-api` → `dist/src/cli.js --help` → README standard (`package.json:116`).

Para uma área só: `npm run build && node --test test/<arquivo>.test.mjs` (o `npm test` compila e roda `test/*.test.mjs` em série, `package.json:99`).

## Como validar

- Todos os comandos acima com exit 0.
- `git diff` vazio depois de `docs:index`.
- Cobertura ≥ 93 % linhas, 79 % branches, 92 % funções (`package.json:100`).

## Erros comuns

- **Snapshot de API divergente:** export mudou de propósito → `npm run check:public-api:update` e commite `docs/stability/public-api-v1.json` (`CONTRIBUTING.md:17`).
- **Diff em `.doc-bridge/` no CI:** esqueceu de rodar `npm run docs:index` e commitar.
- **Gate de docs falha:** `docs:gate` roda `ak-docs gate run`, conformance `documentation-standard-v1`, `llms-full.txt --check` e `test/documentation.test.mjs` (`package.json:112`); mudanças em CLI/Action exigem README e `docs/OPERATIONS.md` atualizados (`AGENTS.md:11`).
- **Changeset ausente:** PR que afeta o produto precisa de `.changeset/*.md`; docs/test/CI-only usam `npx changeset --empty` (ver [[Guia code-review - Publicar uma versão]]).

## Notas relacionadas

[[code-review-engine]], [[code-review-docs]], [[Guia code-review - Adicionar um provedor]].
