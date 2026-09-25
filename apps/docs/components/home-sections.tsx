'use client'

import { useState, type ReactNode } from 'react'

const optionalLenses = [
  ['performance', 'Performance'],
  ['maintainability', 'Maintainability'],
  ['design', 'Design'],
  ['conventions', 'Conventions'],
] as const
const codeKeys = new Set(['review', 'preset', 'lenses', 'performance', 'maintainability', 'design', 'conventions', 'minSeverity', 'comments', 'renderer', 'inline', 'name', 'on', 'permissions', 'contents', 'pull-requests', 'jobs', 'runs-on', 'steps', 'uses', 'with', 'provider', 'model', 'api-key'])
const codeTokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\{\{[^}]+\}\}|--[\w-]+|@[\w/-]+|\b[A-Za-z_$][\w$.-]*\b|[{}()[\]:,])/g

const providers: { name: string; icon: string }[] = [
  { name: 'OpenAI', icon: 'openai' },
  { name: 'Anthropic', icon: 'anthropic' },
  { name: 'Gemini', icon: 'gemini' },
  { name: 'Codex CLI', icon: 'codex' },
  { name: 'Mistral', icon: 'mistral' },
  { name: 'DeepSeek', icon: 'deepseek' },
  { name: 'Groq', icon: 'groq' },
  { name: 'OpenRouter', icon: 'openrouter' },
  { name: 'Together AI', icon: 'together' },
  { name: 'Ollama', icon: 'ollama' },
  { name: 'Grok', icon: 'grok' },
  { name: 'Claude Code', icon: 'claude' },
]

function HighlightedCode({ source }: { source: string }) {
  const output: ReactNode[] = []
  let offset = 0
  let index = 0

  for (const match of source.matchAll(codeTokens)) {
    const value = match[0]
    const start = match.index ?? 0
    if (start > offset) output.push(source.slice(offset, start))
    const next = source.slice(start + value.length).trimStart()
    const kind = value.startsWith('"') || value.startsWith("'") ? 'string'
      : value.startsWith('${{') ? 'variable'
      : value.startsWith('--') ? 'flag'
      : value.startsWith('@agentskit/') ? 'package'
      : value === 'npx' || value === 'true' || value === 'false' ? 'keyword'
      : codeKeys.has(value) && next.startsWith(':') ? 'property'
      : /^[{}()[\]:,]$/.test(value) ? 'punctuation'
      : ''
    output.push(kind ? <span className={`code-token-${kind}`} key={index++}>{value}</span> : value)
    offset = start + value.length
  }

  if (offset < source.length) output.push(source.slice(offset))
  return <>{output}</>
}

function ProviderTrack({ duplicate = false }: { duplicate?: boolean }) {
  return <ul className="provider-track" aria-hidden={duplicate || undefined}>
    {providers.map(provider => <li className="provider-chip" key={provider.name}>
      <img src={`https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.1/icons/${provider.icon}.svg`} width="18" height="18" alt="" loading="lazy" />
      <span>{provider.name}</span>
    </li>)}
  </ul>
}

export function ConfigurationSection() {
  const [lenses, setLenses] = useState<Record<string, boolean>>({ performance: true, maintainability: false, design: false, conventions: false })
  const [severity, setSeverity] = useState('med')
  const [renderer, setRenderer] = useState('coderabbit-inspired')
  const activeCount = Object.values(lenses).filter(Boolean).length
  const lensConfig = optionalLenses.map(([key]) => `${key}: ${lenses[key]}`).join(', ')

  return <section className="home-section configuration-section" aria-labelledby="configuration-title">
    <div className="ak-container config-layout">
      <div className="section-intro">
        <p className="ak-eyebrow">Your standards, in the loop</p>
        <h2 id="configuration-title" className="ak-display">Tune the review to your team.</h2>
        <p>Keep core correctness, security, and test coverage in every full review. Add the lenses, severity floor, and review style your team needs.</p>
        <a href="/docs/getting-started#versioned-configuration">Explore configuration <span aria-hidden="true">→</span></a>
      </div>
      <div className="config-panel glass-panel">
        <div className="config-panel-head"><div><span className="demo-label">CONFIGURATION PREVIEW</span><strong>code-review.config.ts</strong></div><span className="config-status"><i /> PREVIEW ONLY</span></div>
        <fieldset className="lens-controls">
          <legend>Optional review lenses <span>({activeCount} selected)</span></legend>
          {optionalLenses.map(([key, label]) => <label className="lens-option" key={key}>
            <input type="checkbox" checked={lenses[key]} onChange={event => setLenses(current => ({ ...current, [key]: event.target.checked }))} />
            <span>{label}</span>
          </label>)}
        </fieldset>
        <div className="config-selectors">
          <label className="severity-control" htmlFor="review-severity"><span>Minimum severity</span><select id="review-severity" value={severity} onChange={event => setSeverity(event.target.value)}><option value="nit">Nit</option><option value="med">Medium</option><option value="high">High</option><option value="blocker">Blocker</option></select></label>
          <label className="severity-control" htmlFor="comment-renderer"><span>Comment style</span><select id="comment-renderer" value={renderer} onChange={event => setRenderer(event.target.value)}><option value="coderabbit-inspired">Guided</option><option value="github-inline">Inline</option><option value="compact">Compact</option><option value="detailed">Detailed</option></select></label>
        </div>
        <pre className="config-code"><code><HighlightedCode source={`review: {\n  preset: presets.strict().review,\n  lenses: { ${lensConfig} },\n  minSeverity: "${severity}",\n},\ncomments: { renderer: "${renderer}", inline: true },`} /></code></pre>
        <p className="config-note">Three required lenses stay enabled in full reviews. These controls preview supported config values; no repository is being reviewed.</p>
      </div>
    </div>
  </section>
}

