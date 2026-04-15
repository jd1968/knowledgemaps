const SHAPE_PREVIEWS = {
  object: <svg width="48" height="28" viewBox="0 0 48 28" fill="none"><rect x="2" y="2" width="44" height="24" rx="5" fill="#eef3fd" stroke="#5b8dee" strokeWidth="1.5"/></svg>,
  shape: <svg width="48" height="28" viewBox="0 0 48 28" fill="none"><rect x="2" y="2" width="44" height="24" rx="3" fill="#fff" stroke="#6b7280" strokeWidth="1.5"/><text x="24" y="14" textAnchor="middle" dominantBaseline="middle" fill="#374151" fontSize="6.5" fontWeight="500">Container</text></svg>,
  region: <svg width="48" height="28" viewBox="0 0 48 28" fill="none"><rect x="2" y="2" width="44" height="24" rx="5" fill="rgba(160,175,210,0.1)" stroke="#9aa7c4" strokeWidth="1.5" strokeDasharray="5 3"/><text x="7" y="13" fill="#9aa7c4" fontSize="7" fontWeight="600">Region</text></svg>,
  note: <svg width="48" height="28" viewBox="0 0 48 28" fill="none"><path d="M2 2 L40 2 L46 8 L46 26 L2 26 Z" fill="#fefce8" stroke="#d4c56a" strokeWidth="1.5"/><path d="M40 2 L40 8 L46 8" fill="none" stroke="#d4c56a" strokeWidth="1.5"/></svg>,
  'or-annotation': <svg width="48" height="28" viewBox="0 0 48 28" fill="none"><path d="M4,26 Q4,20 24,20 Q44,20 44,26" fill="none" stroke="#888" strokeWidth="2"/><text x="24" y="16" fill="#888" fontSize="7" fontWeight="700" textAnchor="middle">OR</text></svg>,
  relationship: <svg width="48" height="28" viewBox="0 0 48 28" fill="none"><line x1="12" y1="14" x2="36" y2="14" stroke="#5b8dee" strokeWidth="1.8"/><circle cx="12" cy="14" r="4" fill="#5b8dee"/><circle cx="36" cy="14" r="4" fill="#5b8dee"/></svg>,
}

export default function DiagramSidebar({ shapeLibrary }) {
  return (
    <aside className="diagram-sidebar">
      <div className="diagram-sidebar-section-title">Shapes</div>
      {shapeLibrary.map(({ type, name }) => (
        <button
          key={type}
          type="button"
          className="diagram-sidebar-item"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            const pointerId = e.pointerId

            window.dispatchEvent(new CustomEvent('diagram-palette-drag-start', {
              detail: { type, clientX: e.clientX, clientY: e.clientY },
            }))

            const cleanup = () => {
              window.removeEventListener('pointermove', handlePointerMove)
              window.removeEventListener('pointerup', handlePointerUp)
              window.removeEventListener('pointercancel', handlePointerCancel)
              window.removeEventListener('blur', handleWindowBlur)
            }

            const handlePointerMove = (moveEvent) => {
              if (moveEvent.pointerId !== pointerId) return
              window.dispatchEvent(new CustomEvent('diagram-palette-drag-move', {
                detail: { type, clientX: moveEvent.clientX, clientY: moveEvent.clientY },
              }))
            }

            const handlePointerUp = (upEvent) => {
              if (upEvent.pointerId !== pointerId) return
              cleanup()
              window.dispatchEvent(new CustomEvent('diagram-palette-drag-end'))
              window.dispatchEvent(new CustomEvent('diagram-palette-drop', {
                detail: { type, clientX: upEvent.clientX, clientY: upEvent.clientY },
              }))
            }

            const handlePointerCancel = () => {
              cleanup()
              window.dispatchEvent(new CustomEvent('diagram-palette-drag-end'))
            }
            const handleWindowBlur = () => {
              cleanup()
              window.dispatchEvent(new CustomEvent('diagram-palette-drag-end'))
            }

            window.addEventListener('pointermove', handlePointerMove)
            window.addEventListener('pointerup', handlePointerUp)
            window.addEventListener('pointercancel', handlePointerCancel)
            window.addEventListener('blur', handleWindowBlur)
          }}
        >
          {SHAPE_PREVIEWS[type] || null}
          <span className="diagram-sidebar-item-label">{name}</span>
        </button>
      ))}
    </aside>
  )
}
