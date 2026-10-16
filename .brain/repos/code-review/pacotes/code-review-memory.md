---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 4c442c0
metodo: "análise estática do código em 5580f8b; doc-bridge 1.12.0 (`ak-docs list knowledge`) listou os módulos; chamadores conferidos com `git grep`; nenhum store foi gravado. Auditado em 2026-10-16 (v2): todas as referências arquivo:linha e símbolos conferidos mecanicamente e amostra semântica verificada contra o código em 4c442c0 (seção Auditoria v2 em Auditoria - code-review)."
fontes:
  - src/review-stores.ts
  - src/review-feedback.ts
  - src/review-learning.ts
  - src/file-memory.ts
  - src/review-cache.ts
  - src/review-rules.ts
  - agents/code-review/rules.ts
  - agents/code-review/agent.ts
  - src/cli.ts
  - src/index.ts
  - src/public-config.ts
  - src/review-config.ts
  - scripts/review-cycle.mjs
  - docs/adr/0005-separated-safe-review-memory.md
  - docs/adr/0009-layered-language-rules.md
  - docs/for-agents/code-review.md
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-memory

> [!tldr] Em linguagem comum
> É o caderno do revisor, dividido em gavetas que não se misturam: o que aconteceu em cada execução, um cache de resultados já validados, o feedback das pessoas sobre os achados e um pequeno conjunto de regras que alguém **aprovou**. Só as regras aprovadas voltam para a IA, e sempre filtradas pelo repositório, caminho, linguagem e tipo de problema. Conversas com a IA nunca viram memória.

← [[00 Hub - code-review]]

## O que faz e por que existe

Implementa [[code-review ADR-0005 - Memória de revisão separada e segura]]: estado operacional, cache, feedback e conhecimento aprovado ficam em arquivos e schemas diferentes; o conhecimento persistente exclui código-fonte, segredos, prompts e transcrições. Também abriga as **regras por linguagem** de [[code-review ADR-0009 - Regras por linguagem em camadas]], que são conhecimento declarativo (não aprendido).

Partes:

- **Stores** (`src/review-stores.ts`): feedback (até 2000 entradas) e conhecimento aprovado (até 200 regras), com retenção em dias, escrita atômica e trava por caminho dentro do processo (`src/review-stores.ts:147`, `src/review-stores.ts:161`, `src/review-stores.ts:102`).
- **Recuperação com escopo** (`createApprovedReviewRetriever`, `src/review-stores.ts:208`): implementa o contrato `Retriever` de [[agentskit-core]]; até 20 regras e ~2000 tokens (`src/review-stores.ts:26`), ordenadas por especificidade.
- **Reconciliação de feedback** (`reconcileReviewFeedback`, `src/review-feedback.ts:93`): agrupa feedback `accepted`/`fixed` por (repo, arquivo, linha, título); com ≥ 2 evidências gera um **candidato** `active: false`, `requiresApproval: true` (`src/review-feedback.ts:27`, `src/review-feedback.ts:116`). `activeRulesCreated` é literalmente 0 no schema (`src/review-feedback.ts:47`).
- **Cache de revisão** (`createReviewCache`, `src/review-cache.ts:74`): chave = fingerprint de 7 identidades (fonte, diff, base, política, prompt, modelo, conhecimento); só devolve registros com `validation.status: 'passed'` (`src/review-cache.ts:86`).
- **Regras por linguagem** (`src/review-rules.ts`, `agents/code-review/rules.ts`): camadas projeto › global › sistema, por glob.
- **Compatibilidade**: `createFileMemory` (um `ChatMemory` em arquivo) e `loadApprovedReviewRules`, que aceita tanto o store novo quanto mensagens prefixadas num `ChatMemory` (`src/review-learning.ts:14`).

## API e contratos

