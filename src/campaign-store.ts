import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CampaignContractSchema, CampaignEventSchema, type CampaignContract, type CampaignEvent, type ReviewIdentity } from './domain-contracts.js'
import { CampaignEngineStateSchema, createCampaignEngineState, replayCampaign, transitionCampaign } from './campaign-reducer.js'
import { stableFingerprint } from './stable-fingerprint.js'

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)

export const CampaignCheckpointSchema = z.object({
  version: z.literal(1),
  identityFingerprint: fingerprint,
  campaign: CampaignContractSchema,
  events: z.array(CampaignEventSchema).readonly(),
  state: CampaignEngineStateSchema,
  externalEffects: z.record(fingerprint).readonly(),
  updatedAt: z.string().datetime(),
}).strict().readonly()

export type CampaignCheckpoint = z.infer<typeof CampaignCheckpointSchema>

export type CampaignLease = Readonly<{
  version: 1
  ownerId: string
  token: string
  keys: readonly string[]
  expiresAt: string
}>

const leaseSchema = z.object({
  version: z.literal(1),
  ownerId: z.string().min(1),
  token: z.string().uuid(),
  keys: z.array(z.string().min(1)).readonly(),
  expiresAt: z.string().datetime(),
}).strict().readonly()

const checkpointPath = (root: string, campaignId: string) => join(root, 'campaigns', stableFingerprint(campaignId), 'checkpoint.json')
const leasePath = (root: string, key: string) => join(root, 'leases', stableFingerprint(key))
const prKey = (identity: ReviewIdentity) => `pr:${identity.repository}#${identity.pullNumber}`
const guardPath = (directory: string) => join(directory, '.guard')

function parseCheckpoint(raw: unknown): CampaignCheckpoint {
  const checkpoint = CampaignCheckpointSchema.parse(raw)
  const replayed = replayCampaign(checkpoint.campaign, checkpoint.events)
  if (stableFingerprint(replayed) !== stableFingerprint(checkpoint.state)) throw new Error('checkpoint state does not match its event log')
  return checkpoint
}

function atomicJson(file: string, value: unknown, beforeRename?: () => void): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  const body = `${JSON.stringify(value, null, 2)}\n`
  let handle: number | undefined
  try {
    handle = openSync(temporary, 'wx', 0o600)
    writeFileSync(handle, body)
    fsyncSync(handle)
    closeSync(handle)
    handle = undefined
    beforeRename?.()
    renameSync(temporary, file)
    const directory = openSync(dirname(file), 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } catch (error) {
    if (handle !== undefined) closeSync(handle)
    rmSync(temporary, { force: true })
    throw error
  }
}

function readLease(root: string, key: string): CampaignLease {
  return leaseSchema.parse(JSON.parse(readFileSync(join(leasePath(root, key), 'lease.json'), 'utf8')))
}

function assertLease(root: string, lease: CampaignLease, now = Date.now()): void {
  for (const key of lease.keys) {
    const current = readLease(root, key)
    if (current.token !== lease.token || Date.parse(current.expiresAt) <= now) throw new Error(`lease is not active for ${key}`)
  }
}

function acquireGuards(root: string, keys: readonly string[]): string[] {
  const acquired: string[] = []
  try {
    for (const key of keys) {
      const guard = guardPath(leasePath(root, key))
      mkdirSync(guard)
      acquired.push(guard)
    }
    return acquired
  } catch (error) {
    for (const guard of acquired.reverse()) rmSync(guard, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('lease operation already in progress')
    throw error
  }
}

function releaseGuards(guards: readonly string[]): void {
  for (const guard of [...guards].reverse()) rmSync(guard, { recursive: true, force: true })
}

export function acquireCampaignLease(input: {
  root: string
  campaignId: string
  identities: readonly ReviewIdentity[]
  ownerId: string
  ttlMs: number
  now?: number
}): CampaignLease {
  if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) throw new Error('lease ttlMs must be a positive integer')
  const now = input.now ?? Date.now()
  const keys = [...new Set([`campaign:${input.campaignId}`, ...input.identities.map(prKey)])].sort()
  const lease = leaseSchema.parse({ version: 1, ownerId: input.ownerId, token: randomUUID(), keys, expiresAt: new Date(now + input.ttlMs).toISOString() })
  const acquired: string[] = []
  try {
    for (const key of keys) {
      const directory = leasePath(input.root, key)
      mkdirSync(dirname(directory), { recursive: true, mode: 0o700 })
      for (;;) {
        try {
          mkdirSync(directory, { mode: 0o700 })
          mkdirSync(guardPath(directory))
          try { atomicJson(join(directory, 'lease.json'), lease) } finally { rmSync(guardPath(directory), { recursive: true, force: true }) }
          acquired.push(key)
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          const guards = acquireGuards(input.root, [key])
          try {
            const current = readLease(input.root, key)
            if (Date.parse(current.expiresAt) > now) throw new Error(`lease already held for ${key}`)
            const stale = `${directory}.stale.${randomUUID()}`
            renameSync(directory, stale)
            rmSync(stale, { recursive: true, force: true })
          } finally { releaseGuards(guards) }
        }
      }
    }
    return lease
  } catch (error) {
    releaseCampaignLease(input.root, { ...lease, keys: acquired })
    throw error
  }
}

