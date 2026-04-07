import { useMindMapStore } from '../store/useMindMapStore'

const NodeIcon = () => (
  <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
    <rect x="1" y="1" width="26" height="14" rx="7" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const ImageIcon = () => (
  <svg width="24" height="22" viewBox="0 0 24 22" fill="none">
    <rect x="1" y="1" width="22" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7" cy="7.5" r="2" fill="currentColor" opacity="0.6" />
    <path d="M1 16l6-5 4 4 4-4 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
)

const NoteIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <path d="M2 2h18v14l-4 4H2V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M16 16v4l4-4h-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <line x1="5" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="5" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="5" y1="15" x2="12" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const TextIcon = () => (
  <svg width="24" height="16" viewBox="0 0 24 16" fill="none">
    <text x="0" y="13" fontFamily="serif" fontSize="16" fontWeight="bold" fill="currentColor">Aa</text>
  </svg>
)

const DiagramIcon = () => (
  <svg width="24" height="22" viewBox="0 0 24 22" fill="none">
    <rect x="1" y="1" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <rect x="14" y="1" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <rect x="7.5" y="14" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10 4.5h4M12 8v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const ObjectIcon = () => (
  <svg width="24" height="18" viewBox="0 0 24 18" fill="none">
    <rect x="1.5" y="1.5" width="21" height="15" rx="6" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const RelationshipIcon = () => (
  <svg width="24" height="18" viewBox="0 0 24 18" fill="none">
    <line x1="4" y1="9" x2="20" y2="9" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="4" cy="9" r="2" fill="currentColor" />
    <circle cx="20" cy="9" r="2" fill="currentColor" />
  </svg>
)

const ITEMS = [
  { type: 'node',  label: 'Node',  Icon: NodeIcon },
  { type: 'object', label: 'Object', Icon: ObjectIcon },
  { type: 'relationship', label: 'Relationship', Icon: RelationshipIcon },
  { type: 'diagram', label: 'Diagram', Icon: DiagramIcon },
  { type: 'image', label: 'Image', Icon: ImageIcon },
  { type: 'note',  label: 'Note',  Icon: NoteIcon },
  { type: 'text',  label: 'Text',  Icon: TextIcon },
]

const ToolboxItem = ({ type, label, Icon, isEditMode, isActive }) => {
  const setPendingToolboxType = useMindMapStore((s) => s.setPendingToolboxType)

  return (
    <div
      className={`toolbox-item${!isEditMode ? ' toolbox-item--disabled' : ''}${isActive ? ' toolbox-item--active' : ''}`}
      title={isEditMode ? `Click then click canvas to place ${label}` : 'Enable Edit Mode to add items'}
      onPointerDown={(e) => {
        if (!isEditMode) return
        e.preventDefault()
        setPendingToolboxType(type)
      }}
    >
      <span className="toolbox-item-icon"><Icon /></span>
      <span className="toolbox-item-name">{label}</span>
    </div>
  )
}

const Toolbox = () => {
  const isEditMode          = useMindMapStore((s) => s.isEditMode)
  const pendingToolboxType  = useMindMapStore((s) => s.pendingToolboxType)

  return (
    <div className="toolbox">
      {ITEMS.map((item) => (
        <ToolboxItem
          key={item.type}
          {...item}
          isEditMode={isEditMode}
          isActive={pendingToolboxType === item.type}
        />
      ))}
    </div>
  )
}

export default Toolbox