| Símbolo | Tipo | Para que serve | Onde |
|---|---|---|---|
| `createReviewKnowledgeStore(path, retentionDays?)` | fábrica → `{ path, load, approvedRules, saveApprovedRule }` | Regras aprovadas | `src/review-stores.ts:161` |
| `createReviewFeedbackStore(path, retentionDays?)` | fábrica → `{ path, load, append, size }` | Feedback de achados | `src/review-stores.ts:147` |
| `createApprovedReviewRetriever(store, scope)` | função → `Retriever` | Recuperação limitada por escopo | `src/review-stores.ts:208` |
| `createReviewStores(root)`, `createReviewStoreLayout(root)` | funções | Layout `state/`, `cache/`, `feedback.json`, `knowledge.json` | `src/review-stores.ts:221`, `src/review-stores.ts:135` |
| `ReviewSafeTextSchema` | Zod | Recusa texto com bloco de chave privada ou prefixos de token do GitHub, npm, OpenAI e AWS | `src/review-stores.ts:9` |
| `ReviewKnowledgeScopeSchema`, `ReviewKnowledgeSchema`, `ReviewFeedbackSchema` (+ `*FileSchema`) | Zod v1 | Contratos | `src/review-stores.ts:21`, `src/review-stores.ts:67`, `src/review-stores.ts:44` |
| `reconcileReviewFeedback`, `createReviewReconciliationStore`, `ReviewCandidateRuleSchema` | função/fábrica/schema | Candidatos inativos com proveniência | `src/review-feedback.ts:93`, `src/review-feedback.ts:82`, `src/review-feedback.ts:23` |
| `createApprovedReviewRule`, `loadApprovedReviewRules` | funções | Regra como mensagem prefixada; leitura unificada | `src/review-learning.ts:8`, `src/review-learning.ts:14` |
| `createFileMemory(path, retentionDays?)` | fábrica → `ChatMemory` | Memória local limitada (200 mensagens, 2 MiB) | `src/file-memory.ts:9`, `src/file-memory.ts:5` |
| `createReviewCache`, `reviewCacheKey`, `ReviewCacheIdentitySchema`, `ReviewCacheRecordSchema` | cache | Reuso de lotes validados | `src/review-cache.ts:74`, `src/review-cache.ts:70`, `src/review-cache.ts:9`, `src/review-cache.ts:45` |
| `matchGlob`, `loadRuleLayers`, `resolveRuleForFile`, `resolveRulesForFiles` | funções (internas, não exportadas na raiz) | Regras por linguagem | `src/review-rules.ts:42`, `src/review-rules.ts:90`, `src/review-rules.ts:109`, `src/review-rules.ts:126` |
| `SYSTEM_RULES` | const | 10 checklists embutidos (ts-js, python, go, rust, java, terraform, github-workflows, yaml, json, default) | `agents/code-review/rules.ts:81` |

Exportados na raiz: `src/index.ts:12`, `src/index.ts:13`, `src/index.ts:14`, `src/index.ts:101`, `src/index.ts:107`.

**Exemplo real** — a CLI injeta o store de conhecimento quando a config pública habilita memória self-hosted (`src/cli.ts:306`):

