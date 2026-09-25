'use client'

import { useEffect, useRef, useState } from 'react'

const examples = [
  {
    label: 'Security',
    file: 'src/auth/session.ts',
    line: '41',
    before: 'const session = await store.get(cookie.id)',
    after: 'const id = verifySessionCookie(cookie)',
    continuation: 'const session = id ? await store.get(id) : null',
    severity: 'High',
    title: 'Validate the session identifier before lookup.',
    detail: 'The cookie value reaches persistent storage before its signature is checked. Reject invalid identifiers before reading a session.',
    evidence: 'Untrusted input · changed lines 41–42',
  },
  {
    label: 'Code quality',
    file: 'src/users/enrich.ts',
    line: '18',
    before: 'for (const user of users) {',
    after: 'const profiles = await Promise.all(users.map(loadProfile))',
    continuation: 'return profiles.map(mergePreferences)',
    severity: 'Medium',
    title: 'Load independent profiles concurrently.',
    detail: 'Each profile lookup is independent, but the loop waits for one request before starting the next. A single bounded batch keeps this path easier to follow and faster.',
    evidence: 'Sequential I/O · changed lines 18–20',
  },
  {
    label: 'Performance',
    file: 'src/search/results.ts',
    line: '88',
    before: 'return hits.map(hit => all.find(item => item.id === hit.id))',
    after: 'const byId = new Map(all.map(item => [item.id, item]))',
    continuation: 'return hits.map(hit => byId.get(hit.id))',
    severity: 'Medium',
    title: 'Build the lookup once before mapping results.',
    detail: 'The current path scans the full collection for every hit. Indexing once avoids repeated work as the result set grows.',
    evidence: 'Repeated linear scan · changed lines 88–89',
  },
  {
    label: 'Correctness',
    file: 'src/billing/period.ts',
    line: '27',
    before: 'return new Date(`${value}T00:00:00`)',
    after: 'return new Date(`${value}T00:00:00.000Z`)',
    continuation: '}',
    severity: 'High',
    title: 'Parse the billing date in UTC.',
    detail: 'This date is persisted as a calendar day, but local-time parsing can shift it across regions. Make the timezone explicit before calculating the billing window.',
    evidence: 'Timezone dependent · changed line 27',
  },
] as const

type Review = (typeof examples)[number]

export function ReviewConfigDemo() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const root = useRef<HTMLElement | null>(null)
  const item: Review = examples[activeIndex]

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (paused || hovered || focused || reducedMotion) return
    const timer = window.setInterval(() => {
      setActiveIndex(index => (index + 1) % examples.length)
    }, 4200)
    return () => window.clearInterval(timer)
  }, [paused, hovered, focused, reducedMotion])

  function select(index: number, focus = false) {
    setActiveIndex(index)
    if (focus) tabs.current[index]?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? examples.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % examples.length
          : event.key === 'ArrowLeft'
            ? (index - 1 + examples.length) % examples.length
            : -1
    if (next < 0) return
    event.preventDefault()
    select(next, true)
  }

  return <section
    className="review-demo"
    aria-label="Interactive code review example"
    ref={root}
    onPointerEnter={() => setHovered(true)}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => {
      if (!root.current?.contains(event.relatedTarget as Node | null)) setFocused(false)
    }}
  >
    <header className="review-demo-toolbar">
      <div className="review-pr-title"><span className="review-live-dot" /> Pull request <strong>#184</strong><span className="review-pr-divider">/</span> Reviewing changes</div>
      <button className="review-play" type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused}>
        <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span> {paused ? 'Play review' : 'Pause review'}
      </button>
    </header>
    <div className="review-demo-head">
      <div><p className="demo-label">LIVE REVIEW PREVIEW</p><h2 className="ak-display">Your standards shape the review.</h2></div>
      <div className="review-summary"><strong>04</strong><span>example findings</span></div>
    </div>
    <div className="demo-tabs" role="tablist" aria-label="Review comment categories">
      {examples.map((example, index) => <button
        key={example.label}
        ref={element => { tabs.current[index] = element }}
        id={`review-tab-${index}`}
        type="button"
        role="tab"
        aria-selected={activeIndex === index}
        aria-controls="review-panel"
        tabIndex={activeIndex === index ? 0 : -1}
        onKeyDown={event => handleKeyDown(event, index)}
        onClick={() => select(index)}
      >{example.label}</button>)}
    </div>
    <div className="review-window" id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${activeIndex}`} tabIndex={0} key={activeIndex}>
      <div className="review-file">
        <div className="review-file-head"><span>DIFF</span><code>{item.file}</code><span className="review-diff-count">+2 −1</span></div>
        <div className="review-code" aria-label={`Illustrative change in ${item.file}`}>
          <div className="review-code-line review-code-muted"><span>40</span><code>export async function reviewChange(input) {'{'}</code></div>
          <div className="review-code-line review-code-removed"><span>−</span><code>{item.before}</code></div>
          <div className="review-code-line review-code-added"><span>{item.line}</span><code>{item.after}</code></div>
          <div className="review-code-line review-code-added"><span>+</span><code>{item.continuation}</code></div>
          <div className="review-code-line review-code-muted"><span>43</span><code>{'}'}</code></div>
        </div>
        <div className="review-comment" aria-label={`${item.label} review comment`}>
          <div className="comment-avatar" aria-hidden="true">AK</div>
          <div className="comment-body">
            <div className="comment-author"><strong>AgentsKit Review</strong><span>bot · just now</span></div>
            <div className="comment-type"><span className="comment-severity" data-severity={item.severity.toLowerCase()}>{item.severity}</span><span>{item.label}</span></div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            <div className="comment-evidence">{item.evidence}</div>
            <details className="comment-suggestion"><summary>View suggested change</summary><code>{item.after}</code></details>
          </div>
        </div>
      </div>
      <aside className="review-sidebar" aria-label="Pull request summary">
        <div className="review-sidebar-head"><span>CHANGES</span><strong>3 files</strong></div>
        <div className="review-file-list"><span className="file-active"><i aria-hidden="true">M</i>{item.file}</span><span><i aria-hidden="true">M</i>src/config/review.ts</span><span><i aria-hidden="true">A</i>tests/review.test.ts</span></div>
        <div className="review-sidebar-status"><span className="status-check" aria-hidden="true">✓</span><div><strong>Review in progress</strong><span>Policies run on changed code</span></div></div>
        <div className="review-sidebar-count"><strong>04</strong><span>focused findings</span></div>
      </aside>
    </div>
    <p className="demo-caption">Illustrative review output. No repository is scanned.</p>
  </section>
}
