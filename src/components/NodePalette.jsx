import { useMindMapStore } from '../store/useMindMapStore'

const NODE_TEMPLATES = [
  {
    level: 1,
    label: 'Main Topic',
    desc: 'Level 1',
    bg: '#dbeafe',
    border: '#3b82f6',
    text: '#1e3a8a',
  },
  {
    level: 2,
    label: 'Subtopic',
    desc: 'Level 2',
    bg: '#d1fae5',
    border: '#10b981',
    text: '#064e3b',
  },
  {
    level: 3,
    label: 'Detail',
    desc: 'Level 3',
    bg: '#ede9fe',
    border: '#7c3aed',
    text: '#3b0764',
  },
]

const NodeTemplate = ({ level, label, desc, bg, border, text, isEditMode }) => {
  const onDragStart = (e) => {
    if (!isEditMode) return
    e.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({ level, title: label })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      draggable={isEditMode}
      onDragStart={onDragStart}
      className="node-template"
      style={{
        background: bg,
        border: `2px solid ${border}`,
        color: text,
        opacity: isEditMode ? 1 : 0.55,
        cursor: isEditMode ? 'grab' : 'not-allowed',
      }}
    >
      <span className="node-template-label">{label}</span>
      <span className="node-template-desc">{desc} · drag to add</span>
    </div>
  )
}

const NodePalette = () => {
  const isEditMode = useMindMapStore((s) => s.isEditMode)

  return (
    <div className="node-palette">
      <div className="palette-title">Add Nodes</div>
      <p className="palette-hint">
        {isEditMode ? 'Drag a node onto the canvas to add it' : 'Enable Edit Mode to add nodes'}
      </p>

      {NODE_TEMPLATES.map((t) => (
        <NodeTemplate key={t.level} {...t} isEditMode={isEditMode} />
      ))}

      <div className="palette-tip">
        <strong>Connect nodes:</strong>
        <br />
        Drag from a handle (circle) on one node to a handle on another.
      </div>
    </div>
  )
}

export default NodePalette
