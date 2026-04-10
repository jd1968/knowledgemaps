import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '../lib/supabase'
import { CARD_GAP, GRID_SIZE, MAP_CLIENT_WIDTH, MAP_GRID_SIZE, MAP_GRID_Y_SIZE, NEST_PAD_BOTTOM, NEST_PAD_LEFT, NEST_PAD_RIGHT, NEST_PAD_TOP, NEST_V_SPACING, snapCardSpanSize, snapPoint, snapSize, snapValue } from '../lib/grid'
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
const RELATIONSHIP_ALLOWED_NODE_TYPES = new Set(['card', 'shape', 'object', 'diagram', 'submap', 'note', 'image', 'text', 'or'])
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
const FIXED_ORIGIN = { x: 0, y: 0 }
const snapResizeDimensionsForNode = (node, dimensions, isResizing) => {
  if (isResizing) return dimensions
  const isL1CardLike = (node?.data?.nodeType === 'card' || node?.data?.nodeType === 'diagram') && (node?.data?.level ?? 0) === 1
  if (isL1CardLike) {
    return {
      width: snapCardSpanSize(dimensions.width, { min: 60 }),
      height: snapCardSpanSize(dimensions.height, { min: 30, cellSize: MAP_GRID_Y_SIZE }),
    }
  }
  return snapSize(dimensions, { gridSize: GRID_SIZE })
}

const getMoveSnapGridForNode = (node) => {
  const isL1Node = (node?.data?.level ?? 0) === 1
  return isL1Node
    ? { x: MAP_GRID_SIZE, y: MAP_GRID_Y_SIZE }
    : { x: GRID_SIZE, y: GRID_SIZE }
}

const getHierarchyChildrenMap = (edges) => {
  const childrenMap = new Map()
  hierarchyEdgesOnly(edges).forEach((edge) => {
    if (!childrenMap.has(edge.source)) childrenMap.set(edge.source, [])
    childrenMap.get(edge.source).push(edge.target)
  })
  return childrenMap
}

/** Transitive hierarchy targets under `rootId` (excludes `rootId`). */
const collectDescendantIds = (rootId, childrenMap) => {
  const out = new Set()
  const stack = [...(childrenMap.get(rootId) || [])]
  while (stack.length) {
    const id = stack.pop()
    if (out.has(id)) continue
    out.add(id)
    for (const next of childrenMap.get(id) || []) stack.push(next)
  }
  return out
}

const hasNodeContent = (node) => {
  const content = node?.data?.content
  return typeof content === 'string' && content.trim() !== '' && content !== '<p></p>'
}

const estimateCardContentOffset = (parentNode, parentWidth, parentHeight) => {
  if (!hasNodeContent(parentNode)) return 0
  const raw = String(parentNode?.data?.content || '')
  const plain = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const hardBreaks = (raw.match(/\n/g) || []).length
  const usableWidth = Math.max(120, parentWidth - NEST_PAD_LEFT - NEST_PAD_RIGHT)
  const charsPerLine = Math.max(18, Math.floor(usableWidth / 7))
  const lineCount = Math.max(1, Math.ceil((plain.length || 1) / charsPerLine) + hardBreaks)
  const estimatedHeight = lineCount * 16 + 8
  return Math.min(Math.max(16, estimatedHeight), Math.max(24, parentHeight * 0.35))
}

const getCardChildClientArea = (parentNode) => {
  if (!parentNode || parentNode?.data?.nodeType !== 'card') return null
  if ((parentNode?.data?.level ?? 0) <= 0) return null
  const parentSize = resolveNodePixelSize(parentNode)
  const contentOffset = estimateCardContentOffset(parentNode, parentSize.width, parentSize.height)
  const minX = parentNode.position.x + NEST_PAD_LEFT
  const minY = parentNode.position.y + NEST_PAD_TOP + contentOffset
  const maxX = parentNode.position.x + parentSize.width - NEST_PAD_RIGHT
  const maxY = parentNode.position.y + parentSize.height - NEST_PAD_BOTTOM
  return { minX, minY, maxX, maxY }
}

const clampChildPositionInCardClientArea = (node, parentNode, position) => {
  const area = getCardChildClientArea(parentNode)
  if (!area) return position
  const nodeSize = resolveNodePixelSize(node)
  const minX = area.minX
  const minY = area.minY
  const maxX = Math.max(minX, area.maxX - nodeSize.width)
  const maxY = Math.max(minY, area.maxY - nodeSize.height)
  return {
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(minY, position.y)),
  }
}

