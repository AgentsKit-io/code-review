# ADR 0005: Separated safe review memory

## Status

Accepted

Context: PRD #137, issue #138

## Decision

Store operational state, reusable cache, feedback, and approved knowledge separately. Self-hosted structured storage is the default. Persistent knowledge excludes raw source, secrets, full prompts, and transcripts. Candidate rules require regression evidence and human approval by default; AgentsKit retrieval injects only bounded, scoped approved rules.

## Alternatives Considered

- Reuse chat transcripts as knowledge: rejected because it mixes lifecycle, trust, and privacy boundaries.
- Auto-promote observations or require a vector database: rejected because both add avoidable poisoning and operational risk.

## Consequences

Rules retain provenance, scope, confidence, validation history, expiry, and rollback metadata. Semantic vector retrieval remains optional until measured rule volume justifies it.
