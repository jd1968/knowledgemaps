export default function DiagramToolbar({ onUndo, onRedo, canUndo, canRedo, onSave, saveStatus, isEditMode = true, onToggleEditMode = null }) {
  return (
    <div className="diagram-toolbar-bar">
      <div className="diagram-toolbar-group">
        {isEditMode && (
          <>
            <button className="diagram-toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo">
              ↶
            </button>
            <button className="diagram-toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo">
              ↷
            </button>
          </>
        )}
      </div>
      <div className="diagram-toolbar-group diagram-toolbar-group--end">
        {onToggleEditMode && (
          <label className="edit-mode-toggle" title={isEditMode ? 'Disable editing' : 'Enable editing'}>
            <input type="checkbox" checked={isEditMode} onChange={onToggleEditMode} />
            <span className="edit-mode-toggle__track">
              <span className="edit-mode-toggle__thumb" />
            </span>
            <span className="edit-mode-toggle__label">Edit</span>
          </label>
        )}
        {isEditMode && onSave && (
          <>
            {saveStatus === 'saved' && <span className="diagram-toolbar-save-status">Saved</span>}
            {saveStatus === 'unsaved' && <span className="diagram-toolbar-save-status diagram-toolbar-save-status--unsaved">Unsaved</span>}
            <button
              className="btn btn--primary btn--sm"
              onClick={onSave}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