const applyAutoLayoutChildrenForCard = ({ nodes, edges, parentId }) => {
  const parent = nodes.find((n) => n.id === parentId)
  if (!parent) return { nodes, changed: false }
  if (parent.data?.nodeType !== 'card') return { nodes, changed: false }
  const clientArea = getCardChildClientArea(parent)
  if (!clientArea) return { nodes, changed: false }

  const childrenMap = getHierarchyChildrenMap(edges)
  const childIds = childrenMap.get(parentId) || []
  const childIdSet = new Set(childIds)
  const children = nodes.filter((n) => childIdSet.has(n.id))
  if (children.length === 0) {
    return { nodes, changed: false }
  }

  const sortedChildren = [...children].sort((a, b) => {
    const ay = a.position?.y ?? 0
    const by = b.position?.y ?? 0
    if (ay !== by) return ay - by
    const ax = a.position?.x ?? 0
    const bx = b.position?.x ?? 0
    if (ax !== bx) return ax - bx
    return String(a.id).localeCompare(String(b.id))
  })

  const clientAreaWidth = Math.max(120, clientArea.maxX - clientArea.minX)
  const columns = Math.max(1, Math.round((clientAreaWidth + CARD_GAP) / MAP_GRID_SIZE))
  const gap = CARD_GAP
  const innerWidth = clientAreaWidth
  const childWidth = Math.max(40, (innerWidth - gap * (columns - 1)) / columns)
  const startX = clientArea.minX

  const childHeights = sortedChildren.map((child) => {
    const live = resolveNodePixelSize(child).height
    return Math.max(30, snapValue(live, GRID_SIZE))
  })
  const rowCount = Math.ceil(sortedChildren.length / columns)
  const rowHeights = Array.from({ length: rowCount }, () => 0)
  for (let i = 0; i < sortedChildren.length; i++) {
    const row = Math.floor(i / columns)
    rowHeights[row] = Math.max(rowHeights[row], childHeights[i])
  }
  const rowOffsets = Array.from({ length: rowCount }, () => 0)
  for (let row = 1; row < rowCount; row++) {
    rowOffsets[row] = rowOffsets[row - 1] + rowHeights[row - 1] + gap
  }

  let changed = false
  const nextNodes = nodes.map((node) => {
    const idx = sortedChildren.findIndex((c) => c.id === node.id)
    if (idx < 0) return node
    const row = Math.floor(idx / columns)
    const col = idx % columns
    const rawX = startX + col * (childWidth + gap)
    const maxXForNode = Math.max(clientArea.minX, clientArea.maxX - childWidth)
    const x = Math.min(maxXForNode, Math.max(clientArea.minX, rawX))
    const existingHeight = childHeights[idx]
    const rawY = snapValue(clientArea.minY + rowOffsets[row], GRID_SIZE)
    const maxYForNode = Math.max(clientArea.minY, clientArea.maxY - existingHeight)
    const y = Math.min(maxYForNode, Math.max(clientArea.minY, rawY))
    const nextNode = {
      ...node,
      position: { x, y },
      style: {
        ...(node.style || {}),
        width: childWidth,
        height: existingHeight,
      },
      data: {
        ...node.data,
        size: { width: childWidth, height: existingHeight },
      },
    }
    if (
      (node.position?.x ?? 0) !== x ||
      (node.position?.y ?? 0) !== y ||
      (node.data?.size?.width ?? node.style?.width ?? 0) !== childWidth ||
      (node.data?.size?.height ?? node.style?.height ?? 0) !== existingHeight
    ) {
      changed = true
    }
    return nextNode
  })

  return { nodes: changed ? nextNodes : nodes, changed }
}

const getDefaultSizeForNode = (node) => {
  if (node?.data?.nodeType === 'relationship') return { width: 240, height: 40 }
  if (node?.data?.nodeType === 'or') return { width: 120, height: 54 }
  if (node?.data?.nodeType === 'shape') return { width: 190, height: 80 }
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
    return snapResizeDimensionsForNode(node, { width: fromData.width, height: fromData.height }, false)
  }
  const w = styleDim(node?.style?.width)
  const h = styleDim(node?.style?.height)
  if (w != null && h != null) return snapResizeDimensionsForNode(node, { width: w, height: h }, false)
  return snapResizeDimensionsForNode(node, getDefaultSizeForNode(node), false)
}

