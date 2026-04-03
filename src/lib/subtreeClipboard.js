import { v4 as uuidv4 } from 'uuid'
import { GRID_SIZE, snapPoint } from './grid'

export const SUBTREE_CLIPBOARD_KIND = 'knowledgemaps-subtree-v1'

/**
 * All node ids reachable from rootId following parent→child edges.
 */
export function collectSubtreeIds(rootId, edges) {
  const ids = new Set([rootId])
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()
    for (const e of edges) {
      if (e.source === id && !ids.has(e.target)) {
        ids.add(e.target)
        queue.push(e.target)
      }
    }
  }
  return ids
}

function stripNodeForExport(node) {
  const clone = JSON.parse(JSON.stringify(node))
  delete clone.selected
  delete clone.dragging
  delete clone.measured
  return clone
}

/**
 * Build a JSON-serializable payload for clipboard (node + descendants only).
 */
export function buildSubtreePayload(nodes, edges, rootId) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  if (!nodeById.has(rootId)) return null

  const subtreeIds = collectSubtreeIds(rootId, edges)
  const subtreeNodes = nodes
    .filter((n) => subtreeIds.has(n.id))
    .map((n) => stripNodeForExport(n))

  const subtreeEdges = edges.filter(
    (e) => subtreeIds.has(e.source) && subtreeIds.has(e.target)
  )

  return {
    kind: SUBTREE_CLIPBOARD_KIND,
    v: 1,
    rootId,
    nodes: subtreeNodes,
    edges: subtreeEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type ?? 'straight-center',
      style: e.style,
      animated: e.animated,
    })),
  }
}

export function parseSubtreePayload(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const data = JSON.parse(trimmed)
    if (data?.kind !== SUBTREE_CLIPBOARD_KIND || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return null
    }
    if (!data.rootId || !data.nodes.some((n) => n.id === data.rootId)) return null
    return data
  } catch {
    return null
  }
}

function normalizeLevel(level) {
  return Math.min(Math.max(Number(level) || 1, 0), 3)
}

/**
 * Remap ids, shift positions to paste anchor, re-level so subtree root becomes L1.
 * Optionally connect pasted root to the map's central topic (level-0) node.
 */
export function remapSubtreeForPaste(payload, pastePosition, mapRootId) {
  const { rootId, nodes: rawNodes, edges: rawEdges } = payload
  const idMap = new Map()
  rawNodes.forEach((n) => idMap.set(n.id, uuidv4()))

  const rootOld = rawNodes.find((n) => n.id === rootId)
  const rootLevel = rootOld?.data?.level ?? 1
  const levelDelta = 1 - rootLevel

  let minX = Infinity
  let minY = Infinity
  rawNodes.forEach((n) => {
    minX = Math.min(minX, n.position?.x ?? 0)
    minY = Math.min(minY, n.position?.y ?? 0)
  })

  const newNodes = rawNodes.map((n) => {
    const newId = idMap.get(n.id)
    const dx = (n.position?.x ?? 0) - minX
    const dy = (n.position?.y ?? 0) - minY
    const pos = snapPoint({
      x: pastePosition.x + dx,
      y: pastePosition.y + dy,
    }, GRID_SIZE)
    const stripped = stripNodeForExport(n)
    const newLevel = normalizeLevel((n.data?.level ?? 1) + levelDelta)
    return {
      ...stripped,
      id: newId,
      position: pos,
      selected: false,
      data: {
        ...stripped.data,
        key: newId,
        level: newLevel,
      },
    }
  })

  const newRootId = idMap.get(rootId)
  const newEdges = rawEdges.map((e) => ({
    ...e,
    id: `e-${idMap.get(e.source)}-${idMap.get(e.target)}`,
    source: idMap.get(e.source),
    target: idMap.get(e.target),
    type: e.type ?? 'straight-center',
    style: e.style ?? { stroke: '#94a3b8', strokeWidth: 2 },
    animated: !!e.animated,
  }))

  const finalEdges = [...newEdges]
  if (mapRootId && newRootId) {
    const rootNode = newNodes.find((nn) => nn.id === newRootId)
    const hasParentEdge = finalEdges.some((e) => e.target === newRootId)
    if (rootNode && (rootNode.data?.level ?? 0) === 1 && !hasParentEdge) {
      finalEdges.push({
        id: `e-${mapRootId}-${newRootId}`,
        source: mapRootId,
        target: newRootId,
        type: 'straight-center',
        style: { stroke: '#94a3b8', strokeWidth: 2 },
        animated: false,
      })
    }
  }

  return { nodes: newNodes, edges: finalEdges, newRootId }
}
