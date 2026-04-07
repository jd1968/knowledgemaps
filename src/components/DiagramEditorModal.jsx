import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'

const STARTER_SHAPES = [
  { type: 'object', label: 'Object' },
  { type: 'note', label: 'Note' },
  { type: 'relationship', label: 'Relationship' },
]

export default function DiagramEditorModal({ open, initialData, onCancel, onSave }) {
  const svgRef = useRef(null)
  const [activeTool, setActiveTool] = useState('object')
  const [selectedId, setSelectedId] = useState(null)
  const [pendingConnectionFrom, setPendingConnectionFrom] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [shapes, setShapes] = useState(() => initialData?.shapes || [])
  const [connections, setConnections] = useState(() => initialData?.connections || [])

  useEffect(() => {
    if (!open) return
    setShapes(initialData?.shapes || [])
    setConnections(initialData?.connections || [])
    setSelectedId(null)
    setPendingConnectionFrom(null)
  }, [open, initialData])

  if (!open) return null

  const toSvgPoint = (e) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const addShape = (type, x, y) => {
    const isNote = type === 'note'
    const shape = {
      id: uuidv4(),
      type,
      x: Math.round((x - 80) / 10) * 10,
      y: Math.round((y - 40) / 10) * 10,
      width: isNote ? 220 : 180,
      height: isNote ? 150 : 90,
      label: isNote ? '' : 'Object',
      noteText: isNote ? 'Note...' : '',
    }
    setShapes((prev) => [...prev, shape])
    setSelectedId(shape.id)
  }

  const handleCanvasClick = (e) => {
    if (e.target !== svgRef.current) return
    if (activeTool === 'relationship') {
      setPendingConnectionFrom(null)
      setSelectedId(null)
      return
    }
    const pt = toSvgPoint(e)
    addShape(activeTool, pt.x, pt.y)
  }

  const handleShapeClick = (shape, e) => {
    e.stopPropagation()
    if (activeTool === 'relationship') {
      if (!pendingConnectionFrom) {
        setPendingConnectionFrom(shape.id)
      } else if (pendingConnectionFrom !== shape.id) {
        setConnections((prev) => [...prev, { id: uuidv4(), from: pendingConnectionFrom, to: shape.id }])
        setPendingConnectionFrom(null)
      }
      return
    }
    setSelectedId(shape.id)
  }

  const selected = shapes.find((s) => s.id === selectedId) || null

  const saveDiagram = async () => {
    const svgEl = svgRef.current
    let snapshot = ''
    if (svgEl) {
      const clone = svgEl.cloneNode(true)
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bg.setAttribute('x', '0')
      bg.setAttribute('y', '0')
      bg.setAttribute('width', '100%')
      bg.setAttribute('height', '100%')
      bg.setAttribute('fill', '#f8fafc')
      clone.insertBefore(bg, clone.firstChild)
      const xml = new XMLSerializer().serializeToString(clone)
      snapshot = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
    }
    await onSave?.({ shapes, connections, snapshot })
  }

  return createPortal(
    <div className="diagram-modal-overlay" onMouseMove={(e) => {
      if (!dragging) return
      const pt = toSvgPoint(e)
      setShapes((prev) => prev.map((s) => s.id === dragging.id ? { ...s, x: Math.round((pt.x - dragging.dx) / 10) * 10, y: Math.round((pt.y - dragging.dy) / 10) * 10 } : s))
    }} onMouseUp={() => setDragging(null)}>
      <div className="diagram-modal">
        <div className="diagram-modal__header">
          <strong>Diagram Editor</strong>
          <div>
            <button className="btn btn--secondary btn--sm" onClick={onCancel}>Cancel</button>
            <button className="btn btn--primary btn--sm" onClick={saveDiagram}>Done</button>
          </div>
        </div>
        <div className="diagram-modal__body">
          <aside className="diagram-tools">
            {STARTER_SHAPES.map((tool) => (
              <button key={tool.type} className={`diagram-tool-btn${activeTool === tool.type ? ' diagram-tool-btn--active' : ''}`} onClick={() => setActiveTool(tool.type)}>
                {tool.label}
              </button>
            ))}
          </aside>
          <svg ref={svgRef} className="diagram-canvas" onMouseDown={handleCanvasClick}>
            <defs>
              <pattern id="diagram-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#diagram-grid)" />
            {connections.map((c) => {
              const from = shapes.find((s) => s.id === c.from)
              const to = shapes.find((s) => s.id === c.to)
              if (!from || !to) return null
              return <line key={c.id} x1={from.x + from.width} y1={from.y + from.height / 2} x2={to.x} y2={to.y + to.height / 2} stroke="#64748b" strokeWidth="2" />
            })}
            {shapes.map((shape) => (
              <g key={shape.id} onMouseDown={(e) => {
                if (activeTool === 'relationship') return
                const pt = toSvgPoint(e)
                setDragging({ id: shape.id, dx: pt.x - shape.x, dy: pt.y - shape.y })
                handleShapeClick(shape, e)
              }} onClick={(e) => handleShapeClick(shape, e)}>
                {shape.type === 'note' ? (
                  <>
                    <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx="4" fill="#fef9c3" stroke={selectedId === shape.id ? '#ca8a04' : '#d4c56a'} strokeWidth="2" />
                    <foreignObject x={shape.x + 8} y={shape.y + 8} width={shape.width - 16} height={shape.height - 16}>
                      <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: 12, color: '#57534e', whiteSpace: 'pre-wrap' }}>{shape.noteText || 'Note...'}</div>
                    </foreignObject>
                  </>
                ) : (
                  <>
                    <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx="10" fill="#eef3fd" stroke={selectedId === shape.id ? '#3b82f6' : '#93c5fd'} strokeWidth="2" />
                    <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} textAnchor="middle" dominantBaseline="middle" fill="#1e3a8a" fontSize="13">{shape.label || 'Object'}</text>
                  </>
                )}
              </g>
            ))}
          </svg>
          <aside className="diagram-details">
            {!selected && <p>Select a shape to edit.</p>}
            {selected && selected.type === 'note' && (
              <>
                <label>Note</label>
                <textarea value={selected.noteText || ''} onChange={(e) => setShapes((prev) => prev.map((s) => s.id === selected.id ? { ...s, noteText: e.target.value } : s))} />
              </>
            )}
            {selected && selected.type !== 'note' && (
              <>
                <label>Label</label>
                <input value={selected.label || ''} onChange={(e) => setShapes((prev) => prev.map((s) => s.id === selected.id ? { ...s, label: e.target.value } : s))} />
              </>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body
  )
}
