#!/usr/bin/env bash
# Static checks (no build needed). Called from the pipeline's typecheck-command.
set -euo pipefail
npm ci --prefix apps/docs
npm run check:cross-platform
npm run typecheck
npm run docs:web:typecheck
npm run check:readme-standard
