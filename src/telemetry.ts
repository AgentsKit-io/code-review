import type { AgentEvent, Observer } from '@agentskit/core'

export interface TelemetryOptions {
  /** Default false: telemetry is opt-in, never attached silently. */
  enabled?: boolean
  /** `console` (default) writes one JSON line per span; `otlp` POSTs an OTLP/HTTP JSON
   * trace payload to `otlpEndpoint`. */
  exporter?: 'console' | 'otlp'
  /** Required when `exporter: 'otlp'`. The base collector URL; `/v1/traces` is appended. */
  otlpEndpoint?: string
  /**
   * Default false. Progress `detail` text can carry file paths or short excerpts (never
   * prompts, diffs, or provider credentials — those are never visible to an Observer at
   * all). Off by default so enabling telemetry does not, by itself, widen what leaves
   * the process; a caller opts in to this separately and explicitly.
   */
  contentLogging?: boolean
  /** Injectable for testing; defaults to the global `fetch`. */
  fetcher?: typeof fetch
  /** Injectable sink for the `console` exporter; defaults to `process.stderr.write`. */
  write?: (line: string) => void
}

interface OtlpAttribute {
  key: string
  value: { stringValue: string }
}

interface OtlpSpan {
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  status: { code: 0 | 1 | 2 }
}

function buildSpan(event: Extract<AgentEvent, { type: 'progress' }>, contentLogging: boolean): OtlpSpan {
  const endMs = Date.now()
  const startMs = endMs - (event.durationMs ?? 0)
  const attributes: OtlpAttribute[] = [
    { key: 'review.phase', value: { stringValue: event.label } },
    { key: 'review.status', value: { stringValue: event.status } },
  ]
  if (contentLogging && event.detail) attributes.push({ key: 'review.detail', value: { stringValue: event.detail } })
  return {
    name: `code-review.${event.label}`,
    startTimeUnixNano: String(BigInt(startMs) * 1_000_000n),
    endTimeUnixNano: String(BigInt(endMs) * 1_000_000n),
    attributes,
    status: { code: event.status === 'error' ? 2 : 1 },
  }
}

/**
 * An opt-in `Observer` that exports every `progress` event (the same phase/timing
 * stream `createProgressObserver` renders for a human) as an OTLP-shaped span, either
 * printed as JSON (`console`) or POSTed to a collector (`otlp`). Not the official
 * `@opentelemetry/sdk-node` — this package emits OTLP/HTTP JSON directly via `fetch`,
 * matching this repository's existing preference for a small hand-written
 * implementation over a new dependency (see `matchGlob` in `src/review-rules.ts`) —
 * OTLP/HTTP JSON is a documented, stable wire format, not an SDK internal.
 *
 * Never emits prompts, diffs, findings, or provider credentials: an `Observer` only
 * ever receives `AgentEvent`s (phase/status/timing), never the review's config or
 * content. `contentLogging` only controls whether the progress `detail` string (a
 * short phase note, e.g. a truncation warning) is included.
 *
 * Returns `undefined` when `enabled` is not explicitly `true`, so a caller can always
 * write `observers: [createTelemetryObserver(options), ...otherObservers].filter(Boolean)`
 * without a conditional.
 */
export function createTelemetryObserver(options: TelemetryOptions = {}): Observer | undefined {
  if (options.enabled !== true) return undefined
  const exporter = options.exporter ?? 'console'
  if (exporter === 'otlp' && !options.otlpEndpoint) throw new Error("telemetry: exporter 'otlp' requires otlpEndpoint")
  const write = options.write ?? ((line: string) => { process.stderr.write(`${line}\n`) })
  const fetcher = options.fetcher ?? fetch
  const contentLogging = options.contentLogging === true
  return {
    name: 'telemetry',
    async on(event: AgentEvent) {
      if (event.type !== 'progress') return
      const span = buildSpan(event, contentLogging)
      if (exporter === 'console') {
        write(JSON.stringify(span))
        return
      }
      try {
        await fetcher(`${options.otlpEndpoint!.replace(/\/$/, '')}/v1/traces`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resourceSpans: [{
              resource: { attributes: [{ key: 'service.name', value: { stringValue: 'agentskit-code-review' } }] },
              scopeSpans: [{ scope: { name: 'agentskit-code-review' }, spans: [span] }],
            }],
          }),
        })
      } catch {
        // Telemetry delivery is best-effort by design: a collector being unreachable
        // must never fail or slow down the review it is only observing.
      }
    },
  }
}
