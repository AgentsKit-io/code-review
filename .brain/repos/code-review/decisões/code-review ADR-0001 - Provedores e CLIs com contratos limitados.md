---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "leitura do ADR e conferência estática no código em 5580f8b."
fontes:
  - docs/adr/0001-bounded-provider-neutral-cli-agents.md
  - src/provider-registry.ts
  - src/local-cli-process.ts
  - src/review-config.ts
  - src/cli.ts
  - agents/code-review/sources.ts
  - src/github-review-state.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0001 - Provedores e CLIs com contratos limitados

> [!tldr] Em linguagem comum
> Qualquer IA pode ser usada, mas sempre dentro de uma caixa: cada chamada faz uma única tarefa de revisão, num ambiente isolado, sem ferramentas, com limites de tamanho e tempo, e devolvendo um formato fixo. Revisão parcial nunca aparece como aprovação.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-08-25 (f4214ba).

## A decisão em linguagem comum

Manter o contrato `AdapterFactory` do AgentsKit e pôr um **registro de provedores** em volta. APIs e CLIs locais são tipos diferentes mesmo quando usam o mesmo fornecedor (`grok` = API xAI; `grok-cli` = CLI local). CLIs locais só entram registradas explicitamente; transporte ACP por padrão, headless explícito, `auto` só local. Modos: `isolated` (padrão e obrigatório em CI) e `trusted-local` (só local, nunca ligado por arquivo de projeto). Limites de entrada: 256 KB por arquivo e 5 MB por execução por padrão, tetos 1 MB/25 MB; o que passa disso é `UNREVIEWED`, nunca truncado. Exit codes 0/1/2. Marcador estável no GitHub para atualizar em vez de duplicar.

## Contexto

Grok Build e OpenCode são agentes completos com ferramentas, plugins, MCP e memória próprios; tratá-los como agentes livres tornaria cobertura, custo e segurança improváveis de provar. PRs não confiáveis, drift de versão e fronteiras de dados também pesavam (`docs/adr/0001-bounded-provider-neutral-cli-agents.md:16`).

## Consequências

- Positivas: contratos compatíveis, CI não herda capacidades do projeto/usuário, revisão parcial não vira aprovação, custo limitado antes de executar.
- Negativas: modo isolado não reaproveita login interativo (por isso `codex-cli` na Action exige `trusted-local`); dois transportes dobram fixtures; redação pode reduzir detalhe para a lente de segurança; forks podem ficar sem revisão.
- No código: registro em `src/provider-registry.ts:92`; ambiente isolado em `src/local-cli-process.ts:63`; chaves só confiáveis em `src/review-config.ts:130`; limites em `agents/code-review/sources.ts:12`; marcador em `src/github-review-state.ts:46`; exit codes em `src/cli.ts:401`.

## Pacotes afetados

[[code-review-providers]], [[code-review-engine]], [[code-review-scm]], [[code-review-action]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0001-bounded-provider-neutral-cli-agents.md`
