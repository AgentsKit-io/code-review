---
tipo: app
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review-docs"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "análise estática de apps/docs em 5580f8b; doc-bridge 1.12.0 (`ak-docs list knowledge`) listou os módulos do app e o corpus humano Fumadocs; o site não foi construído nem implantado nesta análise."
fontes:
  - apps/docs/package.json
  - apps/docs/README.md
  - apps/docs/AGENTS.md
  - apps/docs/next.config.mjs
  - apps/docs/wrangler.toml
  - apps/docs/source.config.ts
  - apps/docs/public-docs.json
  - apps/docs/app/layout.tsx
  - apps/docs/app/api/search/route.ts
  - apps/docs/lib/shell.ts
  - apps/docs/scripts/cloudflare-headers.mjs
  - apps/docs/components/review-config-demo.tsx
  - apps/docs/app/page.tsx
  - "apps/docs/app/docs/[[...slug]]/page.tsx"
  - apps/docs/app/robots.ts
  - apps/docs/app/sitemap.ts
  - apps/docs/app/opengraph-image.tsx
  - package.json
  - doc-bridge.config.json
  - .github/workflows/ci.yml
  - .github/workflows/dependency-review.yml
  - AGENTS.md
  - docs/for-agents/code-review.md
tags: [app, repo/code-review, camada/ferramenta]
---

# code-review-docs

> [!tldr] Em linguagem comum
> É o site público `code-review.agentskit.io`: apresenta o produto, mostra uma animação de exemplo de revisão e publica os guias de uso. Ele não revisa nada — a revisão de verdade continua na linha de comando e na Action.

← [[00 Hub - code-review]]

## O que faz e por que existe

App Next.js 16 + Fumadocs (`apps/docs/package.json:13`), pacote privado `@agentskit/code-review-docs` (`apps/docs/package.json:2`, `apps/docs/package.json:4`) num repo público. Lê as páginas Markdown de `../../docs` filtradas por `public-docs.json` (`apps/docs/source.config.ts:10`, `apps/docs/public-docs.json:1`) e expõe busca estática (`apps/docs/app/api/search/route.ts:4`). A home usa `ReviewConfigDemo`, uma animação ilustrativa que não executa revisão (`apps/docs/README.md:5`). Limite explícito: "o site Fumadocs é superfície de apresentação; não pode rodar revisões reais" nem embutir runtime do AgentsKit Chat (`AGENTS.md:10`, `docs/for-agents/code-review.md:47`).

## API e contratos

| Superfície | Tipo | Para que serve | Onde |
|---|---|---|---|
| `/` | página | Home com demo e seções | `apps/docs/app/page.tsx` |
| `/docs/[[...slug]]` | páginas | Guias do diretório `docs/` | `apps/docs/app/docs/[[...slug]]/page.tsx` |
| `/api/search` | rota `GET` estática | Índice de busca Fumadocs | `apps/docs/app/api/search/route.ts:5` |
| `/robots.txt`, `/sitemap.xml`, `/opengraph-image` | rotas Next | SEO | `apps/docs/app/robots.ts`, `apps/docs/app/sitemap.ts`, `apps/docs/app/opengraph-image.tsx` |
| Scripts `dev`, `build`, `typecheck`, `cf:build`, `cf:deploy` | npm | Desenvolvimento e deploy | `apps/docs/package.json:6` |

**Exemplo real** — de onde vêm as páginas (`apps/docs/source.config.ts:10`):

