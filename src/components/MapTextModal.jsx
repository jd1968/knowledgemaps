import { useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'

/* ── Tree builder ───────────────────────────────────────────────── */

function buildMarkdown(nodes, edges, mapName) {
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })

  const childrenOf = {}
  edges.forEach(e => {
    if (!childrenOf[e.source]) childrenOf[e.source] = []
    childrenOf[e.source].push(e.target)
  })

  const lines = [`# ${mapName}`, '']

  const rootNode = nodes.find(n => n.data?.level === 0) ?? nodes[0]
  if (!rootNode) return lines.join('\n')

  const visit = (nodeId, depth) => {
    const node = nodeById[nodeId]
    if (!node) return

    const title = node.data?.title || 'Untitled'
    const nodeType = node.data?.nodeType || 'folder'
    const typeSuffix = nodeType !== 'folder' ? ` *(${nodeType})*` : ''

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