```ts
const configuredKnowledge = projectConfig?.config.memory.enabled && projectConfig.config.memory.provider === 'self-hosted'
  ? createReviewKnowledgeStore(memoryFilePath(process.cwd(), projectConfig.config.memory.path), projectConfig.config.memory.retentionDays)
  : undefined
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Consumidor | [[code-review-engine]] — `resolveConventions` junta convenções + "APPROVED REVIEW RULES" + "LANGUAGE/PATH REVIEW RULES" (`agents/code-review/agent.ts:707`) |
| Consumidor | [[code-review-quality]] — `review-cycle` usa cache por lote, A/B de memória, validação de stores e reconciliação (`scripts/review-cycle.mjs:230`, `scripts/review-cycle.mjs:445`, `scripts/review-cycle.mjs:483`) |
| Depende | [[agentskit-core]] — `Retriever`, `MemoryError`, `ChatMemory`, serialização (`src/review-stores.ts:3`, `src/file-memory.ts:3`) |
| Depende | `writeAtomicJson` de [[code-review-campaign]] (`src/review-stores.ts:5`) |

## Dados e efeitos

- **Arquivos** (todos JSON versão 1, escrita atômica `0600`):
  - Conhecimento: `memory.path` da config pública, padrão `.agentskit/review-memory` → `messages.json` quando não termina em `.json` (`src/public-config.ts:66`, `src/cli.ts:133`). No ciclo, relativo ao `state-dir` (`scripts/review-cycle.mjs:486`).
  - Feedback, reconciliação e histórico de validação: `feedback.json`, `reconciliation.json`, `validation-history.json` ao lado do arquivo de conhecimento (`scripts/review-cycle.mjs:504`, `scripts/review-cycle.mjs:512`, `scripts/review-cycle.mjs:515`).
  - Cache: `<state-dir>/review-cache/<chave>.json` (`scripts/review-cycle.mjs:230`, `src/review-cache.ts:75`).
  - Regras: `<projeto>/.agentskit-review/rules.json` e `~/.agentskit-review/rules.json`; arquivo ausente ou inválido vira camada vazia, sem erro (`src/review-rules.ts:89`).
- **Sem rede, sem variáveis de ambiente.** Lê `os.homedir()` para a camada global.
- **Retenção:** padrão 365 dias, máx. 3650 (`src/public-config.ts:67`).

## Como mexer (para agentes)

- **Comece por:** `src/review-stores.ts` (`docs/for-agents/code-review.md:23`) e `src/review-feedback.ts` (`docs/for-agents/code-review.md:24`).
- **Invariantes:**
  - Nada de promoção automática: candidato é sempre `active: false` e `requiresApproval: true`; `memory.autoPromoteRules` padrão `false` (`src/public-config.ts:69`).
  - O runtime de revisão nunca persiste conversa (`memory: undefined`, `agents/code-review/agent.ts:663`).
  - Texto persistido passa por `ReviewSafeTextSchema`; caminhos são relativos e sem `..` (`src/review-stores.ts:16`).
  - Regra de repositório só entra quando o escopo traz o mesmo repositório (`src/review-stores.ts:182`).
  - Regras por linguagem desligadas por padrão (`agents/code-review/agent.ts:476`).
- **Testes:** `test/review-stores.test.mjs`, `test/review-feedback.test.mjs`, `test/review-learning.test.mjs`, `test/file-memory.test.mjs`, `test/review-cache.test.mjs`, `test/review-rules.test.mjs`, `test/continuous-improvement.test.mjs`.
- **Validação:** `npm run check`.
- **Armadilhas:** a trava `withPathLock` só serializa dentro de um processo; dois processos no mesmo arquivo dependem apenas da escrita atômica. O comentário em `agents/code-review/lenses.ts:202` manda manter `DEFAULT_PROTECTED_SUBJECTS` em sincronia com `src/review-config.ts`, mas esse arquivo não define a constante: ela é definida no próprio `agents/code-review/lenses.ts:204` (comentário desatualizado).

## Decisões e história

- [[code-review ADR-0005 - Memória de revisão separada e segura]], [[code-review ADR-0009 - Regras por linguagem em camadas]].

| Data | Commit | O quê |
|---|---|---|
| 2026-09-12 | 41587b6 | Regras por linguagem com globs (#266) |
| 2026-09-09 | 6db325d | Recuperação de conhecimento aprovado com escopo (#202) |
| 2026-09-09 | 99b27b9 | Reconciliação de feedback em candidatos (#200) |
| 2026-09-09 | f764acc | Separação dos stores de estado e conhecimento (#198) |
| 2026-09-09 | 3a02b4c | Reuso de unidades de revisão imutáveis (#194) |
| 2026-09-08 | 94db243 | Ciclo determinístico de qualidade (#135) |
| 2026-09-07 | ab82590 | Memória de projeto e comentários configuráveis (#90) |

> [!info]- Detalhe técnico
> - Ordenação da recuperação: especificidade (repo+path+linguagem+categoria) desc, depois data desc; orçamento de caracteres = `maxTokens × 4` (`src/review-stores.ts:191`, `src/review-stores.ts:196`).
> - `loadApprovedReviewRules` com `ChatMemory` e escopo devolve vazio — escopo só funciona com o store novo (`src/review-learning.ts:21`).
> - Regras resolvidas são truncadas em 4000 caracteres por pacote (`agents/code-review/agent.ts:726`).
> - Glob próprio (`**`, `*`, `?`, `{a,b}`), sem dependência nova (`src/review-rules.ts:42`).

> [!bug] Existe, mas ninguém usa
> - **Não há caminho no repositório que aprove um candidato.** `saveApprovedRule` só é chamado pelo ciclo para semear o corpus de aprendizado e um teste de persistência (`scripts/review-cycle.mjs:454`, `scripts/review-cycle.mjs:496`); aprovar é tarefa de quem usa a API.
> - O ciclo só grava feedback com `status: 'pending'` (`scripts/review-cycle.mjs:509`) e nada no repo muda o status para `accepted`/`fixed`; logo, a reconciliação automática não gera candidatos sem intervenção externa.
> - `feedback.learnFromAcceptedFindings`, `learnFromRejectedFindings`, `learnFromFixedFindings` (`src/public-config.ts:73`) não são lidos por nenhum código; `memory.provider: 'agentskit'` é aceito mas só `self-hosted` tem efeito (`src/cli.ts:306`).
> - `createFileMemory`, `createReviewStores`, `createReviewStoreLayout` e `createApprovedReviewRule` são exportados sem chamador interno.
