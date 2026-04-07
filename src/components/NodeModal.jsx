import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import MarkdownEditor from './MarkdownEditor'
import SubmapChoiceModal from './SubmapChoiceModal'
import { STANDARD_THEME_COLORS } from '../lib/themePalette'

const TYPE_LABELS = { card: 'Card', object: 'Object', relationship: 'Relationship', diagram: 'Diagram', submap: 'Submap' }
const CREATE_TYPE_OPTIONS = ['card', 'object', 'relationship', 'diagram', 'submap']

const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches

export default function NodeModal({ node, isNew, onDelete, onClose }) {
  const updateNodeData   = useMindMapStore((s) => s.updateNodeData)
  const navigateToSubmap = useMindMapStore((s) => s.navigateToSubmap)
  const deleteNode       = useMindMapStore((s) => s.deleteNode)
  const convertToSubmap  = useMindMapStore((s) => s.convertToSubmap)
  const isEditMode       = useMindMapStore((s) => s.isEditMode)
  const currentMapId     = useMindMapStore((s) => s.currentMapId)

  const { id } = node
  const {
    title,
    level,
    content,
    isSubmap,
    submapId,
    nodeType = 'card',
    hasChildren,
    isTodo = false,
    themeColor = '',
    name = '',
    objectType = 'Standard',
    description = '',
    relType = 'lookup',
    fromLabel = '',
    toLabel = '',
    backgroundMode = 'theme',
  } = node.data
  const isObjectNode = nodeType === 'object'
  const isRelationshipNode = nodeType === 'relationship'
  const isPlainNode = nodeType === 'card'

  const [isEditing, setIsEditing]         = useState(isEditMode)
  const [draft, setDraft]                 = useState(isEditMode ? { title: title || '', content: content || '', isTodo: !!isTodo, nodeType, themeColor: themeColor || '', name: name || '', objectType: objectType || 'Standard', description: description || '', relType: relType || 'lookup', fromLabel: fromLabel || '', toLabel: toLabel || '', backgroundMode: backgroundMode || 'theme' } : null)
  const [showConvertMenu, setShowConvertMenu] = useState(false)
  const [converting, setConverting]       = useState(false)
  const [showSubmapChoice, setShowSubmapChoice] = useState(false)
  const [editTab, setEditTab]             = useState('details')
  const headerIsTodo = isEditing ? !!draft?.isTodo : isTodo
  const effectiveDraftType = draft?.nodeType || nodeType
  const canSave = effectiveDraftType === 'note' ? true : !!draft?.title?.trim()

  const hasNotes = content && content.trim() !== ''
  const viewDescription = node.data?.description || ''
  const viewName = node.data?.name || ''
  const viewObjectType = node.data?.objectType || 'Standard'
  const viewRelType = node.data?.relType || 'lookup'
  const viewFromLabel = node.data?.fromLabel || ''
  const viewToLabel = node.data?.toLabel || ''
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
    setEditTab('details')
  }, [isEditMode])

  const startEdit = () => {
    setDraft({ title: title || '', content: content || '', isTodo: !!isTodo, nodeType, themeColor: themeColor || '', name: name || '', objectType: objectType || 'Standard', description: description || '', relType: relType || 'lookup', fromLabel: fromLabel || '', toLabel: toLabel || '', backgroundMode: backgroundMode || 'theme' })
    setEditTab('details')
    setIsEditing(true)
  }

  const saveEdit = () => {
    if (!canSave) {
      alert('Title is required for this node type.')
      return
    }
    const nextType = draft?.nodeType || nodeType
    const nextTitle = nextType === 'note'
      ? (draft?.title?.trim() || '')
      : draft.title.trim()
    if (nextType === 'submap' && (!isSubmap || isNew)) {
      setShowSubmapChoice(true)
      return
    }
    if (draft) updateNodeData(id, {
      title: nextTitle,
      content: draft.content,
      isTodo: !!draft.isTodo,
      nodeType: nextType,
      ...(level === 1 ? { themeColor: draft.themeColor || '' } : {}),
      ...(nextType === 'object' ? {
        name: draft.name || '',
        objectType: draft.objectType || 'Standard',
        description: draft.description || '',
      } : {}),
      ...(nextType === 'relationship' ? {
        relType: draft.relType || 'lookup',
        fromLabel: draft.fromLabel || '',
        toLabel: draft.toLabel || '',
        description: draft.description || '',
      } : {}),
      ...(nextType === 'card' ? {
        backgroundMode: draft.backgroundMode || 'theme',
      } : {}),
    })
    onClose()
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

    if ((newType === 'note' || newType === 'diagram' || newType === 'relationship') && hasChildren) {
      if (!confirm(`"${title}" has children. Converting to ${TYPE_LABELS[newType]} will prevent adding more children, but existing ones will remain.\n\nContinue?`)) return
    }

    updateNodeData(id, { nodeType: newType })
    setShowConvertMenu(false)
    onClose()
  }, [title, id, hasChildren, updateNodeData, onClose])

  const handleCreateNewSubmap = useCallback(async () => {
    if (!canSave) {
      alert('Title is required for this node type.')
      return
    }
    if (draft) updateNodeData(id, { title: draft.title.trim(), content: draft.content, isTodo: !!draft.isTodo, ...(level === 1 ? { themeColor: draft.themeColor || '' } : {}) })
    await handleConvertToSubmap()
    setShowSubmapChoice(false)
  }, [canSave, draft, handleConvertToSubmap, id, level, updateNodeData])

  const handleSelectExistingSubmap = useCallback((map) => {
    if (hasChildren) {
      alert('This node already has children. You can only create a new submap for it.')
      return
    }
    const nextTitle = draft?.title?.trim() || title?.trim() || map.name
    const nextContent = draft?.content ?? content
    const nextTodo = draft?.isTodo ?? isTodo
    const nextThemeColor = draft?.themeColor ?? themeColor
    updateNodeData(id, {
      title: nextTitle,
      content: nextContent,
      isTodo: !!nextTodo,
      ...(level === 1 ? { themeColor: nextThemeColor || '' } : {}),
      isSubmap: true,
      submapId: map.id,
      nodeType: 'submap',
    })
    setShowSubmapChoice(false)
    setShowConvertMenu(false)
    onClose()
  }, [content, draft, hasChildren, id, isTodo, level, onClose, themeColor, title, updateNodeData])

  return createPortal(
    <div
      className="node-modal-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div className="node-modal">

        {/* Header */}
        <div className="node-modal-header">
          <div className="node-modal-header-left">
            <span className="node-modal-header-title">{title || 'Untitled'}</span>
            {headerIsTodo && <span className="node-modal-todo-chip">To Do</span>}
          </div>
          <button className="icon-btn" onClick={requestClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className={`node-modal-body${isEditing ? '' : ' node-modal-body--view'}`}>
          {isEditing ? (
            <>
              <div className="node-create-type-row" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={`btn btn--sm${editTab === 'details' ? ' btn--primary' : ' btn--secondary'}`}
                  onClick={() => setEditTab('details')}
                >
                  Details
                </button>
                <button
                  type="button"
                  className={`btn btn--sm${editTab === 'style' ? ' btn--primary' : ' btn--secondary'}`}
                  onClick={() => setEditTab('style')}
                >
                  Style
                </button>
              </div>

              {editTab === 'details' && (
              <div className="field">
                <label className="field-label">
                  {isObjectNode ? 'Label' : 'Title'}
                </label>
                <input
                  className="field-input"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder={isObjectNode ? 'Object label…' : 'Title…'}
                  autoFocus
                />
              </div>
              )}

              {editTab === 'style' && level === 1 && (
                <div className="field">
                  <label className="field-label">Theme Color</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={`btn btn--sm${!draft.themeColor ? ' btn--primary' : ' btn--secondary'}`}
                      onClick={() => setDraft((d) => ({ ...d, themeColor: '' }))}
                    >
                      Auto
                    </button>
                    {STANDARD_THEME_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Theme ${color}`}
                        title={color}
                        onClick={() => setDraft((d) => ({ ...d, themeColor: color }))}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          border: draft.themeColor === color ? '2px solid #1f2937' : '1px solid #e5e7eb',
                          background: color,
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {editTab === 'style' && isPlainNode && (
                <div className="field">
                  <label className="field-label">Background</label>
                  <div className="node-create-type-row">
                    <button
                      type="button"
                      className={`btn btn--sm${(draft.backgroundMode || 'theme') === 'theme' ? ' btn--primary' : ' btn--secondary'}`}
                      onClick={() => setDraft((d) => ({ ...d, backgroundMode: 'theme' }))}
                    >
                      Theme color
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm${(draft.backgroundMode || 'theme') === 'canvas' ? ' btn--primary' : ' btn--secondary'}`}
                      onClick={() => setDraft((d) => ({ ...d, backgroundMode: 'canvas' }))}
                    >
                      White
                    </button>
                  </div>
                </div>
              )}

              {editTab === 'details' && isNew && (
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

              {editTab === 'details' && isObjectNode ? (
                <>
                  <div className="field">
                    <label className="field-label">API Name</label>
                    <input
                      className="field-input"
                      value={draft.name || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Account"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Object Type</label>
                    <select
                      className="field-input"
                      value={draft.objectType || 'Standard'}
                      onChange={(e) => setDraft((d) => ({ ...d, objectType: e.target.value }))}
                    >
                      <option value="Standard">Standard</option>
                      <option value="Packaged">Packaged</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </div>
                  <div className="field field--grow">
                    <label className="field-label">Purpose</label>
                    <textarea
                      className="field-input"
                      value={draft.description || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Add a purpose..."
                      style={{ minHeight: 120, resize: 'vertical' }}
                    />
                  </div>
                </>
              ) : editTab === 'details' && isRelationshipNode ? (
                <>
                  <div className="field">
                    <label className="field-label">Relationship Type</label>
                    <select
                      className="field-input"
                      value={draft.relType || 'lookup'}
                      onChange={(e) => setDraft((d) => ({ ...d, relType: e.target.value }))}
                    >
                      <option value="lookup">Lookup</option>
                      <option value="master-detail">Master-Detail</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">From Label</label>
                    <input className="field-input" value={draft.fromLabel || ''} onChange={(e) => setDraft((d) => ({ ...d, fromLabel: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="field-label">To Label</label>
                    <input className="field-input" value={draft.toLabel || ''} onChange={(e) => setDraft((d) => ({ ...d, toLabel: e.target.value }))} />
                  </div>
                  <div className="field field--grow">
                    <label className="field-label">Description</label>
                    <textarea
                      className="field-input"
                      value={draft.description || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Add a description..."
                      style={{ minHeight: 120, resize: 'vertical' }}
                    />
                  </div>
                </>
              ) : editTab === 'details' ? (
                <>
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
              ) : null}

            </>
          ) : (
            <>
              {isObjectNode ? (
                <div className="field">
                  <label className="field-label">API Name</label>
                  <div className="key-display">{viewName || '—'}</div>
                  <label className="field-label" style={{ marginTop: 8 }}>Object Type</label>
                  <div className="key-display">{viewObjectType}</div>
                  <label className="field-label" style={{ marginTop: 8 }}>Purpose</label>
                  <div className="key-display">{viewDescription || '—'}</div>
                </div>
              ) : isRelationshipNode ? (
                <div className="field">
                  <label className="field-label">Relationship Type</label>
                  <div className="key-display">{viewRelType}</div>
                  <label className="field-label" style={{ marginTop: 8 }}>From Label</label>
                  <div className="key-display">{viewFromLabel || '—'}</div>
                  <label className="field-label" style={{ marginTop: 8 }}>To Label</label>
                  <div className="key-display">{viewToLabel || '—'}</div>
                  <label className="field-label" style={{ marginTop: 8 }}>Description</label>
                  <div className="key-display">{viewDescription || '—'}</div>
                </div>
              ) : hasNotes && (
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
                {['card', 'object', 'relationship', 'diagram', 'submap'].map((t) => (
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
