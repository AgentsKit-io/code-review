import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MemoryError, deserializeMessages, serializeMessages, type ChatMemory, type Message } from '@agentskit/core'

const MAX_MESSAGES = 200
const MAX_BYTES = 2 * 1024 * 1024

/** A bounded, repository-local ChatMemory implementation for self-hosted runs. */
export function createFileMemory(path: string, retentionDays = 365): ChatMemory {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const read = (): Message[] => {
    try {
      const record = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (!record || typeof record !== 'object' || (record as { version?: unknown }).version !== 1) {
        throw new MemoryError({ code: 'AK_MEMORY_DESERIALIZE_FAILED', message: 'review memory has an unsupported format', hint: 'Restore a version 1 memory file or remove the explicitly configured file after review.' })
      }
      return deserializeMessages(record as Parameters<typeof deserializeMessages>[0])
        .filter((message) => message.createdAt.getTime() >= cutoff)
        .slice(-MAX_MESSAGES)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      if (error instanceof MemoryError) throw error
      throw new MemoryError({ code: 'AK_MEMORY_LOAD_FAILED', message: 'unable to load review memory', hint: 'Remove or repair the repository-local memory file and retry.', cause: error })
    }
  }
  return {
    load: () => read(),
    save: (messages) => {
      const existing = read()
      const byId = new Map(existing.map((message) => [message.id, message]))
      for (const message of messages) byId.set(message.id, message)
      const bounded = [...byId.values()]
        .filter((message) => message.createdAt.getTime() >= cutoff)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(-MAX_MESSAGES)
      const serialized = JSON.stringify(serializeMessages(bounded))
      if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new MemoryError({ code: 'AK_MEMORY_SAVE_FAILED', message: 'review memory exceeds the local size limit', hint: 'Reduce retained messages or use a dedicated memory backend.' })
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
        writeFileSync(path, serialized, { encoding: 'utf8', mode: 0o600 })
      } catch (error) {
        throw new MemoryError({ code: 'AK_MEMORY_SAVE_FAILED', message: 'unable to save review memory', hint: 'Check repository-local memory directory permissions.', cause: error })
      }
    },
  }
}
