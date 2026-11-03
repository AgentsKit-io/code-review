# ReviewBench reviewer image for AgentsKit code-review (agent contract: AGENT_CONTRACT.md in review-bench/ReviewBench).
# Build from the repository root:  docker build -f bench/reviewbench/Dockerfile -t code-review-rb:dev .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY agents ./agents
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund @anthropic-ai/claude-code && npm cache clean --force
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY bench/reviewbench/agent.mjs /agent/agent.mjs
ENTRYPOINT ["node", "/agent/agent.mjs"]
