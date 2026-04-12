export default function DiagramToolbar({ onUndo, onRedo, canUndo, canRedo, onSave, saveStatus }) {
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
      {onSave && (
        <div className="diagram-toolbar-group diagram-toolbar-group--end">
          {saveStatus === 'saved' && <span className="diagram-toolbar-save-status">Saved</span>}
          {saveStatus === 'unsaved' && <span className="diagram-toolbar-save-status diagram-toolbar-save-status--unsaved">Unsaved</span>}
          <button
            className="btn btn--primary btn--sm"
            onClick={onSave}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
