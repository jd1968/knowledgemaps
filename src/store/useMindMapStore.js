import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '../lib/supabase'
import { GRID_SIZE, NEST_PAD_LEFT, NEST_PAD_TOP, NEST_V_SPACING, snapPoint, snapSize, snapValue } from '../lib/grid'
import { buildSubtreePayload, parseSubtreePayload, remapSubtreeForPaste } from '../lib/subtreeClipboard'

const HISTORY_LIMIT = 50
const normalizeNodeType = (nodeType, isSubmap = false) => {
  if (isSubmap) return 'submap'
  if (!nodeType || nodeType === 'pointer') return 'card'
  return nodeType
}
const normalizeEdgeType = (edgeType) => (edgeType === 'pointer-edge' ? 'straight-center' : edgeType)
const DEFAULT_NODE_SIZE_BY_LEVEL = {
  0: { width: 200, height: 200 },
  1: { width: 190, height: 50 },
  2: { width: 150, height: 88 },
  3: { width: 130, height: 76 },
}
const RELATIONSHIP_ALLOWED_NODE_TYPES = new Set(['card', 'object', 'diagram', 'submap', 'note', 'image', 'text'])
const canConnectNodeTypes = (sourceType = 'card', targetType = 'card') => {
  if (sourceType === 'relationship') return RELATIONSHIP_ALLOWED_NODE_TYPES.has(targetType)
  if (targetType === 'relationship') return RELATIONSHIP_ALLOWED_NODE_TYPES.has(sourceType)
  return true
}
const relationshipEndFromHandleId = (handleId) => {
  if (!handleId) return null
  if (String(handleId).includes('left')) return 'left'
  if (String(handleId).includes('right')) return 'right'
  return null
}
const isRelationshipEdge = (edge) => !!edge?.data?.isRelationship
const normalizeRelationshipEdgeForNode = (edge, relationshipNodeId) => {
  if (!isRelationshipEdge(edge)) return edge
  if (edge.source === relationshipNodeId) return edge
  if (edge.target !== relationshipNodeId) return edge
  const end = relationshipEndFromHandleId(edge.targetHandle)
  if (!end) return null
  return {
    ...edge,
    source: relationshipNodeId,
    sourceHandle: `rel-${end}-source`,
    target: edge.source,
    targetHandle: null,
  }
}
const hierarchyEdgesOnly = (edges) => edges.filter((e) => !isRelationshipEdge(e))

const normalizeLevel = (level = 1) => Math.min(Math.max(level, 0), 3)

const getDefaultSizeForNode = (node) => {
  if (node?.data?.nodeType === 'relationship') return { width: 240, height: 40 }
  if (node?.data?.nodeType === 'object') return { width: 200, height: 90 }
  if (node?.data?.nodeType === 'image' || node?.data?.nodeType === 'note' || node?.data?.nodeType === 'diagram') return { width: 220, height: 180 }
  return DEFAULT_NODE_SIZE_BY_LEVEL[normalizeLevel(node?.data?.level ?? 1)]
}

const styleDim = (v) => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

const resolveNodePixelSize = (node) => {
  const fromData = node?.data?.size
  if (fromData?.width != null && fromData?.height != null) {
    return snapSize({ width: fromData.width, height: fromData.height }, { gridSize: GRID_SIZE })
  }
  const w = styleDim(node?.style?.width)
  const h = styleDim(node?.style?.height)
  if (w != null && h != null) return snapSize({ width: w, height: h }, { gridSize: GRID_SIZE })
  return snapSize(getDefaultSizeForNode(node), { gridSize: GRID_SIZE })
}

const applySelectionChanges = (changes, nodes) => applyNodeChanges(
  changes.filter((c) => c.type === 'select'),
  nodes
)

