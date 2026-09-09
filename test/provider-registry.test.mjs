import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ProviderCapabilitiesSchema, providerExecutionPolicy, providerRegistry, resolveProviderId } from '../dist/src/provider-registry.js'

test('registry keeps API and local provider identities separate', () => {
  const entries = providerRegistry()
  const byId = Object.fromEntries(entries.map(entry => [entry.id, entry]))
  assert.equal(byId.grok.kind, 'api')
  assert.equal(byId['grok-cli'].kind, 'cli')
  assert.equal(byId['opencode-cli'].kind, 'cli')
  assert.equal(byId.grok.support, 'stable')
  assert.equal(byId['grok-cli'].support, 'stable')
  assert.equal(byId['opencode-cli'].support, 'stable')
  assert.deepEqual(byId['grok-cli'].transports, ['acp', 'headless', 'auto'])
  assert.deepEqual(byId['opencode-cli'].transports, ['acp', 'headless', 'auto'])
  assert.equal(byId['grok-cli'].defaultTransport, 'acp')
  assert.equal(byId['opencode-cli'].defaultTransport, 'acp')
  assert.equal(resolveProviderId('api'), 'anthropic')
  assert.ok(entries.some(entry => entry.id === 'azureOpenAI'))
  assert.equal(entries.some(entry => entry.id === 'createRouter'), false)
})

test('validated provider capabilities cover engine decisions', () => {
  const entries = providerRegistry()
  const codex = providerExecutionPolicy('codex-cli', entries)
  assert.deepEqual(codex, {
    structuredOutput: true,
    tokenAccounting: 'reported',
    cancellation: true,
    promptCaching: false,
    contextWindowTokens: null,
    sessions: false,
    safeConcurrency: 1,
    requestTimeoutMs: 300_000,
  })
  assert.throws(() => ProviderCapabilitiesSchema.parse({ ...entries[0].capabilities, invented: true }), /unrecognized/i)
  assert.throws(() => ProviderCapabilitiesSchema.parse({ ...entries[0].capabilities, safeConcurrency: 0 }))
})

test('unknown metadata is conservative and explicit AgentsKit hints remain authoritative', () => {
  const entries = providerRegistry({ mystery: () => ({ createSource() {} }) })
  assert.deepEqual(providerExecutionPolicy('mystery', entries), {
    structuredOutput: false,
    tokenAccounting: 'unknown',
    cancellation: false,
    promptCaching: false,
    contextWindowTokens: null,
    sessions: false,
    safeConcurrency: 1,
    requestTimeoutMs: 120_000,
  })
  const adapter = { capabilities: { structuredOutput: true, usage: true }, createSource() { throw new Error('not executed') } }
  const policy = providerExecutionPolicy('mystery', entries, adapter)
  assert.equal(policy.structuredOutput, true)
  assert.equal(policy.tokenAccounting, 'reported')
  assert.equal(policy.safeConcurrency, 1)
})

test('review execution defaults do not branch on provider names', () => {
  const source = readFileSync(new URL('../src/review-config.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /provider\s*===|provider\?\.endsWith/)
  assert.match(source, /providerExecutionPolicy/)
})
