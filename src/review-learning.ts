import { buildMessage, type ChatMemory, type Message } from '@agentskit/core'
import type { ReviewKnowledgeStore } from './review-stores.js'

const APPROVED_RULE_PREFIX = '[agentskit-code-review:approved-rule:v1] '
const MAX_RULES = 20
const MAX_RULE_LENGTH = 500

export function createApprovedReviewRule(rule: string): Message {
  const normalized = rule.trim()
  if (!normalized || normalized.length > MAX_RULE_LENGTH) throw new Error(`approved review rules must contain 1-${MAX_RULE_LENGTH} characters`)
  return buildMessage({ role: 'user', content: `${APPROVED_RULE_PREFIX}${normalized}`, status: 'complete' })
}

export async function loadApprovedReviewRules(memory?: ChatMemory, knowledge?: ReviewKnowledgeStore): Promise<string[]> {
  if (knowledge) return knowledge.approvedRules()
  if (!memory) return []
  const messages = await memory.load()
  return messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith(APPROVED_RULE_PREFIX))
    .map((message) => message.content.slice(APPROVED_RULE_PREFIX.length).trim())
    .filter((rule) => rule.length > 0 && rule.length <= MAX_RULE_LENGTH)
    .slice(-MAX_RULES)
}
