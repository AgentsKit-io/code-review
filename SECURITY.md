# Security Policy

## Supported versions

Security fixes are provided for the latest published release. Older releases may
be asked to upgrade before receiving a fix.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/AgentsKit-io/code-review/security/advisories/new) with the affected version, impact, reproduction steps, and any suggested mitigation.

Please do not include secrets or private source code beyond what is necessary to reproduce the issue. We aim to acknowledge a complete report within 14 days, investigate it, and coordinate disclosure and remediation with the reporter. If the report is accepted, we will keep the reporter informed as the fix progresses.

## Scope reminders

This tool sends selected code to the provider you configure. Review that provider's data handling policy before using a hosted API. Prefer a local model or approved private gateway for repositories whose policy prohibits external processing. Store GitHub tokens and provider keys as secrets; never commit them to workflow files.

Telemetry (`createTelemetryObserver`, `docs/OPERATIONS.md`) is opt-in and disabled by default. Enabled, it exports phase names, statuses, and timings as OTLP-shaped spans — never prompts, diffs, findings, or provider credentials, which an `Observer` cannot access in the first place. A progress event's short `detail` note is included only when `contentLogging` is also explicitly enabled.
