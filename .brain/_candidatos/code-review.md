# Candidatos — code-review

Material bruto para as notas globais. Repo `code-review` em `5580f8b` (código idêntico a `4f37050`; o commit de topo só semeou `.brain/`). Caminhos relativos ao repo.

## Conceitos

- **Verificação adversarial (cético)** → Depois da análise, chamadas separadas tentam refutar cada achado; o achado sobrevive se as refutações forem no máximo metade dos votos (empate sobrevive), com até 3 rodadas adaptativas. Sem veredito, o achado sai marcado `unverified` e a revisão fica incompleta. → [[code-review-engine]], [[code-review ADR-0008 - Postura de verificação conservadora]] → `agents/code-review/agent.ts:1103`, `agents/code-review/agent.ts:1200`.
- **Postura de verificação (`strict` / `conservative`)** → Dois prompts de cético: `strict` refuta com base em raciocínio; `conservative` (padrão) só refuta com prova literal e veta assuntos protegidos. → [[code-review-engine]], ADR-0008 → `agents/code-review/lenses.ts:208`, `agents/code-review/lenses.ts:238`, `agents/code-review/agent.ts:472`.
- **Assunto protegido** → Categoria (memory-safety, concurrency, behavioral-change, unused-parameter, linkage-consistency) que o cético conservador não pode refutar sem prova inequívoca. → ADR-0008 → `agents/code-review/lenses.ts:204`.
- **Pacote de contexto (context pack)** → Grupo pequeno de arquivos relacionados com hunks alterados + vizinhança, medido em tokens antes da chamada; recebe uma análise multidimensional. Arquivo grande é dividido em vários pacotes. → [[code-review-engine]], ADR-0004, ADR-0006 → `agents/code-review/agent.ts:844`, `agents/code-review/agent.ts:939`.
- **Revisão incompleta / UNREVIEWED** → Estado explícito para qualquer cobertura faltante (arquivo excluído, grande demais, lente obrigatória ausente, prazo, achado não verificado); nunca vira aprovação e dá exit 2. → [[code-review-engine]], ADR-0001 → `agents/code-review/agent.ts:1548`, `src/cli.ts:401`.
- **Lente** → Uma das 7 dimensões de revisão (correctness, security, performance, maintainability, design, tests, conventions); correctness/security/tests são obrigatórias por padrão. → [[code-review-engine]] → `agents/code-review/agent.ts:415`, `agents/code-review/agent.ts:438`.
- **Fronteira de dados do provedor** → `local`/`remote`/`unknown`; remota ou desconhecida exige redação de segredos antes de enviar fonte. → [[code-review-providers]], [[code-review-engine]] → `src/provider-registry.ts:72`, `src/cli.ts:127`.
- **Modo de confiança (`isolated` / `trusted-local`)** → Como uma CLI local é executada: ambiente e HOME temporários vs herdar login e ambiente do usuário; `trusted-local` é proibido em CI e em config de projeto. → [[code-review-providers]], ADR-0001 → `src/local-cli-process.ts:63`, `src/review-config.ts:159`.
- **Marcador de revisão idempotente** → Comentário HTML `agentskit-code-review:v1 sha=… fingerprint=…` no corpo publicado; impede repetir revisão da mesma SHA+política e permite revisão incremental. → [[code-review-scm]] → `src/github-review-state.ts:7`, `src/github-review-state.ts:186`.
- **Fingerprint de política** → Hash da configuração semântica efetiva (exceto concorrência) usado para identidade de revisão, cache e marcador. → [[code-review-engine]] → `src/review-policy.ts:15`.
- **Campanha** → Revisão de todos os PRs elegíveis de um repo com preflight sem modelo, fila com leases e desfecho determinístico por PR. → [[code-review-campaign]], ADR-0002 → `src/campaign-runner.ts:75`, `src/campaign-preflight.ts:37`.
- **Lease** → Exclusão mútua por diretório com TTL e heartbeat para campanha e PR. → [[code-review-campaign]] → `src/campaign-store.ts:136`.
- **Canário** → Primeiro lote de um ciclo, validado contra o manifesto (SHA, política, pacotes, completude) antes dos demais. → [[code-review-quality]] → `src/harness.ts:93`, `scripts/review-cycle.mjs:334`.
- **Matriz de qualidade** → 14 áreas pontuadas por execução ou campanha; decisão `PASS`/`BLOCKED` condiciona publicação e merge. → [[code-review-quality]] → `src/quality-matrix.ts:1`, `scripts/review-cycle.mjs:409`.
- **Regra aprovada vs candidata** → Feedback repetido gera candidata inativa que exige aprovação; só aprovadas entram no prompt, com escopo. → [[code-review-memory]], ADR-0005 → `src/review-feedback.ts:27`, `src/review-stores.ts:208`.