export function releaseCampaignLease(root: string, lease: CampaignLease): void {
  for (const key of lease.keys) {
    let guards: string[] = []
    try {
      guards = acquireGuards(root, [key])
      if (readLease(root, key).token === lease.token) {
        const released = `${leasePath(root, key)}.released.${lease.token}`
        renameSync(leasePath(root, key), released)
        rmSync(released, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    finally { releaseGuards(guards) }
  }
}

export function createCampaignCheckpoint(campaign: CampaignContract, identityFingerprint: string, now = new Date().toISOString()): CampaignCheckpoint {
  return parseCheckpoint({ version: 1, identityFingerprint, campaign, events: [], state: createCampaignEngineState(campaign), externalEffects: {}, updatedAt: now })
}

export function loadCampaignCheckpoint(root: string, campaignId: string, identityFingerprint: string): CampaignCheckpoint | undefined {
  const file = checkpointPath(root, campaignId)
  if (!existsSync(file)) return undefined
  const checkpoint = parseCheckpoint(JSON.parse(readFileSync(file, 'utf8')))
  if (checkpoint.identityFingerprint !== identityFingerprint) throw new Error('checkpoint identity is stale')
  return checkpoint
}

export function saveCampaignCheckpoint(root: string, checkpoint: CampaignCheckpoint, lease: CampaignLease, options: { beforeRename?: () => void } = {}): void {
  const parsed = parseCheckpoint(checkpoint)
  const requiredKeys = [`campaign:${parsed.campaign.campaignId}`, ...Object.values(parsed.state.pullRequests).map((run) => prKey(run.identity))]
  if (requiredKeys.some((key) => !lease.keys.includes(key))) throw new Error('lease does not own this campaign and all registered pull requests')
  const guards = acquireGuards(root, lease.keys)
  try {
    assertLease(root, lease)
    atomicJson(checkpointPath(root, parsed.campaign.campaignId), parsed, options.beforeRename)
  } finally { releaseGuards(guards) }
}

export function appendCampaignEvent(root: string, checkpoint: CampaignCheckpoint, event: CampaignEvent, lease: CampaignLease, now = new Date().toISOString()): CampaignCheckpoint {
  const next = parseCheckpoint({ ...checkpoint, events: [...checkpoint.events, event], state: transitionCampaign(checkpoint.state, event), updatedAt: now })
  saveCampaignCheckpoint(root, next, lease)
  return next
}

export function recordExternalEffect(root: string, checkpoint: CampaignCheckpoint, key: string, evidenceFingerprint: string, lease: CampaignLease, now = new Date().toISOString()): CampaignCheckpoint {
  if (checkpoint.externalEffects[key]) return checkpoint
  const next = parseCheckpoint({ ...checkpoint, externalEffects: { ...checkpoint.externalEffects, [key]: fingerprint.parse(evidenceFingerprint) }, updatedAt: now })
  saveCampaignCheckpoint(root, next, lease)
  return next
}

export function pendingReviewUnitIds(checkpoint: CampaignCheckpoint): string[] {
  return Object.values(checkpoint.state.reviewUnits).filter((unit) => unit.state !== 'COMPLETED').map((unit) => unit.unitId).sort()
}

export function shouldApplyExternalEffect(checkpoint: CampaignCheckpoint, key: string): boolean {
  return checkpoint.externalEffects[key] === undefined
}
