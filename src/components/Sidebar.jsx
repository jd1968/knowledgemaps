import { useCallback } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'
import RichTextEditor from './RichTextEditor'

const LEVEL_LABELS = { 0: 'Root', 1: 'Main Topic', 2: 'Subtopic', 3: 'Detail' }

const Sidebar = () => {
  const { nodes, selectedNodeId, updateNodeData, deselectNode, deleteNode } =
    useMindMapStore()

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

  if (!selectedNode) {
    return (
      <div className="sidebar sidebar--empty">
        <p>Click a node to view and edit its details</p>
      </div>
    )
  }

  const { title, key, level, content } = selectedNode.data

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <span className="level-badge" data-level={Math.min(level, 3)}>
            {LEVEL_LABELS[Math.min(level, 3)] || 'Node'} · L{level}
          </span>
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

        <div className="field field--grow">
          <label className="field-label">Notes</label>
          <RichTextEditor
            key={selectedNodeId}
            content={content}
            onChange={handleContentChange}
          />
        </div>
      </div>

      {level > 0 && (
        <div className="sidebar-footer">
          <button className="btn btn--danger btn--sm" onClick={handleDelete}>
            Delete node
          </button>
        </div>
      )}
    </div>
  )
}

export default Sidebar
