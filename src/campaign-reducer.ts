import { z } from 'zod'
import {
  CampaignContractSchema,
  CampaignEventSchema,
  DomainFailureSchema,
  PullRequestRunContractSchema,
  ReviewUnitContractSchema,
  type CampaignContract,
  type CampaignEvent,
  type PullRequestRunContract,
  type ReviewUnitContract,
} from './domain-contracts.js'

export const CampaignEngineStateSchema = z.object({
  version: z.literal(1),
  campaign: CampaignContractSchema,
  pullRequests: z.record(PullRequestRunContractSchema).readonly(),
  reviewUnits: z.record(ReviewUnitContractSchema).readonly(),
  unitEvidence: z.record(z.string().regex(/^[a-f0-9]{64}$/)).readonly(),
  unitFailures: z.record(DomainFailureSchema).readonly(),
  lastSequence: z.number().int().min(-1),
}).strict().readonly()

export type CampaignEngineState = z.infer<typeof CampaignEngineStateSchema>

export function createCampaignEngineState(campaign: CampaignContract): CampaignEngineState {
  if (campaign.state !== 'PLANNED' || campaign.outcome !== null || campaign.pullRequestRunIds.length) throw new Error('initial campaign must be empty and planned')
  return CampaignEngineStateSchema.parse({ version: 1, campaign, pullRequests: {}, reviewUnits: {}, unitEvidence: {}, unitFailures: {}, lastSequence: -1 })
}

function updateRun(state: CampaignEngineState, runId: string, expected: PullRequestRunContract['state'], next: PullRequestRunContract['state']): CampaignEngineState {
  const run = state.pullRequests[runId]
  if (!run || run.state !== expected || run.outcome !== null) throw new Error(`pull-request run ${runId} cannot transition from ${run?.state ?? 'missing'} to ${next}`)
  return { ...state, pullRequests: { ...state.pullRequests, [runId]: PullRequestRunContractSchema.parse({ ...run, state: next }) } }
}

function updateUnit(state: CampaignEngineState, unitId: string, expected: ReviewUnitContract['state'], next: ReviewUnitContract['state']): CampaignEngineState {
  const unit = state.reviewUnits[unitId]
  if (!unit || unit.state !== expected) throw new Error(`review unit ${unitId} cannot transition from ${unit?.state ?? 'missing'} to ${next}`)
  return { ...state, reviewUnits: { ...state.reviewUnits, [unitId]: ReviewUnitContractSchema.parse({ ...unit, state: next }) } }
}

