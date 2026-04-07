import { useRef, useState, useCallback, useEffect } from 'react'
import {
  closestBoundaryPoint,
  normToPoint,
  makePath,
  makeStraightPath,
  makeElbowPath,
  generateElbowWaypoints,
  rectifyElbowWaypoints,
  outwardNormal,
} from './geometry.js'

const SNAP_R = 5
const ENDPOINT_R = 5
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
  if (!fromNorm || !toNorm) return { d: makeStraightPath(fp, tp), fp, tp }
  if (conn.style === 'elbow') {
    let waypoints = conn.waypoints != null ? conn.waypoints : null
    if (waypoints && waypoints.length === 0) {
      const fromH = Math.abs(fromNorm.nx) > Math.abs(fromNorm.ny)
      const isOrthogonal = fromH ? Math.abs(fp.y - tp.y) < 2 : Math.abs(fp.x - tp.x) < 2
      if (!isOrthogonal) waypoints = generateElbowWaypoints(fp, fromNorm, tp, toNorm)
    } else if (!waypoints) {
      waypoints = generateElbowWaypoints(fp, fromNorm, tp, toNorm)
    }
    waypoints = rectifyElbowWaypoints(fp, fromNorm, tp, toNorm, waypoints)
    return { d: makeElbowPath(fp, waypoints, tp), fp, tp, rectifiedWaypoints: waypoints }
  }
  return { d: makePath(fp, fromNorm, tp, toNorm), fp, tp }
}

