import { BaseEdge, useNodes } from '@xyflow/react'


export default function PointerEdge({ id, source, target, style }) {
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

  const l1Color = tgt.data?.l1Color ?? '#64748b'

  const hasHorizontalOverlap = src.position.x < tgt.position.x + tgtW &&
                                src.position.x + srcW > tgt.position.x

  // Path goes from pointer (tgt) → parent (src); arrowhead is at parX/parY (markerEnd)
  let parX, parY, ptrX, ptrY
  if (hasHorizontalOverlap) {
    if (srcCY < tgtCY) {
      // Parent above pointer
      parX = srcCX; parY = src.position.y + srcH  // parent bottom
      ptrX = tgtCX; ptrY = tgt.position.y          // pointer top
    } else {
      // Parent below pointer
      parX = srcCX; parY = src.position.y           // parent top
      ptrX = tgtCX; ptrY = tgt.position.y + tgtH   // pointer bottom
    }
  } else {
    if (srcCX < tgtCX) {
      // Parent left of pointer
      parX = src.position.x + srcW; parY = srcCY   // parent right
      ptrX = tgt.position.x;        ptrY = tgtCY   // pointer left
    } else {
      // Parent right of pointer
      parX = src.position.x;        parY = srcCY   // parent left
      ptrX = tgt.position.x + tgtW; ptrY = tgtCY  // pointer right
    }
  }

  const dx = parX - ptrX
  const dy = parY - ptrY
  const t = 0.5
  let cp1x, cp1y, cp2x, cp2y
  if (hasHorizontalOverlap) {
    cp1x = ptrX; cp1y = ptrY + dy * t
    cp2x = parX; cp2y = parY - dy * t
  } else {
    cp1x = ptrX + dx * t; cp1y = ptrY
    cp2x = parX - dx * t; cp2y = parY
  }

  const path = `M ${ptrX} ${ptrY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${parX} ${parY}`
  const markerId = `pointer-arrow-${id}`

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L6,3 z" fill={l1Color} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...(style || {}), stroke: l1Color, strokeWidth: 1.5, strokeDasharray: '5,3' }}
        markerEnd={`url(#${markerId})`}
      />
    </>
  )
}
