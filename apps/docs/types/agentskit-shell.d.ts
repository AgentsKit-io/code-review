import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type ShellElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { current?: string; repo?: string; 'data-visual'?: string }

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'agentskit-ecosystem': ShellElement
      'agentskit-footer': ShellElement
      'agentskit-aurora': ShellElement
    }
  }
}
