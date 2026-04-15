import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '../lib/supabase'
import DiagramSidebar from './diagram/Sidebar'
import DiagramToolbar from './diagram/Toolbar'
import DiagramDetailsPanel from './diagram/DetailsPanel'
import { DEFAULT_SHAPE_LIBRARY } from './diagram/shapeLibrary'
import CanvasAdvanced from './diagram/CanvasAdvanced'

export default function DiagramPage() {
  const { diagramId } = useParams()
  const navigate = useNavigate()
  const svgRef = useRef(null)
  const autosaveTimer = useRef(null)

  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState('saved') // 'saved' | 'saving' | 'unsaved'
  const [isEditMode, setIsEditMode] = useState(false)
  const [name, setName] = useState('Untitled Diagram')
  const [editingName, setEditingName] = useState(false)
  const [shapes, setShapes] = useState([])
  const [connections, setConnections] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedConnId, setSelectedConnId] = useState(null)
  const [isReroutingConn, setIsReroutingConn] = useState(false)
  const [isEditingConnLabel, setIsEditingConnLabel] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('diagrams')
        .select('id, name, data')
        .eq('id', diagramId)
        .single()
      if (error || !data) {
        navigate('/', { replace: true })
        return
      }
      setName(data.name || 'Untitled Diagram')
      setShapes(data.data?.shapes || [])
      setConnections(data.data?.connections || [])
      setLoading(false)
    })()
  }, [diagramId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (currentShapes, currentConnections, currentName) => {
    setSaveStatus('saving')
    let snapshot = ''
    const svgEl = svgRef.current?.querySelector?.('svg')
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
    await supabase
      .from('diagrams')
      .update({ name: currentName, data: { shapes: currentShapes, connections: currentConnections } })
      .eq('id', diagramId)
    setSaveStatus('saved')
  }, [diagramId])

  // Autosave 2s after any change (skip during initial load)
  useEffect(() => {
    if (loading) return
    setSaveStatus('unsaved')
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => save(shapes, connections, name), 2000)
    return () => clearTimeout(autosaveTimer.current)
  }, [shapes, connections, name]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    clearTimeout(autosaveTimer.current)
    save(shapes, connections, name)
  }

  if (loading) return <div className="diagram-page-loading">Loading…</div>

  const takeSnapshot = () => ({
    shapes: JSON.parse(JSON.stringify(shapes)),
    connections: JSON.parse(JSON.stringify(connections)),
  })
  const pushHistory = () => {
    setPast((p) => [...p, takeSnapshot()].slice(-100))
    setFuture([])
  }
  const undo = () => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [...f, takeSnapshot()])
    setShapes(prev.shapes)
    setConnections(prev.connections)
  }
  const redo = () => {
    if (future.length === 0) return
    const next = future[future.length - 1]
    setFuture((f) => f.slice(0, -1))
    setPast((p) => [...p, takeSnapshot()])
    setShapes(next.shapes)
    setConnections(next.connections)
  }

  const addShape = (type, x, y) => {
    pushHistory()
    const isNote = type === 'note'
    const isRegion = type === 'region'
    const isOr = type === 'or-annotation'
    const shape = {
      id: uuidv4(),
      type,
      x: Math.round(x / 20) * 20,
      y: Math.round(y / 20) * 20,
      width: isRegion ? 320 : isNote ? 200 : isOr ? 200 : 160,
      height: isRegion ? 240 : isNote ? 160 : isOr ? 40 : 80,
      label: isRegion ? 'Region' : isOr ? 'OR' : (isNote ? '' : type === 'shape' ? 'Container' : 'Object'),
      noteText: '',
      objectType: 'Standard',
    }
    setShapes((prev) => [...prev, shape])
    setSelectedId(shape.id)
  }

  const selected = shapes.find((s) => s.id === selectedId) || null
  const selectedConn = connections.find((c) => c.id === selectedConnId) || null

  return (
    <div className="diagram-page">
      <div className="diagram-page__crumbs">
        <button className="btn btn--secondary btn--sm" onClick={() => navigate('/', { state: { activeTab: 'diagrams' } })}>← Home</button>
        {editingName ? (
          <input
            className="diagram-page__name-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false) }}
          />
        ) : (
          <button className="diagram-page__crumb-label diagram-page__crumb-label--btn" onClick={() => setEditingName(true)} title="Click to rename">
            {name}
          </button>
        )}
      </div>
      <DiagramToolbar
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onSave={handleSave}
        saveStatus={saveStatus}
        isEditMode={isEditMode}
        onToggleEditMode={() => {
          setIsEditMode((prev) => {
            const next = !prev
            if (!next) {
              setSelectedConnId(null)
              setIsPanelOpen(false)
            }
            return next
          })
        }}
      />
      <div className="diagram-modal">
        <div className="diagram-modal__header">
          <strong>{name}</strong>
        </div>
        <div className={`diagram-modal__body ${isEditMode ? 'diagram-modal__body--edit' : 'diagram-modal__body--view'}`}>
          {isEditMode && <DiagramSidebar shapeLibrary={DEFAULT_SHAPE_LIBRARY} />}
          <div ref={svgRef} style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CanvasAdvanced
              shapes={shapes}
              connections={connections}
              selectedId={selectedId}
              selectedConnId={selectedConnId}
              onAddShape={addShape}
              onUpdateShape={(id, updates) => setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)))}
              onBeginHistoryStep={pushHistory}
              onDeleteShape={(id) => { pushHistory(); setShapes((prev) => prev.filter((s) => s.id !== id)); setConnections((prev) => prev.filter((c) => c.fromShapeId !== id && c.toShapeId !== id)) }}
              onAddConnection={(fromShapeId, fromNorm, toShapeId, toNorm) => {
                pushHistory()
                const id = uuidv4()
                setConnections((prev) => [...prev, { id, fromShapeId, fromNorm, toShapeId, toNorm, style: 'elbow', relType: 'lookup', fromLabel: 'from', toLabel: 'to', waypoints: [] }])
                setSelectedId(null)
                setSelectedConnId(id)
              }}
              onAddStandaloneRelationship={(x, y) => {
                pushHistory()
                const id = uuidv4()
                setConnections((prev) => [...prev, { id, fromShapeId: null, fromNorm: null, toShapeId: null, toNorm: null, fromFree: { x: x - 80, y }, toFree: { x: x + 80, y }, style: 'elbow', relType: 'lookup', fromLabel: 'from', toLabel: 'to', waypoints: [] }])
                setSelectedId(null)
                setSelectedConnId(id)
              }}
              onUpdateConnection={(id, end, newShapeId, newNorm, keepWaypoints = false, freePoint = null) => {
                pushHistory()
                setConnections((prev) => prev.map((c) => {
                  if (c.id !== id) return c
                  if (end === 'from') return newShapeId ? { ...c, fromShapeId: newShapeId, fromNorm: newNorm, fromFree: null } : { ...c, fromShapeId: null, fromNorm: null, fromFree: freePoint || c.fromFree }
                  return newShapeId ? { ...c, toShapeId: newShapeId, toNorm: newNorm, toFree: null } : { ...c, toShapeId: null, toNorm: null, toFree: freePoint || c.toFree }
                }))
              }}
              onSelectShape={(id) => { setSelectedId(id); if (id != null) setSelectedConnId(null) }}
              onSelectConn={(id) => { setSelectedConnId(id); if (id != null) setSelectedId(null) }}
              onOpenPanel={() => setIsPanelOpen(true)}
              onUpdateConn={(id, updates) => setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))}
              onUpdateConnWaypoints={(id, waypoints) => setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, waypoints } : c)))}
              onUpdateConnLabelOffset={(id, end, offset) => setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, [end === 'from' ? 'fromLabelOffset' : 'toLabelOffset']: offset } : c)))}
              onDeleteConn={(id) => { pushHistory(); setConnections((prev) => prev.filter((c) => c.id !== id)); setSelectedConnId(null) }}
              onReverseConn={(id) => { pushHistory(); setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, fromShapeId: c.toShapeId, fromNorm: c.toNorm, toShapeId: c.fromShapeId, toNorm: c.fromNorm } : c))) }}
              onRerouteStateChange={setIsReroutingConn}
              onLabelEditStateChange={setIsEditingConnLabel}
              isEditMode={isEditMode}
              fitOnMount={false}
            />
          </div>
          <DiagramDetailsPanel
            selectedShape={selected}
            selectedConn={selectedConn}
            shapes={shapes}
            onUpdateShape={(id, updates) => { pushHistory(); setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s))) }}
            onUpdateConn={(id, updates) => { pushHistory(); setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c))) }}
            onClose={() => { setSelectedId(null); setSelectedConnId(null); setIsPanelOpen(false) }}
            onDeleteShape={(id) => { pushHistory(); setShapes((prev) => prev.filter((s) => s.id !== id)); setConnections((prev) => prev.filter((c) => c.fromShapeId !== id && c.toShapeId !== id)); setSelectedId(null); setIsPanelOpen(false) }}
            onDeleteConn={(id) => { pushHistory(); setConnections((prev) => prev.filter((c) => c.id !== id)); setSelectedConnId(null); setIsPanelOpen(false) }}
            suspendOpen={isReroutingConn || isEditingConnLabel}
            panelOpen={isPanelOpen}
            isEditMode={isEditMode}
          />
        </div>
      </div>
    </div>
  )
}
