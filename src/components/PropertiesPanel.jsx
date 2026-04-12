import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Duration must match the CSS transition (0.25s)
const TRANSITION_MS = 250

/**
 * Slide-out right-hand properties panel.
 * Always renders its DOM (via portal) so the CSS transition is smooth.
 * Children are mounted only after the slide-in animation completes so that
 * autoFocus inputs don't fire during the animation (prevents iOS Safari zoom).
 */
export default function PropertiesPanel({ open, title, onClose, footer, children, modal = true }) {
  // `ready` trails `open` by TRANSITION_MS so children mount after slide-in
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setReady(true), TRANSITION_MS)
      return () => clearTimeout(t)
    } else {
      setReady(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return createPortal(
    <>
      <div
        className={`props-backdrop${open ? ' props-backdrop--open' : ''}${modal ? '' : ' props-backdrop--nonmodal'}`}
        onPointerDown={open && modal ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
      />
      <aside className={`props-panel${open ? ' props-panel--open' : ''}`} aria-modal={modal ? 'true' : 'false'} role="dialog" aria-label={title}>
        <div className="props-panel__header">
          <span className="props-panel__title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="props-panel__body">
          {ready && children}
        </div>
        {footer && <div className="props-panel__footer">{footer}</div>}
      </aside>
    </>,
    document.body
  )
}
