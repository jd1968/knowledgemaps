export function closestBoundaryPoint(shape, mx, my) {
  const { x, y, width: w, height: h } = shape
  const GRID_SIZE = 20
  const inside = mx >= x && mx <= x + w && my >= y && my <= y + h
  let bx, by
  if (!inside) {
    bx = Math.max(x, Math.min(x + w, Math.round(mx / GRID_SIZE) * GRID_SIZE))
    by = Math.max(y, Math.min(y + h, Math.round(my / GRID_SIZE) * GRID_SIZE))
  } else {
    const dL = mx - x, dR = (x + w) - mx, dT = my - y, dB = (y + h) - my
    const m = Math.min(dL, dR, dT, dB)
    if (m === dL) { bx = x; by = Math.round(my / GRID_SIZE) * GRID_SIZE }
    else if (m === dR) { bx = x + w; by = Math.round(my / GRID_SIZE) * GRID_SIZE }
    else if (m === dT) { bx = Math.round(mx / GRID_SIZE) * GRID_SIZE; by = y }
    else { bx = Math.round(mx / GRID_SIZE) * GRID_SIZE; by = y + h }
  }
  bx = Math.max(x, Math.min(x + w, bx))
  by = Math.max(y, Math.min(y + h, by))
  return { x: bx, y: by, nx: (bx - x) / w, ny: (by - y) / h }
}

export function outwardNormal(nx, ny) {
  const e = 0.001
  let dx = 0, dy = 0
  if (nx < e) dx -= 1
  if (nx > 1 - e) dx += 1
  if (ny < e) dy -= 1
  if (ny > 1 - e) dy += 1
  const len = Math.sqrt(dx * dx + dy * dy)
  return len > 0 ? { dx: dx / len, dy: dy / len } : { dx: 0, dy: 0 }
}

export function normToPoint(shape, norm) {
  const GRID_SIZE = 20
  let px = shape.x + norm.nx * shape.width
  let py = shape.y + norm.ny * shape.height
  px = Math.round(px / GRID_SIZE) * GRID_SIZE
  py = Math.round(py / GRID_SIZE) * GRID_SIZE
  px = Math.max(shape.x, Math.min(shape.x + shape.width, px))
  py = Math.max(shape.y, Math.min(shape.y + shape.height, py))
  return { x: px, y: py }
}

// Returns 'H' (horizontal exit) or 'V' (vertical exit) for an endpoint.
// Falls back to whichever axis has more distance when norm is absent (free endpoint).
function getExitDir(norm, thisPt, otherPt) {
  if (norm) {
    const n = outwardNormal(norm.nx, norm.ny)
    return Math.abs(n.dx) >= Math.abs(n.dy) ? 'H' : 'V'
  }
  const dx = Math.abs(otherPt.x - thisPt.x)
  const dy = Math.abs(otherPt.y - thisPt.y)
  return dx >= dy ? 'H' : 'V'
}

export function makePath(fp, fromNorm, toPt, toNorm) {
  const dist = Math.sqrt((toPt.x - fp.x) ** 2 + (toPt.y - fp.y) ** 2)
  const offset = Math.max(40, dist * 0.4)
  const fn = fromNorm ? outwardNormal(fromNorm.nx, fromNorm.ny) : { dx: 0, dy: 0 }
  const tn = toNorm ? outwardNormal(toNorm.nx, toNorm.ny) : { dx: 0, dy: 0 }
  const c1 = { x: fp.x + fn.dx * offset, y: fp.y + fn.dy * offset }
  const c2 = { x: toPt.x + tn.dx * offset, y: toPt.y + tn.dy * offset }
  return `M ${fp.x} ${fp.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${toPt.x} ${toPt.y}`
}

export function makeStraightPath(fp, tp) {
  return `M ${fp.x} ${fp.y} L ${tp.x} ${tp.y}`
}

export function makeElbowPath(fp, waypoints, tp) {
  const pts = [fp, ...waypoints, tp]
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

// Always generates a valid orthogonal (elbow) path between fp and tp.
// Works with free endpoints (null norms) by inferring direction from the vector.
export function generateElbowWaypoints(fp, fromNorm, tp, toNorm) {
  const GRID = 20
  const fromDir = getExitDir(fromNorm, fp, tp)
  const toDir = getExitDir(toNorm, tp, fp)

  if (fromDir === 'H' && toDir === 'H') {
    const midX = Math.round(((fp.x + tp.x) / 2) / GRID) * GRID
    return [{ x: midX, y: fp.y }, { x: midX, y: tp.y }]
  }
  if (fromDir === 'V' && toDir === 'V') {
    const midY = Math.round(((fp.y + tp.y) / 2) / GRID) * GRID
    return [{ x: fp.x, y: midY }, { x: tp.x, y: midY }]
  }
  if (fromDir === 'H' && toDir === 'V') {
    return [{ x: tp.x, y: fp.y }]
  }
  // fromDir === 'V' && toDir === 'H'
  return [{ x: fp.x, y: tp.y }]
}

// Adjusts manually-placed waypoints to stay orthogonal after fp/tp have moved.
// If the result contains any diagonal segment, falls back to generateElbowWaypoints.
export function rectifyElbowWaypoints(fp, fromNorm, tp, toNorm, waypoints) {
  if (!waypoints || waypoints.length === 0) return waypoints || []

  const fn = outwardNormal(fromNorm.nx, fromNorm.ny)
  const tn = outwardNormal(toNorm.nx, toNorm.ny)
  const fromH = Math.abs(fn.dx) > Math.abs(fn.dy)
  const toH = Math.abs(tn.dx) > Math.abs(tn.dy)
  const rect = waypoints.map((w) => ({ ...w }))

  // Forward sweep: constrain each waypoint so each segment is orthogonal
  let isH = fromH
  let curr = fp
  for (let i = 0; i < rect.length; i++) {
    if (isH) rect[i].y = curr.y
    else rect[i].x = curr.x
    curr = rect[i]
    isH = !isH
  }

  // Backward sweep: constrain from the tp end
  isH = toH
  curr = tp
  for (let i = rect.length - 1; i >= 0; i--) {
    if (isH) rect[i].y = curr.y
    else rect[i].x = curr.x
    curr = rect[i]
    isH = !isH
  }

  // Validate: every segment must be purely H or V
  const pts = [fp, ...rect, tp]
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x)
    const dy = Math.abs(pts[i].y - pts[i - 1].y)
    if (dx > 1 && dy > 1) {
      // Conflict — fall back to auto-routing
      return generateElbowWaypoints(fp, fromNorm, tp, toNorm)
    }
  }

  return rect
}
