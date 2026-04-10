import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  BackgroundVariant,
  PanOnScrollMode,
  SelectionMode,
  Panel,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMindMapStore } from '../store/useMindMapStore'
import CustomNode from './CustomNode'
import StraightCenterEdge from './StraightCenterEdge'
import RelationshipEdge from './RelationshipEdge'
import { GRID, GRID_SIZE, MAP_CLIENT_WIDTH, MAP_GRID_SIZE, MAP_GRID_Y_SIZE, snapPoint, snapValue } from '../lib/grid'
import { STANDARD_THEME_COLORS } from '../lib/themePalette'
import { NodeIconDisplay } from './NodeIcon'
import { markdownComponents, urlTransform } from './MarkdownEditor'

const nodeTypes = { mindmap: CustomNode }
const edgeTypes = { 'straight-center': StraightCenterEdge, 'relationship-edge': RelationshipEdge }
const TOOLBOX_DRAG_MIME = 'application/x-knowledgemaps-node-type'
const RELATIONSHIP_ALLOWED_NODE_TYPES = new Set(['card', 'shape', 'object', 'diagram', 'submap', 'note', 'image', 'text', 'or'])
const canConnectNodeTypes = (sourceType = 'card', targetType = 'card') => {
  if (sourceType === 'relationship') return RELATIONSHIP_ALLOWED_NODE_TYPES.has(targetType)
  if (targetType === 'relationship') return RELATIONSHIP_ALLOWED_NODE_TYPES.has(sourceType)
  return true
}
const isRelationshipEdge = (edge) => !!edge?.data?.isRelationship
const relationshipStroke = (relType, selected) => {
  if (relType === 'master-detail') return selected ? '#c62828' : '#e53935'
  return selected ? '#3a6fd8' : '#5b8dee'
}
const REL_ENDPOINT_RADIUS = 9.1
const normalizeRelationshipLineStyle = (lineStyle) => {
  if (lineStyle === 'straight') return 'straight'
  if (lineStyle === 'curve' || lineStyle === 'bezier') return 'curve'
  return 'elbow'
}
const outwardNormal = (norm) => {
  if (!norm || typeof norm.nx !== 'number' || typeof norm.ny !== 'number') return { dx: 0, dy: 0 }
  const e = 0.001
  let dx = 0
  let dy = 0
  if (norm.nx < e) dx -= 1
  if (norm.nx > 1 - e) dx += 1
  if (norm.ny < e) dy -= 1
  if (norm.ny > 1 - e) dy += 1
  const len = Math.hypot(dx, dy)
  return len > 0 ? { dx: dx / len, dy: dy / len } : { dx: 0, dy: 0 }
}
const generateElbowWaypoints = (from, fromNorm, to, toNorm) => {
  const fn = outwardNormal(fromNorm)
  const tn = outwardNormal(toNorm)
  const fromH = Math.abs(fn.dx) > Math.abs(fn.dy)
  const toH = Math.abs(tn.dx) > Math.abs(tn.dy)
  if (fromH === toH) {
    if (fromH) {
      const mx = snapPoint({ x: (from.x + to.x) / 2, y: 0 }, GRID[0]).x
      return [{ x: mx, y: from.y }, { x: mx, y: to.y }]
    }
    const my = snapPoint({ x: 0, y: (from.y + to.y) / 2 }, GRID[0]).y
    return [{ x: from.x, y: my }, { x: to.x, y: my }]
  }
  return fromH ? [{ x: to.x, y: from.y }] : [{ x: from.x, y: to.y }]
}
const rectifyElbowWaypoints = (from, fromNorm, to, toNorm, waypoints) => {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return []
  const fn = outwardNormal(fromNorm)
  const tn = outwardNormal(toNorm)
  const rect = waypoints.map((w) => ({ ...w }))
  const first = rect[0] || to
  const last = rect[rect.length - 1] || from
  const hasFromNormal = Math.abs(fn.dx) > 0 || Math.abs(fn.dy) > 0
  const hasToNormal = Math.abs(tn.dx) > 0 || Math.abs(tn.dy) > 0
  const fromH = hasFromNormal
    ? (Math.abs(fn.dx) > Math.abs(fn.dy))
    : (Math.abs(first.x - from.x) >= Math.abs(first.y - from.y))
  const toH = hasToNormal
    ? (Math.abs(tn.dx) > Math.abs(tn.dy))
    : (Math.abs(to.x - last.x) >= Math.abs(to.y - last.y))
  let isH = fromH
  let curr = from
  for (let i = 0; i < rect.length; i++) {
    if (isH) rect[i].y = curr.y
    else rect[i].x = curr.x
    curr = rect[i]
    isH = !isH
  }
  isH = toH
  curr = to
  for (let i = rect.length - 1; i >= 0; i--) {
    if (isH) rect[i].y = curr.y
    else rect[i].x = curr.x
    curr = rect[i]
    isH = !isH
  }

  // Hard terminal constraints: first/last waypoint must stay orthogonal to endpoints.
  if (rect.length > 0) {
    if (fromH) rect[0].y = from.y
    else rect[0].x = from.x
    if (toH) rect[rect.length - 1].y = to.y
    else rect[rect.length - 1].x = to.x
  }
  const snapped = rect.map((w) => snapPoint(w, GRID[0]))
  // Re-apply endpoint axis locks after snapping to prevent diagonal terminal segments.
  if (snapped.length > 0) {
    if (fromH) snapped[0].y = from.y
    else snapped[0].x = from.x
    if (toH) snapped[snapped.length - 1].y = to.y
    else snapped[snapped.length - 1].x = to.x
  }
  return snapped
}
const orthogonalizeElbowWaypoints = (from, to, waypoints) => {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return []
  const rect = waypoints.map((w) => ({ ...snapPoint(w, GRID[0]) }))
  const first = rect[0] || to
  const last = rect[rect.length - 1] || from
  const fromH = Math.abs(first.x - from.x) >= Math.abs(first.y - from.y)
  const toH = Math.abs(to.x - last.x) >= Math.abs(to.y - last.y)

  // Forward pass enforces orthogonality from start.
  let isH = fromH
  let curr = from
  for (let i = 0; i < rect.length; i++) {
    if (isH) rect[i].y = curr.y
    else rect[i].x = curr.x
    curr = rect[i]
    isH = !isH
  }

  // Backward pass preserves orthogonality into end point.
  isH = toH
  curr = to
  for (let i = rect.length - 1; i >= 0; i--) {
    if (isH) rect[i].y = curr.y
    else rect[i].x = curr.x
    curr = rect[i]
    isH = !isH
  }
  if (rect.length > 0) {
    if (fromH) rect[0].y = from.y
    else rect[0].x = from.x
    if (toH) rect[rect.length - 1].y = to.y
    else rect[rect.length - 1].x = to.x
  }
  const snapped = rect.map((w) => snapPoint(w, GRID[0]))
  if (snapped.length > 0) {
    if (fromH) snapped[0].y = from.y
    else snapped[0].x = from.x
    if (toH) snapped[snapped.length - 1].y = to.y
    else snapped[snapped.length - 1].x = to.x
  }
  return snapped
}
const relationshipPathData = (left, right, lineStyle, leftNorm = null, rightNorm = null, storedWaypoints = null, skipRectify = false) => {
  if (lineStyle === 'straight') {
    return { pathD: `M ${left.x} ${left.y} L ${right.x} ${right.y}`, waypoints: [] }
  }
  if (lineStyle === 'curve') {
    const dist = Math.hypot(right.x - left.x, right.y - left.y)
    const offset = Math.max(40, dist * 0.4)
    const fn = outwardNormal(leftNorm)
    const tn = outwardNormal(rightNorm)
    const c1 = { x: left.x + fn.dx * offset, y: left.y + fn.dy * offset }
    const c2 = { x: right.x + tn.dx * offset, y: right.y + tn.dy * offset }
    return { pathD: `M ${left.x} ${left.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${right.x} ${right.y}`, waypoints: [] }
  }
  const base = Array.isArray(storedWaypoints) && storedWaypoints.length > 0
    ? storedWaypoints
    : generateElbowWaypoints(left, leftNorm || { nx: 0.5, ny: 0.5 }, right, rightNorm || { nx: 0.5, ny: 0.5 })
  const waypoints = skipRectify
    ? orthogonalizeElbowWaypoints(left, right, base)
    : rectifyElbowWaypoints(left, leftNorm || { nx: 0.5, ny: 0.5 }, right, rightNorm || { nx: 0.5, ny: 0.5 }, base)
  const points = [left, ...waypoints, right]
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return { pathD, waypoints }
}
const relationshipEndLabelBase = (endPoint, adjacentPoint, end) => {
  const vx = (adjacentPoint?.x ?? endPoint.x) - endPoint.x
  const vy = (adjacentPoint?.y ?? endPoint.y) - endPoint.y
  const len = Math.hypot(vx, vy)
  let ux = len > 0.001 ? vx / len : (end === 'left' ? 1 : -1)
  let uy = len > 0.001 ? vy / len : 0
  let nx = -uy
  let ny = ux
  // Prefer label placement above the connector by default.
  if (ny > 0) {
    nx = -nx
    ny = -ny
  }
  return {
    x: endPoint.x + ux * 24 + nx * 10,
    y: endPoint.y + uy * 24 + ny * 10,
  }
}

// Palette optimised for light backgrounds, one color per L1 branch
const L1_PALETTE = STANDARD_THEME_COLORS

const ROOT_BORDER = '#78716c' // warm slate — neutral for the central topic
const LEAF_NODE_SIZE = { width: 160, height: 70 }
const DEFAULT_NODE_SIZE = {
  0: { width: 200, height: 200 },
  1: { width: 190, height: 50 },
  2: { width: 150, height: 88 },
  3: { width: 130, height: 76 },
}

const getStableNodeSize = (node) => {
  if (node?.data?.size) return node.data.size
  if (node?.data?.manualGroupSize) return node.data.manualGroupSize
  if (node?.data?.groupSize) return node.data.groupSize
  const level = Math.min(Math.max(node?.data?.level ?? 1, 0), 3)
  return DEFAULT_NODE_SIZE[level]
}

