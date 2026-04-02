import { useMindMapStore } from '../store/useMindMapStore'
import NodeModal from './NodeModal'

export default function NodePopup() {
  const nodes          = useMindMapStore((s) => s.nodes)
  const modalNodeId    = useMindMapStore((s) => s.modalNodeId)
  const pendingNewNodeId = useMindMapStore((s) => s.pendingNewNodeId)
  const closeNodeModal = useMindMapStore((s) => s.closeNodeModal)
  const deleteNode     = useMindMapStore((s) => s.deleteNode)

  const modalNode = nodes.find((n) => n.id === modalNodeId)
  if (!modalNode) return null

  const isNew = modalNode.id === pendingNewNodeId

  return (
    <NodeModal
      node={modalNode}
      isNew={isNew}
      onDelete={isNew ? () => deleteNode(modalNode.id) : undefined}
      onClose={closeNodeModal}
    />
  )
}
