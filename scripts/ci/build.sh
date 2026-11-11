#!/usr/bin/env bash
# Checks that need the build. Called from the pipeline's build-command.
set -euo pipefail
cleanup() { rm -f .doc-bridge/.ci-content-revision; }
trap cleanup EXIT
npm ci --prefix apps/docs
npm run build
# Doc Bridge uses a Git SHA for clean checkouts and a content hash for dirty ones.
# The committed index is content-addressed, so keep that revision mode through the gates.
touch .doc-bridge/.ci-content-revision
npm run docs:index
git diff --exit-code -- doc-bridge.config.json .doc-bridge llms-full.txt
npm run docs:gate
npm run check:public-api
node dist/src/cli.js --help > /dev/null
npm pack --dry-run
