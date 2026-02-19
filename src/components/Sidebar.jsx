import { useCallback, useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'
import RichTextEditor from './RichTextEditor'

const LEVEL_LABELS = { 0: 'Root', 1: 'Main Topic', 2: 'Subtopic', 3: 'Detail' }

const Sidebar = () => {
  const { nodes, selectedNodeId, updateNodeData, deselectNode, deleteNode, convertToSubmap, navigateToSubmap } =
    useMindMapStore()
  const [converting, setConverting] = useState(false)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  const handleTitleChange = useCallback(
    (e) => {
      if (!selectedNodeId) return
      updateNodeData(selectedNodeId, { title: e.target.value })
    },
    [selectedNodeId, updateNodeData]
  )

  const handleContentChange = useCallback(
    (html) => {
      if (!selectedNodeId) return
      updateNodeData(selectedNodeId, { content: html })
    },
    [selectedNodeId, updateNodeData]
  )

  const handleDelete = useCallback(() => {
    if (!selectedNode) return
    if (selectedNode.data.level === 0) {
      alert('The root node cannot be deleted.')
      return
    }
    if (confirm(`Delete "${selectedNode.data.title}"?`)) {
      deleteNode(selectedNodeId)
    }
  }, [selectedNode, selectedNodeId, deleteNode])

  const handleConvertToSubmap = useCallback(async () => {
    if (!selectedNode) return
    if (!confirm(`Convert "${selectedNode.data.title}" to a submap?\n\nIts children will be moved into the new map.`)) return
    setConverting(true)
    const result = await convertToSubmap(selectedNodeId)
    setConverting(false)
    if (!result.success) alert('Failed to convert to submap. Please try again.')
  }, [selectedNode, selectedNodeId, convertToSubmap])

  if (!selectedNode) {
    return (
      <div className="sidebar sidebar--empty">
        <p>Click a node to view and edit its details</p>
      </div>
    )
  }

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
              key={selectedNodeId}
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