## Glossário

- `UNREVIEWED` — arquivo fora da cobertura, com motivo (`agents/code-review/agent.ts:75`).
- `incompleteProfile` — perfil que desliga lente obrigatória; só local com `--allow-incomplete` (`src/review-config.ts:172`).
- ACP — Agent Client Protocol por stdio, transporte padrão de grok-cli/opencode-cli (`src/acp-cli-adapter.ts:90`).
- `doctor` — diagnóstico offline do provedor (`src/provider-registry.ts:239`).
- SARIF — saída 2.1.0 para code scanning (`agents/code-review/reporters.ts:147`).
- `packIds` — identidade de pacote para lotes parciais de um arquivo (`docs/adr/0006-measured-batch-completion.md:13`).
- Orca — automação/runner citado como invocador das campanhas (`scripts/review-campaign.mjs:24`).

## Arestas de dependência

- `code-review --> agentskit-core : AdapterFactory, compileBudget, Retriever, redactSecrets, MemoryError : agents/code-review/agent.ts:1, agents/code-review/sources.ts:6, src/review-stores.ts:3`
- `code-review --> agentskit-adapters : fábricas de API descobertas dinamicamente : src/provider-registry.ts:1`
- `code-review --> agentskit-runtime : createRuntime por chamada estruturada : agents/code-review/agent.ts:663`
- `code-review --> agentskit-tools : defineZodTool : agents/code-review/agent.ts:3`
- `code-review --> agentskit-net : fetchWithRetry/readJson para GitHub : src/github-api-client.ts:1`
- `code-review --> agentskit-cross-platform : spawnNodeChild, killProcessTree, toPosix; check:cross-platform : src/local-cli-process.ts:4, package.json:119`
- `code-review --> agentskit-ink : createProgressObserver : src/cli.ts:17`
- `code-review --> doc-bridge : optionalDependency; docs:index/docs:gate (ak-docs) : package.json:140, package.json:111`
- `code-review --> agentskit-registry : agente de revisão vendorizado : README.md:251`
- `code-review --> .github : workflows reutilizáveis codeql/dependency-review/audit/scorecard fixados por SHA : .github/workflows/codeql.yml:22`
- `code-review-docs --> agentskit (site www.agentskit.io) : shell v1 CSS/JS em runtime do navegador : apps/docs/lib/shell.ts:2`
- `harness --> code-review : declarado no hub do harness (não verificado aqui)`

## Infra e deploy

- npm `@agentskit/code-review` publicado só por `publish.yml` via Trusted Publishing OIDC com provenance; GitHub Release imutável obrigatória (`.github/workflows/publish.yml:95`, `.github/workflows/publish.yml:110`).
- Release por Changesets: `release.yml` abre `chore: version packages` e autoriza execução (não merge) dos checks do PR de versão (`.github/workflows/release.yml:49`).
- Action composta roda `npm ci` + `tsx src/cli.ts` em Node 22 (`action.yml:72`, `action.yml:120`).
- Site: Vercel (raiz `apps/docs`) e Cloudflare Workers static assets `ak-code-review` (`apps/docs/README.md:3`, `apps/docs/wrangler.toml:4`); nenhum workflow implanta.
- Estado local em `.agentskit/review-state` e `.agentskit/review-runs` (`src/public-config.ts:111`, `scripts/review-cycle.mjs:65`).
- CI: ubuntu-latest, Node 22; `npm run check`, cobertura, pack (`.github/workflows/ci.yml:17`).

