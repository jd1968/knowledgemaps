import { useMindMapStore } from '../store/useMindMapStore'
import NodeModal from './NodeModal'

export default function NodePopup() {
  const nodes        = useMindMapStore((s) => s.nodes)
  const selectedNodeId = useMindMapStore((s) => s.selectedNodeId)
  const deselectNode   = useMindMapStore((s) => s.deselectNode)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  if (!selectedNode) return null

  return (
    <NodeModal
      node={selectedNode}
      onClose={() => deselectNode()}
    />
  )
}
