import { useCallback, useMemo, useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'
import RichTextEditor from './RichTextEditor'

const LEVEL_LABELS = { 0: 'Root', 1: 'Main Topic', 2: 'Subtopic', 3: 'Detail' }

const Sidebar = () => {
  const {
    nodes,
    updateNodeData,
    deselectNode,
    deleteNode,
    deleteNodes,
    convertToSubmap,
    navigateToSubmap,
  } = useMindMapStore()
  const [converting, setConverting] = useState(false)

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes])
  const selectedCount = selectedNodes.length
  /** First selected in document order — used for title/notes when multiple are selected */
  const primaryNode = selectedNodes[0] ?? null
  const primaryId = primaryNode?.id

  const handleTitleChange = useCallback(
    (e) => {
      if (!primaryId || selectedCount !== 1) return
      updateNodeData(primaryId, { title: e.target.value })
    },
    [primaryId, selectedCount, updateNodeData]
  )

  const handleContentChange = useCallback(
    (html) => {
      if (!primaryId || selectedCount !== 1) return
      updateNodeData(primaryId, { content: html })
    },
    [primaryId, selectedCount, updateNodeData]
  )

  const handleDelete = useCallback(() => {
    if (selectedCount === 0) return
    const ids = selectedNodes.map((n) => n.id)
    const deletable = selectedNodes.filter((n) => (n.data?.level ?? 0) > 0)
    if (deletable.length === 0) {
      alert('The root node cannot be deleted.')
      return
    }
    if (deletable.length < selectedCount) {
      alert('The root node cannot be deleted. Deselect it or delete other nodes first.')
      return
    }
    const titles = deletable.map((n) => n.data?.title || 'Untitled').join(', ')
    const label = deletable.length === 1 ? `"${titles}"` : `${deletable.length} nodes (${titles.slice(0, 80)}${titles.length > 80 ? '…' : ''})`
    if (!confirm(`Delete ${label}?`)) return
    deleteNodes(deletable.map((n) => n.id))
  }, [selectedCount, selectedNodes, deleteNodes])

  const handleConvertToSubmap = useCallback(async () => {
    if (!primaryNode || selectedCount !== 1) return
    if (!confirm(`Convert "${primaryNode.data.title}" to a submap?\n\nIts children will be moved into the new map.`)) return
    setConverting(true)
    const result = await convertToSubmap(primaryId)
    setConverting(false)
    if (!result.success) alert('Failed to convert to submap. Please try again.')
  }, [primaryNode, primaryId, selectedCount, convertToSubmap])

  if (selectedCount === 0) {
    return (
      <div className="sidebar sidebar--empty">
        <p>Click a node to view and edit its details</p>
        <p className="sidebar-hint">Tip: Shift-click, Cmd-click (Mac), or Ctrl-click (Windows) to multi-select; drag on the canvas to marquee-select.</p>
      </div>
    )
  }

  if (selectedCount > 1) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-left">
            <span className="level-badge">{selectedCount} nodes selected</span>
          </div>
          <button
            className="icon-btn"
            onClick={deselectNode}
            title="Clear selection"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
        <div className="sidebar-body">
          <p className="sidebar-multi-hint">
            Select a single node in the sidebar to edit title and notes. You can delete all selected nodes below.
          </p>
        </div>
        <div className="sidebar-footer">
          <button className="btn btn--danger btn--sm" onClick={handleDelete}>
            Delete selected
          </button>
        </div>
      </div>
    )
  }

  const selectedNode = primaryNode
  const { title, key, level, content, isSubmap, submapId } = selectedNode.data

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <span className="level-badge" data-level={Math.min(level, 3)}>
            {LEVEL_LABELS[Math.min(level, 3)] || 'Node'} · L{level}
          </span>
          {isSubmap && <span className="submap-badge">Submap</span>}
        </div>
        <button
          className="icon-btn"
          onClick={deselectNode}
          title="Close panel"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="sidebar-body">
        <div className="field">
          <label className="field-label">Title</label>
          <input
            className="field-input"
            value={title}
            onChange={handleTitleChange}
            placeholder="Node title…"
            autoFocus
          />
        </div>

        <div className="field">
          <label className="field-label">Key</label>
          <div className="key-display">{key}</div>
        </div>

        {!isSubmap && (
          <div className="field field--grow">
            <label className="field-label">Notes</label>
            <RichTextEditor
              key={primaryId}
              content={content}
              onChange={handleContentChange}
            />
          </div>
        )}

        {isSubmap && (
          <div className="submap-info">
            <p>This node links to a submap. Click the arrow on the node, or the button below, to open it.</p>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => navigateToSubmap(submapId)}
            >
              ↗ Open submap
            </button>
          </div>
        )}
      </div>

      {level > 0 && (
        <div className="sidebar-footer">
          {!isSubmap && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleConvertToSubmap}
              disabled={converting}
            >
              {converting ? 'Converting…' : '↗ Convert to submap'}
            </button>
          )}
          <button className="btn btn--danger btn--sm" onClick={handleDelete}>
            Delete node
          </button>
        </div>
      )}
    </div>
  )
}

export default Sidebar