/** L1: keep within fixed map width. Y is unbounded (vertical panning). */
const clampNodePositionToBounds = (node, position) => {
  const level = node?.data?.level ?? 0
  let x = Math.max(FIXED_ORIGIN.x, position?.x ?? 0)
  let y = Math.max(FIXED_ORIGIN.y, position?.y ?? 0)
  if (level === 1) {
    const { width } = resolveNodePixelSize(node)
    x = Math.min(MAP_CLIENT_WIDTH - width, x)
  }
  return { x, y }
}

/** L1 vertical snap to MAP_GRID_Y_SIZE, never above minY (top of map pane). */
const snapL1YToLargeGrid = (y, minY) => Math.max(minY, snapValue(y, MAP_GRID_Y_SIZE))

const snapDragPositionForNode = (node, position) => {
  const level = node?.data?.level ?? 0
  if (level === 1) {
    return {
      x: snapValue(position.x, MAP_GRID_SIZE),
      y: snapL1YToLargeGrid(position.y, FIXED_ORIGIN.y),
    }
  }
  return {
    x: snapValue(position.x, GRID_SIZE),
    y: snapValue(position.y, GRID_SIZE),
  }
}

const shiftPoint = (point, dx, dy) => {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return point
  return { x: point.x + dx, y: point.y + dy }
}

const shiftRelationshipNodeData = (nodeData, dx, dy) => {
  if (nodeData?.nodeType !== 'relationship') return nodeData
  const free = nodeData.relationshipFreeEnds || {}
  const shiftedFree = {}
  if (free.left) shiftedFree.left = shiftPoint(free.left, dx, dy)
  if (free.right) shiftedFree.right = shiftPoint(free.right, dx, dy)
  const hasShiftedFree = Object.keys(shiftedFree).length > 0
  const waypoints = Array.isArray(nodeData.elbowWaypoints)
    ? nodeData.elbowWaypoints.map((p) => shiftPoint(p, dx, dy))
    : nodeData.elbowWaypoints
  return {
    ...nodeData,
    ...(hasShiftedFree ? { relationshipFreeEnds: shiftedFree } : {}),
    ...(Array.isArray(waypoints) ? { elbowWaypoints: waypoints } : {}),
  }
}

const getNodeBounds = (node) => {
  const { width, height } = resolveNodePixelSize(node)
  const x = node?.position?.x ?? 0
  const y = node?.position?.y ?? 0
  return {
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  }
}

const computeMapBounds = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }
  const bounds = nodes.reduce((acc, node) => {
    const b = getNodeBounds(node)
    return {
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }
  }, {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  })
  return {
    ...bounds,
    width: Math.max(0, bounds.maxX - bounds.minX),
    height: Math.max(0, bounds.maxY - bounds.minY),
  }
}

const computeNormalizationDelta = (nodes, origin = FIXED_ORIGIN) => {
  const bounds = computeMapBounds(nodes)
  const shiftX = bounds.minX < origin.x ? origin.x - bounds.minX : 0
  const shiftY = bounds.minY < origin.y ? origin.y - bounds.minY : 0
  return {
    shiftX,
    shiftY,
    requiresShift: !!(shiftX || shiftY),
    bounds,
  }
}

const applySelectionChanges = (changes, nodes) => applyNodeChanges(
  changes.filter((c) => c.type === 'select'),
  nodes
)

