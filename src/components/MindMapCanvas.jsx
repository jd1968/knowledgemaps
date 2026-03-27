import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  BackgroundVariant,
  SelectionMode,
  Panel,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMindMapStore } from '../store/useMindMapStore'
import CustomNode from './CustomNode'
import StraightCenterEdge from './StraightCenterEdge'
import PointerEdge from './PointerEdge'

const nodeTypes = { mindmap: CustomNode }
const edgeTypes = { 'straight-center': StraightCenterEdge, 'pointer-edge': PointerEdge }

// Palette optimised for light backgrounds, one color per L1 branch
const L1_PALETTE = [
  '#2563eb', // blue
  '#059669', // emerald
  '#ea580c', // orange
  '#7c3aed', // violet
  '#e11d48', // rose
  '#0891b2', // cyan
  '#b45309', // amber-brown
  '#0f766e', // teal
  '#4f46e5', // indigo
  '#c026d3', // fuchsia
]

const ROOT_BORDER = '#78716c' // warm slate — neutral for the central topic
const DEFAULT_NODE_SIZE = {
  0: { width: 200, height: 200 },
  1: { width: 170, height: 48 },
  2: { width: 150, height: 88 },
  3: { width: 130, height: 76 },
}
const NEST_PAD_LEFT = 16
const NEST_PAD_RIGHT = 16
const NEST_PAD_TOP = 58
const NEST_PAD_BOTTOM = 24

const getStableNodeSize = (node) => {
  if (node?.data?.groupSize) return node.data.groupSize
  const level = Math.min(Math.max(node?.data?.level ?? 1, 0), 3)
  return DEFAULT_NODE_SIZE[level]
}

const LEVEL_ZOOM = { 0: 0.7, 1: 1.0, 2: 1.3, 3: 1.6 }
const zoomForLevel = (level) => LEVEL_ZOOM[Math.min(level ?? 2, 3)] ?? 1.6

// Watches focusNodeId and flies the viewport to that node at a level-appropriate zoom
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
        setCenter(cx, cy, { zoom: zoomForLevel(node.data?.level), duration: 600 })
      }
      clearFocusNode()
    }, 50)
    return () => clearTimeout(id)
  }, [focusNodeId, getNode, setCenter, clearFocusNode])

  return null
}

