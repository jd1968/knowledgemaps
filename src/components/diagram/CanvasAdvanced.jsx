import { useRef, useState, useCallback, useEffect } from 'react'
import {
  closestBoundaryPoint,
  outwardNormal,
  normToPoint,
  makePath,
  makeStraightPath,
  makeElbowPath,
  generateElbowWaypoints,
  rectifyElbowWaypoints,
} from './geometry.js'

const SNAP_R = 5
const OBJECT_TYPE_FILLS = {
  Standard: '#f1f3f7',
  Packaged: '#e9fbff',
  Custom: '#ffeef6',
}

function getSVGPoint(svgEl, e) {
  const r = svgEl.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function screenToWorld(pt, view) {
  return {
    x: (pt.x - view.x) / view.scale,
    y: (pt.y - view.y) / view.scale,
  }
}

function touchDistance(a, b) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
}

function touchMidpoint(a, b, rect) {
  return {
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  }
}

function resolveConnEndpoint(conn, end, shapes) {
  const shapeIdKey = end === 'from' ? 'fromShapeId' : 'toShapeId'
  const normKey = end === 'from' ? 'fromNorm' : 'toNorm'
  const freeKey = end === 'from' ? 'fromFree' : 'toFree'
  const shape = shapes.find((s) => s.id === conn[shapeIdKey])
  const norm = conn[normKey]
  if (shape && norm) return { point: normToPoint(shape, norm), norm, connected: true }
  if (conn[freeKey]) return { point: conn[freeKey], norm: null, connected: false }
  return null
}

function getConnPath(conn, shapes) {
  const from = resolveConnEndpoint(conn, 'from', shapes)
  const to = resolveConnEndpoint(conn, 'to', shapes)
  if (!from || !to) return null
  const fp = from.point
  const tp = to.point
  const fromNorm = from.norm
  const toNorm = to.norm
  if (conn.style === 'straight') return { d: makeStraightPath(fp, tp), fp, tp }
  if (conn.style === 'elbow' || !conn.style) {
    let waypoints
    if (conn.waypoints && conn.waypoints.length > 0 && fromNorm && toNorm) {
      // User manually adjusted — try to preserve, fall back if it produces diagonals
      waypoints = rectifyElbowWaypoints(fp, fromNorm, tp, toNorm, conn.waypoints)
    } else {
      // Auto-route (handles free endpoints by inferring direction from the vector)
      waypoints = generateElbowWaypoints(fp, fromNorm, tp, toNorm)
    }
    return { d: makeElbowPath(fp, waypoints, tp), fp, tp, rectifiedWaypoints: waypoints }
  }
  if (!fromNorm || !toNorm) return { d: makeStraightPath(fp, tp), fp, tp }
  return { d: makePath(fp, fromNorm, tp, toNorm), fp, tp }
}

function getLabelPosition(point, norm, fallbackTarget, offset = null) {
  let dx = 0
  let dy = -1

  if (norm) {
    const normal = outwardNormal(norm.nx, norm.ny)
    dx = normal.dx
    dy = normal.dy
  } else if (fallbackTarget) {
    const vx = point.x - fallbackTarget.x
    const vy = point.y - fallbackTarget.y
    const len = Math.hypot(vx, vy)
    if (len > 0) {
      dx = vx / len
      dy = vy / len
    }
  }

  return {
    x: point.x + dx * 18 + (offset?.x ?? 0),
    y: point.y + dy * 18 + (offset?.y ?? 0),
    dx,
    dy,
  }
}

