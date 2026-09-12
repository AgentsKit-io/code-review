---
"@agentskit/code-review": patch
---

Add optional, opt-in telemetry: `createTelemetryObserver({ enabled: true, ... })` (`src/telemetry.ts`, re-exported from the package root) exports every progress event as an OTLP-shaped span — `console` (JSON lines) or `otlp` (POSTed to a collector, best-effort, never blocking the review) — via a direct OTLP/HTTP JSON emitter rather than the official `@opentelemetry/sdk-node`, so no new dependency is required. Disabled by default; `contentLogging` (also default off) separately controls whether a progress event's short detail note is included. Telemetry never has access to prompts, diffs, findings, or provider credentials in the first place.