## Onde ficam os dados

- Conhecimento aprovado: `<memory.path>/messages.json` (JSON v1, ≤ 200 regras) (`src/cli.ts:133`, `src/review-stores.ts:169`).
- Feedback/reconciliação/histórico ao lado do conhecimento (`scripts/review-cycle.mjs:504`).
- Cache de lotes: `<state-dir>/review-cache/<chave>.json` (`scripts/review-cycle.mjs:230`).
- Regras por linguagem: `.agentskit-review/rules.json` (projeto) e `~/.agentskit-review/rules.json` (`src/review-rules.ts:91`).
- Nenhum banco, bucket ou fila.

## Variáveis de ambiente (nomes)

`GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN` (apagadas antes do provedor), `CI`, `LLM_API_KEY`, `<PROVIDER>_API_KEY` (ex.: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROK_API_KEY`, `MINIMAX_API_KEY`), `XAI_API_KEY`, `OPENCODE_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `AGENTSKIT_REVIEW_SUBPROCESS_TIMEOUT_MS`, `AGENTSKIT_REVIEW_MODE`, `ORCA_AUTOMATION_ID`, `CODEX_FIXTURE_*` (testes), `CF_STATIC_EXPORT`, `NEXT_PUBLIC_AGENTSKIT_SHELL_ORIGIN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Dúvidas abertas

- O envelope ACP/headless (`src/acp-cli-adapter.ts:11`) exige `findings` e é estrito; verificação (`verdicts`), consolidação e agrupamento parecem incompatíveis com grok-cli/opencode-cli. Testes só cobrem `submit_findings`. Confirmar ao vivo.
- A evidência Orca é gerada pelo próprio comando de campanha com `status: 'passed'` (`scripts/review-campaign.mjs:98`) — autoatestado ou prova pretendida?
- Qual deploy do site está ativo (Vercel ou Cloudflare)?
- Quem aprova regras candidatas na prática? Não há comando; só `saveApprovedRule` via API.
- Quando o executor de campanha passará a usar o reducer/checkpoint de eventos (ADR-0002 "substituição incremental")?
- `harness` realmente invoca `@agentskit/code-review` (CLI ou API)? Não verificável neste repo.

## Capacidades não usadas

- Motor de eventos de campanha (`transitionCampaign`, `appendCampaignEvent`, `recordExternalEffect`…) — só testes e fault injection (`src/campaign-store.ts:245`).
- Desfechos `MERGED`/`MERGE_BLOCKED` nunca emitidos pela campanha (`src/domain-contracts.ts:9`, `scripts/review-campaign.mjs:109`).
- `jsonReporter` não exportado nem usado (`agents/code-review/reporters.ts:202`); `asHandle()` sem chamador (`agents/code-review/agent.ts:1565`).
- `githubInlineReporter` com dedup por IoU — exportado, mas a CLI usa `scmReviewReporter` (`src/cli.ts:301`).
- `createTelemetryObserver`, `createHarnessContract`, `assertCanaryReady`, `createFileMemory`, `createReviewStores`, `createApprovedReviewRule` — exportados sem chamador interno.
- Opções só de API: `rules.*`, `verification.posture`, `context.grouping: 'semantic'`, `GithubCommentPolicy.routeSeverityBelow`/`incrementalOverlapThreshold`.
- Campos de config pública sem leitor: `merge.requireCleanReview|requireCurrentSha|requireSuccessfulChecks|requireNoChangesRequested|forbidForce`, `execution.cleanupTemporaryArtifacts`, `report.format|includeEveryDiscoveredPullRequest|redactSecrets`, `feedback.learnFrom*`, `target.projectId`, `memory.provider: 'agentskit'` (`src/public-config.ts:22`).
- `ProviderExecutionPolicy.promptCaching|sessions|contextWindowTokens` calculados e não lidos (`src/provider-registry.ts:174`).
- SCM `gitlab` declarado no enum e sem implementação (`src/public-config.ts:25`).
