import { useMindMapStore } from '../store/useMindMapStore'
import NodeModal from './NodeModal'

export default function NodePopup() {
  const nodes            = useMindMapStore((s) => s.nodes)
  const selectedNodeId   = useMindMapStore((s) => s.selectedNodeId)
  const pendingNewNodeId = useMindMapStore((s) => s.pendingNewNodeId)
  const deselectNode     = useMindMapStore((s) => s.deselectNode)
  const deleteNode       = useMindMapStore((s) => s.deleteNode)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  if (!selectedNode) return null

  const isNew = selectedNode.id === pendingNewNodeId

  return (
    <NodeModal
      node={selectedNode}
      isNew={isNew}
      onDelete={isNew ? () => deleteNode(selectedNode.id) : undefined}
      onClose={() => deselectNode()}
    />
  )
}
