import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildMessage } from '@agentskit/core'
import { createFileMemory } from '../dist/src/file-memory.js'
import { createApprovedReviewRule, loadApprovedReviewRules } from '../dist/src/review-learning.js'

test('review learning loads only explicitly approved bounded rules', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-review-learning-'))
  try {
    const memory = createFileMemory(join(directory, 'messages.json'))
    await memory.save([
      buildMessage({ role: 'user', content: 'ordinary transcript content', status: 'complete' }),
      createApprovedReviewRule('Never call legacySend; use auditedSend.'),
    ])
    assert.deepEqual(await loadApprovedReviewRules(memory), ['Never call legacySend; use auditedSend.'])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
