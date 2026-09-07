import { defineConfig } from '../../dist/src/public-config.js'

export default defineConfig({
  target: { provider: 'github', repository: 'AgentsKit-io/agentskit-os' },
  review: { provider: 'codex-cli' },
  memory: { enabled: true, provider: 'self-hosted', path: '.agentskit/review-memory/messages.json', retentionDays: 30 },
  batches: { enabled: true, size: 5, requireCompleteCoverage: true, failOnUnreviewableFiles: true },
})
