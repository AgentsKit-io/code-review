---
tipo: guia
repo: code-review
camada: ferramenta
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "passos derivados de CONTRIBUTING.md, docs/for-agents/code-review.md, ADR-0001 e do código de registro/adaptadores em 5580f8b; não executado. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - CONTRIBUTING.md
  - docs/for-agents/code-review.md
  - docs/adr/0001-bounded-provider-neutral-cli-agents.md
  - src/provider-registry.ts
  - src/cli.ts
  - src/grok-cli-adapter.ts
  - src/acp-cli-adapter.ts
  - src/local-cli-process.ts
  - src/index.ts
  - .github/ISSUE_TEMPLATE/provider.yml
tags: [guia, repo/code-review, camada/ferramenta]
---

# Guia code-review - Adicionar um provedor

> [!tldr] Em linguagem comum
> Como ensinar o revisor a usar mais uma IA — seja uma API nova, seja uma ferramenta de linha de comando instalada no computador — sem quebrar o isolamento nem expor chaves.

← [[00 Hub - code-review]]

## Quando usar

Novo provedor de API ou nova CLI local. Há um template de issue específico (`.github/ISSUE_TEMPLATE/provider.yml`).

## Pré-requisitos

- Ler [[code-review ADR-0001 - Provedores e CLIs com contratos limitados]] e [[code-review-providers]].
- Regra: comportamento específico do provedor fica no adaptador (`CONTRIBUTING.md:51`); nada de segunda abstração de modelo (`docs/for-agents/code-review.md:44`).

## Passos

**API já exportada por `@agentskit/adapters`:** ela aparece sozinha como `experimental` (`src/provider-registry.ts:153`). Para torná-la `stable`, acrescente a entrada em `API_METADATA` com a variável de credencial (`src/provider-registry.ts:79`). A CLI passa `{ apiKey, model, baseUrl? }` à fábrica (`src/cli.ts:448`).

**CLI local:**

1. Crie `src/<nome>-cli-adapter.ts` usando `createAcpCliAdapter` e/ou `createHeadlessCliAdapter` como em `src/grok-cli-adapter.ts:9` — processo via `runLocalCli`/`runLocalCliProtocol`, credencial só em `providerCredential` (`src/local-cli-process.ts:37`).
2. Registre em `LOCAL_PROVIDERS` com executável, `minimumVersion`, transportes e `dataBoundary` (`src/provider-registry.ts:92`).
3. Ligue a seleção em `buildAdapter`, recusando `--transport auto` em CI (`src/cli.ts:409`, `src/cli.ts:423`).
4. Exporte na raiz se for público (`src/index.ts:126`) e rode `npm run check:public-api:update`.
5. Acrescente fixture offline em `test/fixtures/bin/<executável>` e teste `test/<nome>-cli-adapter.test.mjs`, cobrindo saída válida, malformada e a retentativa única.
6. Atualize `docs/provider-compatibility.json`/`.md`, README e `docs/OPERATIONS.md`.

```bash
npm run build && node --test test/provider-registry.test.mjs test/<nome>-cli-adapter.test.mjs test/provider-compatibility.test.mjs
npm run check
npm pack --dry-run
```

## Como validar

- `node dist/src/cli.js --list-providers` lista o novo id (`src/cli.ts:182`).
- `node dist/src/cli.js doctor --provider <id> --json` responde sem chamar o modelo (`src/cli.ts:473`).

## Erros comuns

- Passar a chave em argv ou deixar o filho herdar o ambiente em modo `isolated`.
- Envelope de saída: o validador ACP/headless exige `findings` (`src/acp-cli-adapter.ts:11`) — teste também as chamadas de verificação (`submit_verdicts`) e consolidação, não só `submit_findings` (ver dúvida em [[code-review-providers]]).
- Esquecer que a Action não instala CLIs: documente a instalação/login do runner.

## Notas relacionadas

[[code-review-providers]], [[Guia code-review - Validar uma mudança]], [[agentskit-adapters]].