export function ProviderSection() {
  return <section className="home-section provider-section" aria-labelledby="provider-title">
    <div className="ak-container provider-content">
      <div className="provider-heading"><div><p className="ak-eyebrow">Bring the model you already use</p><h2 id="provider-title" className="ak-display">One review flow. Your LLM stack.</h2></div><p>Use local coding agents, hosted APIs, or a local model server. Code Review connects through its provider registry and AgentsKit adapters.</p></div>
      <div className="provider-marquee" role="group" aria-label="LLM providers and coding agent CLIs available to Code Review">
        <ProviderTrack />
        <ProviderTrack duplicate />
      </div>
      <div className="provider-footnote"><span>Codex CLI · Claude Code · API providers · Ollama</span><a href="/docs/provider-compatibility">Check provider compatibility <span aria-hidden="true">→</span></a></div>
      <p className="catalog-note">The broader AgentsKit catalog includes <strong>222 providers</strong>, <strong>7,870 models</strong>, and <strong>50 tool integrations</strong>. Code Review support is listed separately in its compatibility guide.</p>
    </div>
  </section>
}

export function DeliverySection() {
  const [mode, setMode] = useState<'cli' | 'actions'>('cli')
  return <section className="home-section delivery-section" aria-labelledby="delivery-title">
    <div className="ak-container delivery-layout">
      <div className="section-intro">
        <p className="ak-eyebrow">From your terminal to every pull request</p>
        <h2 id="delivery-title" className="ak-display">Run it where your team works.</h2>
        <p>Use the same review policies locally or in CI. Start advisory, then add a merge gate when you are ready.</p>
        <a href="/docs/getting-started#use-the-github-action">Set up a review flow <span aria-hidden="true">→</span></a>
      </div>
      <div className="delivery-panel glass-panel">
        <div className="delivery-tabs" role="group" aria-label="Choose a Code Review run mode">
          <button type="button" aria-pressed={mode === 'cli'} onClick={() => setMode('cli')}>Local CLI</button>
          <button type="button" aria-pressed={mode === 'actions'} onClick={() => setMode('actions')}>GitHub Actions</button>
        </div>
        {mode === 'cli' ? <div className="delivery-example" aria-live="polite">
          <p className="demo-label">REVIEW YOUR CHANGES LOCALLY</p>
          <pre className="config-code"><code><HighlightedCode source={`npx @agentskit/code-review \\\n  --provider codex-cli \\\n  --base origin/main`} /></code></pre>
          <p>Use <code>claude-cli</code>, an API provider, or <code>ollama</code> in place of <code>codex-cli</code>.</p>
        </div> : <div className="delivery-example" aria-live="polite">
          <p className="demo-label">REVIEW EVERY PULL REQUEST</p>
          <pre className="config-code"><code><HighlightedCode source={`name: Code Review\non: pull_request\npermissions:\n  contents: read\n  pull-requests: write\njobs:\n  review:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: AgentsKit-io/code-review@v0.31.0\n        with:\n          provider: openai\n          model: gpt-4o\n          api-key: \${{ secrets.LLM_API_KEY }}`} /></code></pre>
          <p>Hosted runners use an API provider and repository secret. CLI login providers need a trusted, self-hosted runner.</p>
        </div>}
        <div className="delivery-foot"><span><i /> ADVISORY BY DEFAULT</span><a href="/docs/getting-started#use-the-github-action">Read setup guide ↗</a></div>
      </div>
    </div>
  </section>
}
