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
import PointerEdge from './PointerEdge'

const nodeTypes = { mindmap: CustomNode }
const edgeTypes = { 'straight-center': StraightCenterEdge, 'pointer-edge': PointerEdge }

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
const DEFAULT_NODE_SIZE = {
  0: { width: 200, height: 200 },
  1: { width: 170, height: 48 },
  2: { width: 150, height: 88 },
  3: { width: 130, height: 76 },
}
const GROUP_PADDING_X = 16
const GROUP_PADDING_TOP_WITH_HEADER = 58
const GROUP_PADDING_TOP_NO_HEADER = 16
const GROUP_PADDING_BOTTOM = 24

const getStableNodeSize = (node) => {
  if (node?.data?.nodeType === 'group' && node?.data?.groupSize) {
    return node.data.groupSize
  }
  const level = Math.min(Math.max(node?.data?.level ?? 1, 0), 3)
  return DEFAULT_NODE_SIZE[level]
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
    moveSubtreeBy,
    scheduleAutosave,
    isEditMode,
    openMenuNodeId,
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
  const nodesWithColor = useMemo(() => {
    const groupChildrenMap = {}
    nodes.forEach((n) => {
      if (n.data?.nodeType === 'group') groupChildrenMap[n.id] = []
    })
    edges.forEach((e) => {
      if (groupChildrenMap[e.source]) groupChildrenMap[e.source].push(e.target)
    })

    // Process groups innermost-first so outer groups can use sub-group computed layouts
    const groupIdSet = new Set(Object.keys(groupChildrenMap))
    const groupDepth = {}
    const computeGroupDepth = (id) => {
      if (id in groupDepth) return groupDepth[id]
      let max = 0
      ;(groupChildrenMap[id] || []).forEach(childId => {
        if (groupIdSet.has(childId)) max = Math.max(max, computeGroupDepth(childId) + 1)
      })
      groupDepth[id] = max
      return max
    }
    groupIdSet.forEach(id => computeGroupDepth(id))

    const groupLayouts = {}
    Object.entries(groupChildrenMap)
      .sort(([a], [b]) => groupDepth[a] - groupDepth[b])
      .forEach(([groupId, childIds]) => {
        const groupNode = nodeById[groupId]
        const hasGroupHeader = !!groupNode?.data?.title?.trim()
        const topPadding = hasGroupHeader ? GROUP_PADDING_TOP_WITH_HEADER : GROUP_PADDING_TOP_NO_HEADER

        // Collect descendants; stop at sub-groups that already have computed layouts —
        // their full bounds (including padding) are captured via groupLayouts[id] below.
        const allDescendantIds = []
        const collectDescendants = (ids) => {
          ids.forEach((cid) => {
            allDescendantIds.push(cid)
            if (groupIdSet.has(cid) && groupLayouts[cid]) return
            const grandchildren = childrenMap[cid]
            if (grandchildren?.length) collectDescendants(grandchildren)
          })
        }
        collectDescendants(childIds)

        const visibleChildren = allDescendantIds
          .map((id) => nodeById[id])
          .filter((n) => n && !hiddenNodeIds.has(n.id))

        if (visibleChildren.length === 0) return

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity

        visibleChildren.forEach((child) => {
          if (groupIdSet.has(child.id) && groupLayouts[child.id]) {
            // Use the sub-group's already-computed layout bounds (includes its own padding)
            const layout = groupLayouts[child.id]
            minX = Math.min(minX, layout.x)
            minY = Math.min(minY, layout.y)
            maxX = Math.max(maxX, layout.x + layout.width)
            maxY = Math.max(maxY, layout.y + layout.height)
          } else {
            const stableSize = getStableNodeSize(child)
            const childWidth = stableSize.width
            const childHeight = child.measured?.height ?? child.height ?? stableSize.height
            minX = Math.min(minX, child.position.x)
            minY = Math.min(minY, child.position.y)
            maxX = Math.max(maxX, child.position.x + childWidth)
            maxY = Math.max(maxY, child.position.y + childHeight)
          }
        })

        const anchorX = groupNode?.position?.x ?? (minX - GROUP_PADDING_X)
        const anchorY = groupNode?.position?.y ?? (minY - topPadding)
        const x = Math.min(anchorX, minX - GROUP_PADDING_X)
        const y = Math.min(anchorY, minY - topPadding)

        // Keep the group anchored unless children move beyond its top/left bounds.
        // This allows children (including a single child) to be repositioned within the group.
        groupLayouts[groupId] = {
          x,
          y,
          width: Math.max(180, (maxX - x) + GROUP_PADDING_X),
          height: Math.max(80, (maxY - y) + GROUP_PADDING_BOTTOM),
        }
      })

    const decoratedNodes = nodes.map(node => {
      const level = node.data?.level ?? 0
      const l1Color = level === 0
        ? ROOT_BORDER
        : (l1ColorMap[getL1Id(node.id)] ?? L1_PALETTE[0])
      let groupNestingLevel = 0
      let ancestorId = parentMap[node.id]
      while (ancestorId) {
        if (nodeById[ancestorId]?.data?.nodeType === 'group') groupNestingLevel++
        ancestorId = parentMap[ancestorId]
      }
      const hasChildren = !!(childrenMap[node.id]?.length)
      const hasCollapsibleDescendants = hasCollapsibleDescendantsSet.has(node.id)
      const allDescendantsCollapsed = allDescendantsCollapsedSet.has(node.id)
      const hasNotes = !!(node.data.content && node.data.content !== '<p></p>' && node.data.content !== '')
      const groupLayout = groupLayouts[node.id]
      return {
        ...node,
        ...(groupLayout ? { position: { x: groupLayout.x, y: groupLayout.y } } : {}),
        zIndex: node.id === openMenuNodeId ? 9999 : node.data?.nodeType === 'group' ? 0 : 10,
        className: node.data?.nodeType === 'group' ? 'km-group-node' : 'km-content-node',
        hidden: hiddenNodeIds.has(node.id),
        data: {
          ...node.data,
          l1Color,
          hasChildren,
          hasCollapsibleDescendants,
          allDescendantsCollapsed,
          hasNotes,
          groupNestingLevel,
          groupSize: groupLayout ? { width: groupLayout.width, height: groupLayout.height } : undefined,
        },
      }
    })

    // Keep container groups behind regular nodes; elevated (menu-open) node last so it renders on top.
    return decoratedNodes.sort((a, b) => {
      const rank = (n) => n.id === openMenuNodeId ? 2 : n.data?.nodeType === 'group' ? 0 : 1
      return rank(a) - rank(b)
    })
  }, [nodes, edges, l1ColorMap, getL1Id, childrenMap, hiddenNodeIds, hasCollapsibleDescendantsSet, allDescendantsCollapsedSet, nodeById, openMenuNodeId])

  const allDropTargets = useMemo(
    () =>
      nodesWithColor
        .filter((n) => !n.hidden)
        .map((n) => {
          let width, height
          if (n.data?.nodeType === 'group') {
            const size = n.data?.groupSize ?? getStableNodeSize(n)
            width = size.width
            height = size.height
          } else {
            width = n.measured?.width ?? getStableNodeSize(n).width
            height = n.measured?.height ?? getStableNodeSize(n).height
          }
          return { id: n.id, x: n.position.x, y: n.position.y, width, height }
        }),
    [nodesWithColor]
  )

  // All node IDs that are descendants (direct or indirect) of a group node
  const groupDescendantsSet = useMemo(() => {
    const groupIds = new Set(nodes.filter(n => n.data?.nodeType === 'group').map(n => n.id))
    const result = new Set()
    const visit = (id) => {
      ;(childrenMap[id] || []).forEach(childId => {
        result.add(childId)
        visit(childId)
      })
    }
    groupIds.forEach(visit)
    return result
  }, [nodes, childrenMap])

  const displayEdges = useMemo(() =>
    edges.map(e => {
      const sourceNode = nodeById[e.source]
      const isGroupConnector = sourceNode?.data?.nodeType === 'group'
      // Edges between nodes inside a group need elevated zIndex to render above the group background
      const isIntraGroup = groupDescendantsSet.has(e.source)
      return {
        ...e,
        hidden: hiddenNodeIds.has(e.target) || isGroupConnector,
        zIndex: isIntraGroup ? 5 : undefined,
      }
    }),
    [edges, hiddenNodeIds, nodeById, groupDescendantsSet]
  )

  const [isTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  )

  const containerRef = useRef(null)
  const dragStartRef = useRef({})

  const onNodeDragStart = useCallback((_, node) => {
    if (!isEditMode) return
    dragStartRef.current[node.id] = { x: node.position.x, y: node.position.y }
    pushHistory()
  }, [isEditMode, pushHistory])

  const onNodeDrag = useCallback((_, draggedNode) => {
    if (!isEditMode) return
    if (draggedNode.data?.nodeType !== 'group') return
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

  // When a node is dropped, check if its centre landed inside a group node.
  // If so, reparent it to that group.
  const onNodeDragStop = useCallback((_, draggedNode) => {
    if (!isEditMode) return
    if (draggedNode.data?.level === 0) return // root is not reparentable
    const dW = draggedNode.measured?.width ?? 0
    const dH = draggedNode.measured?.height ?? 0
    const cx = draggedNode.position.x + dW / 2
    const cy = draggedNode.position.y + dH / 2

    // Build ancestor set so dragging within a group never accidentally reparents
    // the node to one of its own ancestors (e.g. the containing group node)
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

    if (draggedNode.data?.nodeType === 'group') scheduleAutosave()

    delete dragStartRef.current[draggedNode.id]
  }, [allDropTargets, isEditMode, reparentNode, scheduleAutosave, parentMap])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodesWithColor}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={deselectNode}
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
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'straight-center',
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        }}
        deleteKeyCode={isEditMode ? ['Backspace', 'Delete'] : null}
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
              : isEditMode
                ? 'Hover a node and click + to add a child · Drag to lasso-select · Trackpad to pan & zoom'
                : 'Edit Mode is off · Drag to lasso-select · Trackpad to pan & zoom'}
          </div>
        </Panel>
        <FitViewOnLoad />
        <PinchZoomHandler containerRef={containerRef} />
      </ReactFlow>
    </div>
  )
}

export default MindMapCanvas
