import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  SelectionMode,
  Panel,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMindMapStore } from '../store/useMindMapStore'
import CustomNode from './CustomNode'
import StraightCenterEdge from './StraightCenterEdge'

const nodeTypes = { mindmap: CustomNode }
const edgeTypes = { 'straight-center': StraightCenterEdge }

// Contemporary, compatible palette — one color per L1 branch
const L1_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f97316', // orange
  '#8b5cf6', // violet
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#d946ef', // fuchsia
]

const ROOT_BORDER = '#64748b' // slate — neutral for the central topic

// Breadcrumb navigation bar — only visible when inside a submap
const BreadcrumbNav = () => {
  const breadcrumbs = useMindMapStore((s) => s.breadcrumbs)
  const currentMapName = useMindMapStore((s) => s.currentMapName)
  const navigateBack = useMindMapStore((s) => s.navigateBack)

  if (breadcrumbs.length === 0) return null

  return (
    <Panel position="top-left">
      <div className="breadcrumb-bar">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.mapId} className="breadcrumb-entry">
            <button className="breadcrumb-item" onClick={() => navigateBack(i)}>
              {crumb.mapName}
            </button>
            <span className="breadcrumb-sep">›</span>
          </span>
        ))}
        <span className="breadcrumb-current">{currentMapName}</span>
      </div>
    </Panel>
  )
}

