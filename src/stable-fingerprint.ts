import { createHash } from 'node:crypto'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
