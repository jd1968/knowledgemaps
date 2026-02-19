import { memo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useMindMapStore } from '../store/useMindMapStore'

const LEVEL_CONFIG = {
  0: { width: 200, fontSize: '15px', fontWeight: '700' },
  1: { width: 170, fontSize: '14px', fontWeight: '600' },
  2: { width: 150, fontSize: '13px', fontWeight: '500' },
  3: { width: 130, fontSize: '12px', fontWeight: '400' },
}

const getConfig = (level) => LEVEL_CONFIG[Math.min(Math.max(level, 0), 3)]

const CustomNode = memo(({ id, data, selected }) => {
  const addChildNode = useMindMapStore((state) => state.addChildNode)
  const [hovered, setHovered] = useState(false)
  const { title, level, l1Color } = data
  const cfg = getConfig(level)
  const borderColor = l1Color ?? '#94a3b8'

  // Invisible handles centred on the node — edges connect to the node centre
  const centerHandle = {
    width: 1,
    height: 1,
    minWidth: 'unset',
    minHeight: 'unset',
    background: 'transparent',
    border: 'none',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: cfg.width,
        background: '#ffffff',
        border: `2px solid ${borderColor}`,
        borderRadius: '10px',
        padding: '10px 14px',
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        color: '#0f172a',
        textAlign: 'center',
        cursor: 'pointer',
        boxShadow: selected
          ? `0 0 0 3px ${borderColor}40, 0 4px 12px rgba(0,0,0,0.10)`
          : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s ease',
        userSelect: 'none',
        wordBreak: 'break-word',
        lineHeight: '1.35',
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={centerHandle} />
      <span>{title || 'Untitled'}</span>
      <Handle type="source" position={Position.Right} style={centerHandle} />

      {hovered && (
        <button
          className="add-child-btn"
          title="Add child node"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            addChildNode(id)
          }}
        >
          +
        </button>
      )}
    </div>
  )
})

CustomNode.displayName = 'CustomNode'

export default CustomNode
