import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import RichTextEditor from './RichTextEditor'

const LEVEL_LABELS = { 0: 'Root', 1: 'Main Topic', 2: 'Subtopic', 3: 'Detail' }

// Extract H1 text nodes from an HTML string
function parseH1s(html) {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('h1')).map((el) => el.textContent.trim()).filter(Boolean)
}

export default function NodeModal({ node, onClose }) {
  const updateNodeData   = useMindMapStore((s) => s.updateNodeData)
  const deleteNode       = useMindMapStore((s) => s.deleteNode)
  const deselectNode     = useMindMapStore((s) => s.deselectNode)
  const convertToSubmap  = useMindMapStore((s) => s.convertToSubmap)
  const navigateToSubmap = useMindMapStore((s) => s.navigateToSubmap)

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft]         = useState(null)
  const [converting, setConverting] = useState(false)

  const modalBodyRef = useRef(null)

  const { id } = node
  const { title, level, key, content, overview, isSubmap, submapId } = node.data
  const levelLabel = LEVEL_LABELS[Math.min(level ?? 0, 3)] || 'Node'

  const hasNotes = content && content !== '<p></p>' && content !== ''
  const h1s = useMemo(() => parseH1s(content), [content])

  // Navigation badges: overview (if present) + one per H1
  const showNav = !isEditing && (overview || h1s.length > 0)

  const scrollToOverview = () => {
    modalBodyRef.current?.querySelector('.node-modal-view-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const scrollToH1 = (index) => {
    const h1Els = modalBodyRef.current?.querySelectorAll('h1')
    h1Els?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const startEdit = () => {
    setDraft({ title: title || '', overview: overview || '', content: content || '' })
    setIsEditing(true)
  }

  const saveEdit = () => {
    if (draft) updateNodeData(id, { title: draft.title, overview: draft.overview, content: draft.content })
    setIsEditing(false)
    setDraft(null)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setDraft(null)
  }

  const handleDelete = useCallback(() => {
    if (level === 0) { alert('The root node cannot be deleted.'); return }
    if (confirm(`Delete "${title}"?`)) {
      deleteNode(id)
      deselectNode()
      onClose()
    }
  }, [level, title, id, deleteNode, deselectNode, onClose])

  const handleConvertToSubmap = useCallback(async () => {
    if (!confirm(`Convert "${title}" to a submap?\n\nIts children will be moved into the new map.`)) return
    setConverting(true)
    const result = await convertToSubmap(id)
    setConverting(false)
    if (!result.success) alert('Failed to convert to submap. Please try again.')
    else onClose()
  }, [title, id, convertToSubmap, onClose])

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

        {/* Navigation badges — view mode only */}
        {showNav && (
          <div className="node-modal-nav">
            {overview && (
              <button className="node-modal-nav-badge" onClick={scrollToOverview}>
                Overview
              </button>
            )}
            {h1s.map((text, i) => (
              <button key={i} className="node-modal-nav-badge" onClick={() => scrollToH1(i)}>
                {text}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div
          ref={modalBodyRef}
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

              <div className="field">
                <label className="field-label">Overview</label>
                <textarea
                  className="field-input field-textarea"
                  value={draft.overview}
                  onChange={(e) => setDraft((d) => ({ ...d, overview: e.target.value }))}
                  placeholder="Brief overview…"
                  rows={3}
                />
              </div>

              {!isSubmap && (
                <div className="field field--grow">
                  <label className="field-label">Notes</label>
                  <RichTextEditor
                    key={`edit-${id}`}
                    content={draft.content}
                    onChange={(html) => setDraft((d) => ({ ...d, content: html }))}
                    editable={true}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              {overview ? (
                <div className="node-modal-view-section">
                  <div className="field-label">Overview</div>
                  <p className="node-modal-view-text">{overview}</p>
                </div>
              ) : null}

              {!isSubmap && hasNotes && (
                <div className="field">
                  <div className="field-label">Notes</div>
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
          ) : (
            <>
              {level > 0 && !isSubmap && (
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={handleConvertToSubmap}
                  disabled={converting}
                >
                  {converting ? 'Converting…' : '↗ Convert to submap'}
                </button>
              )}
              {level > 0 && (
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
