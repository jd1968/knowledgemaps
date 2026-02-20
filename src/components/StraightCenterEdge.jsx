import { BaseEdge, getBezierPath, useNodes, Position } from '@xyflow/react'

// Parse the control points out of an SVG cubic Bezier path string ("M x,y C cx1,cy1 cx2,cy2 tx,ty")
function parseCubicBezier(d) {
  const m = d.match(
    /M[\s,]*([\d.e+-]+)[\s,]+([\d.e+-]+)[^C]*C[\s,]*([\d.e+-]+)[\s,]+([\d.e+-]+)[\s,]+([\d.e+-]+)[\s,]+([\d.e+-]+)[\s,]+([\d.e+-]+)[\s,]+([\d.e+-]+)/
  )
  if (!m) return null
  return { x0:+m[1], y0:+m[2], cx1:+m[3], cy1:+m[4], cx2:+m[5], cy2:+m[6], x1:+m[7], y1:+m[8] }
}

// Sample N interior points along a cubic Bezier
function sampleBezier(b, n = 24) {
  const pts = []
  for (let i = 1; i < n; i++) {
    const t = i / n, mt = 1 - t
    pts.push([
      mt**3*b.x0 + 3*mt**2*t*b.cx1 + 3*mt*t**2*b.cx2 + t**3*b.x1,
      mt**3*b.y0 + 3*mt**2*t*b.cy1 + 3*mt*t**2*b.cy2 + t**3*b.y1,
    ])
  }
  return pts
}

function pointInNode(px, py, node) {
  const w = node.measured?.width  ?? 0
  const h = node.measured?.height ?? 0
  return px >= node.position.x && px <= node.position.x + w
      && py >= node.position.y && py <= node.position.y + h
}

export default function StraightCenterEdge({ id, source, target, style }) {
  const nodes = useNodes()
  const src = nodes.find((n) => n.id === source)
  const tgt = nodes.find((n) => n.id === target)

  if (!src || !tgt) return null

  const srcW = src.measured?.width  ?? 0
  const srcH = src.measured?.height ?? 0
  const tgtW = tgt.measured?.width  ?? 0
  const tgtH = tgt.measured?.height ?? 0

  const srcCX = src.position.x + srcW / 2
  const srcCY = src.position.y + srcH / 2
  const tgtCX = tgt.position.x + tgtW / 2
  const tgtCY = tgt.position.y + tgtH / 2

  const horizontalOverlap =
    src.position.x < tgt.position.x + tgtW &&
    tgt.position.x < src.position.x + srcW

  let sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition

  if (horizontalOverlap) {
    if (srcCY < tgtCY) {
      sourceX = srcCX; sourceY = src.position.y + srcH; sourcePosition = Position.Bottom
      targetX = tgtCX; targetY = tgt.position.y;        targetPosition = Position.Top
    } else {
      sourceX = srcCX; sourceY = src.position.y;        sourcePosition = Position.Top
      targetX = tgtCX; targetY = tgt.position.y + tgtH; targetPosition = Position.Bottom
    }
  } else if (srcCX < tgtCX) {
    sourceX = src.position.x + srcW; sourceY = srcCY; sourcePosition = Position.Right
    targetX = tgt.position.x;        targetY = tgtCY; targetPosition = Position.Left
  } else {
    sourceX = src.position.x; sourceY = srcCY; sourcePosition = Position.Left
    targetX = tgt.position.x + tgtW; targetY = tgtCY; targetPosition = Position.Right
  }

  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  // Hide edge if it passes through any other node
  const bezier = parseCubicBezier(path)
  if (bezier) {
    const others = nodes.filter((n) => n.id !== source && n.id !== target && !n.hidden)
    const samples = sampleBezier(bezier)
    if (others.some((n) => samples.some(([px, py]) => pointInNode(px, py, n)))) {
      return null
    }
  }

  return <BaseEdge id={id} path={path} style={style} />
}