export default function CanvasAdvanced({
  shapes, connections, selectedId, selectedConnId,
  onAddShape, onUpdateShape, onDeleteShape,
  onAddStandaloneRelationship, onUpdateConnection, onSelectShape,
  onSelectConn, onUpdateConnWaypoints, onDeleteConn, onReverseConn,
  onBeginHistoryStep, onUpdateConn, onUpdateConnLabelOffset, onRerouteStateChange, onLabelEditStateChange, onOpenPanel, fitOnMount = false, isEditMode = true,
}) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })
  const suppressSelectionRef = useRef(false)
  const touchStateRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [panning, setPanning] = useState(null)
  const [connecting, setConnecting] = useState(null)
  const [reroutingConn, setReroutingConn] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [hoveredShapeId, setHoveredShapeId] = useState(null)
  const [borderSnap, setBorderSnap] = useState(null)
  const [draggingWp, setDraggingWp] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [view, setViewState] = useState({ x: 0, y: 0, scale: 1 })
  const setView = useCallback((v) => {
    const next = typeof v === 'function' ? v(viewRef.current) : v
    viewRef.current = next
    setViewState(next)
  }, [])
  const [marquee, setMarquee] = useState(null)
  const [multiSelectedIds, setMultiSelectedIds] = useState([])
  const [draggingLabel, setDraggingLabel] = useState(null)
  const [editingConnLabel, setEditingConnLabel] = useState(null)
  const [selectedConnLabel, setSelectedConnLabel] = useState(null)
  const [hoveredConnId, setHoveredConnId] = useState(null)
  const [paletteDrag, setPaletteDrag] = useState(null) // { type, x, y } in world coords, or null

  useEffect(() => {
    onRerouteStateChange?.(!!reroutingConn)
  }, [reroutingConn, onRerouteStateChange])

  useEffect(() => {
    onLabelEditStateChange?.(!!editingConnLabel)
  }, [editingConnLabel, onLabelEditStateChange])

  useEffect(() => {
    if (selectedId != null || selectedConnId != null) setSelectedConnLabel(null)
  }, [selectedId, selectedConnId])

  useEffect(() => {
    const onKey = (e) => {
      if (editingConnLabel) return
      const target = e.target
      const isEditingField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (isEditingField) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (multiSelectedIds.length > 0) multiSelectedIds.forEach((id) => onDeleteShape(id))
        else if (selectedId) onDeleteShape(selectedId)
        if (selectedConnId) onDeleteConn(selectedConnId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, selectedConnId, editingConnLabel, onDeleteShape, onDeleteConn, multiSelectedIds])

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('mousedown', closeContextMenu)
    return () => window.removeEventListener('mousedown', closeContextMenu)
  }, [])

  // Stable refs so the palette-drop listener never goes stale
  const isEditModeRef = useRef(isEditMode)
  const onAddShapeRef = useRef(onAddShape)
  const onAddStandaloneRelationshipRef = useRef(onAddStandaloneRelationship)
  useEffect(() => { isEditModeRef.current = isEditMode }, [isEditMode])
  useEffect(() => { onAddShapeRef.current = onAddShape }, [onAddShape])
  useEffect(() => { onAddStandaloneRelationshipRef.current = onAddStandaloneRelationship }, [onAddStandaloneRelationship])

  useEffect(() => {
    const handlePaletteDrop = (event) => {
      if (!isEditModeRef.current) return
      const container = containerRef.current
      if (!container) return
      const { type, clientX, clientY } = event.detail || {}
      if (!type) return
      const rect = container.getBoundingClientRect()
      const inside =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      if (!inside) return
      const world = screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, viewRef.current)
      if (type === 'relationship') {
        onAddStandaloneRelationshipRef.current(Math.round(world.x / 20) * 20, Math.round(world.y / 20) * 20)
      } else {
        // Compute shape dimensions here so we can center on the cursor before addShape snaps to grid
        const isNote = type === 'note'
        const isRegion = type === 'region'
        const isOr = type === 'or-annotation'
        const w = isRegion ? 320 : isNote ? 200 : isOr ? 200 : 160
        const h = isRegion ? 240 : isNote ? 160 : isOr ? 40 : 80
        onAddShapeRef.current(type, world.x - w / 2, world.y - h / 2)
      }
    }
    window.addEventListener('diagram-palette-drop', handlePaletteDrop)
    return () => window.removeEventListener('diagram-palette-drop', handlePaletteDrop)
  }, []) // mount/unmount only — all values accessed via refs

  // Ghost preview while dragging from palette
  useEffect(() => {
    const updateGhost = (clientX, clientY, type) => {
      const container = containerRef.current
      if (!container) { setPaletteDrag(null); return }
      const rect = container.getBoundingClientRect()
      const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      if (!inside) { setPaletteDrag(null); return }
      const world = screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, viewRef.current)
      setPaletteDrag({ type, x: world.x, y: world.y })
    }
    const onMove = (e) => { const { type, clientX, clientY } = e.detail || {}; if (type) updateGhost(clientX, clientY, type) }
    const onEnd = () => setPaletteDrag(null)
    window.addEventListener('diagram-palette-drag-move', onMove)
    window.addEventListener('diagram-palette-drag-end', onEnd)
    window.addEventListener('diagram-palette-drop', onEnd)
    return () => {
      window.removeEventListener('diagram-palette-drag-move', onMove)
      window.removeEventListener('diagram-palette-drag-end', onEnd)
      window.removeEventListener('diagram-palette-drop', onEnd)
    }
  }, [])

  const handleSVGMouseMove = useCallback((e) => {
    if (panning) {
      const dx = e.clientX - panning.startX
      const dy = e.clientY - panning.startY
      setView((v) => ({ ...v, x: panning.startViewX + dx, y: panning.startViewY + dy }))
      return
    }
    const screenPt = getSVGPoint(svgRef.current, e)
    const pt = screenToWorld(screenPt, view)
    setMousePos(pt)
    if (marquee) return setMarquee((prev) => (prev ? { ...prev, x: pt.x, y: pt.y } : prev))
    if (draggingLabel) {
      const dx = pt.x - draggingLabel.startX
      const dy = pt.y - draggingLabel.startY
      onUpdateConnLabelOffset(draggingLabel.connId, draggingLabel.end, { x: (draggingLabel.baseOffset?.x ?? 0) + dx, y: (draggingLabel.baseOffset?.y ?? 0) + dy })
      return
    }
    if (draggingWp) {
      const conn = connections.find((c) => c.id === draggingWp.connId)
      if (conn) {
        const { index, isH } = draggingWp
        const waypoints = conn.waypoints || []
        if (index > 0 && index < waypoints.length + 1) {
          const newWps = waypoints.map((w) => ({ ...w }))
          if (isH) { newWps[index - 1].y = pt.y; newWps[index].y = pt.y }
          else { newWps[index - 1].x = pt.x; newWps[index].x = pt.x }
          onUpdateConnWaypoints(conn.id, newWps)
        }
      }
      return
    }
    if (dragging) {
      if (dragging.type === 'move-multi') {
        const dx = Math.round((pt.x - dragging.startX) / 20) * 20
        const dy = Math.round((pt.y - dragging.startY) / 20) * 20
        dragging.shapeIds.forEach((id) => {
          const orig = dragging.initialPositions[id]
          if (!orig) return
          onUpdateShape(id, { x: orig.x + dx, y: orig.y + dy }, { skipHistory: true })
        })
        return
      }
      if (dragging.type === 'resize') {
        const minSize = 40
        let newX = dragging.origX, newY = dragging.origY, newW = dragging.origW, newH = dragging.origH
        const rightEdge = dragging.origX + dragging.origW
        const bottomEdge = dragging.origY + dragging.origH
        const snappedPtX = Math.round(pt.x / 20) * 20
        const snappedPtY = Math.round(pt.y / 20) * 20
        if (dragging.handle.includes('e')) newW = Math.max(minSize, snappedPtX - dragging.origX)
        if (dragging.handle.includes('s')) newH = Math.max(minSize, snappedPtY - dragging.origY)
        if (dragging.handle.includes('w')) { newW = Math.max(minSize, rightEdge - snappedPtX); newX = rightEdge - newW }
        if (dragging.handle.includes('n')) { newH = Math.max(minSize, bottomEdge - snappedPtY); newY = bottomEdge - newH }
        onUpdateShape(dragging.shapeId, { x: newX, y: newY, width: newW, height: newH }, { skipHistory: true })
      } else {
        onUpdateShape(dragging.shapeId, { x: Math.round((pt.x - dragging.offsetX) / 20) * 20, y: Math.round((pt.y - dragging.offsetY) / 20) * 20 }, { skipHistory: true })
      }
      return
    }
    if (hoveredShapeId) {
      const shape = shapes.find((s) => s.id === hoveredShapeId)
      if (shape && shape.type !== 'region' && shape.type !== 'note' && shape.type !== 'or-annotation') {
        const snap = closestBoundaryPoint(shape, pt.x, pt.y)
        setBorderSnap(reroutingConn ? snap : null)
      } else setBorderSnap(null)
    } else setBorderSnap(null)
  }, [panning, marquee, draggingLabel, draggingWp, dragging, hoveredShapeId, shapes, reroutingConn, onUpdateConnLabelOffset, connections, onUpdateConnWaypoints, onUpdateShape, view])

  const handleSVGMouseUp = useCallback(() => {
    if (reroutingConn) {
      onUpdateConnection(reroutingConn.connId, reroutingConn.end, null, null, false, mousePos)
      setReroutingConn(null); setBorderSnap(null); setDragging(null); setDraggingWp(null); if (connecting) setConnecting(null)
      return
    }
    if (marquee) {
      const minX = Math.min(marquee.startX, marquee.x), maxX = Math.max(marquee.startX, marquee.x)
      const minY = Math.min(marquee.startY, marquee.y), maxY = Math.max(marquee.startY, marquee.y)
      const ids = shapes.filter((s) => s.x < maxX && s.x + s.width > minX && s.y < maxY && s.y + s.height > minY).map((s) => s.id)
      setMultiSelectedIds(ids)
      if (ids.length === 1) onSelectShape(ids[0]); else onSelectShape(null)
      onSelectConn(null); setMarquee(null); return
    }
    setPanning(null); setDragging(null); setDraggingWp(null); setDraggingLabel(null); if (connecting) setConnecting(null)
  }, [reroutingConn, onUpdateConnection, mousePos, connecting, marquee, shapes, onSelectShape, onSelectConn])

  const handleShapeMouseDown = useCallback((e, shape) => {
    if (connecting || reroutingConn) return
    if (suppressSelectionRef.current) {
      suppressSelectionRef.current = false
      e.stopPropagation()
      return
    }
    e.stopPropagation()
    setSelectedConnLabel(null)
    if (!isEditMode) {
      onSelectShape(shape.id)
      onSelectConn(null)
      setMultiSelectedIds([])
      return
    }
    const pt = screenToWorld(getSVGPoint(svgRef.current, e), view)
    if (multiSelectedIds.length > 1 && multiSelectedIds.includes(shape.id)) {
      onBeginHistoryStep()
      const initialPositions = {}
      multiSelectedIds.forEach((id) => { const s = shapes.find((x) => x.id === id); if (s) initialPositions[id] = { x: s.x, y: s.y } })
      setDragging({ type: 'move-multi', shapeIds: multiSelectedIds, startX: pt.x, startY: pt.y, initialPositions })
    } else {
      onBeginHistoryStep(); onSelectShape(shape.id); onSelectConn(null); setMultiSelectedIds([])
      setDragging({ shapeId: shape.id, offsetX: pt.x - shape.x, offsetY: pt.y - shape.y })
    }
  }, [connecting, reroutingConn, isEditMode, view, multiSelectedIds, shapes, onBeginHistoryStep, onSelectShape, onSelectConn])

  const handleShapeMouseUp = useCallback((e, shape) => {
    if (reroutingConn) {
      e.stopPropagation()
      if (shape.type === 'region' || shape.type === 'note' || shape.type === 'or-annotation') { setReroutingConn(null); return }
      const pt = screenToWorld(getSVGPoint(svgRef.current, e), view)
      const snap = closestBoundaryPoint(shape, pt.x, pt.y)
      onUpdateConnection(reroutingConn.connId, reroutingConn.end, shape.id, { nx: snap.nx, ny: snap.ny })
      setReroutingConn(null); setBorderSnap(null)
    } else if (connecting) { setConnecting(null); setBorderSnap(null) }
  }, [reroutingConn, connecting, view, onUpdateConnection])

  const handleSVGMouseDown = useCallback((e) => {
    if (suppressSelectionRef.current) {
      suppressSelectionRef.current = false
      return
    }
    setContextMenu(null)
    if (e.button === 1) {
      // Middle mouse button — pan
      e.preventDefault()
      setPanning({ startX: e.clientX, startY: e.clientY, startViewX: viewRef.current.x, startViewY: viewRef.current.y })
      return
    }
    setSelectedConnLabel(null)
    onSelectShape(null); onSelectConn(null); setConnecting(null); setReroutingConn(null); setMultiSelectedIds([])
    if (e.button === 0 && isEditMode) {
      const pt = screenToWorld(getSVGPoint(svgRef.current, e), view)
      setMarquee({ startX: pt.x, startY: pt.y, x: pt.x, y: pt.y })
    }
  }, [isEditMode, onSelectShape, onSelectConn, view])

  const handleDoubleClick = useCallback((e, shape) => {
    e.stopPropagation()
    onSelectShape(shape.id)
    onSelectConn(null)
    onOpenPanel?.()
  }, [onSelectShape, onSelectConn, onOpenPanel])
  const commitConnLabelEdit = useCallback(() => {
    if (!editingConnLabel) return
    onBeginHistoryStep()
    onUpdateConn(editingConnLabel.connId, {
      [editingConnLabel.end === 'from' ? 'fromLabel' : 'toLabel']: editingConnLabel.value,
    })
    suppressSelectionRef.current = true
    setEditingConnLabel(null)
  }, [editingConnLabel, onBeginHistoryStep, onUpdateConn])
  const startReroute = (e, connId, end) => { e.stopPropagation(); setConnecting(null); setDragging(null); setReroutingConn({ connId, end }) }
  const openConnectionMenu = useCallback((e, connId) => {
    e.preventDefault(); e.stopPropagation()
    const pt = getSVGPoint(svgRef.current, e)
    onSelectConn(connId); onSelectShape(null); setContextMenu({ connId, x: pt.x, y: pt.y })
  }, [onSelectConn, onSelectShape])

  const zoomBy = useCallback((factor) => {
    const svgEl = svgRef.current; if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    const cx = rect.width / 2, cy = rect.height / 2
    setView((v) => {
      const nextScale = Math.max(0.25, Math.min(3, v.scale * factor))
      return { scale: nextScale, x: cx - (cx - v.x) * (nextScale / v.scale), y: cy - (cy - v.y) * (nextScale / v.scale) }
    })
  }, [])
  const centerViewAtScale = useCallback((scale = 1) => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const pad = 24
    if (shapes.length === 0) {
      setView({ x: pad, y: pad, scale })
      return
    }
    const minX = Math.min(...shapes.map((s) => s.x || 0))
    const minY = Math.min(...shapes.map((s) => s.y || 0))
    const maxX = Math.max(...shapes.map((s) => (s.x || 0) + (s.width || 160)))
    const maxY = Math.max(...shapes.map((s) => (s.y || 0) + (s.height || 80)))
    const contentW = maxX - minX || 160
    const contentH = maxY - minY || 80
    const centeredX = (rect.width - contentW * scale) / 2 - minX * scale
    const leftAnchoredX = pad - minX * scale
    setView({
      scale,
      x: Math.max(leftAnchoredX, centeredX),
      y: Math.max(pad, (rect.height - contentH * scale) / 2 - minY * scale),
    })
  }, [shapes, setView])
  const setZoomPercent = useCallback((percent) => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const rawScale = percent / 100
    const nextScale = Math.max(0.25, Math.min(3, Number.isFinite(rawScale) ? rawScale : 1))
    setView((v) => ({ scale: nextScale, x: cx - (cx - v.x) * (nextScale / v.scale), y: cy - (cy - v.y) * (nextScale / v.scale) }))
  }, [setView])
  const fitView = useCallback(() => {
    if (shapes.length === 0) { setView({ x: 0, y: 0, scale: 1 }); return }
    const svgEl = svgRef.current; if (!svgEl) return
    const rect = svgEl.getBoundingClientRect(); if (!rect.width || !rect.height) return
    const pad = 48
    const minX = Math.min(...shapes.map((s) => s.x || 0)), minY = Math.min(...shapes.map((s) => s.y || 0))
    const maxX = Math.max(...shapes.map((s) => (s.x || 0) + (s.width || 160))), maxY = Math.max(...shapes.map((s) => (s.y || 0) + (s.height || 80)))
    const contentW = maxX - minX || 160, contentH = maxY - minY || 80
    const scale = Math.max(0.25, Math.min(3, Math.min((rect.width - pad * 2) / contentW, (rect.height - pad * 2) / contentH)))
    if (!isFinite(scale)) return
    setView({ scale, x: (rect.width - contentW * scale) / 2 - minX * scale, y: (rect.height - contentH * scale) / 2 - minY * scale })
  }, [shapes])
  useEffect(() => {
    requestAnimationFrame(() => {
      if (fitOnMount) fitView()
      else centerViewAtScale(1)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll-wheel zoom (centred on cursor) + trackpad pan
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (trackpad) or ctrl+scroll — zoom centred on cursor
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
        const v = viewRef.current
        const nextScale = Math.max(0.25, Math.min(3, v.scale * factor))
        setView({ scale: nextScale, x: cx - (cx - v.x) * (nextScale / v.scale), y: cy - (cy - v.y) * (nextScale / v.scale) })
      } else {
        // Two-finger trackpad pan or plain scroll
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    const onAuxClick = (e) => { if (e.button === 1) e.preventDefault() }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('auxclick', onAuxClick)
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('auxclick', onAuxClick) }
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect()
        const [a, b] = e.touches
        touchStateRef.current = {
          mode: 'pinch',
          startDistance: touchDistance(a, b),
          startMid: touchMidpoint(a, b, rect),
          startView: { ...viewRef.current },
        }
        e.preventDefault()
        return
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0]
        touchStateRef.current = {
          mode: 'pan',
          startX: touch.clientX,
          startY: touch.clientY,
          startView: { ...viewRef.current },
          moved: false,
        }
      }
    }

    const onTouchMove = (e) => {
      const state = touchStateRef.current
      if (!state) return

      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect()
        const [a, b] = e.touches
        const mid = touchMidpoint(a, b, rect)
        const distance = touchDistance(a, b)
        const startDistance = state.startDistance || distance
        const rawScale = state.startView.scale * (distance / Math.max(1, startDistance))
        const nextScale = Math.max(0.25, Math.min(3, rawScale))
        const panDx = mid.x - state.startMid.x
        const panDy = mid.y - state.startMid.y
        setView({
          scale: nextScale,
          x: mid.x - (state.startMid.x - state.startView.x) * (nextScale / state.startView.scale) + panDx,
          y: mid.y - (state.startMid.y - state.startView.y) * (nextScale / state.startView.scale) + panDy,
        })
        e.preventDefault()
        return
      }

      if (e.touches.length === 1 && state.mode === 'pan') {
        const touch = e.touches[0]
        const dx = touch.clientX - state.startX
        const dy = touch.clientY - state.startY
        if (!state.moved && Math.hypot(dx, dy) > 4) state.moved = true
        if (state.moved) {
          setView((v) => ({ ...v, x: state.startView.x + dx, y: state.startView.y + dy }))
          e.preventDefault()
        }
      }
    }

    const onTouchEnd = (e) => {
      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect()
        const [a, b] = e.touches
        touchStateRef.current = {
          mode: 'pinch',
          startDistance: touchDistance(a, b),
          startMid: touchMidpoint(a, b, rect),
          startView: { ...viewRef.current },
        }
        return
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0]
        touchStateRef.current = {
          mode: 'pan',
          startX: touch.clientX,
          startY: touch.clientY,
          startView: { ...viewRef.current },
          moved: false,
        }
        return
      }

      touchStateRef.current = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchEnd, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [setView])

  return (
    <div ref={containerRef} className="diagram-canvas-wrap">
      <svg
        ref={svgRef}
        className="diagram-canvas"
        onMouseMove={handleSVGMouseMove}
        onMouseUp={handleSVGMouseUp}
        onMouseDown={handleSVGMouseDown}
      >
        <defs>
          {isEditMode && (
            <pattern id="grid" width={20 * (view.scale || 1)} height={20 * (view.scale || 1)} patternUnits="userSpaceOnUse" x={(view.x || 0) % (20 * (view.scale || 1))} y={(view.y || 0) % (20 * (view.scale || 1))}>
              <path d={`M ${20 * view.scale} 0 L 0 0 0 ${20 * view.scale}`} fill="none" stroke="#e0e5f2" strokeWidth="1"/>
            </pattern>
          )}
          {/* Lookup markers — matches RelationshipEdge.jsx */}
          <marker id="lookup-start" markerUnits="userSpaceOnUse" viewBox="-5 0 27 20" markerWidth="27" markerHeight="20" refX="0" refY="10" orient="auto">
            <path d="M 7 4 L 7 16" fill="none" stroke="#5b8dee" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="16" cy="10" r="5" fill="#fff" stroke="#5b8dee" strokeWidth="2"/>
          </marker>
          <marker id="lookup-end" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
            <circle cx="6" cy="10" r="5" fill="#fff" stroke="#5b8dee" strokeWidth="2"/>
            <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#5b8dee" strokeWidth="2" strokeLinecap="round"/>
          </marker>
          <marker id="lookup-start-sel" markerUnits="userSpaceOnUse" viewBox="-5 0 27 20" markerWidth="27" markerHeight="20" refX="0" refY="10" orient="auto">
            <path d="M 7 4 L 7 16" fill="none" stroke="#3a6fd8" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="16" cy="10" r="5" fill="#fff" stroke="#3a6fd8" strokeWidth="2.5"/>
          </marker>
          <marker id="lookup-end-sel" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
            <circle cx="6" cy="10" r="5" fill="#fff" stroke="#3a6fd8" strokeWidth="2.5"/>
            <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#3a6fd8" strokeWidth="2.5" strokeLinecap="round"/>
          </marker>
          {/* Master-detail markers — matches RelationshipEdge.jsx */}
          <marker id="md-start" markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
            <path d="M 7 4 L 7 16 M 12 4 L 12 16" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round"/>
          </marker>
          <marker id="md-end" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
            <circle cx="6" cy="10" r="5" fill="#fff" stroke="#e53935" strokeWidth="2"/>
            <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round"/>
          </marker>
          <marker id="md-start-sel" markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
            <path d="M 7 4 L 7 16 M 12 4 L 12 16" fill="none" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round"/>
          </marker>
          <marker id="md-end-sel" markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
            <circle cx="6" cy="10" r="5" fill="#fff" stroke="#c62828" strokeWidth="2.5"/>
            <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round"/>
          </marker>
        </defs>
        <rect width="100%" height="100%" fill={isEditMode ? 'url(#grid)' : '#f8fafc'} style={{ pointerEvents: 'none' }} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {connections.map((conn) => {
            const result = getConnPath(conn, shapes)
            if (!result) return null
            const { d, fp, tp } = result
            const sel = selectedConnId === conn.id
            const hovered = hoveredConnId === conn.id
            const isMD = conn.relType === 'master-detail'
            const sfx = sel ? '-sel' : ''
            const stroke = isMD
              ? (sel ? '#c62828' : hovered ? '#ef5350' : '#e53935')
              : (sel ? '#3a6fd8' : hovered ? '#7aa6f2' : '#5b8dee')
            let markerEnd = null, markerStart = null
            if (conn.relType === 'lookup') {
              markerStart = `url(#lookup-start${sfx})`
              markerEnd = `url(#lookup-end${sfx})`
            } else if (conn.relType === 'master-detail') {
              markerStart = `url(#md-start${sfx})`
              markerEnd = `url(#md-end${sfx})`
            }
            return (
              <g key={conn.id}>
                <path d={d} fill="none" stroke="transparent" strokeWidth="16" style={{ cursor: 'pointer' }} onMouseEnter={() => setHoveredConnId(conn.id)} onMouseLeave={() => setHoveredConnId((prev) => (prev === conn.id ? null : prev))} onMouseDown={(e) => {
                  if (suppressSelectionRef.current) {
                    suppressSelectionRef.current = false
                    e.stopPropagation()
                    return
                  }
                  e.stopPropagation()
                  setSelectedConnLabel(null)
                  onSelectConn(conn.id)
                  onSelectShape(null)
                }} onDoubleClick={(e) => {
                  e.stopPropagation()
                  onSelectConn(conn.id)
                  onSelectShape(null)
                  onOpenPanel?.()
                }} onContextMenu={(e) => openConnectionMenu(e, conn.id)} />
                <path d={d} fill="none" stroke={stroke} strokeWidth={sel ? 3 : hovered ? 2.75 : 2}
                  style={hovered && !sel ? { filter: 'drop-shadow(0 0 4px rgba(91, 141, 238, 0.45))' } : undefined}
                  markerEnd={markerEnd || undefined}
                  markerStart={markerStart || undefined}
                />
                {(() => {
                  const fromLabel = conn.fromLabel ?? ''
                  const toLabel = conn.toLabel ?? ''
                  const fromPos = getLabelPosition(fp, conn.fromNorm, tp, conn.fromLabelOffset)
                  const toPos = getLabelPosition(tp, conn.toNorm, fp, conn.toLabelOffset)
                  const labels = [
                    { key: 'from', text: fromLabel, pos: fromPos, offset: conn.fromLabelOffset },
                    { key: 'to', text: toLabel, pos: toPos, offset: conn.toLabelOffset },
                  ]

                  return labels.map(({ key, text, pos, offset }) => {
                    const width = Math.max(20, text.length * 7)
                    const x = pos.x - width / 2
                    const y = pos.y - 8
                    const isEditing = editingConnLabel?.connId === conn.id && editingConnLabel?.end === key
                    const isSelected = selectedConnLabel?.connId === conn.id && selectedConnLabel?.end === key
                    return (
                      <g
                        key={key}
                        transform={`translate(${x} ${y})`}
                        style={{ cursor: isEditMode ? 'grab' : 'default' }}
                        onMouseDown={(e) => {
                          if (!isEditMode) return
                          e.stopPropagation()
                          const pt = screenToWorld(getSVGPoint(svgRef.current, e), view)
                          onBeginHistoryStep()
                          setSelectedConnLabel({ connId: conn.id, end: key })
                          onSelectConn(null)
                          onSelectShape(null)
                          setDraggingLabel({
                            connId: conn.id,
                            end: key,
                            startX: pt.x,
                            startY: pt.y,
                            baseOffset: offset,
                          })
                        }}
                        onDoubleClick={(e) => {
                          if (!isEditMode) return
                          e.stopPropagation()
                          setDraggingLabel(null)
                          setSelectedConnLabel({ connId: conn.id, end: key })
                          onSelectConn(null)
                          onSelectShape(null)
                          setEditingConnLabel({
                            connId: conn.id,
                            end: key,
                            value: text,
                          })
                        }}
                      >
                        {(isSelected || isEditing) && (
                          <rect
                            x={-4}
                            y={-6}
                            width={Math.max(28, width + 8)}
                            height={18}
                            rx={6}
                            fill="rgba(37, 99, 235, 0.14)"
                          />
                        )}
                        {isEditing ? (
                          <foreignObject x={-8} y={-10} width={Math.max(70, text.length * 8 + 24)} height={28}>
                            <input
                              xmlns="http://www.w3.org/1999/xhtml"
                              className="diagram-inline-input"
                              autoFocus
                              value={editingConnLabel.value}
                              onChange={(e) => setEditingConnLabel((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                              onBlur={commitConnLabelEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitConnLabelEdit()
                                if (e.key === 'Escape') {
                                  suppressSelectionRef.current = true
                                  setEditingConnLabel(null)
                                }
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                            />
                          </foreignObject>
                        ) : (
                          <text x={width / 2} y={8} textAnchor="middle" dominantBaseline="middle" fill={stroke} fontSize="11" fontWeight="600" style={{ userSelect: 'none' }}>
                            {text}
                          </text>
                        )}
                      </g>
                    )
                  })
                })()}
                {sel && isEditMode && (
                  <>
                    <circle cx={fp.x} cy={fp.y} r={5} fill="#fff" stroke="#2563eb" strokeWidth={1.5} style={{ cursor: 'grab' }} onMouseDown={(e) => startReroute(e, conn.id, 'from')} />
                    <circle cx={tp.x} cy={tp.y} r={5} fill="#fff" stroke="#2563eb" strokeWidth={1.5} style={{ cursor: 'grab' }} onMouseDown={(e) => startReroute(e, conn.id, 'to')} />
                  </>
                )}
              </g>
            )
          })}
          {reroutingConn && (() => {
            const conn = connections.find((c) => c.id === reroutingConn.connId)
            if (!conn) return null
            const fixedEnd = reroutingConn.end === 'from' ? 'to' : 'from'
            const fixed = resolveConnEndpoint(conn, fixedEnd, shapes)
            if (!fixed) return null
            const target = borderSnap || mousePos
            const fp = reroutingConn.end === 'from' ? target : fixed.point
            const tp = reroutingConn.end === 'to' ? target : fixed.point
            const d = makeStraightPath(fp, tp)
            return (
              <path key="reroute-preview" d={d} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" style={{ pointerEvents: 'none' }} />
            )
          })()}
          {shapes.map((shape) => {
            const sx = shape.x ?? 0
            const sy = shape.y ?? 0
            const sw = shape.width ?? 160
            const sh = shape.height ?? 80
            const isHovered = hoveredShapeId === shape.id
            const isSelected = selectedId === shape.id
            const isRerouteTarget = reroutingConn && isHovered && shape.type !== 'region' && shape.type !== 'note' && shape.type !== 'or-annotation'
            const stroke = isRerouteTarget
              ? '#16a34a'
              : isSelected
                ? '#2563eb'
                : isHovered
                  ? '#5b8dee'
                  : '#93b4f5'
            const strokeWidth = isRerouteTarget
              ? 2.5
              : isSelected
                ? 2.5
                : isHovered
                  ? 2.25
                  : 2
            return (
              <g key={shape.id} onMouseEnter={() => setHoveredShapeId(shape.id)} onMouseLeave={() => { setHoveredShapeId(null); setBorderSnap(null) }}>
                <rect
                  x={sx} y={sy} width={sw} height={sh}
                  rx={shape.type === 'note' ? 4 : shape.type === 'shape' ? 3 : 10}
                  fill={shape.type === 'note' ? '#fefce8' : shape.type === 'shape' ? '#ffffff' : (OBJECT_TYPE_FILLS[shape.objectType] || OBJECT_TYPE_FILLS.Standard)}
                  stroke={shape.type === 'shape' ? (isSelected ? '#374151' : isHovered ? '#6b7280' : '#9ca3af') : stroke}
                  strokeWidth={strokeWidth}
                  style={{ filter: isHovered || isSelected ? 'drop-shadow(0 2px 8px rgba(37, 99, 235, 0.12))' : undefined }}
                  onMouseDown={(e) => handleShapeMouseDown(e, shape)}
                  onMouseUp={(e) => handleShapeMouseUp(e, shape)}
                  onDoubleClick={(e) => handleDoubleClick(e, shape)}
                />
                <text x={sx + sw / 2} y={sy + sh / 2} textAnchor="middle" dominantBaseline="middle" fill={shape.type === 'shape' ? '#374151' : '#1e3a8a'} fontSize="12" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {shape.type === 'note' ? (shape.noteText || 'Note') : (shape.label || (shape.type === 'shape' ? 'Container' : 'Object'))}
                </text>
                {isEditMode && isSelected && !reroutingConn && [
                  { h: 'nw', cx: sx,        cy: sy },
                  { h: 'n',  cx: sx + sw/2,  cy: sy },
                  { h: 'ne', cx: sx + sw,    cy: sy },
                  { h: 'e',  cx: sx + sw,    cy: sy + sh/2 },
                  { h: 'se', cx: sx + sw,    cy: sy + sh },
                  { h: 's',  cx: sx + sw/2,  cy: sy + sh },
                  { h: 'sw', cx: sx,         cy: sy + sh },
                  { h: 'w',  cx: sx,         cy: sy + sh/2 },
                ].map(({ h, cx, cy }) => (
                  <rect
                    key={h}
                    x={cx - 4} y={cy - 4} width={8} height={8}
                    fill="#fff" stroke="#2563eb" strokeWidth={1.5}
                    style={{ cursor: `${h}-resize` }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      onBeginHistoryStep()
                      setDragging({ type: 'resize', shapeId: shape.id, handle: h, origX: sx, origY: sy, origW: sw, origH: sh })
                    }}
                  />
                ))}
                {reroutingConn && hoveredShapeId === shape.id && borderSnap && (
                  <circle cx={borderSnap.x} cy={borderSnap.y} r={SNAP_R} fill="#fff" stroke="#2563eb" strokeWidth={2.5} />
                )}
              </g>
            )
          })}
          {paletteDrag && isEditMode && (() => {
            const { type, x, y } = paletteDrag
            const isNote = type === 'note'
            const isRegion = type === 'region'
            const isOr = type === 'or-annotation'
            const w = isRegion ? 320 : isNote ? 200 : isOr ? 200 : 160
            const h = isRegion ? 240 : isNote ? 160 : isOr ? 40 : 80
            // Match addShape's 20px snap, centered on cursor
            const px = Math.round((x - w / 2) / 20) * 20
            const py = Math.round((y - h / 2) / 20) * 20
            const isShapeType = type === 'shape'
            const fill = isNote ? '#fefce8' : isRegion ? 'rgba(160,175,210,0.08)' : isShapeType ? '#ffffff' : '#eef3fd'
            const strokeColor = isRegion ? '#9aa7c4' : isShapeType ? '#6b7280' : '#5b8dee'
            const rx = isNote ? 4 : isShapeType ? 3 : 10
            const label = isNote ? 'Note' : isRegion ? 'Region' : isOr ? 'OR' : isShapeType ? 'Container' : 'Object'
            return (
              <g style={{ pointerEvents: 'none', opacity: 0.75 }}>
                <rect
                  x={px} y={py} width={w} height={h}
                  rx={rx}
                  fill={fill}
                  stroke={strokeColor}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                />
                <text
                  x={px + w / 2} y={py + h / 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={isShapeType ? '#374151' : '#1e3a8a'}
                  fontSize="12"
                  style={{ userSelect: 'none' }}
                >
                  {label}
                </text>
              </g>
            )
          })()}
        </g>
      </svg>
      {contextMenu && (
        <div className="conn-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button className="conn-context-item" onClick={() => { onReverseConn(contextMenu.connId); setContextMenu(null) }}>Reverse</button>
          <button className="conn-context-item danger" onClick={() => { onDeleteConn(contextMenu.connId); setContextMenu(null) }}>Delete</button>
        </div>
      )}
      <div className="canvas-controls">
        <button className="canvas-ctrl-btn" onClick={() => zoomBy(1.25)}>+</button>
        <button className="canvas-ctrl-btn" onClick={() => zoomBy(0.8)}>-</button>
        <button className="canvas-ctrl-btn" onClick={fitView}>Fit</button>
        <label className="canvas-ctrl-zoom">
          <input
            className="canvas-ctrl-zoom-input"
            type="number"
            min="25"
            max="300"
            step="5"
            value={Math.round(view.scale * 100)}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next)) setZoomPercent(next)
            }}
          />
          <span>%</span>
        </label>
      </div>
    </div>
  )
}
