'use client'

import { useEffect, useRef } from 'react'

export function LiquidCursorGradient() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!element || reduced.matches) return

    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || reduced.matches) return
      element.style.setProperty('--cursor-x', `${event.clientX}px`)
      element.style.setProperty('--cursor-y', `${event.clientY}px`)
      element.dataset.active = 'true'
    }
    const hide = () => { element.dataset.active = 'false' }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', hide)
    document.documentElement.addEventListener('pointerleave', hide)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('blur', hide)
      document.documentElement.removeEventListener('pointerleave', hide)
    }
  }, [])

  return <div ref={ref} className="ak-liquid-cursor-gradient" aria-hidden="true" data-active="false">
    <span className="ak-liquid-cursor-gradient__orb ak-liquid-cursor-gradient__orb--blue" />
    <span className="ak-liquid-cursor-gradient__orb ak-liquid-cursor-gradient__orb--green" />
  </div>
}
