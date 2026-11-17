# Regras de CI

Cada regra diz como é verificada. Se a verificação falhar, corrija o código, não a verificação.

- **Pre-push obrigatório e rápido.** `.husky/pre-push` roda `npm run typecheck`. Verifica: `test -x .husky/pre-push`. Não use `--no-verify`.
- **Gate do repo.** `npm run check` e `npm run test:coverage` (npm, `package-lock.json`; nunca pnpm nem lockfile novo). Verifica: job `check` do `ci.yml`.
- **Índice gerado em dia.** Depois de mudar docs ou o `--help` da CLI, rode `npm run docs:index`. Verifica: `git diff --exit-code -- doc-bridge.config.json .doc-bridge llms-full.txt` no CI.
- **Não apague nem pule teste para ganhar tempo.** Teste lento ou instável vira ticket.
