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
import { useNavigate } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import CustomNode from './CustomNode'
import StraightCenterEdge from './StraightCenterEdge'
import PointerEdge from './PointerEdge'
import { GRID, NEST_PAD_BOTTOM, NEST_PAD_LEFT, NEST_PAD_RIGHT, NEST_PAD_TOP } from '../lib/grid'
import { computeNodeLayouts } from '../lib/layout/computeNodeLayouts'
import { STANDARD_THEME_COLORS } from '../lib/themePalette'

const nodeTypes = { mindmap: CustomNode }
const edgeTypes = { 'straight-center': StraightCenterEdge, 'pointer-edge': PointerEdge }

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

const LEVEL_ZOOM = { 0: 0.7, 1: 1.0, 2: 1.3, 3: 1.6 }
const zoomForLevel = (level) => LEVEL_ZOOM[Math.min(level ?? 2, 3)] ?? 1.6
const VIEW_MODE_PASSIVE_NODE_TYPES = new Set(['card', 'image', 'note', 'text'])

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
    moveSubtreeBy,
    addNode,
    isEditMode,
    openNodeModal,
    setSelectedNodeIds,
    breadcrumbs,
    currentMapId,
    currentMapName,
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
    isFullscreen,
    setIsFullscreen,
    snapSubtreeToGrid,
    copySubtreeToClipboard,
    pasteSubtreeFromClipboard,
  } = useMindMapStore()

  const navigate = useNavigate()
  const [nodeContextMenu, setNodeContextMenu] = useState(null)
  const [paneContextMenu, setPaneContextMenu] = useState(null)

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

  // Compute nested layout in a pure helper and keep projection logic separate.
  const { layouts } = useMemo(() => computeNodeLayouts({
    nodes,
    edges,
    rootId,
    getNodeSize: (node) => {
      const hasChildren = !!(childrenMap[node.id]?.length)
      const hasExpandedContents = node.data?.showContents === true || node.data?.nodeType === 'note' || node.data?.nodeType === 'image' || node.data?.nodeType === 'diagram' || node.data?.nodeType === 'object' || node.data?.nodeType === 'relationship'
      return (!hasChildren && !hasExpandedContents) ? LEAF_NODE_SIZE : getStableNodeSize(node)
    },
    padding: {
      left: NEST_PAD_LEFT,
      right: NEST_PAD_RIGHT,
      top: NEST_PAD_TOP,
      bottom: NEST_PAD_BOTTOM,
    },
  }), [nodes, edges, rootId])

  const nodesWithColor = useMemo(() => {
    return nodes.map(node => {
      const level = node.data?.level ?? 0
      const l1Color = level === 0
        ? ROOT_BORDER
        : (l1ColorMap[getL1Id(node.id)] ?? L1_PALETTE[0])
      const hasChildren = !!(childrenMap[node.id]?.length)
      const hasExpandedContents = node.data?.showContents === true || node.data?.nodeType === 'note' || node.data?.nodeType === 'image' || node.data?.nodeType === 'diagram' || node.data?.nodeType === 'object' || node.data?.nodeType === 'relationship'
      const useFixedLeafSize = !hasChildren && !hasExpandedContents
      const hasNotes = !!(node.data.content && node.data.content !== '<p></p>' && node.data.content !== '')
      const layout = layouts[node.id]
      const persistedSize = node.data?.size
      const fixedGroupSize = hasChildren
        ? (persistedSize ?? {
            width: node.style?.width ?? DEFAULT_NODE_SIZE[Math.min(Math.max(level, 0), 3)].width,
            height: node.style?.height ?? DEFAULT_NODE_SIZE[Math.min(Math.max(level, 0), 3)].height,
          })
        : undefined
      return {
        ...node,
        ...(!hasChildren && layout ? { position: { x: layout.x, y: layout.y } } : {}),
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
        },
      }
    }).sort((a, b) => {
      if (a.id === openMenuNodeId) return 1
      if (b.id === openMenuNodeId) return -1
      if (a.id === glyphMenuNodeId) return 1
      if (b.id === glyphMenuNodeId) return -1
      return (a.data?.level ?? 0) - (b.data?.level ?? 0)
    })
  }, [nodes, l1ColorMap, getL1Id, childrenMap, openMenuNodeId, glyphMenuNodeId, layouts])

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
    if (!reparentSourceNodeId && !copySizeSourceNodeId) return
    document.body.style.cursor = 'copy'
    return () => {
      document.body.style.cursor = ''
    }
  }, [reparentSourceNodeId, copySizeSourceNodeId])

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

  // Dragging onto another node does not change hierarchy; reparent uses the reparent glyph only.
  const onNodeDragStop = useCallback((_, draggedNode) => {
    if (!isEditMode) return
    if (draggedNode.data?.level === 0) return
    snapSubtreeToGrid(draggedNode.id, true)
    delete dragStartRef.current[draggedNode.id]
  }, [isEditMode, snapSubtreeToGrid])

  const { screenToFlowPosition } = useReactFlow()

  const closeContextMenus = useCallback(() => {
    setNodeContextMenu(null)
    setPaneContextMenu(null)
  }, [])

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
    if (!isEditMode) return
    const onPasteKey = async (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'v') return
      const t = e.target
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const pos = screenToFlowPosition(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        { snapToGrid: true, snapGrid: GRID }
      )
      const result = await pasteSubtreeFromClipboard(pos)
      if (!result?.success && result?.error === 'invalid') {
        // Clipboard wasn't a subtree payload — let user know only when they used the shortcut
        console.debug('Clipboard does not contain a Knowledge Maps subtree.')
      }
    }
    window.addEventListener('keydown', onPasteKey)
    return () => window.removeEventListener('keydown', onPasteKey)
  }, [isEditMode, screenToFlowPosition, pasteSubtreeFromClipboard])

  // Cancel toolbox placement on Escape
  useEffect(() => {
    if (!pendingToolboxType) return
    const onKey = (e) => { if (e.key === 'Escape') clearPendingToolboxType() }
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

  const onCanvasPointerUp = useCallback((e) => {
    if (!pendingToolboxType || !isEditMode) return
    const position = screenToFlowPosition(
      { x: e.clientX, y: e.clientY },
      { snapToGrid: true, snapGrid: GRID }
    )
    addNode({ position, level: 1, nodeType: pendingToolboxType })
    clearPendingToolboxType()
  }, [pendingToolboxType, isEditMode, screenToFlowPosition, addNode, clearPendingToolboxType])

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

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: pendingToolboxType ? 'crosshair' : undefined }}
      onPointerUp={onCanvasPointerUp}
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
            onClick={async () => {
              const id = nodeContextMenu.nodeId
              closeContextMenus()
              const r = await copySubtreeToClipboard(id)
              if (!r?.success) alert('Could not copy to clipboard.')
            }}
          >
            Copy subtree…
          </button>
          <p className="map-context-menu__hint">Includes this node and all descendants. Paste from another map via right‑click on the canvas or Ctrl/⌘+V.</p>
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
              const pos = screenToFlowPosition(
                { x: paneContextMenu.x, y: paneContextMenu.y },
                { snapToGrid: true, snapGrid: GRID }
              )
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
        onNodeClick={onNodeClick}
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
        panOnScroll={!isTouch}
        panOnDrag={isTouch ? true : [1, 2]}
        selectionOnDrag={!isTouch}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        zoomOnScroll={false}
        zoomOnPinch={false}
        snapToGrid={isEditMode}
        snapGrid={GRID}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'straight-center',
          style: { stroke: '#363b56', strokeWidth: 1.5 },
        }}
        deleteKeyCode={isEditMode ? ['Backspace', 'Delete'] : null}
      >
        {isEditMode && (
          <Background
            variant={BackgroundVariant.Lines}
            gap={GRID}
            offset={[0, 0]}
            size={0.8}
            color="#d8cfc2"
          />
        )}
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
                    ? 'Click a new parent node to reparent · Escape, source node, or canvas to cancel'
                    : copySizeSourceNodeId
                      ? 'Click a shape to copy size from the source · Escape, source node, or canvas to cancel'
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
