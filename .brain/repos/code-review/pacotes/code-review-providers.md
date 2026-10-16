---
tipo: pacote
repo: code-review
camada: ferramenta
npm: "@agentskit/code-review"
visibilidade: publico
verificado-em: 2026-10-16
commits:
  code-review: 5580f8b
metodo: "análise estática do código em 5580f8b; doc-bridge 1.12.0 (`ak-docs list knowledge`) confirmou os módulos `src/*-adapter.ts` e `src/provider-*.ts`; nenhum provedor ou CLI foi executado."
fontes:
  - src/provider-registry.ts
  - src/provider-execution.ts
  - src/provider-circuit-breaker.ts
  - src/local-cli-process.ts
  - src/local-cli-timeout.ts
  - src/codex-adapter.ts
  - src/claude-code-adapter.ts
  - src/grok-cli-adapter.ts
  - src/opencode-cli-adapter.ts
  - src/acp-cli-adapter.ts
  - src/headless-cli-adapter.ts
  - src/ollama-adapter.ts
  - src/cli.ts
  - src/index.ts
  - agents/code-review/agent.ts
  - action.yml
  - docs/OPERATIONS.md
  - docs/for-agents/code-review.md
  - test/grok-cli-adapter.test.mjs
  - test/opencode-cli-adapter.test.mjs
  - src/review-config.ts
  - scripts/review-campaign.mjs
  - scripts/review-cycle.mjs
  - AGENTS.md
  - docs/adr/0001-bounded-provider-neutral-cli-agents.md
  - docs/provider-compatibility.json
tags: [pacote, repo/code-review, camada/ferramenta]
---

# code-review-providers

> [!tldr] Em linguagem comum
> É a camada que deixa o revisor trabalhar com "qualquer IA": sabe quais provedores existem, confere se estão instalados e autenticados sem gastar uma chamada, e conecta as CLIs instaladas no computador (Codex, Claude Code, Grok, OpenCode) ou um Ollama local como se fossem um modelo comum — sempre em uma caixa isolada, sem ferramentas nem acesso ao repositório.

← [[00 Hub - code-review]]

## O que faz e por que existe

Mantém o contrato `AdapterFactory` de [[agentskit-core]] como única fronteira de modelo (sem segunda abstração, `docs/for-agents/code-review.md:44`) e acrescenta à volta dele:

- **Registro de provedores** com nível de suporte, transporte, fronteira de dados e credenciais (`src/provider-registry.ts:59`). As APIs vêm das fábricas exportadas por [[agentskit-adapters]], descobertas dinamicamente (`src/provider-registry.ts:142`); CLIs locais são uma lista fixa — nunca descobertas arbitrariamente (`src/provider-registry.ts:92`).
- **`doctor`** offline (executável, versão mínima, transporte, modelo, modo, presença de credencial) e `--live` só para `codex-cli` (`src/provider-registry.ts:239`, `src/provider-registry.ts:284`).
- **Adaptadores de CLI local** que transformam uma CLI-agente em um "modelo" de uma ferramenta só, com saída JSON validada.
- **Execução resiliente:** classificação de falhas, backoff, concorrência adaptativa e circuit breaker (`src/provider-execution.ts:6`, `src/provider-execution.ts:46`, `src/provider-circuit-breaker.ts:14`).

## API e contratos

| Símbolo | Tipo | Para que serve | Onde |
|---|---|---|---|
| `providerRegistry()`, `providerEntry()`, `resolveProviderId()` | funções | Lista/resolve provedores (alias `api` → `anthropic`) | `src/provider-registry.ts:146`, `src/provider-registry.ts:169`, `src/provider-registry.ts:164` |
| `PROVIDER_REGISTRY_VERSION`, `ProviderCapabilitiesSchema`, `providerExecutionPolicy()` | const/schema/função | Capacidades declaradas → `safeConcurrency`, `requestTimeoutMs` | `src/provider-registry.ts:10`, `src/provider-registry.ts:18`, `src/provider-registry.ts:174` |
| `diagnoseProvider(options)` | função → `DoctorReport` | Base do `agentskit-review doctor` (não exportada na raiz) | `src/provider-registry.ts:239`, `src/cli.ts:473` |
| `codexCli`, `claudeCode`, `grokCli`, `opencodeCli`, `ollamaReview` | fábricas `AdapterFactory` | Provedores locais | `src/codex-adapter.ts:145`, `src/claude-code-adapter.ts:45`, `src/grok-cli-adapter.ts:9`, `src/opencode-cli-adapter.ts:10`, `src/ollama-adapter.ts:137` |
| `createHeadlessCliAdapter`, `createAutoCliAdapter` | fábricas | Transporte headless e fallback ACP→headless (só local) | `src/headless-cli-adapter.ts:22`, `src/headless-cli-adapter.ts:60` |
| `normalizeProviderFailure`, `providerRetryDelay`, `waitForProviderRetry`, `AdaptiveConcurrencyGate` | funções/classe | Falha tipada (`RETRYABLE`/`TERMINAL`/`CANCELLED`), espera com jitter, gate que reduz paralelismo em instabilidade | `src/provider-execution.ts:6`, `src/provider-execution.ts:31`, `src/provider-execution.ts:37`, `src/provider-execution.ts:46` |
| `LocalCliMode` | tipo | `isolated` \| `trusted-local` | `src/local-cli-process.ts:28` |

