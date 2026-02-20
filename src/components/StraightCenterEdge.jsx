import { BaseEdge, useNodes } from '@xyflow/react'


export default function StraightCenterEdge({ id, source, target, style }) {
  const nodes = useNodes()
  const src = nodes.find((n) => n.id === source)
  if (!src) return null
  const tgt = nodes.find((n) => n.id === target)
  if (!tgt) return null

  const srcCX = src.position.x + (src.measured?.width  ?? src.width  ?? 0) / 2
  const srcCY = src.position.y + (src.measured?.height ?? src.height ?? 0) / 2
  const tgtCX = tgt.position.x + (tgt.measured?.width  ?? tgt.width  ?? 0) / 2
  const tgtCY = tgt.position.y + (tgt.measured?.height ?? tgt.height ?? 0) / 2

  const path = `M ${srcCX} ${srcCY} L ${tgtCX} ${tgtCY}`

  return <BaseEdge id={id} path={path} style={style} />
}
