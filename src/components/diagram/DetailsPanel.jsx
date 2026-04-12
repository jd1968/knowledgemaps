function autoResize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function DiagramDetailsPanel({ selectedShape, selectedConn, shapes, onUpdateShape, onUpdateConn }) {
  const fromShape = selectedConn ? shapes.find((s) => s.id === selectedConn.fromShapeId) : null
  const toShape = selectedConn ? shapes.find((s) => s.id === selectedConn.toShapeId) : null

  return (
    <aside className="diagram-details-panel">
      {selectedShape && (
        <>
          <div className="diagram-details-title">Shape Details</div>
          {selectedShape.type === 'note' ? (
            <textarea
              className="diagram-details-input"
              value={selectedShape.noteText || ''}
              onInput={(e) => autoResize(e.target)}
              onChange={(e) => onUpdateShape(selectedShape.id, { noteText: e.target.value }, { skipHistory: true })}
            />
          ) : (
            <input className="diagram-details-input" value={selectedShape.label || ''} onChange={(e) => onUpdateShape(selectedShape.id, { label: e.target.value })} />
          )}
          {selectedShape.type === 'object' && (
            <div className="diagram-details-grid" style={{ marginTop: 10 }}>
              <label>Type</label>
              <select
                className="diagram-details-input"
                value={selectedShape.objectType || 'Standard'}
                onChange={(e) => onUpdateShape(selectedShape.id, { objectType: e.target.value })}
              >
                <option value="Standard">Standard</option>
                <option value="Packaged">Packaged</option>
                <option value="Custom">Custom</option>
              </select>
            </div>
          )}
        </>
      )}
      {!selectedShape && selectedConn && (
        <>
          <div className="diagram-details-title">Connector Details</div>
          <div className="diagram-details-grid">
            <label>Style</label>
            <select className="diagram-details-input" value={selectedConn.style || 'elbow'} onChange={(e) => onUpdateConn(selectedConn.id, { style: e.target.value })}>
              <option value="elbow">Elbow</option>
              <option value="straight">Straight</option>
              <option value="bezier">Curve</option>
            </select>
            <label>Relationship</label>
            <select className="diagram-details-input" value={selectedConn.relType || 'lookup'} onChange={(e) => onUpdateConn(selectedConn.id, { relType: e.target.value })}>
              <option value="lookup">Lookup</option>
              <option value="master-detail">Master-Detail</option>
            </select>
            <label>From</label><div>{fromShape?.label || selectedConn.fromShapeId || 'free'}</div>
            <label>To</label><div>{toShape?.label || selectedConn.toShapeId || 'free'}</div>
          </div>
        </>
      )}
      {!selectedShape && !selectedConn && <div className="diagram-details-empty">Select a shape or connector.</div>}
    </aside>
  )
}
