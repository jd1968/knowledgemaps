import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import MarkdownEditor from './MarkdownEditor'
import SubmapChoiceModal from './SubmapChoiceModal'

const TYPE_LABELS = { folder: 'Folder', group: 'Group', note: 'Note', pointer: 'Pointer', submap: 'Submap' }
const CREATE_TYPE_OPTIONS = ['folder', 'group', 'note', 'pointer', 'submap']

const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches

export default function NodeModal({ node, isNew, onDelete, onClose }) {
  const updateNodeData   = useMindMapStore((s) => s.updateNodeData)
  const navigateToSubmap = useMindMapStore((s) => s.navigateToSubmap)
  const deleteNode       = useMindMapStore((s) => s.deleteNode)
  const setEdgeType      = useMindMapStore((s) => s.setEdgeType)
  const convertToSubmap  = useMindMapStore((s) => s.convertToSubmap)
  const isEditMode       = useMindMapStore((s) => s.isEditMode)
  const currentMapId     = useMindMapStore((s) => s.currentMapId)

  const { id } = node
  const { title, level, content, longTitle = '', isSubmap, submapId, nodeType = 'folder', hasChildren, isTodo = false } = node.data

  const [isEditing, setIsEditing]         = useState(isEditMode)
  const [draft, setDraft]                 = useState(isEditMode ? { title: title || '', longTitle: longTitle || title || '', content: content || '', isTodo: !!isTodo, nodeType } : null)
  const [showConvertMenu, setShowConvertMenu] = useState(false)
  const [converting, setConverting]       = useState(false)
  const [showSubmapChoice, setShowSubmapChoice] = useState(false)
  const headerIsTodo = isEditing ? !!draft?.isTodo : isTodo
  const canSave = !!draft?.title?.trim()

  const hasNotes = content && content.trim() !== ''
  const requestClose = useCallback(() => {
    if (isNew && onDelete) onDelete()
    onClose()
  }, [isNew, onDelete, onClose])

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  // If edit mode is turned off while the modal is open, force read-only view.
  useEffect(() => {
    if (isEditMode) return
    setIsEditing(false)
    setShowConvertMenu(false)
    setDraft(null)
  }, [isEditMode])

  const startEdit = () => {
    setDraft({ title: title || '', longTitle: longTitle || title || '', content: content || '', isTodo: !!isTodo, nodeType })
    setIsEditing(true)
  }

  const saveEdit = () => {
    if (!canSave) {
      alert('Title is required.')
      return
    }
    const nextType = draft?.nodeType || nodeType
    if (nextType === 'submap' && (!isSubmap || isNew)) {
      setShowSubmapChoice(true)
      return
    }
    if (draft) updateNodeData(id, { title: draft.title.trim(), longTitle: draft.longTitle?.trim() || '', content: draft.content, isTodo: !!draft.isTodo, nodeType: nextType })
    if (nextType === 'pointer') setEdgeType(id, 'pointer-edge')
    else if (nodeType === 'pointer') setEdgeType(id, 'straight-center')
    setIsEditing(false)
    setDraft(null)
  }

  const cancelEdit = () => {
    requestClose()
  }

  const handleDelete = useCallback(() => {
    if (!confirm(`Delete "${title || 'Untitled'}"?`)) return
    deleteNode(id)
    onClose()
  }, [title, id, deleteNode, onClose])

  const handleConvertToSubmap = useCallback(async () => {
    setConverting(true)
    const result = await convertToSubmap(id)
    setConverting(false)
    if (!result.success) alert('Failed to convert to submap. Please try again.')
    else { setShowConvertMenu(false); onClose() }
  }, [title, id, convertToSubmap, onClose])

  const handleConvertType = useCallback((newType) => {
    if (newType === nodeType) return
    if (newType === 'submap') {
      setShowSubmapChoice(true)
      return
    }

    if ((newType === 'note' || newType === 'pointer') && hasChildren) {
      if (!confirm(`"${title}" has children. Converting to ${TYPE_LABELS[newType]} will prevent adding more children, but existing ones will remain.\n\nContinue?`)) return
    }

    if (newType === 'pointer') {
      updateNodeData(id, { nodeType: 'pointer' })
      setEdgeType(id, 'pointer-edge')
    } else {
      if (nodeType === 'pointer') setEdgeType(id, 'straight-center')
      updateNodeData(id, { nodeType: newType })
    }
    setShowConvertMenu(false)
    onClose()
  }, [nodeType, title, id, hasChildren, updateNodeData, setEdgeType, onClose])

  const handleCreateNewSubmap = useCallback(async () => {
    if (!canSave) {
      alert('Title is required.')
      return
    }
    if (draft) updateNodeData(id, { title: draft.title.trim(), longTitle: draft.longTitle?.trim() || '', content: draft.content, isTodo: !!draft.isTodo })
    await handleConvertToSubmap()
    setShowSubmapChoice(false)
  }, [canSave, draft, handleConvertToSubmap, id, updateNodeData])

  const handleSelectExistingSubmap = useCallback((map) => {
    if (hasChildren) {
      alert('This node already has children. You can only create a new submap for it.')
      return
    }
    const nextTitle = draft?.title?.trim() || title?.trim() || map.name
    const nextLongTitle = draft?.longTitle?.trim() ?? longTitle
    const nextContent = draft?.content ?? content
    const nextTodo = draft?.isTodo ?? isTodo
    if (nodeType === 'pointer') setEdgeType(id, 'straight-center')
    updateNodeData(id, {
      title: nextTitle,
      longTitle: nextLongTitle || '',
      content: nextContent,
      isTodo: !!nextTodo,
      isSubmap: true,
      submapId: map.id,
      nodeType: 'submap',
      collapsed: false,
    })
    setShowSubmapChoice(false)
    setShowConvertMenu(false)
    onClose()
  }, [content, draft, hasChildren, id, isTodo, nodeType, onClose, setEdgeType, title, updateNodeData])

  return createPortal(
    <div
      className="node-modal-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div className="node-modal">

        {/* Header */}
        <div className="node-modal-header">
          <div className="node-modal-header-left">
            <span className="node-modal-header-title">{longTitle || title || 'Untitled'}</span>
            {headerIsTodo && <span className="node-modal-todo-chip">To Do</span>}
          </div>
          <button className="icon-btn" onClick={requestClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className={`node-modal-body${isEditing ? '' : ' node-modal-body--view'}`}>
          {isEditing ? (
            <>
              <div className="field">
                <label className="field-label">Long Title <span className="field-label-hint">(shown on cards — leave blank to use short title)</span></label>
                <input
                  className="field-input"
                  value={draft.longTitle || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, longTitle: e.target.value }))}
                  placeholder="More descriptive title for feed cards…"
                  autoFocus
                />
              </div>

              <div className="field">
                <label className="field-label">Short Title <span className="field-label-hint">(shown on map)</span></label>
                <input
                  className="field-input"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Node title…"
                />
              </div>

              {isNew && (
                <div className="field">
                  <label className="field-label">Type</label>
                  <div className="node-create-type-row">
                    {CREATE_TYPE_OPTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`btn btn--sm${draft?.nodeType === t ? ' btn--primary' : ' btn--secondary'}`}
                        onClick={() => setDraft((d) => ({ ...(d || { title: '', content: '', isTodo: false, nodeType }), nodeType: t }))}
                      >
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="field field--grow">
                <label className="field-label">Notes</label>
                <MarkdownEditor
                  key={`edit-${id}`}
                  content={draft.content}
                  onChange={(md) => setDraft((d) => ({ ...d, content: md }))}
                  editable={true}
                />
              </div>
            </>
          ) : (
            <>
              {hasNotes && (
                <div className="field">
                  <MarkdownEditor key={`view-${id}`} content={content} editable={false} />
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
            showConvertMenu ? (
              <>
                <span className="node-modal-convert-label">Convert to:</span>
                {['folder', 'group', 'note', 'pointer', 'submap'].map((t) => (
                  <button
                    key={t}
                    className={`btn btn--sm${nodeType === t ? ' btn--disabled' : ' btn--secondary'}`}
                    disabled={nodeType === t || converting}
                    onClick={() => handleConvertType(t)}
                  >
                    {TYPE_LABELS[t]}
                    {converting && t === 'submap' ? '…' : ''}
                  </button>
                ))}
                <button className="btn btn--secondary btn--sm" onClick={() => setShowConvertMenu(false)}>
                  ✕
                </button>
              </>
            ) : (
              <>
                <button className="btn btn--secondary btn--sm" onClick={cancelEdit}>
                  Cancel
                </button>
                {isTouch && level > 0 && !isSubmap && (
                  <button className="btn btn--secondary btn--sm" onClick={() => setShowConvertMenu(true)}>
                    ⇄
                  </button>
                )}
                {isTouch && level > 0 && (
                  <button className="btn btn--danger btn--sm" onClick={handleDelete}>
                    Delete
                  </button>
                )}
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => setDraft((d) => ({ ...(d || { title: '', content: '', nodeType }), isTodo: !d?.isTodo }))}
                >
                  {draft?.isTodo ? 'Unmark To Do' : 'Mark To Do'}
                </button>
                <button className="btn btn--primary btn--sm" onClick={saveEdit} disabled={!canSave}>
                  Save
                </button>
              </>
            )
          ) : (
            <button className="btn btn--primary btn--sm node-modal-edit-btn" onClick={startEdit}>
              Edit
            </button>
          )}
        </div>

      </div>

      <SubmapChoiceModal
        open={showSubmapChoice}
        onClose={() => { setShowSubmapChoice(false) }}
        onCreateNew={handleCreateNewSubmap}
        onSelectExisting={handleSelectExistingSubmap}
        currentMapId={currentMapId}
        existingDisabledReason={hasChildren ? 'This node has children, so an existing map cannot be selected.' : ''}
      />
    </div>,
    document.body
  )
}