const applyPositionChanges = (changes, nodes) => applyNodeChanges(
  changes.filter((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add' || c.type === 'replace'),
  nodes
)

const applyResizeChanges = (changes, nodes, edges) => {
  const dimensionChanges = changes
    .filter((c) => c.type === 'dimensions' && c.dimensions)

  if (dimensionChanges.length === 0) return nodes

  const parentIds = new Set(edges.map((e) => e.source))
  const changeById = new Map(dimensionChanges.map((c) => [c.id, c]))
  const nodesAfterDimensions = applyNodeChanges(dimensionChanges, nodes)

  return nodesAfterDimensions.map((node) => {
    const change = changeById.get(node.id)
    if (!change) return node
    // During active drag keep raw dimensions for smooth tracking; snap only on release
    const dims = change.resizing
      ? change.dimensions
      : snapSize(change.dimensions, { gridSize: GRID_SIZE })
    return {
      ...node,
      style: {
        ...(node.style || {}),
        width: dims.width,
        height: dims.height,
      },
      data: {
        ...node.data,
        // Single persisted size authority for all resizable nodes.
        size: dims,
        ...(parentIds.has(node.id) ? { sizeMode: 'manual' } : {}),
      },
    }
  })
}

const ROOT_ID = 'root-' + uuidv4().slice(0, 8)

/** Single selected node id, or null if 0 or 2+ nodes selected — drives floating glyph / convert cleanup */
const selectionAnchorFromNodes = (nodes) => {
  const sel = nodes.filter((n) => n.selected).map((n) => n.id)
  return sel.length === 1 ? sel[0] : null
}

const initialNodes = [
  {
    id: ROOT_ID,
    type: 'mindmap',
    position: { x: 350, y: 250 },
    selected: false,
    data: {
      title: 'Central Topic',
      key: ROOT_ID,
      level: 0,
      nodeType: 'card',
      content: '',
    },
  },
]

export const useMindMapStore = create((set, get) => ({
  // ── Map data ─────────────────────────────────────────────────
  nodes: initialNodes,
  edges: [],
  pendingNewNodeId: null,
  modalNodeId: null,

  // ── Map metadata ─────────────────────────────────────────────
  currentMapId: null,
  currentMapName: 'Untitled Map',
  isDirty: false,
  saveStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'error'

  // ── History ──────────────────────────────────────────────────
  past: [],
  future: [],

  // ── UI state ─────────────────────────────────────────────────
  isMapListOpen: false,
  autosaveTimer: null,
  fitViewTrigger: 0,
  isEditMode: false,
  isFullscreen: false,
  viewMode: 'map',
  openMenuNodeId: null,
  /** Bumped whenever selection changes so nodes can clear stale hover / convert UI (see CustomNode). */
  floatingUiEpoch: 0,
  /** When exactly one node is selected, its id; otherwise null. Nodes with id !== anchor dismiss floating UI on epoch bump. */
  floatingUiAnchorId: null,
  /** While a node's floating glyph strip is shown, bring that node above overlaps (see MindMapCanvas zIndex). */
  glyphMenuNodeId: null,
  reparentSourceNodeId: null,
  copySizeSourceNodeId: null,
  pendingToolboxType: null,
  relationshipDrag: null,
  relationshipSourceNodeId: null,
  diagramEditorNodeId: null,

  // ── Node focus (map navigation) ───────────────────────────────
  focusNodeId: null,

  setIsFullscreen: (val) => set({ isFullscreen: val }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setOpenMenuNodeId: (id) => set({ openMenuNodeId: id }),
  setGlyphMenuNodeId: (id) => set({ glyphMenuNodeId: id }),
  clearGlyphMenuNodeIdIf: (id) => set((s) => (s.glyphMenuNodeId === id ? { glyphMenuNodeId: null } : {})),
  setReparentSourceNodeId: (id) => set({ reparentSourceNodeId: id, copySizeSourceNodeId: null }),
  clearReparentMode: () => set({ reparentSourceNodeId: null }),
  setCopySizeSourceNodeId: (id) => set({ copySizeSourceNodeId: id, reparentSourceNodeId: null }),
  clearCopySizeMode: () => set({ copySizeSourceNodeId: null }),
  setPendingToolboxType: (type) => set({ pendingToolboxType: type }),
  clearPendingToolboxType: () => set({ pendingToolboxType: null }),
  startRelationshipEndDrag: (relationshipNodeId, end, startScreenPos = null) => set({ relationshipDrag: { relationshipNodeId, end, startScreenPos } }),
  clearRelationshipEndDrag: () => set({ relationshipDrag: null }),
  setRelationshipSourceNodeId: (id) => set({ relationshipSourceNodeId: id }),
  clearRelationshipDraft: () => set({ relationshipSourceNodeId: null }),
  openDiagramEditor: (nodeId) => set({ diagramEditorNodeId: nodeId }),
  closeDiagramEditor: () => set({ diagramEditorNodeId: null }),

  setEditMode: (isEditMode) => set({
    isEditMode,
    reparentSourceNodeId: isEditMode ? get().reparentSourceNodeId : null,
    copySizeSourceNodeId: isEditMode ? get().copySizeSourceNodeId : null,
    glyphMenuNodeId: isEditMode ? get().glyphMenuNodeId : null,
  }),
  toggleEditMode: () => set((state) => ({
    isEditMode: !state.isEditMode,
    reparentSourceNodeId: state.isEditMode ? null : state.reparentSourceNodeId,
    copySizeSourceNodeId: state.isEditMode ? null : state.copySizeSourceNodeId,
    glyphMenuNodeId: state.isEditMode ? null : state.glyphMenuNodeId,
  })),

  focusNode: (nodeId) => set({ focusNodeId: nodeId }),
  clearFocusNode: () => set({ focusNodeId: null }),

  // ── Submap navigation ─────────────────────────────────────────
  // Each entry: { mapId, mapName }  — the trail of maps above the current one
  breadcrumbs: [],

  // ── React Flow handlers ───────────────────────────────────────

  onNodesChange: (changes) => {
    const { isEditMode, edges } = get()
    const effectiveChanges = isEditMode
      ? changes
      : changes.filter((c) => c.type === 'select' || c.type === 'dimensions')
    if (effectiveChanges.length === 0) return
    const hasNonSelectChange = effectiveChanges.some((c) => c.type !== 'select' && c.type !== 'dimensions')
    const hasSelectChange = effectiveChanges.some((c) => c.type === 'select')

    // Don't push position changes to history during drag (too noisy)
    // History is pushed in onNodeDragStart instead
    set((state) => {
      const selectedApplied = applySelectionChanges(effectiveChanges, state.nodes)
      const positionedApplied = applyPositionChanges(effectiveChanges, selectedApplied)
      const resizedApplied = applyResizeChanges(effectiveChanges, positionedApplied, edges)
      const anchor = selectionAnchorFromNodes(resizedApplied)
      return {
        nodes: resizedApplied,
        isDirty: hasNonSelectChange ? true : state.isDirty,
        ...(hasSelectChange
          ? {
              floatingUiEpoch: state.floatingUiEpoch + 1,
              floatingUiAnchorId: anchor,
            }
          : {}),
      }
    })
    // Debounce autosave (skip for selection-only changes)
    if (hasNonSelectChange) get().scheduleAutosave()
  },

  onEdgesChange: (changes) => {
    const { isEditMode } = get()
    const effectiveChanges = isEditMode
      ? changes
      : changes.filter((c) => c.type === 'select')
    if (effectiveChanges.length === 0) return

    const hasNonSelectChange = effectiveChanges.some((c) => c.type !== 'select')

    set((state) => ({
      edges: applyEdgeChanges(effectiveChanges, state.edges),
      isDirty: hasNonSelectChange ? true : state.isDirty,
    }))
    if (hasNonSelectChange) get().scheduleAutosave()
  },

  onConnect: (connection) => {
    if (!get().isEditMode) return
    const { nodes } = get()
    let normalizedConnection = { ...connection }
    const sourceNode = nodes.find((n) => n.id === normalizedConnection.source)
    const targetNode = nodes.find((n) => n.id === normalizedConnection.target)
    const sourceType = sourceNode?.data?.nodeType || 'card'
    const targetType = targetNode?.data?.nodeType || 'card'
    const sourceIsRelationship = sourceType === 'relationship'
    const targetIsRelationship = targetType === 'relationship'

    // Normalize relationship connections so they are always stored as:
    // relationship(source, specific-end-handle) -> object(target)
    if (sourceIsRelationship || targetIsRelationship) {
      const relationshipNode = sourceIsRelationship ? sourceNode : targetNode
      const objectNode = sourceIsRelationship ? targetNode : sourceNode
      const end = sourceIsRelationship
        ? relationshipEndFromHandleId(normalizedConnection.sourceHandle)
        : relationshipEndFromHandleId(normalizedConnection.targetHandle)
      if (!relationshipNode || !objectNode || !end) return
      // Keep obj-target-* handles; discard anything else (e.g. stale handle IDs)
      const rawTargetHandle = sourceIsRelationship
        ? normalizedConnection.targetHandle
        : normalizedConnection.sourceHandle
      const keepTargetHandle = rawTargetHandle?.startsWith?.('obj-target-') ? rawTargetHandle : null
      normalizedConnection = {
        source: relationshipNode.id,
        sourceHandle: `rel-${end}-source`,
        target: objectNode.id,
        targetHandle: keepTargetHandle,
      }
    }

    if (!canConnectNodeTypes(sourceType, targetType)) {
      alert('Relationship nodes can currently connect only to Object nodes.')
      return
    }
    const isRelationshipConnection = sourceIsRelationship || targetIsRelationship
    const edgeType = isRelationshipConnection ? 'relationship-edge' : 'straight-center'
    const edgeData = isRelationshipConnection
      ? { isRelationship: true, relType: sourceNode?.data?.relType || targetNode?.data?.relType || 'lookup' }
      : undefined
    const newEdge = {
      ...normalizedConnection,
      type: edgeType,
      ...(edgeData ? { data: edgeData } : {}),
      style: isRelationshipConnection
        ? { stroke: '#5b8dee', strokeWidth: 2.2 }
        : { stroke: '#94a3b8', strokeWidth: 2 },
      animated: false,
    }

    get().pushHistory()
    set((state) => {
      // For relationship endpoints, dragging from the same connector end should re-route
      // that end (replace existing edge) rather than creating an additional edge.
      if (isRelationshipConnection) {
        const replacementIndex = state.edges.findIndex((e) => {
          if (!isRelationshipEdge(e)) return false
          if (normalizedConnection.source && e.source === normalizedConnection.source && (e.sourceHandle || null) === (normalizedConnection.sourceHandle || null)) return true
          if (normalizedConnection.target && e.target === normalizedConnection.target && (e.targetHandle || null) === (normalizedConnection.targetHandle || null)) return true
          return false
        })
        if (replacementIndex >= 0) {
          const nextEdges = [...state.edges]
          nextEdges[replacementIndex] = { ...nextEdges[replacementIndex], ...newEdge, id: nextEdges[replacementIndex].id }
          return { edges: nextEdges, isDirty: true }
        }
      }

      return {
        edges: addEdge(newEdge, state.edges),
        isDirty: true,
      }
    })
    get().scheduleAutosave()
  },

  addRelationshipEdge: (sourceId, targetId) => {
    if (!get().isEditMode) return null
    const { nodes, edges } = get()
    const sourceNode = nodes.find((n) => n.id === sourceId)
    const targetNode = nodes.find((n) => n.id === targetId)
    const sourceType = sourceNode?.data?.nodeType || 'card'
    const targetType = targetNode?.data?.nodeType || 'card'
    if (!canConnectNodeTypes('relationship', sourceType) || !canConnectNodeTypes('relationship', targetType)) {
      return null
    }
    const exists = edges.some((e) => isRelationshipEdge(e) && e.source === sourceId && e.target === targetId)
    if (exists) return null
    const id = `rel-${uuidv4()}`
    const edge = {
      id,
      source: sourceId,
      target: targetId,
      type: 'relationship-edge',
      data: { isRelationship: true, relType: 'lookup', fromLabel: '', toLabel: '', description: '' },
      style: { stroke: '#5b8dee', strokeWidth: 2 },
    }
    get().pushHistory()
    set((state) => ({ edges: [...state.edges, edge], isDirty: true }))
    get().scheduleAutosave()
    return id
  },

  updateRelationshipEdgeData: (edgeId, updates) => {
    set((state) => ({
      edges: state.edges.map((e) => e.id === edgeId && isRelationshipEdge(e) ? { ...e, data: { ...(e.data || {}), ...updates } } : e),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  connectRelationshipEndToNode: (relationshipNodeId, end, targetNodeId, targetHandleOverride = null, targetNorm = null) => {
    if (!get().isEditMode) return
    const { nodes } = get()
    const relationshipNode = nodes.find((n) => n.id === relationshipNodeId)
    const targetNode = nodes.find((n) => n.id === targetNodeId)
    if (!relationshipNode || !targetNode) return
    if (relationshipNode.data?.nodeType !== 'relationship') return
    if (!RELATIONSHIP_ALLOWED_NODE_TYPES.has(targetNode.data?.nodeType || 'card')) return
    const sourceHandle = `rel-${end}-source`

    const targetHandle = targetHandleOverride || 'obj-target-left'

    const edgeData = { isRelationship: true, relType: relationshipNode.data?.relType || 'lookup', ...(targetNorm ? { targetNorm } : {}) }
    const newEdge = {
      id: `rel-${uuidv4()}`,
      source: relationshipNodeId,
      sourceHandle,
      target: targetNodeId,
      targetHandle,
      type: 'relationship-edge',
      data: edgeData,
      style: { stroke: '#5b8dee', strokeWidth: 2.2 },
      animated: false,
    }
    get().pushHistory()
    set((state) => {
      const sanitized = []
      const seenEnds = new Set()
      for (const raw of state.edges) {
        if (!isRelationshipEdge(raw)) {
          sanitized.push(raw)
          continue
        }
        const normalized = normalizeRelationshipEdgeForNode(raw, relationshipNodeId)
        if (!normalized) continue
        if (normalized.source !== relationshipNodeId) {
          sanitized.push(normalized)
          continue
        }
        const edgeEnd = relationshipEndFromHandleId(normalized.sourceHandle)
        // Drop malformed or same-end edges; we are replacing this end now.
        if (!edgeEnd || edgeEnd === end) continue
        // Keep at most one edge for the opposite end.
        if (seenEnds.has(edgeEnd)) continue
        seenEnds.add(edgeEnd)
        sanitized.push(normalized)
      }
      const nodes = state.nodes.map((n) => {
        if (n.id !== relationshipNodeId) return n
        const free = { ...(n.data?.relationshipFreeEnds || {}) }
        delete free[end]
        return { ...n, data: { ...n.data, relationshipFreeEnds: free } }
      })
      return { edges: [...sanitized, newEdge], nodes, isDirty: true, relationshipDrag: null }
    })
    get().scheduleAutosave()
  },

  setRelationshipFreeEnd: (relationshipNodeId, end, point) => {
    if (!get().isEditMode) return
    get().pushHistory()
    set((state) => {
      const sourceHandle = `rel-${end}-source`
      const nextEdges = []
      for (const raw of state.edges) {
        if (!isRelationshipEdge(raw)) {
          nextEdges.push(raw)
          continue
        }
        const normalized = normalizeRelationshipEdgeForNode(raw, relationshipNodeId)
        if (!normalized) continue
        if (normalized.source === relationshipNodeId && (normalized.sourceHandle || null) === sourceHandle) {
          continue
        }
        nextEdges.push(normalized)
      }
      const nodes = state.nodes.map((n) => {
        if (n.id !== relationshipNodeId) return n
        const free = { ...(n.data?.relationshipFreeEnds || {}) }
        if (point) free[end] = point
        else delete free[end]
        return { ...n, data: { ...n.data, relationshipFreeEnds: free } }
      })
      return { edges: nextEdges, nodes, relationshipDrag: null, isDirty: true }
    })
    get().scheduleAutosave()
  },

  reverseRelationshipConnector: (relationshipNodeId) => {
    if (!get().isEditMode) return
    get().pushHistory()
    set((state) => {
      const edges = state.edges.map((raw) => {
        if (!isRelationshipEdge(raw)) return raw
        const normalized = normalizeRelationshipEdgeForNode(raw, relationshipNodeId)
        if (!normalized || normalized.source !== relationshipNodeId) return normalized || raw
        const end = relationshipEndFromHandleId(normalized.sourceHandle)
        if (!end) return normalized
        return {
          ...normalized,
          sourceHandle: end === 'left' ? 'rel-right-source' : 'rel-left-source',
        }
      }).filter(Boolean)
      const nodes = state.nodes.map((n) => {
        if (n.id !== relationshipNodeId) return n
        const free = n.data?.relationshipFreeEnds || {}
        return {
          ...n,
          data: {
            ...n.data,
            fromLabel: n.data?.toLabel || '',
            toLabel: n.data?.fromLabel || '',
            relationshipFreeEnds: {
              left: free?.right,
              right: free?.left,
            },
          },
        }
      })
      return { edges, nodes, isDirty: true }
    })
    get().scheduleAutosave()
  },

  moveNodePosition: (nodeId, nextPosition, isFinal = false) => {
    if (!get().isEditMode) return
    set((state) => ({
      nodes: state.nodes.map((n) => (
        n.id === nodeId
          ? { ...n, position: nextPosition }
          : n
      )),
      isDirty: isFinal ? true : state.isDirty,
    }))
    if (isFinal) get().scheduleAutosave()
  },

  // ── Node CRUD ─────────────────────────────────────────────────

  addNode: ({ position, level = 1, title = '', nodeType = 'card' }) => {
    if (!get().isEditMode) return null
    get().pushHistory()
    const id = uuidv4()
    const snappedPosition = snapPoint(position)
    const baseSize = getDefaultSizeForNode({ data: { level, nodeType } })
    const newNode = {
      id,
      type: 'mindmap',
      position: snappedPosition,
      selected: true,
      ...(nodeType === 'text' ? {} : {
        style: { width: baseSize.width, height: baseSize.height },
      }),
      data: {
        title,
        key: id,
        level,
        nodeType,
        ...(nodeType === 'text' ? {} : { size: baseSize }),
        content: '',
      },
    }
    set((state) => ({
      nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), newNode],
      pendingNewNodeId: id,
      isDirty: true,
      floatingUiEpoch: state.floatingUiEpoch + 1,
      floatingUiAnchorId: id,
    }))
    get().scheduleAutosave()
    return newNode
  },

  resizeNode: (nodeId, { width, height, x, y }, isResizing = false) => {
    const size = isResizing
      ? { width, height }
      : snapSize({ width, height }, { gridSize: GRID_SIZE })
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node
        return {
          ...node,
          position: (x != null && y != null)
            ? { x: isResizing ? x : snapValue(x, GRID_SIZE), y: isResizing ? y : snapValue(y, GRID_SIZE) }
            : node.position,
          style: { ...(node.style || {}), width: size.width, height: size.height },
          data: { ...node.data, size },
        }
      }),
      isDirty: !isResizing,
    }))
    if (!isResizing) get().scheduleAutosave()
  },

  updateNodeData: (nodeId, updates) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      ),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  setDescendantsCollapsed: () => {
  },

  setEdgeType: (targetNodeId, edgeType) => {
    const normalizedType = normalizeEdgeType(edgeType)
    set((state) => ({
      edges: state.edges.map((e) =>
        e.target === targetNodeId ? { ...e, type: normalizedType } : e
      ),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  deleteNode: (nodeId) => {
    if (!get().isEditMode) return
    get().pushHistory()
    set((state) => {
      const nodes = state.nodes.filter((n) => n.id !== nodeId)
      return {
        nodes,
        edges: state.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        ),
        isDirty: true,
        floatingUiEpoch: state.floatingUiEpoch + 1,
        floatingUiAnchorId: selectionAnchorFromNodes(nodes),
      }
    })
    // Remove content row immediately so it doesn't linger in the nodes table
    const { currentMapId } = get()
    if (currentMapId) {
      supabase.from('nodes').delete().eq('id', nodeId).then(({ error }) => {
        if (error) console.error('Failed to delete node row:', error)
      })
    }
    get().scheduleAutosave()
  },

  /** Delete several nodes in one history step (e.g. multi-select). Skips level-0 root. */
  deleteNodes: (nodeIds) => {
    if (!get().isEditMode) return
    const { nodes } = get()
    const toRemove = nodeIds.filter((id) => {
      const n = nodes.find((x) => x.id === id)
      return n && (n.data?.level ?? 0) > 0
    })
    if (toRemove.length === 0) return
    get().pushHistory()
    const removeSet = new Set(toRemove)
    set((state) => {
      const nodes = state.nodes.filter((n) => !removeSet.has(n.id))
      return {
        nodes,
        edges: state.edges.filter(
          (e) => !removeSet.has(e.source) && !removeSet.has(e.target)
        ),
        isDirty: true,
        floatingUiEpoch: state.floatingUiEpoch + 1,
        floatingUiAnchorId: selectionAnchorFromNodes(nodes),
      }
    })
    const { currentMapId } = get()
    if (currentMapId) {
      toRemove.forEach((nodeId) => {
        supabase.from('nodes').delete().eq('id', nodeId).then(({ error }) => {
          if (error) console.error('Failed to delete node row:', error)
        })
      })
    }
    get().scheduleAutosave()
  },

  /** Copy a node and all descendants as JSON on the system clipboard (for pasting on this or another map). */
  copySubtreeToClipboard: async (nodeId) => {
    if (!get().isEditMode) return { success: false, error: 'edit' }
    const { nodes, edges } = get()
    const payload = buildSubtreePayload(nodes, edges, nodeId)
    if (!payload) return { success: false, error: 'empty' }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload))
      return { success: true }
    } catch {
      return { success: false, error: 'clipboard' }
    }
  },

  /** Paste subtree from clipboard at the given flow position (new ids, levels adjusted so root is L1). */
  pasteSubtreeFromClipboard: async (flowPosition) => {
    if (!get().isEditMode) return { success: false, error: 'edit' }
    let text
    try {
      text = await navigator.clipboard.readText()
    } catch {
      return { success: false, error: 'clipboard' }
    }
    const payload = parseSubtreePayload(text)
    if (!payload) return { success: false, error: 'invalid' }

    const { nodes, edges } = get()
    const mapRoot = nodes.find((n) => (n.data?.level ?? 0) === 0)
    const mapRootId = mapRoot?.id ?? null

    const { nodes: pastedNodes, edges: pastedEdges, newRootId } = remapSubtreeForPaste(
      payload,
      flowPosition,
      mapRootId
    )

    const mergedNodes = pastedNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        nodeType: normalizeNodeType(n.data?.nodeType, !!n.data?.isSubmap),
      },
      selected: n.id === newRootId,
    }))
    const normalizedPastedEdges = pastedEdges.map((e) => ({ ...e, type: normalizeEdgeType(e.type) }))

    get().pushHistory()
    set((state) => ({
      nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), ...mergedNodes],
      edges: [...state.edges, ...normalizedPastedEdges],
      isDirty: true,
      floatingUiEpoch: state.floatingUiEpoch + 1,
      floatingUiAnchorId: newRootId,
    }))
    get().scheduleAutosave()
    return { success: true, pastedRootId: newRootId }
  },

  // ── Selection (React Flow `nodes[].selected` is source of truth) ──

  setSelectedNodeIds: (ids) => {
    const idSet = new Set(ids)
    set((state) => {
      const nodes = state.nodes.map((n) => ({ ...n, selected: idSet.has(n.id) }))
      return {
        nodes,
        floatingUiEpoch: state.floatingUiEpoch + 1,
        floatingUiAnchorId: ids.length === 1 ? ids[0] : null,
      }
    })
  },

  selectNode: (nodeId) => {
    get().setSelectedNodeIds([nodeId])
  },

  deselectNode: () => {
    set((state) => ({
      nodes: state.nodes.map((n) => ({ ...n, selected: false })),
      pendingNewNodeId: null,
      floatingUiEpoch: state.floatingUiEpoch + 1,
      floatingUiAnchorId: null,
    }))
  },

  openNodeModal: (nodeId) => set({ modalNodeId: nodeId }),
  closeNodeModal: () => set({ modalNodeId: null, pendingNewNodeId: null }),

  // ── History ───────────────────────────────────────────────────

  pushHistory: () => {
    const { nodes, edges, past } = get()
    const snapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    set({ past: [...past, snapshot].slice(-HISTORY_LIMIT), future: [] })
  },

  undo: () => {
    if (!get().isEditMode) return
    const { nodes, edges, past, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const currentSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: past.slice(0, -1),
      future: [currentSnapshot, ...future].slice(0, HISTORY_LIMIT),
      isDirty: true,
    })
  },

  redo: () => {
    if (!get().isEditMode) return
    const { nodes, edges, past, future } = get()
    if (future.length === 0) return
    const next = future[0]
    const currentSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    set({
      nodes: next.nodes,
      edges: next.edges,
      past: [...past, currentSnapshot].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      isDirty: true,
    })
  },

  // ── Autosave ──────────────────────────────────────────────────

  scheduleAutosave: () => {
    const state = get()
    if (state.autosaveTimer) clearTimeout(state.autosaveTimer)
    if (!state.currentMapId) return // Only autosave maps that have been explicitly saved once

    const timer = setTimeout(() => {
      get().saveMap()
    }, 2000)

    set({ autosaveTimer: timer })
  },

  // ── Save / Load ───────────────────────────────────────────────

  saveMap: async (nameOverride) => {
    const { nodes, edges, currentMapId, currentMapName } = get()
    const name = nameOverride || currentMapName

    // Strip content from diagram JSON — content lives in the nodes table
    const mapData = {
      nodes: nodes.map(({ data: { content: _c, ...rest }, selected: _s, dragging: _d, measured: _m, ...node }) => ({
        ...node,
        data: { ...rest, nodeType: normalizeNodeType(rest.nodeType, !!rest.isSubmap) },
      })),
      edges: edges.map((e) => ({ ...e, type: normalizeEdgeType(e.type) })),
    }

    set({ saveStatus: 'saving' })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      let mapId = currentMapId

      if (mapId) {
        const { error } = await supabase
          .from('maps')
          .update({ name, data: mapData })
          .eq('id', mapId)
        if (error) throw error
      } else {
        const { data: saved, error } = await supabase
          .from('maps')
          .insert({ name, data: mapData, user_id: user?.id })
          .select()
          .single()
        if (error) throw error
        mapId = saved.id
        set({ currentMapId: mapId })
      }

      // Upsert node content — skip submap pointer nodes (their content lives in the child map)
      const contentNodes = nodes.filter((n) => !n.data.isSubmap)
      if (contentNodes.length > 0) {
        const nodeRows = contentNodes.map((n) => ({
          id: n.id,
          map_id: mapId,
          user_id: user?.id,
          title: n.data.title || '',
          content: n.data.content || '',
        }))
        const { error } = await supabase
          .from('nodes')
          .upsert(nodeRows, { onConflict: 'id' })
        if (error) throw error
      }

      set({ isDirty: false, currentMapName: name, saveStatus: 'saved' })
      setTimeout(() => set({ saveStatus: 'idle' }), 2000)

      return { success: true }
    } catch (err) {
      console.error('Save failed:', err)
      set({ saveStatus: 'error' })
      setTimeout(() => set({ saveStatus: 'idle' }), 3000)
      return { success: false, error: err }
    }
  },

  loadMap: async (mapId, breadcrumbs = []) => {
    try {
      // Phase 1: load map structure only so the canvas renders immediately
      const mapResult = await supabase.from('maps').select('*').eq('id', mapId).single()
      if (mapResult.error) throw mapResult.error

      const nodes = (mapResult.data.data.nodes || []).map((n) => ({
        ...n,
        selected: false,
        data: {
          ...n.data,
          nodeType: normalizeNodeType(n.data.nodeType, !!n.data.isSubmap),
          content: '',
        },
      }))

      set((state) => ({
        nodes,
        edges: (mapResult.data.data.edges || []).map((e) => ({ ...e, type: normalizeEdgeType(e.type) })),
        currentMapId: mapResult.data.id,
        currentMapName: mapResult.data.name,
        isDirty: false,
        past: [],
        future: [],
        saveStatus: 'idle',
        fitViewTrigger: state.fitViewTrigger + 1,
        breadcrumbs,
        diagramEditorNodeId: null,
        openMenuNodeId: null,
        glyphMenuNodeId: null,
        floatingUiEpoch: state.floatingUiEpoch + 1,
        floatingUiAnchorId: null,
      }))

      // Touch last_visited_at — fire-and-forget, not critical
      supabase.from('maps').update({ last_visited_at: new Date().toISOString() }).eq('id', mapId).then()

      // Only persist the last-opened map when at the root level
      if (breadcrumbs.length === 0) {
        localStorage.setItem('km_lastMapId', mapId)
      }

      // Phase 2: load node content in the background — updates hasNotes indicators
      get()._loadContentForMap(mapId)

      return { success: true }
    } catch (err) {
      console.error('Load failed:', err)
      return { success: false, error: err }
    }
  },

  _loadContentForMap: async (mapId) => {
    const { data } = await supabase.from('nodes').select('id, content').eq('map_id', mapId)
    if (!data) return
    const contentById = {}
    data.forEach((n) => { contentById[n.id] = n.content || '' })
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const content = contentById[n.id]
        if (content === undefined) return n
        return { ...n, data: { ...n.data, content } }
      }),
    }))
  },

  // ── Submap ────────────────────────────────────────────────────

  convertToSubmap: async (nodeId) => {
    if (!get().isEditMode) return { success: false }
    const { nodes, edges, currentMapId, currentMapName, isDirty, autosaveTimer } = get()
    const hierarchyEdges = hierarchyEdgesOnly(edges)
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return { success: false }

    // Flush any pending autosave for the parent map first
    if (isDirty && currentMapId) {
      if (autosaveTimer) clearTimeout(autosaveTimer)
      await get().saveMap()
    }

    const nodeLevel = node.data.level

    // Build children map from edges
    const childrenMap = {}
    hierarchyEdges.forEach((e) => {
      if (!childrenMap[e.source]) childrenMap[e.source] = []
      childrenMap[e.source].push(e.target)
    })

    // Collect the node + all its descendants
    const subtreeIds = new Set([nodeId])
    const collectIds = (id) => {
      ;(childrenMap[id] || []).forEach((kid) => { subtreeIds.add(kid); collectIds(kid) })
    }
    collectIds(nodeId)

    const subtreeNodes = nodes.filter((n) => subtreeIds.has(n.id))
    const subtreeEdges = hierarchyEdges.filter((e) => subtreeIds.has(e.source) && subtreeIds.has(e.target))

    // Offset positions so the converted node lands at a nice centre
    const offsetX = 350 - node.position.x
    const offsetY = 250 - node.position.y

    const submapNodes = subtreeNodes.map((n) => ({
      ...n,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
      data: {
        ...n.data,
        level: n.id === nodeId ? 0 : Math.min(Math.max(n.data.level - nodeLevel, 1), 3),
        // Clear submap pointer fields — nodes are "real" inside the submap
        isSubmap: undefined,
        submapId: undefined,
      },
    }))

    // Strip content from map JSON (content lives in nodes table)
    const submapMapData = {
      nodes: submapNodes.map(({ data: { content: _c, ...rest }, ...n }) => ({ ...n, data: rest })),
      edges: subtreeEdges,
      parentMapId: currentMapId,
      parentNodeId: nodeId,
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Create the new submap record
      const { data: newMap, error: mapErr } = await supabase
        .from('maps')
        .insert({ name: node.data.title || 'Submap', data: submapMapData, user_id: user?.id })
        .select()
        .single()
      if (mapErr) throw mapErr

      // Write node content rows for the submap (this moves map_id ownership to the submap)
      const contentRows = subtreeNodes.map((n) => ({
        id: n.id,
        map_id: newMap.id,
        user_id: user?.id,
        title: n.data.title || '',
        content: n.data.content || '',
      }))
      const { error: contentErr } = await supabase
        .from('nodes')
        .upsert(contentRows, { onConflict: 'id' })
      if (contentErr) throw contentErr

      // Update parent map in memory: remove descendants, mark node as submap pointer
      const descendantIds = new Set([...subtreeIds].filter((id) => id !== nodeId))
      set((state) => ({
        nodes: state.nodes
          .filter((n) => !descendantIds.has(n.id))
          .map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, isSubmap: true, submapId: newMap.id, nodeType: 'submap' } }
              : n
          ),
        edges: state.edges.filter(
          (e) => !descendantIds.has(e.source) && !descendantIds.has(e.target)
        ),
        isDirty: true,
      }))

      // Save the updated parent map immediately
      await get().saveMap()

      return { success: true, submapId: newMap.id }
    } catch (err) {
      console.error('convertToSubmap failed:', err)
      return { success: false, error: err }
    }
  },

  navigateToSubmap: async (submapId) => {
    const { currentMapId, currentMapName, breadcrumbs, isDirty, autosaveTimer } = get()
    if (isDirty && currentMapId) {
      if (autosaveTimer) clearTimeout(autosaveTimer)
      await get().saveMap()
    }
    const newCrumbs = [...breadcrumbs, { mapId: currentMapId, mapName: currentMapName }]
    return get().loadMap(submapId, newCrumbs)
  },

  navigateBack: async (targetIndex = null) => {
    const { breadcrumbs } = get()
    if (breadcrumbs.length === 0) return
    let crumb, newCrumbs
    if (targetIndex !== null) {
      crumb = breadcrumbs[targetIndex]
      newCrumbs = breadcrumbs.slice(0, targetIndex)
    } else {
      crumb = breadcrumbs[breadcrumbs.length - 1]
      newCrumbs = breadcrumbs.slice(0, -1)
    }
    return get().loadMap(crumb.mapId, newCrumbs)
  },

  newMap: (name = 'Untitled Map') => {
    const rootId = 'root-' + uuidv4().slice(0, 8)
    set((state) => ({
      nodes: [
        {
          id: rootId,
          type: 'mindmap',
          position: { x: 350, y: 250 },
          selected: false,
          data: { title: name, key: rootId, level: 0, content: '' },
        },
      ],
      edges: [],
      currentMapId: null,
      currentMapName: name,
      isDirty: false,
      past: [],
      future: [],
      saveStatus: 'idle',
      openMenuNodeId: null,
      glyphMenuNodeId: null,
      floatingUiEpoch: state.floatingUiEpoch + 1,
      floatingUiAnchorId: null,
    }))
  },

  setMapName: (name) => {
    set({ currentMapName: name, isDirty: true })
  },

  // ── Add child node ────────────────────────────────────────────

  addChildNode: (parentId, nodeType = 'card', options = {}) => {
    if (!get().isEditMode) return
    const { nodes, edges } = get()
    const hierarchyEdges = hierarchyEdgesOnly(edges)
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) return

    get().pushHistory()

    const parentLevel = parent.data.level ?? 0
    const childLevel = parentLevel + 1
    const parentType = parent.data?.nodeType || 'card'
    if (!canConnectNodeTypes(parentType, nodeType)) {
      alert('Relationship nodes can currently connect only to Object nodes.')
      return null
    }

    // Find existing children of this parent to stack below them
    const childIds = new Set(
      hierarchyEdges.filter((e) => e.source === parentId).map((e) => e.target)
    )
    const childNodes = nodes.filter((n) => childIds.has(n.id))

    // Place child inside the parent node
    let x = parent.position.x + NEST_PAD_LEFT
    let y = parent.position.y + NEST_PAD_TOP

    if (childNodes.length > 0) {
      const sorted = [...childNodes].sort((a, b) => a.position.y - b.position.y)
      const last = sorted[sorted.length - 1]
      const lastHeight = last.data?.size?.height ?? getDefaultSizeForNode(last).height
      y = last.position.y + lastHeight + NEST_V_SPACING
    }
    const overridePosition = options?.position
      ? snapPoint(options.position)
      : null
    const snappedPosition = overridePosition ?? snapPoint({ x, y })

    const id = uuidv4()
    const size = getDefaultSizeForNode({ data: { level: childLevel, nodeType } })
    const newNode = {
      id,
      type: 'mindmap',
      position: snappedPosition,
      selected: true,
      style: nodeType === 'text' ? undefined : { width: size.width, height: size.height },
      data: { title: '', key: id, level: childLevel, nodeType, size, content: '' },
    }

    const newEdge = {
      id: `e-${parentId}-${id}`,
      source: parentId,
      target: id,
      type: 'straight-center',
      style: { stroke: '#94a3b8', strokeWidth: 2 },
      animated: false,
    }

    set((state) => ({
      nodes: [
        ...state.nodes.map((n) => ({ ...n, selected: false })),
        newNode,
      ],
      edges: [...state.edges, newEdge],
      pendingNewNodeId: id,
      isDirty: true,
      floatingUiEpoch: state.floatingUiEpoch + 1,
      floatingUiAnchorId: id,
    }))

    get().scheduleAutosave()
    return id
  },

  // ── Reparent node (drag-drop into group) ──────────────────────

  reparentNode: (nodeId, newParentId) => {
    if (!get().isEditMode) return
    const { nodes, edges } = get()
    const hierarchyEdges = hierarchyEdgesOnly(edges)

    // Guard: can't reparent to self
    if (nodeId === newParentId) return

    // Guard: already a direct child of this parent
    const currentParentEdge = hierarchyEdges.find(e => e.target === nodeId)
    if (currentParentEdge?.source === newParentId) return

    // Guard: newParentId must not be a descendant of nodeId (would create cycle)
    const isDescendant = (fromId, targetId) => {
      for (const e of hierarchyEdges) {
        if (e.source !== fromId) continue
        if (e.target === targetId || isDescendant(e.target, targetId)) return true
      }
      return false
    }
    if (isDescendant(nodeId, newParentId)) return

    const newParentNode = nodes.find(n => n.id === newParentId)
    const newParentLevel = newParentNode?.data?.level ?? 0
    const movingNode = nodes.find((n) => n.id === nodeId)
    const sourceType = newParentNode?.data?.nodeType || 'card'
    const targetType = movingNode?.data?.nodeType || 'card'
    if (!canConnectNodeTypes(sourceType, targetType)) {
      alert('Relationship nodes can currently connect only to Object nodes.')
      return
    }

    // Preserve the existing edge type (e.g. pointer-edge) when reparenting
    const existingEdgeType = currentParentEdge?.type ?? 'straight-center'

    // Build new edge list: remove old parent edge, add new one
    const newEdges = [
      ...edges.filter(e => e.target !== nodeId || isRelationshipEdge(e)),
      {
        id: `e-${newParentId}-${nodeId}`,
        source: newParentId,
        target: nodeId,
        type: existingEdgeType,
        style: { stroke: '#94a3b8', strokeWidth: 2 },
        animated: false,
      },
    ]

    // Recursively assign new levels for the moved subtree
    const levelMap = {}
    const assignLevels = (id, level) => {
      levelMap[id] = level
      newEdges.filter(e => e.source === id).forEach(e => assignLevels(e.target, level + 1))
    }
    assignLevels(nodeId, newParentLevel + 1)

    // Position the moved node inside the new parent
    const existingSiblingCount = newEdges.filter(e => e.source === newParentId && e.target !== nodeId).length
    const newX = newParentNode.position.x + NEST_PAD_LEFT
    const newY = newParentNode.position.y + NEST_PAD_TOP + existingSiblingCount * (88 + NEST_V_SPACING)
    const snappedPosition = snapPoint({ x: newX, y: newY })

    set(state => ({
      nodes: state.nodes.map(n => {
        const nextLevel = levelMap[n.id]
        if (n.id === nodeId) {
          return { ...n, position: snappedPosition, data: { ...n.data, level: levelMap[n.id] ?? n.data.level } }
        }
        if (nextLevel !== undefined) {
          return { ...n, data: { ...n.data, level: nextLevel } }
        }
        return n
      }),
      edges: newEdges,
      isDirty: true,
    }))

    get().scheduleAutosave()
  },

  // ── Copy size from one node to another (glyph workflow) ─────────

  applySizeFromSourceToTarget: (sourceId, targetId) => {
    if (!get().isEditMode) return
    if (sourceId === targetId) return
    const { nodes, edges } = get()
    const source = nodes.find((n) => n.id === sourceId)
    const target = nodes.find((n) => n.id === targetId)
    if (!source || !target) return
    if ((target.data?.level ?? 0) === 0) return
    if (target.data?.nodeType === 'text' || source.data?.nodeType === 'text') return

    get().pushHistory()
    const size = resolveNodePixelSize(source)
    const parentIds = new Set(edges.map((e) => e.source))

    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== targetId) return n
        return {
          ...n,
          style: { ...(n.style || {}), width: size.width, height: size.height },
          data: {
            ...n.data,
            size,
            ...(parentIds.has(targetId) ? { sizeMode: 'manual' } : {}),
          },
        }
      }),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  // ── Move subtree ──────────────────────────────────────────────

  moveSubtreeBy: (rootId, dx, dy, shouldScheduleAutosave = true) => {
    if (!get().isEditMode) return
    if (!dx && !dy) return
    const { edges } = get()
    const hierarchyEdges = hierarchyEdgesOnly(edges)
    const descendants = new Set()
    const stack = [rootId]
    while (stack.length) {
      const current = stack.pop()
      hierarchyEdges.forEach((e) => {
        if (e.source === current && !descendants.has(e.target)) {
          descendants.add(e.target)
          stack.push(e.target)
        }
      })
    }
    if (descendants.size === 0) return

    set((state) => ({
      nodes: state.nodes.map((n) =>
        descendants.has(n.id)
          ? {
              ...n,
              position: { x: n.position.x + dx, y: n.position.y + dy },
            }
          : n
      ),
      isDirty: true,
    }))
    if (shouldScheduleAutosave) get().scheduleAutosave()
  },

  snapSubtreeToGrid: (rootId, includeRoot = true) => {
    const { nodes, edges } = get()
    const hierarchyEdges = hierarchyEdgesOnly(edges)
    const ids = new Set(includeRoot ? [rootId] : [])
    const stack = [rootId]
    while (stack.length) {
      const current = stack.pop()
      hierarchyEdges.forEach((e) => {
        if (e.source === current && !ids.has(e.target)) {
          ids.add(e.target)
          stack.push(e.target)
        }
      })
    }
    set((state) => ({
      nodes: state.nodes.map((n) => (
        ids.has(n.id)
          ? { ...n, position: snapPoint(n.position) }
          : n
      )),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  // ── Modal ─────────────────────────────────────────────────────

  openMapList: () => set({ isMapListOpen: true }),
  closeMapList: () => set({ isMapListOpen: false }),

  // ── Settings ──────────────────────────────────────────────────

  settings: { initialZoom: 0.9 },

  loadSettings: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('user_settings')
      .select('initial_zoom')
      .eq('user_id', user.id)
      .maybeSingle()
    if (data) {
      set({ settings: { initialZoom: data.initial_zoom } })
    }
  },

  saveSettings: async (updates) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false }
    const row = { user_id: user.id, updated_at: new Date().toISOString() }
    if ('initialZoom' in updates) row.initial_zoom = updates.initialZoom
    const { error } = await supabase
      .from('user_settings')
      .upsert(row, { onConflict: 'user_id' })
    if (error) return { success: false, error }
    set((state) => ({ settings: { ...state.settings, ...updates } }))
    return { success: true }
  },
}))
