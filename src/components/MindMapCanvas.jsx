import { useCallback, useEffect, useMemo } from 'react'
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

const MindMapCanvas = () => {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    pushHistory,
    selectNode,
    deselectNode,
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

  // Inject display-only props into node data; apply hidden flag
  const nodesWithColor = useMemo(() =>
    nodes.map(node => {
      const level = node.data?.level ?? 0
      const l1Color = level === 0
        ? ROOT_BORDER
        : (l1ColorMap[getL1Id(node.id)] ?? L1_PALETTE[0])
      const hasChildren = !!(childrenMap[node.id]?.length)
      return {
        ...node,
        hidden: hiddenNodeIds.has(node.id),
        data: { ...node.data, l1Color, hasChildren },
      }
    }),
    [nodes, l1ColorMap, getL1Id, childrenMap, hiddenNodeIds]
  )

  // Hide edges whose target is hidden
  const edgesWithHidden = useMemo(() =>
    edges.map(edge => ({ ...edge, hidden: hiddenNodeIds.has(edge.target) })),
    [edges, hiddenNodeIds]
  )

  const onNodeDragStart = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  const onSelectionChange = useCallback(
    ({ nodes: selected }) => {
      if (selected.length === 1) {
        selectNode(selected[0].id)
      } else {
        deselectNode()
      }
    },
    [selectNode, deselectNode]
  )

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodesWithColor}
        edges={edgesWithHidden}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Miro-style interaction: trackpad pans, left-drag lassos
        panOnScroll={true}
        panOnDrag={[1, 2]}
        selectionOnDrag={true}
        selectionMode={SelectionMode.Partial}
        zoomOnScroll={false}
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
            Hover a node and click + to add a child · Drag to lasso-select · Trackpad to pan &amp; zoom
          </div>
        </Panel>
        <FitViewOnLoad />
      </ReactFlow>
    </div>
  )
}

export default MindMapCanvas
