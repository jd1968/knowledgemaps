import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import RichTextEditor from './RichTextEditor'

const LEVEL_LABELS = { 0: 'Root', 1: 'Main Topic', 2: 'Subtopic', 3: 'Detail' }

const TYPE_LABELS = { folder: 'Folder', group: 'Group', note: 'Note', submap: 'Submap' }

export default function NodeModal({ node, onClose }) {
  const updateNodeData   = useMindMapStore((s) => s.updateNodeData)
  const deleteNode       = useMindMapStore((s) => s.deleteNode)
  const deselectNode     = useMindMapStore((s) => s.deselectNode)
  const convertToSubmap  = useMindMapStore((s) => s.convertToSubmap)
  const navigateToSubmap = useMindMapStore((s) => s.navigateToSubmap)
  const isEditMode       = useMindMapStore((s) => s.isEditMode)

  const { id } = node
  const { title, level, content, isSubmap, submapId, nodeType = 'folder' } = node.data

  const [isEditing, setIsEditing] = useState(isEditMode)
  const [draft, setDraft]         = useState(isEditMode ? { title: title || '', content: content || '' } : null)
  const [converting, setConverting] = useState(false)
  const [showConvertMenu, setShowConvertMenu] = useState(false)

  const hasNotes = content && content !== '<p></p>' && content !== ''

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // If edit mode is turned off while the modal is open, force read-only view.
  useEffect(() => {
    if (isEditMode) return
    setIsEditing(false)
    setShowConvertMenu(false)
    setDraft(null)
  }, [isEditMode])

  const startEdit = () => {
    setDraft({ title: title || '', content: content || '' })
    setIsEditing(true)
  }

  const saveEdit = () => {
    if (draft) updateNodeData(id, { title: draft.title, content: draft.content })
    onClose()
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setDraft(null)
  }

  const handleDelete = useCallback(() => {
    if (!isEditMode) return
    if (level === 0) { alert('The root node cannot be deleted.'); return }
    if (confirm(`Delete "${title}"?`)) {
      deleteNode(id)
      deselectNode()
      onClose()
    }
  }, [isEditMode, level, title, id, deleteNode, deselectNode, onClose])

  const handleConvertToSubmap = useCallback(async () => {
    if (!isEditMode) return
    if (!confirm(`Convert "${title}" to a submap?\n\nIts children will be moved into the new map.`)) return
    setConverting(true)
    const result = await convertToSubmap(id)
    setConverting(false)
    if (!result.success) alert('Failed to convert to submap. Please try again.')
    else onClose()
  }, [isEditMode, title, id, convertToSubmap, onClose])

  const handleConvertType = useCallback((newType) => {
    if (!isEditMode) return
    if (newType === nodeType) return
    if (newType === 'submap') { handleConvertToSubmap(); return }

    if (newType === 'note') {
      const hasChildren = node.data.hasChildren
      if (hasChildren && !confirm(`"${title}" has children. Converting to Note will prevent adding more children, but existing ones will remain.\n\nContinue?`)) return
      updateNodeData(id, { nodeType: 'note' })
    } else if (newType === 'folder') {
      updateNodeData(id, { nodeType: 'folder' })
    } else if (newType === 'group') {
      updateNodeData(id, { nodeType: 'group' })
    }
    setShowConvertMenu(false)
    onClose()
  }, [isEditMode, nodeType, title, id, node.data.hasChildren, updateNodeData, handleConvertToSubmap, onClose])

  return createPortal(
    <div
      className="node-modal-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="node-modal">

        {/* Header */}
        <div className="node-modal-header">
          <span className="node-modal-header-title">{title || 'Untitled'}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div
          className={`node-modal-body${isEditing ? '' : ' node-modal-body--view'}`}
        >
          {isEditing ? (
            <>
              <div className="field">
                <label className="field-label">Title</label>
                <input
                  className="field-input"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Node title…"
                  autoFocus
                />
              </div>

              <div className="field field--grow">
                <label className="field-label">Notes</label>
                <RichTextEditor
                  key={`edit-${id}`}
                  content={draft.content}
                  onChange={(html) => setDraft((d) => ({ ...d, content: html }))}
                  editable={true}
                />
              </div>
            </>
          ) : (
            <>
              {hasNotes && (
                <div className="field">
                  <RichTextEditor
                    key={`view-${id}`}
                    content={content}
                    editable={false}
                  />
                </div>
              )}

              {isSubmap && (
                <div className="submap-info">
                  <p>This node links to a submap. Open it to view and edit its contents.</p>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => { navigateToSubmap(submapId); onClose() }}
                  >
                    ↗ Open submap
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="node-modal-footer">
          {isEditing ? (
            <>
              <button className="btn btn--secondary btn--sm" onClick={cancelEdit}>
                Cancel
              </button>
              <button className="btn btn--primary btn--sm" onClick={saveEdit}>
                Save
              </button>
            </>
          ) : showConvertMenu ? (
            <>
              <span className="node-modal-convert-label">Convert to:</span>
              {['folder', 'group', 'note', 'submap'].map((t) => (
                <button
                  key={t}
                  className={`btn btn--sm${nodeType === t ? ' btn--disabled' : ' btn--secondary'}`}
                  disabled={nodeType === t || converting}
                  onClick={() => handleConvertType(t)}
                >
                  {t === 'submap' ? '↗ Submap' : TYPE_LABELS[t]}
                  {converting && t === 'submap' ? '…' : ''}
                </button>
              ))}
              <button className="btn btn--secondary btn--sm" onClick={() => setShowConvertMenu(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {isEditMode && level > 0 && !isSubmap && (
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => setShowConvertMenu(true)}
                >
                  Convert to…
                </button>
              )}
              {isEditMode && level > 0 && (
                <button className="btn btn--danger btn--sm" onClick={handleDelete}>
                  Delete
                </button>
              )}
              <button
                className="btn btn--primary btn--sm node-modal-edit-btn"
                onClick={startEdit}
              >
                Edit
              </button>
            </>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}