const VIEW_MODE_PASSIVE_NODE_TYPES = new Set(['card', 'shape', 'image', 'note', 'text'])
// Canonical map interaction contract: fixed zoom, fixed left origin, vertical-only panning.
const CANVAS_POLICY = {
  zoom: 1,
  origin: { x: 0, y: 0 },
  maxPanDown: 100000,
  nodeExtent: [[0, 0], [100000, 100000]],
  translateExtent: [[0, -100000], [0, 0]],
  panOnScrollMode: PanOnScrollMode.Vertical,
}
const DRAG_SNAP_GRID = [GRID_SIZE, GRID_SIZE]
const BACKGROUND_GRID = [MAP_GRID_SIZE, MAP_GRID_Y_SIZE]

// Watches focusNodeId and flies the viewport to that node.
const FocusNodeHandler = () => {
  const focusNodeId = useMindMapStore(s => s.focusNodeId)
  const clearFocusNode = useMindMapStore(s => s.clearFocusNode)
  const { getNode, setCenter } = useReactFlow()

  useEffect(() => {
    if (!focusNodeId) return
    // Use setTimeout to allow the canvas to fully mount and measure nodes
    // (needed when switching from a non-map view mode)
    const id = setTimeout(() => {
      const node = getNode(focusNodeId)
      if (node) {
        const cx = node.position.x + (node.measured?.width ?? 160) / 2
        const cy = node.position.y + (node.measured?.height ?? 60) / 2
        setCenter(cx, cy, { zoom: CANVAS_POLICY.zoom, duration: 600 })
      }
      clearFocusNode()
    }, 50)
    return () => clearTimeout(id)
  }, [focusNodeId, getNode, setCenter, clearFocusNode])

  return null
}

// Must live inside the ReactFlow tree to access the ReactFlow context
const ResetViewportOnLoad = () => {
  const fitViewTrigger = useMindMapStore((s) => s.fitViewTrigger)
  const { setViewport } = useReactFlow()

  useEffect(() => {
    if (fitViewTrigger === 0) return
    const id = requestAnimationFrame(() => {
      setViewport({ x: 0, y: 0, zoom: CANVAS_POLICY.zoom }, { duration: 0 })
    })
    return () => cancelAnimationFrame(id)
  }, [fitViewTrigger, setViewport])

  return null
}

// Handles pinch-to-zoom for touch devices — attached to the outer container in
// capture phase so it intercepts before ReactFlow's node/pane handlers see the events.
const PinchZoomHandler = ({ containerRef }) => {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let prevDist = null

    const getDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        prevDist = getDist(e.touches)
        e.stopPropagation()
      }
    }

    const onTouchMove = (e) => {
      if (e.touches.length !== 2 || prevDist === null) return
      e.preventDefault()
      e.stopPropagation()

      const currDist = getDist(e.touches)
      prevDist = currDist
      // Zoom is fixed at 100%, so swallow pinch gestures.
    }

    const onTouchEnd = (e) => { if (e.touches.length < 2) prevDist = null }

    el.addEventListener('touchstart', onTouchStart, { passive: true,  capture: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false, capture: true })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true,  capture: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true })
      el.removeEventListener('touchmove',  onTouchMove,  { capture: true })
      el.removeEventListener('touchend',   onTouchEnd,   { capture: true })
    }
  }, [containerRef])

  return null
}

const ZoomDisplay = () => {
  const { zoom } = useViewport()
  return (
    <div className="zoom-display">{Math.round(zoom * 100)}%</div>
  )
}

const ExpandIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="11" y1="11" x2="4" y2="4" /><polyline points="4,8 4,4 8,4" />
    <line x1="13" y1="11" x2="20" y2="4" /><polyline points="16,4 20,4 20,8" />
    <line x1="11" y1="13" x2="4" y2="20" /><polyline points="4,16 4,20 8,20" />
    <line x1="13" y1="13" x2="20" y2="20" /><polyline points="20,16 20,20 16,20" />
  </svg>
)

const CompressIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="4" x2="11" y2="11" /><polyline points="7,11 11,11 11,7" />
    <line x1="20" y1="4" x2="13" y2="11" /><polyline points="17,11 13,11 13,7" />
    <line x1="4" y1="20" x2="11" y2="13" /><polyline points="7,13 11,13 11,17" />
    <line x1="20" y1="20" x2="13" y2="13" /><polyline points="17,13 13,13 13,17" />
  </svg>
)