// Must live inside the ReactFlow tree to access the ReactFlow context
const FitViewOnLoad = () => {
  const fitViewTrigger = useMindMapStore((s) => s.fitViewTrigger)
  const nodes = useMindMapStore((s) => s.nodes)
  const initialZoom = useMindMapStore((s) => s.settings.initialZoom)
  const { fitView } = useReactFlow()

  // Keep refs so the effect can read latest values without re-triggering on every node change
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const initialZoomRef = useRef(initialZoom)
  initialZoomRef.current = initialZoom

  useEffect(() => {
    if (fitViewTrigger === 0) return
    const topNodes = nodesRef.current
      .filter((n) => (n.data?.level ?? 0) === 1)
      .map((n) => ({ id: n.id }))
    const targets = topNodes.length > 0 ? topNodes : undefined
    const id = requestAnimationFrame(() =>
      fitView({ nodes: targets, padding: 0.3, duration: 400 })
    )
    return () => cancelAnimationFrame(id)
  }, [fitViewTrigger, fitView]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// Handles pinch-to-zoom for touch devices — attached to the outer container in
// capture phase so it intercepts before ReactFlow's node/pane handlers see the events.
const PinchZoomHandler = ({ containerRef }) => {
  const { getViewport, setViewport } = useReactFlow()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let prevDist = null

    const getDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const getMid  = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

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
      const scale = currDist / prevDist
      prevDist = currDist

      const { x, y, zoom } = getViewport()
      const newZoom = Math.min(Math.max(zoom * scale, 0.2), 2)

      const mid  = getMid(e.touches)
      const rect = el.getBoundingClientRect()
      const px   = mid.x - rect.left
      const py   = mid.y - rect.top

      setViewport({
        x: px - (px - x) * (newZoom / zoom),
        y: py - (py - y) * (newZoom / zoom),
        zoom: newZoom,
      })
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
  }, [containerRef, getViewport, setViewport])

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
    reparentNode,
    moveSubtreeBy,
    addNode,
    isEditMode,
    openMenuNodeId,
    reparentSourceNodeId,
    clearReparentMode,
    pendingToolboxType,
    clearPendingToolboxType,
    isFullscreen,
    setIsFullscreen,
  } = useMindMapStore()

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
    edges.forEach(e => { map[e.target] = e.source })
    return map
  }, [edges])

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
    edges.forEach(e => {
      if (!map[e.source]) map[e.source] = []
      map[e.source].push(e.target)
    })
    return map
  }, [edges])

  // Assign each L1 node a palette color in creation order — includes both
  // root-connected nodes and orphan nodes placed via the toolbox (level === 1, no root edge)
  const l1ColorMap = useMemo(() => {
    const map = {}
    let idx = 0
    nodes.forEach(n => {
      if (n.data?.level === 1) {
        map[n.id] = L1_PALETTE[idx % L1_PALETTE.length]
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

  // Compute nested layout: every non-root parent node expands to visually contain its children
  const nodesWithColor = useMemo(() => {
    // All nodes that have children (excluding root — it's hidden and L1 nodes float freely)
    const parentChildrenMap = {}
    edges.forEach(e => {
      if (!parentChildrenMap[e.source]) parentChildrenMap[e.source] = []
      parentChildrenMap[e.source].push(e.target)
    })
    const parentIdSet = new Set(
      Object.keys(parentChildrenMap).filter(id => id !== rootId && parentChildrenMap[id].length > 0)
    )

    // Process innermost parents first so outer parents can use sub-parent computed bounds
    const nestDepth = {}
    const computeDepth = (id) => {
      if (id in nestDepth) return nestDepth[id]
      let max = 0
      ;(parentChildrenMap[id] || []).forEach(cid => {
        if (parentIdSet.has(cid)) max = Math.max(max, computeDepth(cid) + 1)
      })
      nestDepth[id] = max
      return max
    }
    parentIdSet.forEach(id => computeDepth(id))

    const layouts = {}
    Array.from(parentIdSet)
      .sort((a, b) => (nestDepth[a] ?? 0) - (nestDepth[b] ?? 0))
      .forEach(parentId => {
        const parentNode = nodeById[parentId]
        const childIds = parentChildrenMap[parentId] || []

        // Collect all descendants, using sub-parent layout bounds for already-computed sub-parents
        const allDescIds = []
        const collectDesc = (ids) => {
          ids.forEach(cid => {
            allDescIds.push(cid)
            if (parentIdSet.has(cid) && layouts[cid]) return
            const grandkids = parentChildrenMap[cid]
            if (grandkids?.length) collectDesc(grandkids)
          })
        }
        collectDesc(childIds)

        const children = allDescIds.map(id => nodeById[id]).filter(Boolean)
        if (children.length === 0) {
          layouts[parentId] = { x: parentNode?.position?.x ?? 0, y: parentNode?.position?.y ?? 0, width: 200, height: 80 }
          return
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        children.forEach(child => {
          if (parentIdSet.has(child.id) && layouts[child.id]) {
            const l = layouts[child.id]
            minX = Math.min(minX, l.x); minY = Math.min(minY, l.y)
            maxX = Math.max(maxX, l.x + l.width); maxY = Math.max(maxY, l.y + l.height)
          } else {
            const sz = getStableNodeSize(child)
            const w = sz.width
            const h = child.measured?.height ?? child.height ?? sz.height
            minX = Math.min(minX, child.position.x); minY = Math.min(minY, child.position.y)
            maxX = Math.max(maxX, child.position.x + w); maxY = Math.max(maxY, child.position.y + h)
          }
        })

        const anchorX = parentNode?.position?.x ?? (minX - NEST_PAD_LEFT)
        const anchorY = parentNode?.position?.y ?? (minY - NEST_PAD_TOP)
        const x = Math.min(anchorX, minX - NEST_PAD_LEFT)
        const y = Math.min(anchorY, minY - NEST_PAD_TOP)

        layouts[parentId] = {
          x,
          y,
          width: Math.max(220, (maxX - x) + NEST_PAD_RIGHT),
          height: Math.max(80, (maxY - y) + NEST_PAD_BOTTOM),
        }
      })

    return nodes.map(node => {
      const level = node.data?.level ?? 0
      const l1Color = level === 0
        ? ROOT_BORDER
        : (l1ColorMap[getL1Id(node.id)] ?? L1_PALETTE[0])
      const hasChildren = !!(childrenMap[node.id]?.length)
      const hasNotes = !!(node.data.content && node.data.content !== '<p></p>' && node.data.content !== '')
      const layout = layouts[node.id]
      return {
        ...node,
        ...(layout ? { position: { x: layout.x, y: layout.y } } : {}),
        zIndex: node.id === openMenuNodeId ? 9999 : level * 10,
        className: 'km-content-node',
        hidden: level === 0,
        data: {
          ...node.data,
          l1Color,
          hasChildren,
          hasNotes,
          groupSize: layout ? { width: layout.width, height: layout.height } : undefined,
        },
      }
    }).sort((a, b) => {
      if (a.id === openMenuNodeId) return 1
      if (b.id === openMenuNodeId) return -1
      return (a.data?.level ?? 0) - (b.data?.level ?? 0)
    })
  }, [nodes, edges, l1ColorMap, getL1Id, childrenMap, nodeById, openMenuNodeId, rootId])

  const allDropTargets = useMemo(
    () =>
      nodesWithColor
        .filter((n) => !n.hidden)
        .map((n) => ({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? getStableNodeSize(n).width,
          height: n.measured?.height ?? getStableNodeSize(n).height,
        })),
    [nodesWithColor]
  )

  // No edge connectors — hierarchy is shown through visual nesting
  const displayEdges = useMemo(() =>
    edges.map(e => ({ ...e, hidden: true })),
    [edges]
  )

  const [isTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  )

  const containerRef = useRef(null)
  const dragStartRef = useRef({})

  useEffect(() => {
    if (!reparentSourceNodeId) return
    document.body.style.cursor = 'copy'
    return () => {
      document.body.style.cursor = ''
    }
  }, [reparentSourceNodeId])

  const onNodeDragStart = useCallback((_, node) => {
    if (!isEditMode) return
    dragStartRef.current[node.id] = { x: node.position.x, y: node.position.y }
    pushHistory()
  }, [isEditMode, pushHistory])

  const onNodeDrag = useCallback((_, draggedNode) => {
    if (!isEditMode) return
    if (!draggedNode.data?.groupSize) return  // only parent nodes need subtree dragging
    const prev = dragStartRef.current[draggedNode.id]
    if (!prev) {
      dragStartRef.current[draggedNode.id] = { x: draggedNode.position.x, y: draggedNode.position.y }
      return
    }
    const dx = draggedNode.position.x - prev.x
    const dy = draggedNode.position.y - prev.y
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      moveSubtreeBy(draggedNode.id, dx, dy, false)
    }
    dragStartRef.current[draggedNode.id] = { x: draggedNode.position.x, y: draggedNode.position.y }
  }, [isEditMode, moveSubtreeBy])

  // When a node is dropped, check if its centre landed inside another node.
  // If so, reparent it to that node.
  const onNodeDragStop = useCallback((_, draggedNode) => {
    if (!isEditMode) return
    if (draggedNode.data?.level === 0) return // root is not reparentable
    const dW = draggedNode.measured?.width ?? 0
    const dH = draggedNode.measured?.height ?? 0
    const cx = draggedNode.position.x + dW / 2
    const cy = draggedNode.position.y + dH / 2

    // Build ancestor set so a node can never be reparented to one of its own ancestors
    const ancestorIds = new Set()
    let cur = parentMap[draggedNode.id]
    while (cur) {
      ancestorIds.add(cur)
      cur = parentMap[cur]
    }

    // Pick the smallest overlapping target (most specific hit when nodes overlap)
    const target = allDropTargets
      .filter((t) => {
        if (t.id === draggedNode.id) return false
        if (ancestorIds.has(t.id)) return false
        return cx > t.x && cx < t.x + t.width && cy > t.y && cy < t.y + t.height
      })
      .sort((a, b) => (a.width * a.height) - (b.width * b.height))[0]

    if (target) reparentNode(draggedNode.id, target.id)

    delete dragStartRef.current[draggedNode.id]
  }, [allDropTargets, isEditMode, reparentNode, parentMap])

  const { screenToFlowPosition } = useReactFlow()

  // Cancel toolbox placement on Escape
  useEffect(() => {
    if (!pendingToolboxType) return
    const onKey = (e) => { if (e.key === 'Escape') clearPendingToolboxType() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingToolboxType, clearPendingToolboxType])

  const onCanvasPointerUp = useCallback((e) => {
    if (!pendingToolboxType || !isEditMode) return
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode({ position, level: 1, nodeType: pendingToolboxType })
    clearPendingToolboxType()
  }, [pendingToolboxType, isEditMode, screenToFlowPosition, addNode, clearPendingToolboxType])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: pendingToolboxType ? 'crosshair' : undefined }}
      onPointerUp={onCanvasPointerUp}
    >
      <ReactFlow
        nodes={nodesWithColor}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => {
          if (reparentSourceNodeId) {
            clearReparentMode()
            return
          }
          deselectNode()
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={isEditMode}
        nodesConnectable={isEditMode}
        elementsSelectable
        panOnScroll={!isTouch}
        panOnDrag={isTouch ? true : [1, 2]}
        selectionOnDrag={!isTouch}
        selectionMode={SelectionMode.Partial}
        zoomOnScroll={false}
        zoomOnPinch={false}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'straight-center',
          style: { stroke: '#363b56', strokeWidth: 1.5 },
        }}
        deleteKeyCode={isEditMode ? ['Backspace', 'Delete'] : null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="#d4cabb"
        />
        {!isTouch && <Controls showInteractive={false}>
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
                    ? 'Click a new parent node to reparent · Click source node or canvas to cancel'
                    : 'Hover a node and click + to add a child · Drag to lasso-select · Trackpad to pan & zoom'
                : 'Edit Mode is off · Drag to lasso-select · Trackpad to pan & zoom'}
          </div>
        </Panel>
        <FitViewOnLoad />
        <FocusNodeHandler />
        <PinchZoomHandler containerRef={containerRef} />
      </ReactFlow>
    </div>
  )
}

export default MindMapCanvas
