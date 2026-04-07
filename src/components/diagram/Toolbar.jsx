export default function DiagramToolbar({ onUndo, onRedo, canUndo, canRedo }) {
  return (
    <div className="diagram-toolbar-bar">
      <div className="diagram-toolbar-group">
        <button className="diagram-toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo">
          ↶
        </button>
        <button className="diagram-toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo">
          ↷
        </button>
      </div>
    </div>
  )
}
