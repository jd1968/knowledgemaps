import { useEffect, useRef } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'

const NodeTreePanel = ({ onClose, buttonRef }) => {
  const { nodes, edges, focusNode } = useMindMapStore()
  const panelRef = useRef(null)

  // Close on outside click (excluding the toggle button)
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (buttonRef?.current?.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, buttonRef])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Build lookup maps
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })
  const childrenOf = {}
  edges.forEach(e => {
    if (!childrenOf[e.source]) childrenOf[e.source] = []
    childrenOf[e.source].push(e.target)
  })

  // Flat depth-first tree, children sorted alphabetically
  const rootNode = nodes.find(n => n.data?.level === 0) ?? nodes[0]
  const treeItems = []
  const visit = (nodeId, depth) => {
    const node = nodeById[nodeId]
    if (!node) return
    const kids = (childrenOf[nodeId] ?? [])
      .map(id => nodeById[id])
      .filter(Boolean)
      .sort((a, b) => (a.data?.title || '').localeCompare(b.data?.title || ''))
    treeItems.push({ node, depth })
    kids.forEach(k => visit(k.id, depth + 1))
  }
  if (rootNode) visit(rootNode.id, 0)

  const handleSelect = (nodeId) => {
    focusNode(nodeId)
    onClose()
  }

  return (
    <div className="node-tree-panel" ref={panelRef}>
      <div className="node-tree-header">
        <span>Contents</span>
        <button className="node-tree-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="node-tree-list">
        {treeItems.map(({ node, depth }) => (
          <button
            key={node.id}
            className="node-tree-item"
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            onClick={() => handleSelect(node.id)}
          >
            {node.data?.title || 'Untitled'}
          </button>
        ))}
      </div>
    </div>
  )
}

export default NodeTreePanel
