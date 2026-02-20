import { BaseEdge, getBezierPath, useNodes, Position } from '@xyflow/react'


export default function StraightCenterEdge({ id, source, target, style }) {
  const nodes = useNodes()
  const src = nodes.find((n) => n.id === source)
  if (!src) return null

  const srcW = src.measured?.width  ?? src.width  ?? 0
  const srcH = src.measured?.height ?? src.height ?? 0

  const tgt = nodes.find((n) => n.id === target)
  if (!tgt) return null
  const tgtX = tgt.position.x
  const tgtY = tgt.position.y
  const tgtW = tgt.measured?.width  ?? tgt.width  ?? 0
  const tgtH = tgt.measured?.height ?? tgt.height ?? 0

  const srcCX = src.position.x + srcW / 2
  const srcCY = src.position.y + srcH / 2
  const tgtCX = tgtX + tgtW / 2
  const tgtCY = tgtY + tgtH / 2

  const horizontalOverlap =
    src.position.x < tgtX + tgtW &&
    tgtX < src.position.x + srcW

  let sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition

  if (horizontalOverlap) {
    if (srcCY < tgtCY) {
      sourceX = srcCX; sourceY = src.position.y + srcH; sourcePosition = Position.Bottom
      targetX = tgtCX; targetY = tgtY;        targetPosition = Position.Top
    } else {
      sourceX = srcCX; sourceY = src.position.y; sourcePosition = Position.Top
      targetX = tgtCX; targetY = tgtY + tgtH;   targetPosition = Position.Bottom
    }
  } else if (srcCX < tgtCX) {
    sourceX = src.position.x + srcW; sourceY = srcCY; sourcePosition = Position.Right
    targetX = tgtX;                  targetY = tgtCY; targetPosition = Position.Left
  } else {
    sourceX = src.position.x; sourceY = srcCY; sourcePosition = Position.Left
    targetX = tgtX + tgtW;    targetY = tgtCY; targetPosition = Position.Right
  }

  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  return <BaseEdge id={id} path={path} style={style} />
}
