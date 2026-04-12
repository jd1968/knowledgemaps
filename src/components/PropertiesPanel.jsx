import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Slide-out right-hand properties panel.
 * Always renders its DOM (via portal) so the CSS transition is smooth.
 * Pass `open` to show/hide. Children are only rendered when open.
 */
export default function PropertiesPanel({ open, title, onClose, footer, children }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return createPortal(
    <>
      <div
        className={`props-backdrop${open ? ' props-backdrop--open' : ''}`}
        onPointerDown={open ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
      />
      <aside className={`props-panel${open ? ' props-panel--open' : ''}`} aria-modal="true" role="dialog" aria-label={title}>
        <div className="props-panel__header">
          <span className="props-panel__title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="props-panel__body">
          {open && children}
        </div>
        {footer && <div className="props-panel__footer">{footer}</div>}
      </aside>
    </>,
    document.body
  )
}