// Must live inside the ReactFlow tree to access the ReactFlow context
const FitViewOnLoad = () => {
  const fitViewTrigger = useMindMapStore((s) => s.fitViewTrigger)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (fitViewTrigger === 0) return
    const id = requestAnimationFrame(() => fitView({ padding: 0.3, duration: 400 }))
    return () => cancelAnimationFrame(id)
  }, [fitViewTrigger, fitView])

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
  } = useMindMapStore()

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

  // Assign each L1 node (direct child of root) a palette color, in creation order
  const l1ColorMap = useMemo(() => {
    if (!rootId) return {}
    const map = {}
    let idx = 0
    nodes.forEach(n => {
      if (parentMap[n.id] === rootId) {
        map[n.id] = L1_PALETTE[idx % L1_PALETTE.length]
        idx++
      }
    })
    return map
  }, [nodes, parentMap, rootId])

  // Walk up the parent chain to find the L1 ancestor of any node
  const getL1Id = useCallback((nodeId) => {
    let current = nodeId
    while (parentMap[current] && parentMap[current] !== rootId) {
      current = parentMap[current]
    }
    return parentMap[current] === rootId ? current : null
  }, [parentMap, rootId])

  // sourceId -> [targetIds] lookup
  const childrenMap = useMemo(() => {
    const map = {}
    edges.forEach(e => {
      if (!map[e.source]) map[e.source] = []
      map[e.source].push(e.target)
    })
    return map
  }, [edges])

  // All node IDs that should be hidden (descendants of any collapsed node)
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set()
    const collect = (nodeId) => {
      ;(childrenMap[nodeId] || []).forEach(childId => {
        hidden.add(childId)
        collect(childId)
      })
    }
    nodes.forEach(node => { if (node.data?.collapsed) collect(node.id) })
    return hidden
  }, [nodes, childrenMap])

  // Fast node lookup for descendant checks
  const nodeById = useMemo(() => {
    const map = {}
    nodes.forEach(n => { map[n.id] = n })
    return map
  }, [nodes])

  // Nodes that have at least one descendant which itself has children (i.e. can offer collapse-all)
  const hasCollapsibleDescendantsSet = useMemo(() => {
    const result = new Set()
    const markAncestors = (nodeId) => {
      let cur = parentMap[nodeId]
      while (cur) {
        if (result.has(cur)) break
        result.add(cur)
        cur = parentMap[cur]
      }
    }
    nodes.forEach(node => {
      if (childrenMap[node.id]?.length) markAncestors(node.id)
    })
    return result
  }, [nodes, childrenMap, parentMap])

  // For each node with collapsible descendants, are ALL of those descendants currently collapsed?
  const allDescendantsCollapsedSet = useMemo(() => {
    const result = new Set()
    nodes.forEach(node => {
      if (!hasCollapsibleDescendantsSet.has(node.id)) return
      let allCollapsed = true
      const stack = [...(childrenMap[node.id] || [])]
      const visited = new Set()
      outer: while (stack.length > 0) {
        const curr = stack.pop()
        if (visited.has(curr)) continue
        visited.add(curr)
        const kids = childrenMap[curr] || []
        if (kids.length > 0 && !nodeById[curr]?.data?.collapsed) {
          allCollapsed = false
          break outer
        }
        stack.push(...kids)
      }
      if (allCollapsed) result.add(node.id)
    })
    return result
  }, [nodes, childrenMap, hasCollapsibleDescendantsSet, nodeById])

  // Inject display-only props into node data; apply hidden flag
  const nodesWithColor = useMemo(() =>
    nodes.map(node => {
      const level = node.data?.level ?? 0
      const l1Color = level === 0
        ? ROOT_BORDER
        : (l1ColorMap[getL1Id(node.id)] ?? L1_PALETTE[0])
      const hasChildren = !!(childrenMap[node.id]?.length)
      const hasCollapsibleDescendants = hasCollapsibleDescendantsSet.has(node.id)
      const allDescendantsCollapsed = allDescendantsCollapsedSet.has(node.id)
      const hasNotes = !!(node.data.content && node.data.content !== '<p></p>' && node.data.content !== '')
      const hasOverview = !!(node.data.overview && node.data.overview.trim() !== '')
      return {
        ...node,
        hidden: hiddenNodeIds.has(node.id),
        data: { ...node.data, l1Color, hasChildren, hasCollapsibleDescendants, allDescendantsCollapsed, hasNotes, hasOverview },
      }
    }),
    [nodes, l1ColorMap, getL1Id, childrenMap, hiddenNodeIds, hasCollapsibleDescendantsSet, allDescendantsCollapsedSet]
  )

  const displayEdges = useMemo(() =>
    edges.map(e => ({ ...e, hidden: hiddenNodeIds.has(e.target) })),
    [edges, hiddenNodeIds]
  )

  const [isTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  )

  const containerRef = useRef(null)

  const onNodeDragStart = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  // When a node is dropped, check if its centre landed inside a group node.
  // If so, reparent it to that group.
  const onNodeDragStop = useCallback((_, draggedNode) => {
    if (draggedNode.data?.level === 0) return // root is not reparentable
    const dW = draggedNode.measured?.width ?? 0
    const dH = draggedNode.measured?.height ?? 0
    const cx = draggedNode.position.x + dW / 2
    const cy = draggedNode.position.y + dH / 2

    const target = nodes.find(n => {
      if (n.id === draggedNode.id || n.data?.nodeType !== 'group') return false
      const nW = n.measured?.width ?? 0
      const nH = n.measured?.height ?? 0
      return cx > n.position.x && cx < n.position.x + nW &&
             cy > n.position.y && cy < n.position.y + nH
    })

    if (target) reparentNode(draggedNode.id, target.id)
  }, [nodes, reparentNode])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodesWithColor}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={deselectNode}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        panOnScroll={!isTouch}
        panOnDrag={isTouch ? true : [1, 2]}
        selectionOnDrag={!isTouch}
        selectionMode={SelectionMode.Partial}
        zoomOnScroll={false}
        zoomOnPinch={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'straight-center',
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="#cbd5e1"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => node.data?.l1Color ?? ROOT_BORDER}
          maskColor="rgba(241,245,249,0.7)"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
          zoomable
          pannable
        />
        <Panel position="bottom-center">
          <div className="canvas-hint">
            {isTouch
              ? 'Tap a node to select · Drag to pan · Pinch to zoom'
              : 'Hover a node and click + to add a child · Drag to lasso-select · Trackpad to pan & zoom'}
          </div>
        </Panel>
        <BreadcrumbNav />
        <FitViewOnLoad />
        <PinchZoomHandler containerRef={containerRef} />
      </ReactFlow>
    </div>
  )
}

export default MindMapCanvas