Todos exportados na raiz em `src/index.ts:82`, `src/index.ts:84` e `src/index.ts:126`.

Provedores registrados: APIs `anthropic`, `openai`, `gemini`, `grok`, `deepseek`, `mistral`, `groq`, `openrouter`, `together`, `minimax` (`src/provider-registry.ts:79`); locais `codex-cli`, `claude-cli`, `grok-cli`, `opencode-cli`, `ollama` (`src/provider-registry.ts:92`). Fábricas de `@agentskit/adapters` fora dessa lista entram como `experimental` (`src/provider-registry.ts:153`).

**Exemplo real** — seleção na CLI (`src/cli.ts:415`):

```ts
if (provider === 'claude-cli') return claudeCode({ model, mode, oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, worker: reviewConfig.worker })
if (provider === 'codex-cli') return codexCli({ model, mode, worker: reviewConfig.worker, onUsage: (usage) => onTokens?.(usage.inputTokens + usage.outputTokens) })
```

## Quem usa e do que depende

| Relação | Nota / evidência |
|---|---|
| Consumidor principal | [[code-review-engine]] — `buildAdapter` e `preflightProvider` (`src/cli.ts:409`, `src/cli.ts:453`); o agente usa gate e circuit breaker (`agents/code-review/agent.ts:26`) |
| Consumidor | [[code-review-campaign]] — `diagnoseProvider` estático no início da campanha (`scripts/review-campaign.mjs:70`) |
| Consumidor | [[code-review-quality]] — `doctor --json` e `codex login status` no preflight do ciclo (`scripts/review-cycle.mjs:156`, `scripts/review-cycle.mjs:161`) |
| Depende | [[agentskit-adapters]] (import `* as adapters`, `src/provider-registry.ts:1`), [[agentskit-core]] (`redactSecrets`, `src/local-cli-process.ts:3`), [[agentskit-cross-platform]] (`spawnNodeChild`, `killProcessTree`, `src/local-cli-process.ts:4`) |
| Externos | Executáveis `codex`, `claude`, `grok`, `opencode` no `PATH`; servidor Ollama |

## Dados e efeitos

- **Processos:** cada chamada a CLI local abre um processo filho com argv sem shell; o prompt vai por stdin (Windows limita a linha de comando, `src/local-cli-process.ts:39`, `src/codex-adapter.ts:117`).
- **Modo `isolated` (padrão):** `HOME`/`TMPDIR` temporários e ambiente reduzido a `PATH`, `LANG`, `LC_ALL`, `CI`, `SystemRoot`, variáveis `CODEX_FIXTURE_*` de teste e a credencial explicitamente passada (`src/local-cli-process.ts:63`, `src/local-cli-process.ts:70`, `src/local-cli-process.ts:76`). Diretório temporário apagado no fim (`src/local-cli-process.ts:122`).
- **Modo `trusted-local`:** herda todo `process.env` e o cwd (`src/local-cli-process.ts:64`) — necessário para reaproveitar login interativo (por isso a Action recusa `codex-cli` fora de `trusted-local`, `action.yml:99`). Proibido em CI e em config de projeto ([[code-review-engine]]).
- **Limites:** saída 20 MiB padrão / 25 MiB absoluto; timeout absoluto 10 min (`src/local-cli-process.ts:24`); padrão 120 s, Codex 300 s, ajustável por `AGENTSKIT_REVIEW_SUBPROCESS_TIMEOUT_MS` (`src/local-cli-timeout.ts:1`, `src/local-cli-timeout.ts:4`). Ollama usa timeout próprio (`src/ollama-adapter.ts:139`; 30 s segundo `docs/OPERATIONS.md:615`).
- **Codex:** `codex exec --ephemeral --ignore-user-config --ignore-rules -s read-only` com shell, plugins, multi-agent e web search desligados e `--output-schema` (`src/codex-adapter.ts:89`).
- **ACP:** o cliente nega capacidades de fs/terminal e responde `-32601` a qualquer pedido do agente (`src/acp-cli-adapter.ts:94`, `src/acp-cli-adapter.ts:68`).
- **Variáveis:** `XAI_API_KEY` (grok), `OPENCODE_API_KEY` (opencode), `CLAUDE_CODE_OAUTH_TOKEN` (claude em CI), `AGENTSKIT_REVIEW_MODE` (modo padrão do doctor, `src/provider-registry.ts:252`), `LLM_API_KEY` e `<ID>_API_KEY` para APIs (`src/provider-registry.ts:255`).
- **Diagnósticos:** stdout/stderr de falhas passam por `redactSecrets` e são cortados em 4000 caracteres (`src/local-cli-process.ts:53`).