const MindMapCanvas = () => {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    pushHistory,
    deselectNode,
    addNode,
    addChildNode,
    isEditMode,
    openNodeModal,
    setSelectedNodeIds,
    breadcrumbs,
    currentMapId,
    currentMapName,
    currentMapIconUrl,
    currentMapContent,
    isDirty,
    saveMap,
    openMenuNodeId,
    glyphMenuNodeId,
    reparentSourceNodeId,
    clearReparentMode,
    copySizeSourceNodeId,
    clearCopySizeMode,
    pendingToolboxType,
    clearPendingToolboxType,
    relationshipDrag,
    startRelationshipEndDrag,
    isFullscreen,
    setIsFullscreen,
    snapSubtreeToGrid,
    copySubtreeToClipboard,
    pasteSubtreeFromClipboard,
    updateNodeData,
    deleteNode,
    convertToSubmap,
    updateRelationshipEdgeData,
    connectRelationshipEndToNode,
    setRelationshipFreeEnd,
    setRelationshipElbowWaypoints,
    reverseRelationshipConnector,
    moveNodePosition,
    autoLayoutChildrenForCard,
    finalizeSubtreeDrag,
    setReparentSourceNodeId,
    setCopySizeSourceNodeId,
    openDiagramEditor,
  } = useMindMapStore()

  const navigate = useNavigate()
  const [nodeContextMenu, setNodeContextMenu] = useState(null)
  const [paneContextMenu, setPaneContextMenu] = useState(null)
  const [dragDropTargetNodeId, setDragDropTargetNodeId] = useState(null)
  const [dragDropNodeType, setDragDropNodeType] = useState(null)
  const [relationshipDragScreenPos, setRelationshipDragScreenPos] = useState(null)
  const [relationshipLineDrag, setRelationshipLineDrag] = useState(null)
  const [relationshipSegmentDrag, setRelationshipSegmentDrag] = useState(null)
  const [selectedRelationshipId, setSelectedRelationshipId] = useState(null)
  const [hoveredRelationshipId, setHoveredRelationshipId] = useState(null)
  const [hoveredRelationshipEnd, setHoveredRelationshipEnd] = useState(null)
  const [relationshipSnapPreview, setRelationshipSnapPreview] = useState(null)
  const [relationshipContextMenu, setRelationshipContextMenu] = useState(null)
  const [relationshipLabelDrag, setRelationshipLabelDrag] = useState(null)
  const relationshipClickRef = useRef({ id: null, ts: 0, x: 0, y: 0 })
  const viewport = useViewport()
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow()
  const CONVERT_LABELS = { card: 'Card', shape: 'Shape', object: 'Object', relationship: 'Relationship', or: 'Or', diagram: 'Diagram', submap: 'Submap' }
  const hierarchyEdges = useMemo(() => edges.filter((e) => !isRelationshipEdge(e)), [edges])
  const relationshipEdges = useMemo(() => edges.filter((e) => isRelationshipEdge(e)), [edges])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [setIsFullscreen])

  // targetId -> sourceId lookup
  const parentMap = useMemo(() => {
    const map = {}
    hierarchyEdges.forEach(e => { map[e.target] = e.source })
    return map
  }, [hierarchyEdges])

  const rootId = useMemo(
    () => nodes.find(n => n.data?.level === 0)?.id ?? null,
    [nodes]
  )

  // Fast node lookup
  const nodeById = useMemo(() => {
    const map = {}
    nodes.forEach(n => { map[n.id] = n })
    return map
  }, [nodes])

  // sourceId -> [targetIds] lookup
  const childrenMap = useMemo(() => {
    const map = {}
    hierarchyEdges.forEach(e => {
      if (!map[e.source]) map[e.source] = []
      map[e.source].push(e.target)
    })
    return map
  }, [hierarchyEdges])
  const nodesWithHierarchyChildren = useMemo(() => {
    const ids = new Set()
    hierarchyEdges.forEach((e) => ids.add(e.source))
    return ids
  }, [hierarchyEdges])

  // Assign each L1 node a palette color in creation order — includes both
  // root-connected nodes and orphan nodes placed via the toolbox (level === 1, no root edge)
  const l1ColorMap = useMemo(() => {
    const map = {}
    let idx = 0
    nodes.forEach(n => {
      if (n.data?.level === 1) {
        map[n.id] = n.data?.themeColor || L1_PALETTE[idx % L1_PALETTE.length]
        idx++
      }
    })
    return map
  }, [nodes])

  // Walk up the parent chain to find the L1 ancestor of any node.
  // Also handles orphan L1 nodes that have no parent edge to root.
  const getL1Id = useCallback((nodeId) => {
    let current = nodeId
    while (parentMap[current] && parentMap[current] !== rootId) {
      current = parentMap[current]
    }
    if (parentMap[current] === rootId) return current
    if (nodeById[current]?.data?.level === 1) return current
    return null
  }, [parentMap, rootId, nodeById])

  const nodesWithColor = useMemo(() => {
    return nodes.map(node => {
      const level = node.data?.level ?? 0
      const l1Color = level === 0
        ? ROOT_BORDER
        : (l1ColorMap[getL1Id(node.id)] ?? L1_PALETTE[0])
      const hasChildren = !!(childrenMap[node.id]?.length)
      const hasExpandedContents = !!node.data?.content?.trim() || node.data?.nodeType === 'note' || node.data?.nodeType === 'image' || node.data?.nodeType === 'diagram' || node.data?.nodeType === 'object' || node.data?.nodeType === 'relationship' || node.data?.nodeType === 'or'
      const useFixedLeafSize = !hasChildren && !hasExpandedContents && node.data?.sizeMode !== 'manual'
      const hasNotes = !!(node.data.content && node.data.content !== '<p></p>' && node.data.content !== '')
      const persistedSize = node.data?.size
      const fixedGroupSize = hasChildren
        ? (persistedSize ?? {
            width: node.style?.width ?? DEFAULT_NODE_SIZE[Math.min(Math.max(level, 0), 3)].width,
            height: node.style?.height ?? DEFAULT_NODE_SIZE[Math.min(Math.max(level, 0), 3)].height,
          })
        : undefined
      const dropTargetState =
        dragDropTargetNodeId === node.id && dragDropNodeType
          ? (canConnectNodeTypes(node.data?.nodeType || 'card', dragDropNodeType) ? 'valid' : 'invalid')
          : null
      return {
        ...node,
        ...(node.data?.nodeType === 'relationship' ? { draggable: false } : {}),
        ...(useFixedLeafSize ? { style: { ...node.style, width: LEAF_NODE_SIZE.width, height: LEAF_NODE_SIZE.height } } : {}),
        zIndex: node.id === openMenuNodeId || node.id === glyphMenuNodeId ? 9999 : level * 10,
        className: 'km-content-node',
        hidden: level === 0,
        data: {
          ...node.data,
          l1Color,
          hasChildren,
          hasNotes,
          groupSize: fixedGroupSize,
          dropTargetState,
        },
      }
    }).sort((a, b) => {
      if (a.id === openMenuNodeId) return 1
      if (b.id === openMenuNodeId) return -1
      if (a.id === glyphMenuNodeId) return 1
      if (b.id === glyphMenuNodeId) return -1
      return (a.data?.level ?? 0) - (b.data?.level ?? 0)
    })
  }, [nodes, l1ColorMap, getL1Id, childrenMap, openMenuNodeId, glyphMenuNodeId, dragDropTargetNodeId, dragDropNodeType])

  const clampViewportToExtent = useCallback((nextViewport) => {
    const minY = -CANVAS_POLICY.maxPanDown
    const maxY = CANVAS_POLICY.origin.y
    const lockedX = CANVAS_POLICY.origin.x
    return {
      x: lockedX,
      y: Math.min(maxY, Math.max(minY, nextViewport.y)),
      zoom: CANVAS_POLICY.zoom,
    }
  }, [])

  const clampToOrigin = useCallback((point) => ({
    x: Math.max(CANVAS_POLICY.origin.x, point?.x ?? CANVAS_POLICY.origin.x),
    y: Math.max(CANVAS_POLICY.origin.y, point?.y ?? CANVAS_POLICY.origin.y),
  }), [])

  const getBoundedFlowPosition = useCallback((clientX, clientY) => {
    const pos = screenToFlowPosition(
      { x: clientX, y: clientY },
      { snapToGrid: true, snapGrid: GRID }
    )
    return clampToOrigin(pos)
  }, [screenToFlowPosition, clampToOrigin])

  const [isTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  )

  const onVerticalWheelPan = useCallback((event) => {
    if (isTouch) return
    let handled = false

    // Route horizontal trackpad scroll to the outer shell so users can
    // navigate back to either side on smaller viewports.
    if (Math.abs(event.deltaX) > 0.01) {
      const wrapper = event.currentTarget?.closest?.('.canvas-wrapper')
      if (wrapper) {
        wrapper.scrollLeft += event.deltaX
        handled = true
      }
    }

    if (Math.abs(event.deltaY) > 0.01) {
      const vp = getViewport()
      const nextViewport = {
        x: vp.x,
        y: vp.y - event.deltaY,
        zoom: CANVAS_POLICY.zoom,
      }
      setViewport(clampViewportToExtent(nextViewport), { duration: 0 })
      handled = true
    }

    if (!handled) return
    event.preventDefault()
    event.stopPropagation()
  }, [isTouch, getViewport, setViewport, clampViewportToExtent])

  // Relationship lines are rendered as single-segment overlays, not per-end RF edges.
  const displayEdges = useMemo(() => [], [])

  const containerRef = useRef(null)

  useEffect(() => {
    if (!reparentSourceNodeId && !copySizeSourceNodeId) return
    document.body.style.cursor = 'copy'
    return () => {
      document.body.style.cursor = ''
    }
  }, [reparentSourceNodeId, copySizeSourceNodeId])

  useEffect(() => {
    const wrapper = containerRef.current?.closest('.canvas-wrapper')
    if (!wrapper) return
    wrapper.scrollLeft = 0
  }, [currentMapId])

  const onViewportMove = useCallback((_, nextViewport) => {
    const clamped = clampViewportToExtent(nextViewport)
    if (
      Math.abs(clamped.x - nextViewport.x) < 0.1 &&
      Math.abs(clamped.y - nextViewport.y) < 0.1 &&
      Math.abs(clamped.zoom - nextViewport.zoom) < 0.0001
    ) {
      return
    }
    setViewport(clamped, { duration: 0 })
  }, [clampViewportToExtent, setViewport])

  const onNodeDragStart = useCallback((_, node) => {
    if (!isEditMode) return
    pushHistory()
  }, [isEditMode, pushHistory])

  // Dragging onto another node does not change hierarchy; reparent uses context-menu actions.
  const onNodeDragStop = useCallback((_, draggedNode) => {
    if (!isEditMode) return
    if (draggedNode.data?.level === 0) return
    if (nodesWithHierarchyChildren.has(draggedNode.id)) {
      finalizeSubtreeDrag(draggedNode.id)
    } else {
      snapSubtreeToGrid(draggedNode.id, true)
    }
  }, [isEditMode, snapSubtreeToGrid, finalizeSubtreeDrag, nodesWithHierarchyChildren])

  const containerRectRef = useRef(null)

  // Keep the visual canvas position stable when layout shifts (e.g. Toolbox
  // appears/disappears on Edit mode toggle and changes container left offset).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const next = el.getBoundingClientRect()
    const prev = containerRectRef.current
    containerRectRef.current = next
    if (!prev) return
    const dy = next.top - prev.top
    if (Math.abs(dy) < 0.5) return
    const vp = getViewport()
    const nextViewport = { x: vp.x, y: vp.y - dy, zoom: vp.zoom }
    setViewport(clampViewportToExtent(nextViewport), { duration: 0 })
  }, [isEditMode, getViewport, setViewport, clampViewportToExtent])

  const clientToWorld = useCallback((clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    const vp = viewport
    return {
      x: (clientX - rect.left - vp.x) / vp.zoom,
      y: (clientY - rect.top - vp.y) / vp.zoom,
    }
  }, [viewport])

  const snapWorldToGrid = useCallback((point) => (
    point ? snapPoint(point, GRID[0]) : null
  ), [])

  const getNodeRect = useCallback((node) => {
    const w = node.measured?.width ?? node.style?.width ?? node.data?.size?.width ?? 180
    const h = node.measured?.height ?? node.style?.height ?? node.data?.size?.height ?? 80
    return { x1: node.position.x, y1: node.position.y, x2: node.position.x + w, y2: node.position.y + h, w, h }
  }, [])

  const closestBoundaryForNode = useCallback((node, worldPoint) => {
    const r = getNodeRect(node)
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
    const leftP = { x: r.x1, y: clamp(worldPoint.y, r.y1, r.y2), handle: 'obj-target-left', norm: { nx: 0, ny: (clamp(worldPoint.y, r.y1, r.y2) - r.y1) / r.h } }
    const rightP = { x: r.x2, y: clamp(worldPoint.y, r.y1, r.y2), handle: 'obj-target-right', norm: { nx: 1, ny: (clamp(worldPoint.y, r.y1, r.y2) - r.y1) / r.h } }
    const topP = { x: clamp(worldPoint.x, r.x1, r.x2), y: r.y1, handle: 'obj-target-top', norm: { nx: (clamp(worldPoint.x, r.x1, r.x2) - r.x1) / r.w, ny: 0 } }
    const bottomP = { x: clamp(worldPoint.x, r.x1, r.x2), y: r.y2, handle: 'obj-target-bottom', norm: { nx: (clamp(worldPoint.x, r.x1, r.x2) - r.x1) / r.w, ny: 1 } }
    const cand = [leftP, rightP, topP, bottomP]
    cand.sort((a, b) => ((a.x - worldPoint.x) ** 2 + (a.y - worldPoint.y) ** 2) - ((b.x - worldPoint.x) ** 2 + (b.y - worldPoint.y) ** 2))
    return cand[0]
  }, [getNodeRect])

  const nodeAtClientPoint = useCallback((clientX, clientY) => {
    const world = clientToWorld(clientX, clientY)
    if (!world) return null
    const { x, y } = world
    const candidates = nodes
      .filter((n) => (n.data?.level ?? 0) > 0)
      .map((n) => ({ node: n, ...getNodeRect(n) }))
      .filter((b) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)
    if (candidates.length === 0) return null
    // Prefer the smallest containing box (most specific / top-like target).
    candidates.sort((a, b) => ((a.x2 - a.x1) * (a.y2 - a.y1)) - ((b.x2 - b.x1) * (b.y2 - b.y1)))
    return candidates[0].node
  }, [nodes, clientToWorld, getNodeRect])

  const closeContextMenus = useCallback(() => {
    setNodeContextMenu(null)
    setPaneContextMenu(null)
    setRelationshipContextMenu(null)
    setHoveredRelationshipId(null)
    setHoveredRelationshipEnd(null)
    setRelationshipSegmentDrag(null)
    setRelationshipLabelDrag(null)
  }, [])

  const contextNode = useMemo(() => {
    if (!nodeContextMenu?.nodeId) return null
    return nodes.find((n) => n.id === nodeContextMenu.nodeId) ?? null
  }, [nodeContextMenu, nodes])

  const isRelationshipDoubleClick = useCallback((relationshipId, clientX, clientY) => {
    const now = Date.now()
    const prev = relationshipClickRef.current
    const near = Math.hypot(clientX - prev.x, clientY - prev.y) <= 14
    const isDouble = prev.id === relationshipId && (now - prev.ts) <= 360 && near
    relationshipClickRef.current = { id: relationshipId, ts: now, x: clientX, y: clientY }
    return isDouble
  }, [])

  const convertNodeType = useCallback(async (node, newType) => {
    if (!node || newType === node.data?.nodeType) return
    const nodeType = node.data?.nodeType
    const title = node.data?.title ?? ''
    const hasChildren = edges.some((e) => e.source === node.id)
    if ((newType === 'note' || newType === 'diagram' || newType === 'relationship' || newType === 'or') && hasChildren) {
      if (!confirm(`"${title}" has children. Converting to ${CONVERT_LABELS[newType]} will prevent adding more children, but existing ones will remain.\n\nContinue?`)) return
    }
    if (newType === 'submap') {
      const r = await convertToSubmap(node.id)
      if (!r?.success) alert('Failed to convert to submap. Please try again.')
      return
    }
    updateNodeData(node.id, { nodeType: newType })
  }, [edges, convertToSubmap, updateNodeData, CONVERT_LABELS])

  const onRelationshipEdgeDoubleClick = useCallback((event, edge) => {
    if (!isEditMode || !edge?.data?.isRelationship) return
    event.preventDefault()
    const currentType = edge.data?.relType || 'lookup'
    const relTypeInput = window.prompt('Relationship type (lookup or master-detail):', currentType)
    if (relTypeInput === null) return
    const relType = relTypeInput.trim().toLowerCase() === 'master-detail' ? 'master-detail' : 'lookup'
    const fromLabel = window.prompt('From label:', edge.data?.fromLabel || '')
    if (fromLabel === null) return
    const toLabel = window.prompt('To label:', edge.data?.toLabel || '')
    if (toLabel === null) return
    const description = window.prompt('Description:', edge.data?.description || '')
    if (description === null) return
    updateRelationshipEdgeData(edge.id, { relType, fromLabel, toLabel, description })
  }, [isEditMode, updateRelationshipEdgeData])

  const onNodeContextMenu = useCallback(
    (event, node) => {
      event.preventDefault()
      if (!isEditMode) return
      setPaneContextMenu(null)
      setNodeContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
    },
    [isEditMode]
  )

  const onPaneContextMenu = useCallback(
    (event) => {
      event.preventDefault()
      if (!isEditMode) return
      setNodeContextMenu(null)
      setPaneContextMenu({ x: event.clientX, y: event.clientY })
    },
    [isEditMode]
  )

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeContextMenus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeContextMenus])

  useEffect(() => {
    if (!isEditMode || !selectedRelationshipId) return
    const onDeleteKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      deleteNode(selectedRelationshipId)
      setSelectedRelationshipId(null)
      setRelationshipContextMenu(null)
      setRelationshipLabelDrag(null)
    }
    window.addEventListener('keydown', onDeleteKey)
    return () => window.removeEventListener('keydown', onDeleteKey)
  }, [isEditMode, selectedRelationshipId, deleteNode])

  useEffect(() => {
    if (!isEditMode) return
    const onPasteKey = async (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'v') return
      const t = e.target
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const pos = getBoundedFlowPosition(rect.left + rect.width / 2, rect.top + rect.height / 2)
      const result = await pasteSubtreeFromClipboard(pos)
      if (!result?.success && result?.error === 'invalid') {
        // Clipboard wasn't a subtree payload — let user know only when they used the shortcut
        console.debug('Clipboard does not contain a Knowledge Maps subtree.')
      }
    }
    window.addEventListener('keydown', onPasteKey)
    return () => window.removeEventListener('keydown', onPasteKey)
  }, [isEditMode, getBoundedFlowPosition, pasteSubtreeFromClipboard])

  // Cancel toolbox placement on Escape
  useEffect(() => {
    if (!pendingToolboxType) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      clearPendingToolboxType()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingToolboxType, clearPendingToolboxType])

  // Cancel reparent / copy-size pick modes on Escape (edit mode only)
  useEffect(() => {
    if (!isEditMode) return
    if (!reparentSourceNodeId && !copySizeSourceNodeId) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (reparentSourceNodeId) clearReparentMode()
      else if (copySizeSourceNodeId) clearCopySizeMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEditMode, reparentSourceNodeId, copySizeSourceNodeId, clearReparentMode, clearCopySizeMode])

  useLayoutEffect(() => {
    if (!relationshipDrag || !isEditMode) return
    if (relationshipDrag.startScreenPos) setRelationshipDragScreenPos(relationshipDrag.startScreenPos)
    const getRelationshipHandleWorld = (node, end) => {
      const w = node?.measured?.width ?? node?.style?.width ?? node?.data?.size?.width ?? 240
      const h = node?.measured?.height ?? node?.style?.height ?? node?.data?.size?.height ?? 40
      const x = end === 'left'
        ? node.position.x + w * 0.09 + 7
        : node.position.x + w * 0.91 - 7
      return { x, y: node.position.y + h / 2 }
    }
    const getTargetAnchorWorld = (edge) => {
      const targetNode = nodes.find((n) => n.id === edge.target)
      if (!targetNode) return null
      const w = targetNode?.measured?.width ?? targetNode?.style?.width ?? targetNode?.data?.size?.width ?? 200
      const h = targetNode?.measured?.height ?? targetNode?.style?.height ?? targetNode?.data?.size?.height ?? 90
      const cx = targetNode.position.x + w / 2
      const cy = targetNode.position.y + h / 2
      switch (edge.targetHandle) {
        case 'obj-target-left': return { x: targetNode.position.x, y: cy }
        case 'obj-target-right': return { x: targetNode.position.x + w, y: cy }
        case 'obj-target-top': return { x: cx, y: targetNode.position.y }
        case 'obj-target-bottom': return { x: cx, y: targetNode.position.y + h }
        default: return { x: cx, y: cy }
      }
    }
    const onMove = (e) => {
      const world = clientToWorld(e.clientX, e.clientY)
      const snappedWorld = snapWorldToGrid(world)
      if (snappedWorld) {
        const rect = containerRef.current?.getBoundingClientRect()
        const vp = viewport
        setRelationshipDragScreenPos({
          x: snappedWorld.x * vp.zoom + vp.x + (rect?.left ?? 0),
          y: snappedWorld.y * vp.zoom + vp.y + (rect?.top ?? 0),
        })
      } else {
        setRelationshipDragScreenPos({ x: e.clientX, y: e.clientY })
      }
      const hoveredNode = nodeAtClientPoint(e.clientX, e.clientY)
      const hoveredId = hoveredNode?.id || null
      if (!hoveredId) {
        setDragDropTargetNodeId(null)
        setDragDropNodeType('relationship')
        setRelationshipSnapPreview(null)
        return
      }
      const valid = canConnectNodeTypes('relationship', hoveredNode?.data?.nodeType || 'card')
      if (valid) {
        const nearest = snappedWorld ? closestBoundaryForNode(hoveredNode, snappedWorld) : null
        if (nearest) {
          setRelationshipSnapPreview({
            x: nearest.x,
            y: nearest.y,
          })
        } else {
          setRelationshipSnapPreview(null)
        }
        setDragDropTargetNodeId(hoveredId)
      } else {
        setRelationshipSnapPreview(null)
        setDragDropTargetNodeId(null)
      }
      setDragDropNodeType('relationship')
    }
    const onUp = (e) => {
      const hoveredNode = nodeAtClientPoint(e.clientX, e.clientY)
      const hoveredId = hoveredNode?.id || null
      if (hoveredId) {
        const valid = canConnectNodeTypes('relationship', hoveredNode?.data?.nodeType || 'card')
        if (valid) {
          const world = clientToWorld(e.clientX, e.clientY)
          const snappedWorld = snapWorldToGrid(world)
          const nearest = snappedWorld ? closestBoundaryForNode(hoveredNode, snappedWorld) : null
          connectRelationshipEndToNode(
            relationshipDrag.relationshipNodeId,
            relationshipDrag.end,
            hoveredId,
            nearest?.handle || 'obj-target-left',
            nearest?.norm || null
          )
        } else {
          const world = clientToWorld(e.clientX, e.clientY)
          setRelationshipFreeEnd(relationshipDrag.relationshipNodeId, relationshipDrag.end, snapWorldToGrid(world))
        }
      } else {
        const world = clientToWorld(e.clientX, e.clientY)
        setRelationshipFreeEnd(relationshipDrag.relationshipNodeId, relationshipDrag.end, snapWorldToGrid(world))
      }
      setRelationshipDragScreenPos(null)
      setDragDropTargetNodeId(null)
      setDragDropNodeType(null)
      setRelationshipSnapPreview(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [relationshipDrag, isEditMode, viewport, connectRelationshipEndToNode, setRelationshipFreeEnd, nodeAtClientPoint, clientToWorld, closestBoundaryForNode, snapWorldToGrid])

  useEffect(() => {
    if (!relationshipLineDrag || !isEditMode) return
    const onMove = (e) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const vp = viewport
      const dx = (e.clientX - relationshipLineDrag.startScreen.x) / vp.zoom
      const dy = (e.clientY - relationshipLineDrag.startScreen.y) / vp.zoom
      moveNodePosition(
        relationshipLineDrag.relationshipNodeId,
        {
          x: relationshipLineDrag.startWorld.x + dx,
          y: relationshipLineDrag.startWorld.y + dy,
        },
        false
      )
    }
    const onUp = (e) => {
      const vp = viewport
      const dx = (e.clientX - relationshipLineDrag.startScreen.x) / vp.zoom
      const dy = (e.clientY - relationshipLineDrag.startScreen.y) / vp.zoom
      moveNodePosition(
        relationshipLineDrag.relationshipNodeId,
        {
          x: relationshipLineDrag.startWorld.x + dx,
          y: relationshipLineDrag.startWorld.y + dy,
        },
        true
      )
      setRelationshipLineDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [relationshipLineDrag, isEditMode, viewport, moveNodePosition])

  useEffect(() => {
    if (!relationshipSegmentDrag || !isEditMode) return
    const onMove = (e) => {
      const world = snapWorldToGrid(clientToWorld(e.clientX, e.clientY))
      if (!world) return
      const { segmentIndex, isHorizontal, baseWaypoints, startWorld, relationshipNodeId } = relationshipSegmentDrag
      const next = baseWaypoints.map((w) => ({ ...w }))
      if (!(segmentIndex > 0 && segmentIndex < next.length + 1)) return
      if (isHorizontal) {
        const baseY = baseWaypoints[segmentIndex - 1].y
        const y = snapPoint({ x: 0, y: baseY + (world.y - startWorld.y) }, GRID[0]).y
        next[segmentIndex - 1].y = y
        next[segmentIndex].y = y
      } else {
        const baseX = baseWaypoints[segmentIndex - 1].x
        const x = snapPoint({ x: baseX + (world.x - startWorld.x), y: 0 }, GRID[0]).x
        next[segmentIndex - 1].x = x
        next[segmentIndex].x = x
      }
      setRelationshipElbowWaypoints(relationshipNodeId, next, false)
    }
    const onUp = () => {
      const rel = useMindMapStore.getState().nodes.find((n) => n.id === relationshipSegmentDrag.relationshipNodeId)
      let wps = rel?.data?.elbowWaypoints || []
      // Remove consecutive coincident waypoint pairs left over from boundary buffer expansion.
      // (Same cleanup as data-model: pairs within 3px are considered degenerate.)
      let i = 0
      while (i < wps.length - 1) {
        const dx = Math.abs(wps[i].x - wps[i + 1].x)
        const dy = Math.abs(wps[i].y - wps[i + 1].y)
        if (dx < 3 && dy < 3) {
          wps = [...wps.slice(0, i), ...wps.slice(i + 2)]
          if (i > 0) i--
        } else {
          i++
        }
      }
      setRelationshipElbowWaypoints(relationshipSegmentDrag.relationshipNodeId, wps, true)
      setRelationshipSegmentDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [relationshipSegmentDrag, isEditMode, clientToWorld, snapWorldToGrid, setRelationshipElbowWaypoints])

  useEffect(() => {
    if (!relationshipLabelDrag || !isEditMode) return
    const onMove = (e) => {
      const world = clientToWorld(e.clientX, e.clientY)
      if (!world) return
      setRelationshipLabelDrag((prev) => {
        if (!prev) return prev
        const dx = world.x - prev.startWorld.x
        const dy = world.y - prev.startWorld.y
        return {
          ...prev,
          liveOffset: { x: prev.baseOffset.x + dx, y: prev.baseOffset.y + dy },
        }
      })
    }
    const onUp = () => {
      setRelationshipLabelDrag((drag) => {
        if (!drag) return null
        const state = useMindMapStore.getState()
        const relNode = state.nodes.find((n) => n.id === drag.relationshipNodeId)
        if (relNode) {
          const existingOffsets = relNode.data?.relationshipLabelOffsets || {}
          state.updateNodeData(drag.relationshipNodeId, {
            relationshipLabelOffsets: {
              ...existingOffsets,
              [drag.end]: drag.liveOffset || drag.baseOffset,
            },
          })
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [relationshipLabelDrag, isEditMode, clientToWorld])

  const relationshipSegments = useMemo(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    const ox = rect?.left ?? 0
    const oy = rect?.top ?? 0
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const getRelHandleWorld = (node, end) => {
      const w = node?.measured?.width ?? node?.style?.width ?? node?.data?.size?.width ?? 240
      const h = node?.measured?.height ?? node?.style?.height ?? node?.data?.size?.height ?? 40
      return {
        x: end === 'left' ? node.position.x + w * 0.09 + 7 : node.position.x + w * 0.91 - 7,
        y: node.position.y + h / 2,
      }
    }
    const getTargetAnchorWorld = (edge) => {
      const n = nodeById.get(edge.target)
      if (!n) return null
      const w = n?.measured?.width ?? n?.style?.width ?? n?.data?.size?.width ?? 200
      const h = n?.measured?.height ?? n?.style?.height ?? n?.data?.size?.height ?? 90
      const norm = edge?.data?.targetNorm
      if (norm && typeof norm.nx === 'number' && typeof norm.ny === 'number') {
        const nx = Math.max(0, Math.min(1, norm.nx))
        const ny = Math.max(0, Math.min(1, norm.ny))
        return {
          point: { x: n.position.x + nx * w, y: n.position.y + ny * h },
          norm: { nx, ny },
        }
      }
      const cx = n.position.x + w / 2
      const cy = n.position.y + h / 2
      switch (edge.targetHandle) {
        case 'obj-target-left': return { point: { x: n.position.x, y: cy }, norm: { nx: 0, ny: 0.5 } }
        case 'obj-target-right': return { point: { x: n.position.x + w, y: cy }, norm: { nx: 1, ny: 0.5 } }
        case 'obj-target-top': return { point: { x: cx, y: n.position.y }, norm: { nx: 0.5, ny: 0 } }
        case 'obj-target-bottom': return { point: { x: cx, y: n.position.y + h }, norm: { nx: 0.5, ny: 1 } }
        default: return { point: { x: cx, y: cy }, norm: null }
      }
    }
    return nodes
      .filter((n) => n.data?.nodeType === 'relationship')
      .map((rel) => {
        const free = rel.data?.relationshipFreeEnds || {}
        const leftEdge = relationshipEdges.find((e) => e.source === rel.id && (e.sourceHandle || null) === 'rel-left-source')
        const rightEdge = relationshipEdges.find((e) => e.source === rel.id && (e.sourceHandle || null) === 'rel-right-source')
        const leftAnchor = leftEdge ? getTargetAnchorWorld(leftEdge) : null
        const rightAnchor = rightEdge ? getTargetAnchorWorld(rightEdge) : null
        let left = leftEdge
          ? (leftAnchor?.point || getRelHandleWorld(rel, 'left'))
          : (free.left || getRelHandleWorld(rel, 'left'))
        let right = rightEdge
          ? (rightAnchor?.point || getRelHandleWorld(rel, 'right'))
          : (free.right || getRelHandleWorld(rel, 'right'))
        if (relationshipDrag?.relationshipNodeId === rel.id && relationshipDragScreenPos) {
          const draggedWorld = {
            x: (relationshipDragScreenPos.x - ox - viewport.x) / viewport.zoom,
            y: (relationshipDragScreenPos.y - oy - viewport.y) / viewport.zoom,
          }
          if (relationshipDrag.end === 'left') left = draggedWorld
          if (relationshipDrag.end === 'right') right = draggedWorld
        }
        const relType = rel.data?.relType === 'master-detail' ? 'master-detail' : 'lookup'
        const lineStyle = normalizeRelationshipLineStyle(rel.data?.lineStyle)
        const storedWaypoints = Array.isArray(rel.data?.elbowWaypoints) ? rel.data.elbowWaypoints : []
        const isDraggingSeg = relationshipSegmentDrag?.relationshipNodeId === rel.id
        const pathData = relationshipPathData(left, right, lineStyle, leftAnchor?.norm, rightAnchor?.norm, storedWaypoints, isDraggingSeg)
        const leftAdjacent = pathData.waypoints[0] || right
        const rightAdjacent = pathData.waypoints[pathData.waypoints.length - 1] || left
        const fromLabelBase = relationshipEndLabelBase(left, leftAdjacent, 'left')
        const toLabelBase = relationshipEndLabelBase(right, rightAdjacent, 'right')
        const storedLabelOffsets = rel.data?.relationshipLabelOffsets || {}
        const fromLabelOffset = relationshipLabelDrag?.relationshipNodeId === rel.id && relationshipLabelDrag?.end === 'from'
          ? (relationshipLabelDrag.liveOffset || relationshipLabelDrag.baseOffset || { x: 0, y: 0 })
          : (storedLabelOffsets.from || { x: 0, y: 0 })
        const toLabelOffset = relationshipLabelDrag?.relationshipNodeId === rel.id && relationshipLabelDrag?.end === 'to'
          ? (relationshipLabelDrag.liveOffset || relationshipLabelDrag.baseOffset || { x: 0, y: 0 })
          : (storedLabelOffsets.to || { x: 0, y: 0 })
        const draggableElbowSegments = []
        if (lineStyle === 'elbow' && pathData.waypoints.length >= 1) {
          const points = [left, ...pathData.waypoints, right]
          for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i]
            const p2 = points[i + 1]
            const isHorizontal = Math.abs(p1.x - p2.x) >= Math.abs(p1.y - p2.y)
            draggableElbowSegments.push({ segmentIndex: i, isHorizontal, p1, p2 })
          }
        }
        return {
          id: rel.id,
          relType,
          lineStyle,
          leftConnected: !!leftEdge,
          rightConnected: !!rightEdge,
          left,
          right,
          leftNorm: leftAnchor?.norm || null,
          rightNorm: rightAnchor?.norm || null,
          pathD: pathData.pathD,
          elbowWaypoints: pathData.waypoints,
          fromLabel: rel.data?.fromLabel || '',
          toLabel: rel.data?.toLabel || '',
          fromLabelOffset,
          toLabelOffset,
          fromLabelPos: { x: fromLabelBase.x + fromLabelOffset.x, y: fromLabelBase.y + fromLabelOffset.y },
          toLabelPos: { x: toLabelBase.x + toLabelOffset.x, y: toLabelBase.y + toLabelOffset.y },
          draggableElbowSegments,
        }
      })
  }, [nodes, relationshipEdges, relationshipDrag, relationshipDragScreenPos, relationshipSegmentDrag, relationshipLabelDrag, viewport])

  const onCanvasDragOver = useCallback((e) => {
    if (!isEditMode) return
    e.preventDefault()
    const draggedType = e.dataTransfer.getData(TOOLBOX_DRAG_MIME) || e.dataTransfer.getData('text/plain') || pendingToolboxType
    const targetEl =
      e.target?.closest?.('.react-flow__node') ||
      document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.react-flow__node')
    const hoveredId = targetEl?.getAttribute?.('data-id') || null
    setDragDropNodeType(draggedType || null)
    if (hoveredId && draggedType) {
      const hoveredNode = nodes.find((n) => n.id === hoveredId)
      const valid = canConnectNodeTypes(hoveredNode?.data?.nodeType || 'card', draggedType)
      e.dataTransfer.dropEffect = valid ? 'copy' : 'none'
    } else {
      e.dataTransfer.dropEffect = 'copy'
    }
    setDragDropTargetNodeId((prev) => (prev === hoveredId ? prev : hoveredId))
  }, [isEditMode, pendingToolboxType, nodes])

  const onCanvasDrop = useCallback((e) => {
    if (!isEditMode) return
    const droppedType = e.dataTransfer.getData(TOOLBOX_DRAG_MIME) || e.dataTransfer.getData('text/plain') || pendingToolboxType
    if (!droppedType) return
    e.preventDefault()

    const targetEl =
      e.target?.closest?.('.react-flow__node') ||
      document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.react-flow__node')
    const parentId = targetEl?.getAttribute?.('data-id') || dragDropTargetNodeId

    if (droppedType === 'relationship') {
      const position = getBoundedFlowPosition(e.clientX, e.clientY)
      let createdId = null
      if (parentId && nodes.some((n) => n.id === parentId)) {
        createdId = addChildNode(parentId, 'relationship', { position })
      } else {
        const created = addNode({ position, level: 1, nodeType: 'relationship' })
        createdId = created?.id || null
      }
      clearPendingToolboxType()
      setDragDropTargetNodeId(null)
      setDragDropNodeType(null)
      if (createdId) openNodeModal(createdId)
      return
    }

    if (parentId && nodes.some((n) => n.id === parentId)) {
      const flowPos = getBoundedFlowPosition(e.clientX, e.clientY)
      const newId = addChildNode(parentId, droppedType, { position: flowPos })
      if (newId) openNodeModal(newId)
      clearPendingToolboxType()
      setDragDropTargetNodeId(null)
      setDragDropNodeType(null)
      return
    }

    const position = getBoundedFlowPosition(e.clientX, e.clientY)
    const created = addNode({ position, level: 1, nodeType: droppedType })
    clearPendingToolboxType()
    setDragDropTargetNodeId(null)
    setDragDropNodeType(null)
    if (created?.id) openNodeModal(created.id)
  }, [isEditMode, pendingToolboxType, dragDropTargetNodeId, nodes, addChildNode, openNodeModal, clearPendingToolboxType, getBoundedFlowPosition, addNode])

  // Plain click: only this node selected (sidebar + rings). Shift/Cmd/Ctrl = additive (multi-select).
  const onNodeClick = useCallback(
    async (event, node) => {
      if (!isEditMode) {
        if (node.data?.isSubmap && node.data?.submapId) {
          if (isDirty && currentMapId) await saveMap()
          const newCrumbs = [...breadcrumbs, { mapId: currentMapId, mapName: currentMapName }]
          navigate(`/map/${node.data.submapId}`, { state: { breadcrumbs: newCrumbs } })
          return
        }
        setSelectedNodeIds([node.id])
        if (VIEW_MODE_PASSIVE_NODE_TYPES.has(node.data?.nodeType)) return
        openNodeModal(node.id)
        return
      }
      if (event.shiftKey || event.metaKey || event.ctrlKey) return
      setSelectedNodeIds([node.id])
    },
    [isEditMode, openNodeModal, setSelectedNodeIds, isDirty, currentMapId, saveMap, breadcrumbs, currentMapName, navigate]
  )

  const overlayTransform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`
  const mapHeaderTitle = (currentMapName || 'Untitled Map').trim() || 'Untitled Map'
  const mapHeaderContent = (currentMapContent || '').trim()
  return (
    <div
      className="map-view-root"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        cursor: pendingToolboxType ? 'crosshair' : undefined,
      }}
    >
      {isEditMode && nodeContextMenu && (
        <div
          className="map-context-menu"
          style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="map-context-menu__item"
            onClick={() => {
              if (!contextNode) return
              closeContextMenus()
              openNodeModal(contextNode.id)
            }}
          >
            Edit node
          </button>
          {contextNode?.data?.isSubmap && contextNode?.data?.submapId && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={async () => {
                if (isDirty && currentMapId) await saveMap()
                const newCrumbs = [...breadcrumbs, { mapId: currentMapId, mapName: currentMapName }]
                closeContextMenus()
                navigate(`/map/${contextNode.data.submapId}`, { state: { breadcrumbs: newCrumbs } })
              }}
            >
              Open submap
            </button>
          )}
          {contextNode && contextNode.data?.isSubmap !== true && !['note', 'relationship', 'or', 'image', 'diagram', 'text'].includes(contextNode.data?.nodeType) && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                const id = addChildNode(contextNode.id, 'card')
                closeContextMenus()
                if (id) openNodeModal(id)
              }}
            >
              Add child node
            </button>
          )}
          {contextNode && contextNode.data?.level > 0 && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                closeContextMenus()
                if (reparentSourceNodeId === contextNode.id) clearReparentMode()
                else setReparentSourceNodeId(contextNode.id)
              }}
            >
              {reparentSourceNodeId === contextNode.id ? 'Cancel reparent' : 'Reparent node'}
            </button>
          )}
          {contextNode && contextNode.data?.level > 0 && contextNode.data?.nodeType !== 'text' && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                closeContextMenus()
                if (copySizeSourceNodeId === contextNode.id) clearCopySizeMode()
                else setCopySizeSourceNodeId(contextNode.id)
              }}
            >
              {copySizeSourceNodeId === contextNode.id ? 'Cancel copy size' : 'Copy size to another shape'}
            </button>
          )}
          {contextNode && contextNode.data?.level > 0 && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                closeContextMenus()
                updateNodeData(contextNode.id, { isTodo: !contextNode.data?.isTodo })
              }}
            >
              {contextNode.data?.isTodo ? 'Unmark To Do' : 'Mark as To Do'}
            </button>
          )}
          {contextNode && contextNode.data?.nodeType === 'card' && (() => {
            const contextChildIds = childrenMap[contextNode.id] || []
            const hasDirectChildren = contextChildIds.length > 0
            const hasGrandchildren = contextChildIds.some((childId) => (childrenMap[childId]?.length ?? 0) > 0)
            return hasDirectChildren && !hasGrandchildren
          })() && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                closeContextMenus()
                autoLayoutChildrenForCard(contextNode.id)
              }}
            >
              Auto Layout Children
            </button>
          )}
          {contextNode && contextNode.data?.level > 0 && contextNode.data?.nodeType === 'diagram' && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                closeContextMenus()
                openDiagramEditor(contextNode.id)
              }}
            >
              Open diagram editor
            </button>
          )}
          {contextNode && contextNode.data?.level > 0 && contextNode.data?.isSubmap !== true && (
            <div className="map-context-menu__submenu">
              <button type="button" className="map-context-menu__item map-context-menu__item--submenu">
                Convert To <span aria-hidden="true">›</span>
              </button>
              <div className="map-context-menu__submenu-panel" role="menu">
              {['card', 'shape', 'object', 'relationship', 'or', 'diagram', 'submap'].map((type) => (
                <button
                  key={type}
                  type="button"
                  className="map-context-menu__item"
                  disabled={contextNode.data?.nodeType === type}
                  onClick={async () => {
                    closeContextMenus()
                    await convertNodeType(contextNode, type)
                  }}
                >
                  Convert to {CONVERT_LABELS[type]}
                </button>
              ))}
              </div>
            </div>
          )}
          {contextNode && contextNode.data?.level > 0 && (
            <button
              type="button"
              className="map-context-menu__item"
              onClick={() => {
                const nodeTitle = contextNode.data?.title || 'Untitled'
                if (!confirm(`Delete "${nodeTitle}"?`)) return
                closeContextMenus()
                deleteNode(contextNode.id)
              }}
            >
              Delete node
            </button>
          )}
          <button
            type="button"
            className="map-context-menu__item"
            onClick={async () => {
              const id = nodeContextMenu.nodeId
              closeContextMenus()
              const r = await copySubtreeToClipboard(id)
              if (!r?.success) alert('Could not copy to clipboard.')
            }}
          >
            Copy subtree…
          </button>
          <p className="map-context-menu__hint">Includes this node and all descendants. Paste from another map via right-click on the canvas or Ctrl/⌘+V.</p>
        </div>
      )}
      {isEditMode && paneContextMenu && (
        <div
          className="map-context-menu"
          style={{ left: paneContextMenu.x, top: paneContextMenu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="map-context-menu__item"
            onClick={async () => {
              const pos = getBoundedFlowPosition(paneContextMenu.x, paneContextMenu.y)
              closeContextMenus()
              const r = await pasteSubtreeFromClipboard(pos)
              if (!r?.success) {
                if (r?.error === 'invalid') alert('Clipboard does not contain a copied subtree. Copy a node first (right‑click → Copy subtree).')
                else if (r?.error === 'clipboard') alert('Could not read the clipboard. Check browser permissions.')
              }
            }}
          >
            Paste subtree
          </button>
        </div>
      )}
      {isEditMode && relationshipContextMenu && (
        <div
          className="map-context-menu"
          style={{ left: relationshipContextMenu.x, top: relationshipContextMenu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="map-context-menu__item"
            onClick={() => {
              openNodeModal(relationshipContextMenu.id)
              setRelationshipContextMenu(null)
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="map-context-menu__item"
            onClick={() => {
              reverseRelationshipConnector(relationshipContextMenu.id)
              setRelationshipContextMenu(null)
            }}
          >
            Reverse connector
          </button>
          <button
            type="button"
            className="map-context-menu__item"
            onClick={() => {
              const relId = relationshipContextMenu.id
              setRelationshipContextMenu(null)
              if (reparentSourceNodeId === relId) clearReparentMode()
              else setReparentSourceNodeId(relId)
            }}
          >
            {reparentSourceNodeId === relationshipContextMenu.id ? 'Cancel reparent' : 'Reparent node'}
          </button>
          <button
            type="button"
            className="map-context-menu__item"
            onClick={() => {
              deleteNode(relationshipContextMenu.id)
              setRelationshipContextMenu(null)
              setSelectedRelationshipId(null)
              setRelationshipLabelDrag(null)
            }}
          >
            Delete connector
          </button>
        </div>
      )}
      <header className="map-header-shell">
        <div className="map-header-block" style={{ width: MAP_CLIENT_WIDTH, margin: '0 auto' }}>
          <div className="map-header-title-row">
            {currentMapIconUrl && (
              <NodeIconDisplay iconUrl={currentMapIconUrl} className="map-header-icon" />
            )}
            <h1 className="map-header-title">{mapHeaderTitle}</h1>
          </div>
          {mapHeaderContent && (
            <div className="map-header-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                urlTransform={urlTransform}
              >
                {mapHeaderContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </header>
      <div className="map-header-gap" aria-hidden="true" />
      <div
        ref={containerRef}
        className="map-flow-client"
        onWheelCapture={onVerticalWheelPan}
      >
        <ReactFlow
        style={{ width: '100%', height: '100%' }}
        nodes={nodesWithColor}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeDoubleClick={onRelationshipEdgeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={(event) => {
          setSelectedRelationshipId(null)
          setRelationshipContextMenu(null)
          setHoveredRelationshipId(null)
          setHoveredRelationshipEnd(null)
          setRelationshipLabelDrag(null)
          if (pendingToolboxType && isEditMode) {
            const position = getBoundedFlowPosition(event.clientX, event.clientY)
            const created = addNode({ position, level: 1, nodeType: pendingToolboxType })
            clearPendingToolboxType()
            if (created?.id) openNodeModal(created.id)
            return
          }
          closeContextMenus()
          if (reparentSourceNodeId) {
            clearReparentMode()
            return
          }
          if (copySizeSourceNodeId) {
            clearCopySizeMode()
            return
          }
          deselectNode()
        }}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onMove={onViewportMove}
        onNodeClick={(event, node) => {
          setSelectedRelationshipId(null)
          setRelationshipContextMenu(null)
          setHoveredRelationshipId(null)
          setHoveredRelationshipEnd(null)
          setRelationshipLabelDrag(null)
          if (pendingToolboxType && isEditMode) {
            const position = getBoundedFlowPosition(event.clientX, event.clientY)
            const created = addNode({ position, level: 1, nodeType: pendingToolboxType })
            clearPendingToolboxType()
            if (created?.id) openNodeModal(created.id)
            return
          }
          onNodeClick(event, node)
        }}
        onBeforeDelete={async ({ nodes: toRemove, edges: edgesToRemove }) => {
          const nodes = toRemove.filter((n) => (n.data?.level ?? 0) > 0)
          if (nodes.length === toRemove.length) return true
          if (nodes.length === 0) return false
          return { nodes, edges: edgesToRemove }
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={isEditMode}
        nodesConnectable={isEditMode}
        elementsSelectable
        elevateNodesOnSelect={false}
        panOnScroll={false}
        panOnScrollMode={CANVAS_POLICY.panOnScrollMode}
        panOnDrag={isTouch ? true : [1, 2]}
        selectionOnDrag={!isTouch}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        zoomOnScroll={false}
        // Enable native pinch zoom for trackpads/fine pointers; coarse touch pinch is handled
        // by PinchZoomHandler to keep behavior consistent on touch devices.
        zoomOnPinch={false}
        preventScrolling={false}
        snapToGrid={false}
        snapGrid={DRAG_SNAP_GRID}
        minZoom={CANVAS_POLICY.zoom}
        maxZoom={CANVAS_POLICY.zoom}
        nodeExtent={CANVAS_POLICY.nodeExtent}
        translateExtent={CANVAS_POLICY.translateExtent}
        defaultEdgeOptions={{
          type: 'straight-center',
          style: { stroke: '#363b56', strokeWidth: 1.5 },
        }}
        deleteKeyCode={isEditMode ? ['Backspace', 'Delete'] : null}
      >
        {isEditMode && (
          <Background
            variant={BackgroundVariant.Lines}
            gap={BACKGROUND_GRID}
            offset={[0, 0]}
            size={0.8}
            color="#d8cfc2"
          />
        )}
        {!isTouch && <Controls showInteractive={false} showZoom={false}>
          <ZoomDisplay />
          <ControlButton
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
          </ControlButton>
        </Controls>}
        {!isTouch && <MiniMap
          nodeColor={(node) => node.data?.l1Color ?? ROOT_BORDER}
          maskColor="rgba(240,236,227,0.75)"
          style={{ background: '#f9f6f1', border: '1px solid #e5ddd0' }}
          zoomable
          pannable
        />}
        <Panel position="bottom-center">
          <div className="canvas-hint">
            {isTouch
              ? 'Tap a node to select · Drag to pan · Pinch to zoom'
              : isEditMode
                ? pendingToolboxType
                  ? `Click to place ${pendingToolboxType} · Press Escape to cancel`
                  : reparentSourceNodeId
                    ? 'Click a new parent node to reparent · Escape, source node, or canvas to cancel'
                    : copySizeSourceNodeId
                      ? 'Click a shape to copy size from the source · Escape, source node, or canvas to cancel'
                      : 'Right-click a node for actions · Drag with mouse to pan · Trackpad scroll to pan vertically'
                : 'Edit Mode is off · Drag with mouse to pan · Trackpad scroll to pan vertically'}
          </div>
        </Panel>
        {relationshipSegments.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
            <svg width="100%" height="100%">
              <defs>
                <marker id="km-md-start" markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
                  <path d="M 7 4 L 7 16 M 12 4 L 12 16" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" />
                </marker>
                <marker id="km-md-start-sel" markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
                  <path d="M 7 4 L 7 16 M 12 4 L 12 16" fill="none" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" />
                </marker>
                <marker id="km-md-end" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
                  <circle cx="6" cy="10" r="5" fill="#fff" stroke="#e53935" strokeWidth="2" />
                  <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" />
                </marker>
                <marker id="km-md-end-sel" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
                  <circle cx="6" cy="10" r="5" fill="#fff" stroke="#c62828" strokeWidth="2.5" />
                  <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" />
                </marker>
                <marker id="km-lookup-start" markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
                  <path d="M 5 4 L 5 16" fill="none" stroke="#5b8dee" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="14" cy="10" r="5" fill="#fff" stroke="#5b8dee" strokeWidth="2" />
                </marker>
                <marker id="km-lookup-start-sel" markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
                  <path d="M 5 4 L 5 16" fill="none" stroke="#3a6fd8" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="14" cy="10" r="5" fill="#fff" stroke="#3a6fd8" strokeWidth="2.5" />
                </marker>
                <marker id="km-lookup-end" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
                  <circle cx="6" cy="10" r="5" fill="#fff" stroke="#5b8dee" strokeWidth="2" />
                  <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#5b8dee" strokeWidth="2" strokeLinecap="round" />
                </marker>
                <marker id="km-lookup-end-sel" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
                  <circle cx="6" cy="10" r="5" fill="#fff" stroke="#3a6fd8" strokeWidth="2.5" />
                  <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#3a6fd8" strokeWidth="2.5" strokeLinecap="round" />
                </marker>
              </defs>
              <g transform={overlayTransform}>
                {relationshipSegments.map((seg) => (
                  <g key={seg.id}>
                      <path
                        d={seg.pathD}
                        stroke="transparent"
                        strokeWidth="14"
                        fill="none"
                        style={{ cursor: isEditMode ? 'grab' : 'default', pointerEvents: isEditMode && !relationshipDrag && !relationshipSegmentDrag ? 'auto' : 'none' }}
                        onPointerEnter={() => {
                          if (!isEditMode || relationshipDrag) return
                          setHoveredRelationshipId(seg.id)
                        }}
                        onPointerLeave={() => {
                          setHoveredRelationshipId((prev) => (prev === seg.id ? null : prev))
                        }}
                        onContextMenu={(e) => {
                          if (!isEditMode) return
                          e.preventDefault()
                          e.stopPropagation()
                          setSelectedNodeIds([])
                          setNodeContextMenu(null)
                          setPaneContextMenu(null)
                          setSelectedRelationshipId(seg.id)
                          setRelationshipContextMenu({ id: seg.id, x: e.clientX, y: e.clientY })
                        }}
                        onPointerDown={(e) => {
                          if (!isEditMode || relationshipDrag || e.button !== 0) return
                          if (isRelationshipDoubleClick(seg.id, e.clientX, e.clientY)) {
                            e.stopPropagation()
                            e.preventDefault()
                            setSelectedNodeIds([])
                            setSelectedRelationshipId(seg.id)
                            setRelationshipContextMenu(null)
                            openNodeModal(seg.id)
                            return
                          }
                          e.stopPropagation()
                          e.preventDefault()
                          setSelectedNodeIds([])
                          setSelectedRelationshipId(seg.id)
                          setRelationshipContextMenu(null)
                          const relNode = nodes.find((n) => n.id === seg.id)
                          if (!relNode) return
                          setRelationshipLineDrag({
                            relationshipNodeId: seg.id,
                            startScreen: { x: e.clientX, y: e.clientY },
                            startWorld: { x: relNode.position.x, y: relNode.position.y },
                          })
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          setSelectedNodeIds([])
                          setSelectedRelationshipId(seg.id)
                          setRelationshipContextMenu(null)
                          openNodeModal(seg.id)
                        }}
                      />
                      <path
                        d={seg.pathD}
                        stroke={relationshipStroke(seg.relType, selectedRelationshipId === seg.id)}
                        strokeWidth={selectedRelationshipId === seg.id ? 2.5 : 2}
                        markerStart={seg.leftConnected ? `url(#${seg.relType === 'master-detail'
                          ? (selectedRelationshipId === seg.id ? 'km-md-start-sel' : 'km-md-start')
                          : (selectedRelationshipId === seg.id ? 'km-lookup-start-sel' : 'km-lookup-start')
                        })` : undefined}
                        markerEnd={seg.rightConnected ? `url(#${seg.relType === 'master-detail'
                          ? (selectedRelationshipId === seg.id ? 'km-md-end-sel' : 'km-md-end')
                          : (selectedRelationshipId === seg.id ? 'km-lookup-end-sel' : 'km-lookup-end')
                        })` : undefined}
                        fill="none"
                        pointerEvents="none"
                      />
                      {seg.fromLabel?.trim() && (
                        <text
                          x={seg.fromLabelPos.x}
                          y={seg.fromLabelPos.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="11"
                          fontWeight="500"
                          fill={selectedRelationshipId === seg.id ? '#1f3f8f' : '#4b5563'}
                          stroke="#ffffff"
                          strokeWidth="3"
                          paintOrder="stroke"
                          style={{
                            pointerEvents: isEditMode ? 'auto' : 'none',
                            cursor: isEditMode ? 'move' : 'default',
                            userSelect: 'none',
                          }}
                          onContextMenu={(e) => {
                            if (!isEditMode) return
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedNodeIds([])
                            setNodeContextMenu(null)
                            setPaneContextMenu(null)
                            setSelectedRelationshipId(seg.id)
                            setRelationshipContextMenu({ id: seg.id, x: e.clientX, y: e.clientY })
                          }}
                          onPointerDown={(e) => {
                            if (!isEditMode || e.button !== 0) return
                            const world = clientToWorld(e.clientX, e.clientY)
                            if (!world) return
                            e.stopPropagation()
                            e.preventDefault()
                            pushHistory()
                            setSelectedNodeIds([])
                            setSelectedRelationshipId(seg.id)
                            setRelationshipContextMenu(null)
                            setRelationshipLabelDrag({
                              relationshipNodeId: seg.id,
                              end: 'from',
                              startWorld: world,
                              baseOffset: seg.fromLabelOffset || { x: 0, y: 0 },
                              liveOffset: seg.fromLabelOffset || { x: 0, y: 0 },
                            })
                          }}
                        >
                          {seg.fromLabel}
                        </text>
                      )}
                      {seg.toLabel?.trim() && (
                        <text
                          x={seg.toLabelPos.x}
                          y={seg.toLabelPos.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="11"
                          fontWeight="500"
                          fill={selectedRelationshipId === seg.id ? '#1f3f8f' : '#4b5563'}
                          stroke="#ffffff"
                          strokeWidth="3"
                          paintOrder="stroke"
                          style={{
                            pointerEvents: isEditMode ? 'auto' : 'none',
                            cursor: isEditMode ? 'move' : 'default',
                            userSelect: 'none',
                          }}
                          onContextMenu={(e) => {
                            if (!isEditMode) return
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedNodeIds([])
                            setNodeContextMenu(null)
                            setPaneContextMenu(null)
                            setSelectedRelationshipId(seg.id)
                            setRelationshipContextMenu({ id: seg.id, x: e.clientX, y: e.clientY })
                          }}
                          onPointerDown={(e) => {
                            if (!isEditMode || e.button !== 0) return
                            const world = clientToWorld(e.clientX, e.clientY)
                            if (!world) return
                            e.stopPropagation()
                            e.preventDefault()
                            pushHistory()
                            setSelectedNodeIds([])
                            setSelectedRelationshipId(seg.id)
                            setRelationshipContextMenu(null)
                            setRelationshipLabelDrag({
                              relationshipNodeId: seg.id,
                              end: 'to',
                              startWorld: world,
                              baseOffset: seg.toLabelOffset || { x: 0, y: 0 },
                              liveOffset: seg.toLabelOffset || { x: 0, y: 0 },
                            })
                          }}
                        >
                          {seg.toLabel}
                        </text>
                      )}
                      {isEditMode && selectedRelationshipId === seg.id && seg.lineStyle === 'elbow' && !relationshipDrag && !relationshipLineDrag && seg.draggableElbowSegments.map((s) => {
                        const midX = (s.p1.x + s.p2.x) / 2
                        const midY = (s.p1.y + s.p2.y) / 2
                        const active = relationshipSegmentDrag?.relationshipNodeId === seg.id && relationshipSegmentDrag?.segmentIndex === s.segmentIndex
                        return (
                          <g key={`${seg.id}-elbow-seg-${s.segmentIndex}`}>
                            <line
                              x1={s.p1.x}
                              y1={s.p1.y}
                              x2={s.p2.x}
                              y2={s.p2.y}
                              stroke="transparent"
                              strokeWidth="14"
                              style={{ pointerEvents: 'auto', cursor: s.isHorizontal ? 'ns-resize' : 'ew-resize' }}
                              onContextMenu={(e) => {
                                if (!isEditMode) return
                                e.preventDefault()
                                e.stopPropagation()
                                setSelectedNodeIds([])
                                setNodeContextMenu(null)
                                setPaneContextMenu(null)
                                setSelectedRelationshipId(seg.id)
                                setRelationshipContextMenu({ id: seg.id, x: e.clientX, y: e.clientY })
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                setSelectedNodeIds([])
                                setSelectedRelationshipId(seg.id)
                                setRelationshipContextMenu(null)
                                openNodeModal(seg.id)
                              }}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return
                                if (isRelationshipDoubleClick(seg.id, e.clientX, e.clientY)) {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  setSelectedNodeIds([])
                                  setSelectedRelationshipId(seg.id)
                                  setRelationshipContextMenu(null)
                                  openNodeModal(seg.id)
                                  return
                                }
                                e.stopPropagation()
                                e.preventDefault()
                                const world = snapWorldToGrid(clientToWorld(e.clientX, e.clientY))
                                if (!world) return
                                pushHistory()
                                const origLength = seg.elbowWaypoints.length
                                let baseWaypoints = seg.elbowWaypoints.map((w) => ({ ...w }))
                                let dragSegmentIndex = s.segmentIndex
                                const MIN_END_DIST = GRID[0] * 2
                                const expandStart = (from, first, waypoints) => {
                                  const vertical = Math.abs(first.y - from.y) >= Math.abs(first.x - from.x)
                                  if (vertical) {
                                    const sign = Math.sign(first.y - from.y) || 1
                                    const ay = from.y + sign * MIN_END_DIST
                                    return [{ x: from.x, y: ay }, { x: first.x, y: ay }, ...waypoints]
                                  }
                                  const sign = Math.sign(first.x - from.x) || 1
                                  const ax = from.x + sign * MIN_END_DIST
                                  return [{ x: ax, y: from.y }, { x: ax, y: first.y }, ...waypoints]
                                }
                                if (s.segmentIndex === 0 && origLength > 0) {
                                  baseWaypoints = expandStart(seg.left, baseWaypoints[0], baseWaypoints)
                                  dragSegmentIndex = 2
                                  setRelationshipElbowWaypoints(seg.id, baseWaypoints, false)
                                } else if (s.segmentIndex === origLength && origLength > 0) {
                                  const reversed = [...baseWaypoints].reverse()
                                  const expandedReversed = expandStart(seg.right, reversed[0], reversed)
                                  baseWaypoints = expandedReversed.reverse()
                                  const L = baseWaypoints.length
                                  const dragIndexReversed = 2
                                  dragSegmentIndex = L - dragIndexReversed
                                  setRelationshipElbowWaypoints(seg.id, baseWaypoints, false)
                                }
                                setRelationshipSegmentDrag({
                                  relationshipNodeId: seg.id,
                                  segmentIndex: dragSegmentIndex,
                                  isHorizontal: s.isHorizontal,
                                  startWorld: world,
                                  baseWaypoints,
                                })
                              }}
                            />
                            <rect
                              x={midX - (s.isHorizontal ? 7 : 4)}
                              y={midY - (s.isHorizontal ? 4 : 7)}
                              width={s.isHorizontal ? 14 : 8}
                              height={s.isHorizontal ? 8 : 14}
                              rx="3"
                              fill={active ? '#3a6fd8' : '#ffffff'}
                              stroke={active ? '#1e4fb8' : '#7aa0ea'}
                              strokeWidth={1.5}
                              style={{ pointerEvents: 'none' }}
                            />
                          </g>
                        )
                      })}
                      {(seg.id === selectedRelationshipId || seg.id === hoveredRelationshipId || relationshipDrag?.relationshipNodeId === seg.id) && (
                        <>
                          <circle
                            cx={seg.left.x}
                            cy={seg.left.y}
                            r={REL_ENDPOINT_RADIUS + 5}
                            fill="transparent"
                            style={{ cursor: isEditMode ? 'grab' : 'default', pointerEvents: isEditMode ? 'auto' : 'none' }}
                            onContextMenu={(e) => {
                              if (!isEditMode) return
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedNodeIds([])
                              setNodeContextMenu(null)
                              setPaneContextMenu(null)
                              setSelectedRelationshipId(seg.id)
                              setRelationshipContextMenu({ id: seg.id, x: e.clientX, y: e.clientY })
                            }}
                            onPointerDown={(e) => {
                              if (!isEditMode || e.button !== 0) return
                              if (isRelationshipDoubleClick(seg.id, e.clientX, e.clientY)) {
                                e.stopPropagation()
                                e.preventDefault()
                                setSelectedNodeIds([])
                                setSelectedRelationshipId(seg.id)
                                setRelationshipContextMenu(null)
                                openNodeModal(seg.id)
                                return
                              }
                              e.stopPropagation()
                              e.preventDefault()
                              setSelectedNodeIds([])
                              setSelectedRelationshipId(seg.id)
                              setHoveredRelationshipId(seg.id)
                              startRelationshipEndDrag(seg.id, 'left', { x: e.clientX, y: e.clientY })
                            }}
                            onPointerEnter={() => setHoveredRelationshipEnd({ id: seg.id, end: 'left' })}
                            onPointerLeave={() => setHoveredRelationshipEnd((prev) => (prev?.id === seg.id && prev?.end === 'left' ? null : prev))}
                          />
                          <circle
                            cx={seg.left.x}
                            cy={seg.left.y}
                            r={(hoveredRelationshipEnd?.id === seg.id && hoveredRelationshipEnd?.end === 'left') ? REL_ENDPOINT_RADIUS * 1.12 : REL_ENDPOINT_RADIUS}
                            fill="#ffffff"
                            stroke={(hoveredRelationshipEnd?.id === seg.id && hoveredRelationshipEnd?.end === 'left') ? '#3a6fd8' : '#7aa0ea'}
                            strokeWidth={(hoveredRelationshipEnd?.id === seg.id && hoveredRelationshipEnd?.end === 'left') ? 2.5 : 1.5}
                            style={{ pointerEvents: 'none' }}
                          />
                          <circle
                            cx={seg.right.x}
                            cy={seg.right.y}
                            r={REL_ENDPOINT_RADIUS + 5}
                            fill="transparent"
                            style={{ cursor: isEditMode ? 'grab' : 'default', pointerEvents: isEditMode ? 'auto' : 'none' }}
                            onContextMenu={(e) => {
                              if (!isEditMode) return
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedNodeIds([])
                              setNodeContextMenu(null)
                              setPaneContextMenu(null)
                              setSelectedRelationshipId(seg.id)
                              setRelationshipContextMenu({ id: seg.id, x: e.clientX, y: e.clientY })
                            }}
                            onPointerDown={(e) => {
                              if (!isEditMode || e.button !== 0) return
                              if (isRelationshipDoubleClick(seg.id, e.clientX, e.clientY)) {
                                e.stopPropagation()
                                e.preventDefault()
                                setSelectedNodeIds([])
                                setSelectedRelationshipId(seg.id)
                                setRelationshipContextMenu(null)
                                openNodeModal(seg.id)
                                return
                              }
                              e.stopPropagation()
                              e.preventDefault()
                              setSelectedNodeIds([])
                              setSelectedRelationshipId(seg.id)
                              setHoveredRelationshipId(seg.id)
                              startRelationshipEndDrag(seg.id, 'right', { x: e.clientX, y: e.clientY })
                            }}
                            onPointerEnter={() => setHoveredRelationshipEnd({ id: seg.id, end: 'right' })}
                            onPointerLeave={() => setHoveredRelationshipEnd((prev) => (prev?.id === seg.id && prev?.end === 'right' ? null : prev))}
                          />
                          <circle
                            cx={seg.right.x}
                            cy={seg.right.y}
                            r={(hoveredRelationshipEnd?.id === seg.id && hoveredRelationshipEnd?.end === 'right') ? REL_ENDPOINT_RADIUS * 1.12 : REL_ENDPOINT_RADIUS}
                            fill="#ffffff"
                            stroke={(hoveredRelationshipEnd?.id === seg.id && hoveredRelationshipEnd?.end === 'right') ? '#3a6fd8' : '#7aa0ea'}
                            strokeWidth={(hoveredRelationshipEnd?.id === seg.id && hoveredRelationshipEnd?.end === 'right') ? 2.5 : 1.5}
                            style={{ pointerEvents: 'none' }}
                          />
                        </>
                      )}
                  </g>
                ))}
                {relationshipSnapPreview && (
                  <circle
                    cx={relationshipSnapPreview.x}
                    cy={relationshipSnapPreview.y}
                    r={6}
                    fill="#ffffff"
                    stroke="#3a6fd8"
                    strokeWidth={2.5}
                    pointerEvents="none"
                  />
                )}
              </g>
            </svg>
          </div>
        )}
        <ResetViewportOnLoad />
        <FocusNodeHandler />
        <PinchZoomHandler containerRef={containerRef} />
      </ReactFlow>
      </div>
    </div>
  )
}

export default MindMapCanvas