```ts
export const docs = defineDocs({
  dir: '../../docs',
  docs: { files: publicDocs },
  meta: { files: ['meta.json'] },
})
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Documenta | [[code-review-engine]], [[code-review-action]] — conteúdo é `docs/*.md` do repo |
| Depende em tempo de execução do navegador | Shell compartilhado do ecossistema: CSS/JS de `${NEXT_PUBLIC_AGENTSKIT_SHELL_ORIGIN}/shell/v1.*`, padrão `https://www.agentskit.io` (`apps/docs/lib/shell.ts:2`, `apps/docs/app/layout.tsx:29`) — servido pelo site do [[00 Hub - agentskit]] |
| Corpus humano do doc-bridge | `doc-bridge.config.json` declara o plugin `fumadocs` com `contentDir: docs` ([[00 Hub - doc-bridge]], `doc-bridge.config.json:21`) |
| Dependências | `fumadocs-core`/`-ui`/`-mdx`, `next`, `react` fixados (`apps/docs/package.json:13`) |

## Dados e efeitos

- **Build:** lê `docs/` e `meta.json`; gera `.next/` ou, com `CF_STATIC_EXPORT=1`, export estático em `out/` (`apps/docs/next.config.mjs:6`, `apps/docs/wrangler.toml:9`).
- **Deploy (dois caminhos declarados):** Vercel com raiz `apps/docs` (`apps/docs/README.md:3`) e Cloudflare Workers static assets `ak-code-review` via `npm run cf:deploy` (`apps/docs/wrangler.toml:4`, `apps/docs/package.json:11`). O comentário do `wrangler.toml` fala em "migração off Vercel" (`apps/docs/wrangler.toml:1`). Nenhum workflow do repo implanta o site.
- **Variáveis:** `CF_STATIC_EXPORT` (build), `NEXT_PUBLIC_AGENTSKIT_SHELL_ORIGIN` (origem do shell), `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` para o deploy Cloudflare (citadas em `apps/docs/wrangler.toml:3`).
- **Rede no cliente:** fontes Google via `next/font`, shell do agentskit.io; imagens remotas permitidas de `bestpractices.dev`, `github.com` (badges de workflow) e `img.shields.io` (`apps/docs/next.config.mjs:14`).
- **Sem dados de usuário, sem backend próprio.**

## Como mexer (para agentes)

- **Comece por:** `apps/docs/AGENTS.md` (aviso de que é um Next.js recente com APIs diferentes) e `apps/docs/source.config.ts`.
- **Instalação separada:** o app tem `package-lock.json` próprio; use `npm ci --prefix apps/docs` (`.github/workflows/ci.yml:31`).
- **Validação:** `npm run docs:web:typecheck` (faz parte de `npm run check`, `package.json:116`, `package.json:125`) e `npm run docs:web:build` (check exigido pelo doc-bridge, `doc-bridge.config.json:37`). Exemplos de revisão da home: `node --test test/docs-review-examples.test.mjs` (`apps/docs/README.md:7`).
- **Invariantes:** nada de execução de revisão no site; página nova em `docs/` só aparece se listada em `public-docs.json`; links relativos são reescritos por `remarkRepoLinks` (`apps/docs/source.config.ts:18`).
- **Armadilhas:** a auditoria npm do app roda com `production-only: false` (`.github/workflows/dependency-review.yml:43`), então dependência de desenvolvimento vulnerável também falha.

## Decisões e história

Nenhum ADR trata do site. Mudanças recentes (`git log -- apps/docs`):

| Data | Commit | O quê |
|---|---|---|
| 2026-10-02 | 8c339a4 | Correção de advisory do Next.js (#329) |
| 2026-10-02 | 5dec80b | Export estático para Cloudflare Workers (#322) |
| 2026-09-26 | 5e03ced, 73f4128, d688f26, 1b810c7 | Diffs ilustrativos coerentes, footer do ecossistema, links relativos, adoção do AgentsKit shell v1 |
| 2026-09-25 | fa31ebe | Home e docs curados (#304) |

> [!info]- Detalhe técnico
> - `_headers` do Cloudflare é gerado por `apps/docs/scripts/cloudflare-headers.mjs`.
> - Busca: `createFromSource(source)` + `staticGET`, `dynamic = 'force-static'` (`apps/docs/app/api/search/route.ts:3`).

> [!question] Dúvida
> Qual deploy está ativo hoje (Vercel ou Cloudflare `ak-code-review`)? O código mantém os dois; produção não foi consultada.
