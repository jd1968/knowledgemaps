import { BaseEdge, getStraightPath, useNodes } from '@xyflow/react'

// Custom edge that draws a straight line between the centres of source and target nodes,
// ignoring handle positions entirely.
export default function StraightCenterEdge({ id, source, target, style }) {
  const nodes = useNodes()
  const src = nodes.find((n) => n.id === source)
  const tgt = nodes.find((n) => n.id === target)

  if (!src || !tgt) return null

  const sx = src.position.x + (src.measured?.width ?? 0) / 2
  const sy = src.position.y + (src.measured?.height ?? 0) / 2
  const tx = tgt.position.x + (tgt.measured?.width ?? 0) / 2
  const ty = tgt.position.y + (tgt.measured?.height ?? 0) / 2

  const [path] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })

  return <BaseEdge id={id} path={path} style={style} />
}