export default function CanvasAdvanced({
  shapes, connections, selectedId, selectedConnId,
  onAddShape, onUpdateShape, onDeleteShape,
  onAddConnection, onAddStandaloneRelationship, onUpdateConnection, onSelectShape,
  onSelectConn, onUpdateConnWaypoints, onDeleteConn, onReverseConn,
  onBeginHistoryStep, onUpdateConnLabelOffset, fitOnMount = false,
}) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [connecting, setConnecting] = useState(null)
  const [reroutingConn, setReroutingConn] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [hoveredShapeId, setHoveredShapeId] = useState(null)
  const [hoveredConnId, setHoveredConnId] = useState(null)
  const [borderSnap, setBorderSnap] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [draggingWp, setDraggingWp] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [marquee, setMarquee] = useState(null)
  const [multiSelectedIds, setMultiSelectedIds] = useState([])
  const [draggingLabel, setDraggingLabel] = useState(null)

  useEffect(() => {
    const onKey = (e) => {
      if (editingId) return
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
  }, [selectedId, selectedConnId, editingId, onDeleteShape, onDeleteConn, multiSelectedIds])

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('mousedown', closeContextMenu)
    return () => window.removeEventListener('mousedown', closeContextMenu)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('shapeType')
    if (!type) return
    const pt = getSVGPoint(svgRef.current, e)
    const world = screenToWorld(pt, view)
    if (type === 'relationship') {
      const snappedX = Math.round(world.x / 20) * 20
      const snappedY = Math.round(world.y / 20) * 20
      onAddStandaloneRelationship(snappedX, snappedY)
      return
    }
    const x = Math.max(0, world.x - 80)
    const y = Math.max(0, world.y - 40)
    onAddShape(type, Math.round(x / 20) * 20, Math.round(y / 20) * 20)
  }, [onAddShape, onAddStandaloneRelationship, view])

  const handleSVGMouseMove = useCallback((e) => {
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
  }, [marquee, draggingLabel, draggingWp, dragging, hoveredShapeId, shapes, reroutingConn, onUpdateConnLabelOffset, connections, onUpdateConnWaypoints, onUpdateShape, view])

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
    setDragging(null); setDraggingWp(null); setDraggingLabel(null); if (connecting) setConnecting(null)
  }, [reroutingConn, onUpdateConnection, mousePos, connecting, marquee, shapes, onSelectShape, onSelectConn])

  const handleShapeMouseDown = useCallback((e, shape) => {
    if (connecting || reroutingConn) return
    e.stopPropagation()
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
  }, [connecting, reroutingConn, view, multiSelectedIds, shapes, onBeginHistoryStep, onSelectShape, onSelectConn])

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
    setContextMenu(null)
    if (e.target === svgRef.current) {
      onSelectShape(null); onSelectConn(null); setConnecting(null); setReroutingConn(null); setMultiSelectedIds([])
      if (e.button === 0) {
        const pt = screenToWorld(getSVGPoint(svgRef.current, e), view)
        setMarquee({ startX: pt.x, startY: pt.y, x: pt.x, y: pt.y })
      }
    }
  }, [onSelectShape, onSelectConn, view])

  const handleDoubleClick = useCallback((e, shape) => {
    e.stopPropagation(); setEditingId(shape.id); setEditingLabel(shape.type === 'note' ? (shape.noteText || '') : (shape.label || ''))
  }, [])
  const commitEdit = useCallback(() => {
    if (!editingId) return
    const editingShape = shapes.find((s) => s.id === editingId)
    if (editingShape?.type === 'note') onUpdateShape(editingId, { noteText: editingLabel })
    else onUpdateShape(editingId, { label: editingLabel || 'Label' })
    setEditingId(null)
  }, [editingId, editingLabel, onUpdateShape, shapes])
  const startReroute = useCallback((e, connId, end) => { e.stopPropagation(); setConnecting(null); setDragging(null); setReroutingConn({ connId, end }) }, [])
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
  useEffect(() => { if (fitOnMount) requestAnimationFrame(fitView) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} className="diagram-canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <svg
        ref={svgRef}
        className="diagram-canvas"
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onMouseMove={handleSVGMouseMove}
        onMouseUp={handleSVGMouseUp}
        onMouseDown={handleSVGMouseDown}
      >
        <defs>
          <pattern id="grid" width={20 * (view.scale || 1)} height={20 * (view.scale || 1)} patternUnits="userSpaceOnUse" x={(view.x || 0) % (20 * (view.scale || 1))} y={(view.y || 0) % (20 * (view.scale || 1))}>
            <path d={`M ${20 * view.scale} 0 L 0 0 0 ${20 * view.scale}`} fill="none" stroke="#e0e5f2" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" style={{ pointerEvents: 'none' }} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {connections.map((conn) => {
            const result = getConnPath(conn, shapes)
            if (!result) return null
            const { d } = result
            return (
              <g key={conn.id} onMouseEnter={() => setHoveredConnId(conn.id)} onMouseLeave={() => setHoveredConnId(null)}>
                <path d={d} fill="none" stroke="transparent" strokeWidth="12" onClick={(e) => { e.stopPropagation(); onSelectConn(conn.id); onSelectShape(null) }} onContextMenu={(e) => openConnectionMenu(e, conn.id)} />
                <path d={d} fill="none" stroke={selectedConnId === conn.id ? '#2563eb' : '#64748b'} strokeWidth={selectedConnId === conn.id ? 2.5 : 2} />
              </g>
            )
          })}
          {shapes.map((shape) => (
            <g key={shape.id} onMouseEnter={() => setHoveredShapeId(shape.id)} onMouseLeave={() => { setHoveredShapeId(null); setBorderSnap(null) }}>
              <rect
                x={shape.x} y={shape.y} width={shape.width} height={shape.height}
                rx={shape.type === 'note' ? 4 : 10}
                fill={shape.type === 'note' ? '#fefce8' : (OBJECT_TYPE_FILLS[shape.objectType] || OBJECT_TYPE_FILLS.Standard)}
                stroke={selectedId === shape.id ? '#2563eb' : '#93b4f5'}
                strokeWidth="2"
                onMouseDown={(e) => handleShapeMouseDown(e, shape)}
                onMouseUp={(e) => handleShapeMouseUp(e, shape)}
                onDoubleClick={(e) => handleDoubleClick(e, shape)}
              />
              {editingId === shape.id ? (
                <foreignObject x={shape.x + 8} y={shape.y + 8} width={Math.max(0, shape.width - 16)} height={Math.max(0, shape.height - 16)}>
                  <textarea xmlns="http://www.w3.org/1999/xhtml" className="diagram-inline-input" autoFocus value={editingLabel} onChange={(e) => setEditingLabel(e.target.value)} onBlur={commitEdit} />
                </foreignObject>
              ) : (
                <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} textAnchor="middle" dominantBaseline="middle" fill="#1e3a8a" fontSize="12">
                  {shape.type === 'note' ? (shape.noteText || 'Note') : (shape.label || 'Object')}
                </text>
              )}
              {reroutingConn && hoveredShapeId === shape.id && borderSnap && (
                <circle cx={borderSnap.x} cy={borderSnap.y} r={SNAP_R} fill="#fff" stroke="#2563eb" strokeWidth={2.5} />
              )}
            </g>
          ))}
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
        <div className="canvas-ctrl-zoom">{Math.round(view.scale * 100)}%</div>
      </div>
    </div>
  )
}
