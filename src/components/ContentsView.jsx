import { useMindMapStore } from '../store/useMindMapStore'

export default function ContentsView() {
  const { nodes, edges, setSelectedNodeIds, focusNode, setViewMode } = useMindMapStore()

  // Build lookup maps
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })
  const childrenOf = {}
  const hasParent = new Set()
  edges.forEach(e => {
    if (!childrenOf[e.source]) childrenOf[e.source] = []
    childrenOf[e.source].push(e.target)
    hasParent.add(e.target)
  })

  // Flat depth-first tree
  const CANVAS_ONLY = new Set(['image', 'text', 'note'])
  const rootNode = nodes.find(n => n.data?.level === 0) ?? nodes[0]
  const treeItems = []
  const visited = new Set()
  const visit = (nodeId, depth) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const node = nodeById[nodeId]
    if (!node) return
    const kids = (childrenOf[nodeId] ?? []).map(id => nodeById[id]).filter(Boolean)
    if (!CANVAS_ONLY.has(node.data?.nodeType)) treeItems.push({ node, depth })
    kids.forEach(k => visit(k.id, depth + 1))
  }
  if (rootNode) {
    visit(rootNode.id, 0)
    nodes
      .filter(n => n.data?.level === 1 && !hasParent.has(n.id))
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
      .forEach(n => visit(n.id, 1))
  }

  const handleGoToMap = (e, nodeId) => {
    e.stopPropagation()
    setViewMode('map')
    focusNode(nodeId)
  }

  return (
    <div className="contents-view">
      <div className="contents-view__list">
        {treeItems.map(({ node, depth }) => (
          <button
            key={node.id}
            className={`contents-view__item contents-view__item--depth-${Math.min(depth, 4)}`}
            style={{ paddingLeft: `${20 + depth * 18}px` }}
            onClick={() => setSelectedNodeIds([node.id])}
          >
            <span className="contents-view__item-title">
              {node.data?.longTitle || node.data?.title || 'Untitled'}
            </span>
            <span className="contents-view__item-actions">
              {!!(node.data?.content && node.data.content.trim() !== '') && (
                <span className="contents-view__item-notes" title="Has notes" aria-label="Has notes">≡</span>
              )}
              {node.data?.nodeType && node.data.nodeType !== 'node' && node.data.nodeType !== 'folder' && (
                <span className="contents-view__item-type">{node.data.nodeType}</span>
              )}
              <span
                className="contents-view__item-map-link"
                role="button"
                title="Show on map"
                onClick={(e) => handleGoToMap(e, node.id)}
              >
                ↗
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