const applyPositionChanges = (changes, nodes) => applyNodeChanges(
  changes.filter((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add' || c.type === 'replace'),
  nodes
)

const applyResizeChanges = (changes, nodes, _edges) => {
  const dimensionChanges = changes
    .filter((c) => c.type === 'dimensions' && c.dimensions)

  if (dimensionChanges.length === 0) return nodes

  const changeById = new Map(dimensionChanges.map((c) => [c.id, c]))
  const nodesAfterDimensions = applyNodeChanges(dimensionChanges, nodes)

  return nodesAfterDimensions.map((node) => {
    const change = changeById.get(node.id)
    if (!change) return node
    // During active drag keep raw dimensions for smooth tracking; snap only on release
    const dims = snapResizeDimensionsForNode(node, change.dimensions, !!change.resizing)
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
          // Any direct resize should persist as a manual size, including leaf cards.
          sizeMode: 'manual',
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
  currentMapIconUrl: '',
  currentMapContent: '',
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

  getMapBounds: () => {
    const { nodes } = get()
    return computeMapBounds(nodes.filter((n) => (n.data?.level ?? 0) > 0))
  },

  previewNormalizationDelta: () => {
    const { nodes } = get()
    return computeNormalizationDelta(nodes.filter((n) => (n.data?.level ?? 0) > 0))
  },

  normalizeMapCoordinates: async ({ persist = true } = {}) => {
    const state = get()
    const candidateNodes = state.nodes.filter((n) => (n.data?.level ?? 0) > 0)
    const { shiftX, shiftY, requiresShift, bounds } = computeNormalizationDelta(candidateNodes)
    if (!requiresShift) {
      return { success: true, changed: false, shiftX: 0, shiftY: 0, bounds }
    }

    get().pushHistory()
    set((curr) => ({
      nodes: curr.nodes.map((node) => {
        if ((node.data?.level ?? 0) <= 0) return node
        return {
          ...node,
          position: {
            x: (node?.position?.x ?? 0) + shiftX,
            y: (node?.position?.y ?? 0) + shiftY,
          },
          data: shiftRelationshipNodeData(node.data, shiftX, shiftY),
        }
      }),
      isDirty: true,
    }))

    const currentMapId = get().currentMapId
    if (persist && currentMapId) {
      const saveResult = await get().saveMap()
      if (!saveResult?.success) {
        return { success: false, changed: true, shiftX, shiftY, bounds, error: saveResult?.error }
      }
      return { success: true, changed: true, persisted: true, shiftX, shiftY, bounds }
    }

    if (persist && !currentMapId) {
      return { success: true, changed: true, persisted: false, shiftX, shiftY, bounds }
    }

    get().scheduleAutosave()
    return { success: true, changed: true, persisted: false, shiftX, shiftY, bounds }
  },

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
      const prevById = new Map(state.nodes.map((n) => [n.id, n]))
      const selectedApplied = applySelectionChanges(effectiveChanges, state.nodes)
      const positionedApplied = applyPositionChanges(effectiveChanges, selectedApplied)
      const resizedApplied = applyResizeChanges(effectiveChanges, positionedApplied, edges)
      const changedPositionIds = new Set(
        effectiveChanges
          .filter((c) => c.type === 'position')
          .map((c) => c.id)
      )
      const positionChangeById = new Map()
      effectiveChanges.forEach((c) => {
        if (c.type === 'position') positionChangeById.set(c.id, c)
      })
      const hierarchyEdges = hierarchyEdgesOnly(edges)
      const parentByChildId = {}
      hierarchyEdges.forEach((e) => { parentByChildId[e.target] = e.source })
      const hierarchyChildMap = getHierarchyChildrenMap(hierarchyEdges)

      // When RF moves a parent, it only updates that node. Shift all hierarchy descendants by the
      // same delta (after clamp/snap) so the last drop frame cannot leave children behind.
      let working = resizedApplied
      const subtreeShiftedParents = new Set()
      for (const cid of changedPositionIds) {
        const directKids = hierarchyChildMap.get(cid)
        if (!directKids?.length) continue
        const prevNode = prevById.get(cid)
        if (!prevNode) continue
        const cur = working.find((n) => n.id === cid)
        if (!cur) continue
        const posCh = positionChangeById.get(cid)
        const isPointerDrag = posCh?.dragging === true
        let targetP = clampNodePositionToBounds(cur, cur.position)
        if (!isPointerDrag) {
          targetP = snapDragPositionForNode(cur, targetP)
        }
        const dx = targetP.x - (prevNode.position?.x ?? 0)
        const dy = targetP.y - (prevNode.position?.y ?? 0)
        const descIds = collectDescendantIds(cid, hierarchyChildMap)
        working = working.map((n) => {
          if (n.id === cid) return { ...n, position: targetP }
          if (descIds.has(n.id)) {
            return {
              ...n,
              position: {
                x: (n.position?.x ?? 0) + dx,
                y: (n.position?.y ?? 0) + dy,
              },
              data: shiftRelationshipNodeData(n.data, dx, dy),
            }
          }
          return n
        })
        subtreeShiftedParents.add(cid)
      }

      const byId = {}
      working.forEach((n) => { byId[n.id] = n })
      const boundedNodes = working.map((node) => {
        let p
        if (subtreeShiftedParents.has(node.id)) {
          p = { x: node.position.x, y: node.position.y }
        } else {
          p = clampNodePositionToBounds(node, node.position)
          if (changedPositionIds.has(node.id)) {
            const pch = positionChangeById.get(node.id)
            if (pch?.dragging !== true) {
              p = snapDragPositionForNode(node, p)
            }
          }
        }
        let boundedNode = node
        if (p.x !== node.position.x || p.y !== node.position.y) {
          boundedNode = { ...node, position: p }
        }
        const parentId = parentByChildId[node.id]
        if (!parentId) return boundedNode
        const parentNode = byId[parentId]
        if (!parentNode || parentNode.data?.nodeType !== 'card') return boundedNode
        if (!changedPositionIds.has(node.id)) return boundedNode
        const bounded = clampChildPositionInCardClientArea(boundedNode, parentNode, boundedNode.position)
        if (bounded.x === boundedNode.position.x && bounded.y === boundedNode.position.y) return boundedNode
        return { ...boundedNode, position: bounded }
      })
      const anchor = selectionAnchorFromNodes(boundedNodes)
      return {
        nodes: boundedNodes,
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
        const labelOffsets = n.data?.relationshipLabelOffsets || {}
        return {
          ...n,
          data: {
            ...n.data,
            fromLabel: n.data?.toLabel || '',
            toLabel: n.data?.fromLabel || '',
            relationshipLabelOffsets: {
              from: labelOffsets?.to || { x: 0, y: 0 },
              to: labelOffsets?.from || { x: 0, y: 0 },
            },
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
          ? {
              ...n,
              position: clampNodePositionToBounds(n, nextPosition),
            }
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
    const provisionalNodeForBounds = { data: { level } }
    const snappedPosition = clampNodePositionToBounds(
      provisionalNodeForBounds,
      snapPoint(position)
    )
    const baseSize = getDefaultSizeForNode({ data: { level, nodeType } })
    const effectiveTitle = nodeType === 'or' ? (title || 'or') : title
    const newNode = {
      id,
      type: 'mindmap',
      position: snappedPosition,
      selected: true,
      ...(nodeType === 'text' ? {} : {
        style: { width: baseSize.width, height: baseSize.height },
      }),
      data: {
        title: effectiveTitle,
        key: id,
        level,
        nodeType,
        ...(nodeType === 'text' ? {} : { size: baseSize }),
        ...(nodeType === 'relationship' ? {
          relType: 'lookup',
          lineStyle: 'elbow',
          fromLabel: '',
          toLabel: '',
          description: '',
          relationshipLabelOffsets: {
            from: { x: 0, y: 0 },
            to: { x: 0, y: 0 },
          },
        } : {}),
        ...(nodeType === 'shape' ? {
          backgroundMode: 'theme',
          shapeBorderColor: '',
          shapeShadow: false,
          shapeTextAlign: 'center',
        } : {}),
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
    const node = get().nodes.find((n) => n.id === nodeId)
    const size = snapResizeDimensionsForNode(node, { width, height }, isResizing)
    const isL1CardLike = (node?.data?.nodeType === 'card' || node?.data?.nodeType === 'diagram') && (node?.data?.level ?? 0) === 1
    const positionSnapGridX = isL1CardLike ? MAP_GRID_SIZE : GRID_SIZE
    const positionSnapGridY = isL1CardLike ? MAP_GRID_Y_SIZE : GRID_SIZE
    set((state) => ({
      nodes: (() => {
        const resizedNodes = state.nodes.map((node) => {
          if (node.id !== nodeId) return node
          return {
            ...node,
            position: (x != null && y != null)
              ? clampNodePositionToBounds(
                  node,
                  { x: isResizing ? x : snapValue(x, positionSnapGridX), y: isResizing ? y : snapValue(y, positionSnapGridY) },
                )
              : node.position,
            style: { ...(node.style || {}), width: size.width, height: size.height },
            // Mark explicit user resizes as manual so layout defaults don't override them.
            data: { ...node.data, size, sizeMode: 'manual' },
          }
        })
        if (isResizing) return resizedNodes

        // Keep sibling child heights aligned when one child is manually resized.
        const hierarchyEdges = hierarchyEdgesOnly(state.edges)
        const parentEdge = hierarchyEdges.find((e) => e.target === nodeId)
        if (!parentEdge) return resizedNodes
        const resizedNode = resizedNodes.find((n) => n.id === nodeId)
        if (!resizedNode) return resizedNodes
        const siblingIds = new Set(
          hierarchyEdges
            .filter((e) => e.source === parentEdge.source)
            .map((e) => e.target)
        )
        const nonLeafNodeIds = new Set(hierarchyEdges.map((e) => e.source))
        if (nonLeafNodeIds.has(nodeId)) return resizedNodes
        const targetLevel = resizedNode.data?.level ?? null
        const targetHeight = size.height
        return resizedNodes.map((n) => {
          if (n.id === nodeId) return n
          if (!siblingIds.has(n.id)) return n
          if ((n.data?.level ?? null) !== targetLevel) return n
          if (nonLeafNodeIds.has(n.id)) return n
          if (n.data?.nodeType === 'text') return n
          const existingSize = n.data?.size || {}
          return {
            ...n,
            style: {
              ...(n.style || {}),
              height: targetHeight,
            },
            data: {
              ...n.data,
              size: {
                ...existingSize,
                width: existingSize.width ?? n.style?.width ?? getDefaultSizeForNode(n).width,
                height: targetHeight,
              },
            },
          }
        })
      })(),
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

  autoLayoutChildrenForCard: (nodeId) => {
    if (!get().isEditMode) return
    const target = get().nodes.find((n) => n.id === nodeId)
    if (!target || target.data?.nodeType !== 'card') return
    get().pushHistory()
    set((state) => {
      const laidOut = applyAutoLayoutChildrenForCard({
        nodes: state.nodes,
        edges: state.edges,
        parentId: nodeId,
      })
      return { nodes: laidOut.nodes, isDirty: true }
    })
    get().scheduleAutosave()
  },

  setRelationshipElbowWaypoints: (nodeId, waypoints, commit = false) => {
    set((state) => ({
      nodes: state.nodes.map((node) => (
        node.id === nodeId
          ? { ...node, data: { ...node.data, elbowWaypoints: Array.isArray(waypoints) ? waypoints : [] } }
          : node
      )),
      isDirty: commit ? true : state.isDirty,
    }))
    if (commit) get().scheduleAutosave()
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
      meta: {
        iconUrl: get().currentMapIconUrl || '',
        content: get().currentMapContent || '',
      },
      nodes: nodes.map((rawNode) => {
        const {
          data: { content: _c, ...restData },
          selected: _s,
          dragging: _d,
          measured: _m,
          width: _w,
          height: _h,
          resizing: _r,
          ...node
        } = rawNode
        return {
          ...node,
          data: { ...restData, nodeType: normalizeNodeType(restData.nodeType, !!restData.isSubmap) },
        }
      }),
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

      const nodes = (mapResult.data.data.nodes || []).map((rawNode) => {
        const {
          selected: _s,
          dragging: _d,
          measured: _m,
          width: _w,
          height: _h,
          resizing: _r,
          ...n
        } = rawNode
        return {
          ...n,
          selected: false,
          data: {
            ...n.data,
            nodeType: normalizeNodeType(n.data.nodeType, !!n.data.isSubmap),
            content: '',
          },
        }
      })

      set((state) => ({
        nodes,
        edges: (mapResult.data.data.edges || []).map((e) => ({ ...e, type: normalizeEdgeType(e.type) })),
        currentMapId: mapResult.data.id,
        currentMapName: mapResult.data.name,
        currentMapIconUrl: mapResult.data.data?.meta?.iconUrl || '',
        currentMapContent: mapResult.data.data?.meta?.content || '',
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
      currentMapIconUrl: '',
      currentMapContent: '',
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

  setMapProperties: ({ name, iconUrl, content }) => {
    set((state) => ({
      currentMapName: typeof name === 'string' ? name : state.currentMapName,
      currentMapIconUrl: typeof iconUrl === 'string' ? iconUrl : state.currentMapIconUrl,
      currentMapContent: typeof content === 'string' ? content : state.currentMapContent,
      isDirty: true,
    }))
    get().scheduleAutosave()
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
    const initialPosition = clampNodePositionToBounds(
      { data: { level: childLevel } },
      overridePosition ?? snapPoint({ x, y })
    )

    const id = uuidv4()
    const size = getDefaultSizeForNode({ data: { level: childLevel, nodeType } })
    const defaultTitle = nodeType === 'or' ? 'or' : ''
    const provisionalNode = {
      id,
      type: 'mindmap',
      position: initialPosition,
      selected: true,
      style: nodeType === 'text' ? undefined : { width: size.width, height: size.height },
      data: {
        title: defaultTitle,
        key: id,
        level: childLevel,
        nodeType,
        size,
        content: '',
      },
    }
    const snappedPosition = parent.data?.nodeType === 'card'
      ? clampChildPositionInCardClientArea(provisionalNode, parent, initialPosition)
      : initialPosition
    const newNode = {
      id,
      type: 'mindmap',
      position: snappedPosition,
      selected: true,
      style: nodeType === 'text' ? undefined : { width: size.width, height: size.height },
      data: {
        title: defaultTitle,
        key: id,
        level: childLevel,
        nodeType,
        size,
        ...(nodeType === 'shape' ? {
          backgroundMode: 'theme',
          shapeBorderColor: '',
          shapeShadow: false,
          shapeTextAlign: 'center',
        } : {}),
        content: '',
      },
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
    let snappedPosition = snapPoint({ x: newX, y: newY })
    if (newParentNode.data?.nodeType === 'card' && movingNode) {
      snappedPosition = clampChildPositionInCardClientArea(
        { ...movingNode, position: snappedPosition },
        newParentNode,
        snappedPosition
      )
    }

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

  finalizeSubtreeDrag: (rootId) => {
    if (!get().isEditMode) return
    const { nodes, edges } = get()
    const root = nodes.find((n) => n.id === rootId)
    if (!root) return
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
    const rootSnapGrid = getMoveSnapGridForNode(root)
    const rawY = (root.data?.level ?? 0) === 1
      ? snapL1YToLargeGrid(root.position?.y ?? 0, FIXED_ORIGIN.y)
      : snapValue(root.position?.y ?? 0, rootSnapGrid.y)
    const snappedRoot = clampNodePositionToBounds(root, {
      x: snapValue(root.position?.x ?? 0, rootSnapGrid.x),
      y: rawY,
    })
    const dx = snappedRoot.x - (root.position?.x ?? 0)
    const dy = snappedRoot.y - (root.position?.y ?? 0)
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      get().scheduleAutosave()
      return
    }
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== rootId && !descendants.has(n.id)) return n
        return {
          ...n,
          position: { x: (n.position?.x ?? 0) + dx, y: (n.position?.y ?? 0) + dy },
          data: shiftRelationshipNodeData(n.data, dx, dy),
        }
      }),
      isDirty: true,
    }))
    get().scheduleAutosave()
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
    set((state) => {
      const hierarchyEdgesCurrent = hierarchyEdgesOnly(state.edges)
      const parentByChildId = {}
      hierarchyEdgesCurrent.forEach((e) => { parentByChildId[e.target] = e.source })
      const byId = {}
      state.nodes.forEach((n) => { byId[n.id] = n })
      return {
        nodes: state.nodes.map((n) => {
          if (!ids.has(n.id)) return n
          const snapGrid = getMoveSnapGridForNode(n)
          const level = n?.data?.level ?? 0
          const sy = level === 1
            ? snapL1YToLargeGrid(n.position.y, FIXED_ORIGIN.y)
            : snapValue(n.position.y, snapGrid.y)
          let snappedPosition = clampNodePositionToBounds(n, {
            x: snapValue(n.position.x, snapGrid.x),
            y: sy,
          })
          const parentId = parentByChildId[n.id]
          const parentNode = parentId ? byId[parentId] : null
          if (parentNode?.data?.nodeType === 'card') {
            snappedPosition = clampChildPositionInCardClientArea(n, parentNode, snappedPosition)
          }
          const dx = snappedPosition.x - n.position.x
          const dy = snappedPosition.y - n.position.y
          if (!dx && !dy) return n
          return {
            ...n,
            position: snappedPosition,
            data: shiftRelationshipNodeData(n.data, dx, dy),
          }
        }),
        isDirty: true,
      }
    })
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
