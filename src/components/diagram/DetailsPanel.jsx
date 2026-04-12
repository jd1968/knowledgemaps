import PropertiesPanel from '../PropertiesPanel'

function autoResize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function DiagramDetailsPanel({
  selectedShape,
  selectedConn,
  shapes,
  onUpdateShape,
  onUpdateConn,
  onClose,
  onDeleteShape,
  onDeleteConn,
  suspendOpen = false,
  isEditMode = true,
}) {
  const fromShape = selectedConn ? shapes.find((s) => s.id === selectedConn.fromShapeId) : null
  const toShape = selectedConn ? shapes.find((s) => s.id === selectedConn.toShapeId) : null
  const open = !isEditMode && !suspendOpen && (!!selectedShape || !!selectedConn)
  const title = selectedShape ? 'Shape Properties' : selectedConn ? 'Connector Properties' : 'Properties'
  const footer = !isEditMode ? (
    <button className="btn btn--secondary btn--sm" onClick={onClose}>Close</button>
  ) : selectedShape ? (
    <>
      <button className="btn btn--danger btn--sm" onClick={() => onDeleteShape?.(selectedShape.id)}>Delete shape</button>
      <button className="btn btn--secondary btn--sm" onClick={onClose}>Close</button>
    </>
  ) : selectedConn ? (
    <>
      <button className="btn btn--danger btn--sm" onClick={() => onDeleteConn?.(selectedConn.id)}>Delete connector</button>
      <button className="btn btn--secondary btn--sm" onClick={onClose}>Close</button>
    </>
  ) : null

  return (
    <PropertiesPanel open={open} title={title} onClose={onClose} footer={footer} modal={false}>
      {selectedShape && (
        <>
          {selectedShape.type === 'note' ? (
            <div className="field field--grow">
              <label className="field-label">Note</label>
              {isEditMode ? (
                <textarea
                  className="field-input"
                  value={selectedShape.noteText || ''}
                  onInput={(e) => autoResize(e.target)}
                  onChange={(e) => onUpdateShape(selectedShape.id, { noteText: e.target.value }, { skipHistory: true })}
                  autoFocus
                />
              ) : (
                <div className="key-display">{selectedShape.noteText || 'No note'}</div>
              )}
            </div>
          ) : (
            <div className="field">
              <label className="field-label">Label</label>
              {isEditMode ? (
                <input className="field-input" value={selectedShape.label || ''} onChange={(e) => onUpdateShape(selectedShape.id, { label: e.target.value })} autoFocus />
              ) : (
                <div className="key-display">{selectedShape.label || 'Untitled'}</div>
              )}
            </div>
          )}
          {selectedShape.type === 'object' && (
            <div className="field">
              <label className="field-label">Type</label>
              {isEditMode ? (
                <select
                  className="field-input"
                  value={selectedShape.objectType || 'Standard'}
                  onChange={(e) => onUpdateShape(selectedShape.id, { objectType: e.target.value })}
                >
                  <option value="Standard">Standard</option>
                  <option value="Packaged">Packaged</option>
                  <option value="Custom">Custom</option>
                </select>
              ) : (
                <div className="key-display">{selectedShape.objectType || 'Standard'}</div>
              )}
            </div>
          )}
        </>
      )}
      {!selectedShape && selectedConn && (
        <>
          {isEditMode ? (
            <>
              <div className="field">
                <label className="field-label">Style</label>
                <select className="field-input" value={selectedConn.style || 'elbow'} onChange={(e) => onUpdateConn(selectedConn.id, { style: e.target.value })} autoFocus>
                  <option value="elbow">Elbow</option>
                  <option value="straight">Straight</option>
                  <option value="bezier">Curve</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Relationship</label>
                <select className="field-input" value={selectedConn.relType || 'lookup'} onChange={(e) => onUpdateConn(selectedConn.id, { relType: e.target.value })}>
                  <option value="lookup">Lookup</option>
                  <option value="master-detail">Master-Detail</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">From Label</label>
                <input className="field-input" value={selectedConn.fromLabel ?? ''} onChange={(e) => onUpdateConn(selectedConn.id, { fromLabel: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">To Label</label>
                <input className="field-input" value={selectedConn.toLabel ?? ''} onChange={(e) => onUpdateConn(selectedConn.id, { toLabel: e.target.value })} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label className="field-label">Style</label>
                <div className="key-display">{selectedConn.style || 'elbow'}</div>
              </div>
              <div className="field">
                <label className="field-label">Relationship</label>
                <div className="key-display">{selectedConn.relType || 'lookup'}</div>
              </div>
              <div className="field">
                <label className="field-label">From Label</label>
                <div className="key-display">{selectedConn.fromLabel || 'None'}</div>
              </div>
              <div className="field">
                <label className="field-label">To Label</label>
                <div className="key-display">{selectedConn.toLabel || 'None'}</div>
              </div>
            </>
          )}
          <div className="field">
            <label className="field-label">From</label>
            <div className="key-display">{fromShape?.label || selectedConn.fromShapeId || 'free'}</div>
          </div>
          <div className="field">
            <label className="field-label">To</label>
            <div className="key-display">{toShape?.label || selectedConn.toShapeId || 'free'}</div>
          </div>
        </>
      )}
    </PropertiesPanel>
  )
}