export function transitionCampaign(input: CampaignEngineState, rawEvent: CampaignEvent): CampaignEngineState {
  const state = CampaignEngineStateSchema.parse(input)
  const event = CampaignEventSchema.parse(rawEvent)
  if (state.campaign.state === 'TERMINAL') throw new Error('terminal campaign state is immutable')
  if (event.campaignId !== state.campaign.campaignId) throw new Error('event belongs to another campaign')
  if (event.sequence !== state.lastSequence + 1) throw new Error(`expected event sequence ${state.lastSequence + 1}`)

  const payload = event.payload
  let next = state
  switch (payload.type) {
    case 'CAMPAIGN_STARTED':
      if (state.campaign.state !== 'PLANNED') throw new Error('campaign can start only once')
      next = { ...state, campaign: CampaignContractSchema.parse({ ...state.campaign, state: 'RUNNING' }) }
      break
    case 'PULL_REQUEST_REGISTERED': {
      const run = payload.run
      if (state.campaign.state !== 'RUNNING' || run.campaignId !== state.campaign.campaignId || run.state !== 'DISCOVERED' || run.outcome !== null || state.pullRequests[run.runId]) throw new Error('invalid pull-request registration')
      next = {
        ...state,
        campaign: CampaignContractSchema.parse({ ...state.campaign, pullRequestRunIds: [...state.campaign.pullRequestRunIds, run.runId] }),
        pullRequests: { ...state.pullRequests, [run.runId]: run },
      }
      break
    }
    case 'PULL_REQUEST_ELIGIBLE': next = updateRun(state, payload.runId, 'DISCOVERED', 'ELIGIBLE'); break
    case 'PREFLIGHT_PASSED': next = updateRun(state, payload.runId, 'ELIGIBLE', 'PREFLIGHTED'); break
    case 'REVIEW_PLANNED': next = updateRun(state, payload.runId, 'PREFLIGHTED', 'PLANNED'); break
    case 'REVIEW_STARTED': next = updateRun(state, payload.runId, 'PLANNED', 'RUNNING'); break
    case 'REVIEW_UNIT_PLANNED': {
      const unit = payload.unit
      if (state.pullRequests[unit.runId]?.state !== 'RUNNING' || unit.state !== 'PENDING' || state.reviewUnits[unit.unitId]) throw new Error('invalid review-unit plan')
      next = { ...state, reviewUnits: { ...state.reviewUnits, [unit.unitId]: unit } }
      break
    }
    case 'REVIEW_UNIT_STARTED': next = updateUnit(state, payload.unitId, 'PENDING', 'RUNNING'); break
    case 'REVIEW_UNIT_COMPLETED':
      next = { ...updateUnit(state, payload.unitId, 'RUNNING', 'COMPLETED'), unitEvidence: { ...state.unitEvidence, [payload.unitId]: payload.evidenceFingerprint } }
      break
    case 'REVIEW_UNIT_FAILED':
      next = { ...updateUnit(state, payload.unitId, 'RUNNING', 'FAILED'), unitFailures: { ...state.unitFailures, [payload.unitId]: payload.failure } }
      break
    case 'PULL_REQUEST_TERMINATED': {
      const run = state.pullRequests[payload.runId]
      const early = payload.outcome === 'SKIPPED' || payload.outcome === 'BLOCKED' || payload.outcome === 'CANCELLED'
      if (!run || run.state === 'TERMINAL' || (!early && run.state !== 'RUNNING')) throw new Error('invalid pull-request terminal transition')
      const units = Object.values(state.reviewUnits).filter((unit) => unit.runId === payload.runId)
      if (!early && (!units.length || units.some((unit) => unit.state !== 'COMPLETED'))) throw new Error('successful pull-request outcome requires complete review units')
      next = { ...state, pullRequests: { ...state.pullRequests, [run.runId]: PullRequestRunContractSchema.parse({ ...run, state: 'TERMINAL', outcome: payload.outcome }) } }
      break
    }
    case 'CAMPAIGN_TERMINATED':
      if (Object.values(state.pullRequests).some((run) => run.state !== 'TERMINAL')) throw new Error('campaign cannot terminate while a pull request is active')
      next = { ...state, campaign: CampaignContractSchema.parse({ ...state.campaign, state: 'TERMINAL', outcome: payload.outcome }) }
      break
    case 'CANCELLATION_REQUESTED':
      next = {
        ...state,
        campaign: CampaignContractSchema.parse({ ...state.campaign, state: 'TERMINAL', outcome: 'CANCELLED' }),
        pullRequests: Object.fromEntries(Object.entries(state.pullRequests).map(([id, run]) => [id, run.state === 'TERMINAL' ? run : PullRequestRunContractSchema.parse({ ...run, state: 'TERMINAL', outcome: 'CANCELLED' })])),
        reviewUnits: Object.fromEntries(Object.entries(state.reviewUnits).map(([id, unit]) => [id, unit.state === 'PENDING' || unit.state === 'RUNNING' ? ReviewUnitContractSchema.parse({ ...unit, state: 'CANCELLED' }) : unit])),
      }
      break
    default: {
      const unsupported: never = payload
      throw new Error(`unsupported campaign event: ${String(unsupported)}`)
    }
  }
  return CampaignEngineStateSchema.parse({ ...next, lastSequence: event.sequence })
}

export function replayCampaign(campaign: CampaignContract, events: readonly CampaignEvent[]): CampaignEngineState {
  return events.reduce(transitionCampaign, createCampaignEngineState(campaign))
}
