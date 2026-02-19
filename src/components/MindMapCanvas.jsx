import { useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  SelectionMode,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMindMapStore } from '../store/useMindMapStore'
import CustomNode from './CustomNode'
import StraightCenterEdge from './StraightCenterEdge'

const nodeTypes = { mindmap: CustomNode }
const edgeTypes = { 'straight-center': StraightCenterEdge }

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
        nodes={nodes}
        edges={edges}
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
          nodeColor={(node) => {
            const colors = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6']
            return colors[Math.min(node.data?.level ?? 0, 3)]
          }}
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
      </ReactFlow>
    </div>
  )
}

export default MindMapCanvas
