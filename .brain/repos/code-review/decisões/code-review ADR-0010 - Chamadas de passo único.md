---
tipo: adr
repo: code-review
camada: ferramenta
visibilidade: publico
status: aceito
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "leitura do ADR e conferência estática no código em 5580f8b. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - docs/adr/0010-single-step-calls.md
  - agents/code-review/agent.ts
tags: [adr, repo/code-review, camada/ferramenta]
---

# code-review ADR-0010 - Chamadas de passo único

> [!tldr] Em linguagem comum
> Cada pergunta à IA é feita uma única vez, com tudo o que ela precisa já incluído, e a resposta tem formato fixo. O revisor não deixa a IA "sair procurando" outros arquivos em várias rodadas — isso mantém custo, teste e reprodução sob controle.

← [[00 Decisões - code-review]]

## Status e datas

Aceito. Criado em 2026-09-12 (539c825).

## A decisão em linguagem comum

Não adotar arquitetura de loop de agente com ferramentas de leitura e, por isso, não adotar compressão de transcrição. A chamada estruturada única, validada por Zod, continua sendo o modelo de execução. Revisitar só se a detecção cair de forma rastreável à falta de informação que não dá para antecipar, ou se uma classe recorrente de achado exigir que o modelo escolha, na hora, qual arquivo ler.

## Contexto

O `alibaba/open-code-review` roda até 100 turnos com `file_read`/`code_search` e comprime a transcrição a 60 %/80 % da janela. Aqui `maxSteps` padrão é 1 e cada chamada termina num único `submit_*`; agrupamento semântico (#255) e regras por glob (#254) dão raciocínio entre arquivos sem loop.

## Consequências

- Cada chamada é orçada, reproduzível e testável isoladamente; não há estado conversacional oculto nem risco de loop descontrolado.
- Custo: perguntas exploratórias entre arquivos só são atendidas se agrupamento, regras ou `context.maxRelatedFiles` anteciparem a necessidade.
- No código: `maxSteps` em `agents/code-review/agent.ts:455`; `runStructured` em `agents/code-review/agent.ts:589`; agrupamento semântico como chamada separada em `agents/code-review/agent.ts:793`.

## Pacotes afetados

[[code-review-engine]], [[code-review-providers]].

## Substitui / substituído por

Nenhum.

## Fonte

`docs/adr/0010-single-step-calls.md`