## Como mexer (para agentes)

- **Comece por:** `src/provider-registry.ts` (registro) e o `src/<provider>-adapter.ts` correspondente (`docs/for-agents/code-review.md:55`); a seleção fica em `src/cli.ts:409`.
- **Invariantes:**
  - Nunca colocar chave em argv, fixture, log ou saída (`AGENTS.md:9`); credencial só via `providerCredential` no ambiente do filho.
  - Cada chamada a CLI é um trabalhador de uma lente só; a CLI não pode criar subagentes, ferramentas ou verificações (`docs/adr/0001-bounded-provider-neutral-cli-agents.md:85`).
  - CI não faz fallback silencioso ACP→headless: `--transport auto` é recusado com `CI` (`src/cli.ts:423`).
  - Erro de autenticação é `TERMINAL` (`src/provider-execution.ts:15`) e encerra a revisão inteira.
- **Testes:** `test/provider-registry.test.mjs`, `test/provider-execution.test.mjs`, `test/provider-circuit-breaker.test.mjs`, `test/provider-compatibility.test.mjs`, `test/local-cli-process.test.mjs`, `test/codex-adapter.test.mjs`, `test/grok-cli-adapter.test.mjs`, `test/opencode-cli-adapter.test.mjs`, `test/headless-cli-adapter.test.mjs`, `test/ollama-adapter.test.mjs`, `test/ollama-cli.test.mjs`; fixtures offline em `test/fixtures/bin/`.
- **Validação:** `npm run check` e `npm pack --dry-run`. Passo a passo em [[Guia code-review - Adicionar um provedor]].
- **Armadilhas:** a tabela pública de compatibilidade (`docs/provider-compatibility.json`) é coberta por teste — atualize junto; `live` do doctor só testa Codex.

## Decisões e história

- [[code-review ADR-0001 - Provedores e CLIs com contratos limitados]] — registro, modos de confiança, envelope `schemaVersion: 1`, uma retentativa só para saída inválida.
- [[code-review ADR-0003 - Fronteiras de modelo e SCM]] — `AdapterFactory` como fronteira única.

| Data | Commit | O quê |
|---|---|---|
| 2026-10-02 | 5db8225 | Diagnósticos usam a redação do core (#327) |
| 2026-09-28 | 7b8032d | `minimax` reconhecido como API estável (#319) |
| 2026-09-27 | d132f51 | Codex recebe o prompt por stdin (#315) |
| 2026-09-22 | 57d62f7, 504c72c | Spawn de CLIs no Windows e prompt do Claude por stdin (#295, #296) |
| 2026-09-12 | a792ed7 | Campo `analysis` antes do veredito (#274) |
| 2026-09-09 | d437efc, 1c53222 | Orçamentos hierárquicos; todas as dimensões em uma chamada (#196, #184) |
| 2026-09-08 | 6155fec, d857a58, f142fab | Execução adaptativa, política de capacidades, falha rápida em trabalhador travado |

> [!info]- Detalhe técnico
> - Envelope aceito das CLIs ACP/headless: `.strict()` com `findings` obrigatório e `completedCategories`/`analysis` opcionais (`src/acp-cli-adapter.ts:11`, `src/acp-cli-adapter.ts:18`); o prompt pede sempre `{"schemaVersion":1,...,"findings":[]}` (`src/acp-cli-adapter.ts:40`).
> - Retentativa interna de 1 vez para saída inválida em ACP/headless (`src/acp-cli-adapter.ts:122`, `src/headless-cli-adapter.ts:32`); o agente ainda aplica até 1 retry por falha `RETRYABLE` (`agents/code-review/agent.ts:696`).
> - Circuit breaker: abre após 2 falhas, meio-aberto após 30 s (`src/provider-circuit-breaker.ts:19`).
> - Codex: repete sem `--output-schema` só quando a versão rejeita o schema (`src/codex-adapter.ts:136`).

> [!question] Dúvida
> Pela leitura estática, o envelope ACP/headless (`src/acp-cli-adapter.ts:11`) exige `findings` e rejeita chaves extras; as chamadas de verificação (`submit_verdicts` com `verdicts`), consolidação (`duplicateGroups`) e agrupamento (`groups`) não cabem nele. Com `grok-cli`/`opencode-cli`, toda verificação tenderia a falhar e os achados sairiam `unverified` (revisão `incomplete`). Os testes só exercitam `submit_findings` (`test/grok-cli-adapter.test.mjs:13`, `test/opencode-cli-adapter.test.mjs:14`). Confirmar com uma execução real.

> [!bug] Existe, mas ninguém usa
> - `ProviderExecutionPolicy.promptCaching`, `sessions` e `contextWindowTokens` (`src/provider-registry.ts:174`) são calculados, mas só `safeConcurrency` e `requestTimeoutMs` são lidos por `resolveReviewConfig` (`src/review-config.ts:185`).
