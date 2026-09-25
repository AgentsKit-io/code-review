import { ImageResponse } from 'next/og'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export default function Image() { return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#0d1117', color: '#e6edf3', padding: '88px', border: '1px solid #30363d' }}><div style={{ color: '#f97316', fontSize: 22, letterSpacing: 8 }}>AGENTSKIT · CODE REVIEW</div><div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.06, marginTop: 40, maxWidth: 900 }}>Code review that follows your standards.</div><div style={{ color: '#8b949e', fontSize: 26, marginTop: 32 }}>Configurable. Provider-neutral. Open source.</div></div>, size) }
