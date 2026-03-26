import { useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'

/* ── Tree builder ───────────────────────────────────────────────── */

function buildMarkdown(nodes, edges, mapName) {
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })

  const childrenOf = {}
  const hasParent = new Set()
  edges.forEach(e => {
    if (!childrenOf[e.source]) childrenOf[e.source] = []
    childrenOf[e.source].push(e.target)
    hasParent.add(e.target)
  })

  const lines = [`# ${mapName}`, '']

  const rootNode = nodes.find(n => n.data?.level === 0) ?? nodes[0]
  if (!rootNode) return lines.join('\n')

  const CANVAS_ONLY = new Set(['image', 'text', 'note'])
  const visited = new Set([rootNode.id])
  const visit = (nodeId, depth) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const node = nodeById[nodeId]
    if (!node) return
    if (CANVAS_ONLY.has(node.data?.nodeType)) {
      // Still visit children in case they're content nodes
      const kids = (childrenOf[nodeId] ?? []).map(id => nodeById[id]).filter(Boolean)
      kids.forEach(k => visit(k.id, depth))
      return
    }

    const title = node.data?.title || 'Untitled'
    const nodeType = (node.data?.nodeType === 'folder' ? 'node' : node.data?.nodeType) || 'node'
    const typeSuffix = nodeType !== 'node' ? ` *(${nodeType})*` : ''

    const headingLevel = Math.min(depth + 1, 6)
    lines.push(`${'#'.repeat(headingLevel)} ${title}${typeSuffix}`)
    lines.push('')

    const kids = (childrenOf[nodeId] ?? [])
      .map(id => nodeById[id])
      .filter(Boolean)
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))

    kids.forEach(k => visit(k.id, depth + 1))
  }

  // Skip the root node itself (already used as the # heading via mapName)
  const rootKids = (childrenOf[rootNode.id] ?? [])
    .map(id => nodeById[id])
    .filter(Boolean)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
  rootKids.forEach(k => visit(k.id, 1))

  // Also include level-1 nodes with no parent edge (placed without edge to root)
  nodes
    .filter(n => n.data?.level === 1 && !hasParent.has(n.id) && !visited.has(n.id))
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
    .forEach(n => visit(n.id, 1))

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ── TextView ───────────────────────────────────────────────────── */

export default function MapTextModal() {
  const { nodes, edges, currentMapName } = useMindMapStore()
  const [copied, setCopied] = useState(false)

  const text = buildMarkdown(nodes, edges, currentMapName)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="text-view">
      <div className="text-view__inner">
        <div className="text-view__toolbar">
          <span className="map-text-format-badge">Markdown</span>
          <button className="btn btn--secondary btn--sm" onClick={handleCopy}>
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="text-view__content">{text}</pre>
      </div>
    </div>
  )
}
