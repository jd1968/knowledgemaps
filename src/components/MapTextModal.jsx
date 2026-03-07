import { useState } from 'react'
import { createPortal } from 'react-dom'
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

    // Sort children by vertical position to reflect visual order
    const kids = (childrenOf[nodeId] ?? [])
      .map(id => nodeById[id])
      .filter(Boolean)
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))

    kids.forEach(k => visit(k.id, depth + 1))
  }

  visit(rootNode.id, 0)

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ── Modal ──────────────────────────────────────────────────────── */

const MapTextModal = ({ onClose }) => {
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

  return createPortal(
    <div
      className="map-text-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="map-text-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="map-text-header">
          <div className="map-text-header-left">
            <h3>Map as Text</h3>
            <span className="map-text-format-badge">Markdown</span>
          </div>
          <div className="map-text-header-actions">
            <button className="btn btn--secondary btn--sm" onClick={handleCopy}>
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <pre className="map-text-content">{text}</pre>
      </div>
    </div>,
    document.body
  )
}

export default MapTextModal
