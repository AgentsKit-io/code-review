---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "leitura de docs/adr/*.md e conferência no código em 5580f8b; datas de `git log --diff-filter=A -- docs/adr`. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - docs/adr/README.md
  - docs/adr/0001-bounded-provider-neutral-cli-agents.md
  - docs/adr/0002-deterministic-campaign-engine.md
  - docs/adr/0003-model-and-scm-adapter-boundaries.md
  - docs/adr/0004-diff-first-context-and-token-budgets.md
  - docs/adr/0005-separated-safe-review-memory.md
  - docs/adr/0006-measured-batch-completion.md
  - docs/adr/0007-whole-cycle-resource-accounting.md
  - docs/adr/0008-verification-posture.md
  - docs/adr/0009-layered-language-rules.md
  - docs/adr/0010-single-step-calls.md
  - agents/code-review/agent.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# 00 Decisões - code-review

> [!tldr] Em linguagem comum
> Índice das dez decisões de arquitetura registradas no repositório, agrupadas por tema. Todas estão aceitas; nenhuma substitui outra.

← [[00 Hub - code-review]]

## Por tema

| Tema | ADR | Decisão em uma linha |
|---|---|---|
| Provedores e segurança | [[code-review ADR-0001 - Provedores e CLIs com contratos limitados]] | Registro de provedores em volta do `AdapterFactory`; CLIs locais como trabalhadores isolados de uma lente |
| Provedores e segurança | [[code-review ADR-0003 - Fronteiras de modelo e SCM]] | Uma fronteira de modelo (AgentsKit) e um contrato SCM interno; GitHub primeiro |
| Orquestração | [[code-review ADR-0002 - Motor de campanha determinístico]] | Reducer puro como autoridade de estado; modelos só fazem análise |
| Contexto e custo | [[code-review ADR-0004 - Contexto diff-first e orçamentos]] | Pacotes limitados a partir do diff; uma análise multidimensional por pacote |
| Contexto e custo | [[code-review ADR-0006 - Lotes medidos antes da execução]] | Medir e dividir lotes antes de chamar o modelo |
| Contexto e custo | [[code-review ADR-0007 - Contabilidade do ciclo inteiro]] | Reservar e reconciliar tokens/chamadas do ciclo inteiro |
| Contexto e custo | [[code-review ADR-0010 - Chamadas de passo único]] | Não adotar loop de agente com ferramentas nem compressão de transcrição |
| Qualidade da revisão | [[code-review ADR-0008 - Postura de verificação conservadora]] | Cético `conservative` vira padrão após A/B; achado sem veredito aparece como `unverified` |
| Memória e regras | [[code-review ADR-0005 - Memória de revisão separada e segura]] | Estado, cache, feedback e conhecimento aprovado separados; sem promoção automática |
| Memória e regras | [[code-review ADR-0009 - Regras por linguagem em camadas]] | Checklists por glob em camadas, opt-in e só na API |

## Cronologia

| Data | ADRs | Commit |
|---|---|---|
| 2026-08-25 | 0001 | f4214ba |
| 2026-09-08 | 0002, 0003, 0004, 0005 | 072bae3 |
| 2026-09-10 | 0006, 0007 | 4c00bc8, 70d20dc |
| 2026-09-12 | 0008 (atualizado no mesmo dia por 3ad2dde), 0009, 0010 | 96c1f3a, 539c825 |

> [!info]- Detalhe técnico
> O índice do repositório (`docs/adr/README.md:14`) ainda descreve ADR-0008 como "default unchanged pending a live A/B"; o ADR foi atualizado (`docs/adr/0008-verification-posture.md:65`) e o código usa `conservative` como padrão (`agents/code-review/agent.ts:472`).
