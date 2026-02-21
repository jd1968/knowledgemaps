import { BaseEdge, useNodes } from '@xyflow/react'


export default function StraightCenterEdge({ id, source, target, style }) {
  const nodes = useNodes()
  const src = nodes.find((n) => n.id === source)
  if (!src) return null
  const tgt = nodes.find((n) => n.id === target)
  if (!tgt) return null

  const srcW = src.measured?.width  ?? src.width  ?? 0
  const srcH = src.measured?.height ?? src.height ?? 0
  const tgtW = tgt.measured?.width  ?? tgt.width  ?? 0
  const tgtH = tgt.measured?.height ?? tgt.height ?? 0

  const srcCX = src.position.x + srcW / 2
  const srcCY = src.position.y + srcH / 2
  const tgtCX = tgt.position.x + tgtW / 2
  const tgtCY = tgt.position.y + tgtH / 2

  // Determine entry point on the target's edge
  const hasHorizontalOverlap = src.position.x < tgt.position.x + tgtW &&
                                src.position.x + srcW > tgt.position.x

  let tgtX, tgtY
  if (hasHorizontalOverlap) {
    // Source is above or below — enter via top or bottom
    tgtX = tgtCX
    tgtY = srcCY < tgtCY ? tgt.position.y : tgt.position.y + tgtH
  } else {
    // Source is left or right — enter via left or right side
    tgtX = srcCX < tgtCX ? tgt.position.x : tgt.position.x + tgtW
    tgtY = tgtCY
  }

  // Control points extend in the axis of travel for a smooth curve
  const dx = tgtX - srcCX
  const dy = tgtY - srcCY
  const t = 0.5
  let cp1x, cp1y, cp2x, cp2y
  if (hasHorizontalOverlap) {
    // Vertical travel — pull control points along y
    cp1x = srcCX; cp1y = srcCY + dy * t
    cp2x = tgtX;  cp2y = tgtY - dy * t
  } else {
    // Horizontal travel — pull control points along x
    cp1x = srcCX + dx * t; cp1y = srcCY
    cp2x = tgtX - dx * t;  cp2y = tgtY
  }

  const path = `M ${srcCX} ${srcCY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${tgtX} ${tgtY}`

  return <BaseEdge id={id} path={path} style={style} />
}
