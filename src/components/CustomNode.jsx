import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useMindMapStore } from '../store/useMindMapStore'

const LEVEL_CONFIG = {
  0: { width: 200, height: 200, fontSize: '15px', fontWeight: '700' },
  1: { width: 170, height: 100, fontSize: '14px', fontWeight: '600' },
  2: { width: 150, height: null,  fontSize: '13px', fontWeight: '500' },
  3: { width: 130, height: null,  fontSize: '12px', fontWeight: '400' },
}

const getConfig = (level) => LEVEL_CONFIG[Math.min(Math.max(level, 0), 3)]

const CustomNode = memo(({ id, data, selected }) => {
  const addChildNode = useMindMapStore((state) => state.addChildNode)
  const updateNodeData = useMindMapStore((state) => state.updateNodeData)
  const pushHistory = useMindMapStore((state) => state.pushHistory)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const { title, level, l1Color, hasChildren, collapsed } = data
  const cfg = getConfig(level)
  const borderColor = l1Color ?? '#94a3b8'

  const startEditing = useCallback(() => {
    setDraft(title || '')
    setEditing(true)
  }, [title])

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== title) {
      pushHistory()
      updateNodeData(id, { title: trimmed })
    }
    setEditing(false)
  }, [draft, title, id, pushHistory, updateNodeData])

  const cancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  // Focus and select-all when edit mode opens
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

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
      onDoubleClick={(e) => { e.stopPropagation(); startEditing() }}
      style={{
        width: cfg.width,
        ...(cfg.height ? { height: cfg.height } : {}),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff',
        border: `2px solid ${borderColor}`,
        borderRadius: '10px',
        padding: '10px 14px',
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        color: '#0f172a',
        textAlign: 'center',
        cursor: editing ? 'text' : 'pointer',
        boxShadow: selected
          ? `0 0 0 3px ${borderColor}40, 0 4px 12px rgba(0,0,0,0.10)`
          : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s ease',
        userSelect: 'none',
        wordBreak: 'break-word',
        lineHeight: '1.35',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Handle type="target" position={Position.Left} style={centerHandle} />

      {editing ? (
        <input
          ref={inputRef}
          className="nodrag nopan"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
            e.stopPropagation() // prevent ReactFlow intercepting Delete/Backspace
          }}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            color: 'inherit',
            textAlign: 'center',
            fontFamily: 'inherit',
            lineHeight: 'inherit',
            padding: 0,
          }}
        />
      ) : (
        <span>{title || 'Untitled'}</span>
      )}

      <Handle type="source" position={Position.Right} style={centerHandle} />

      {level !== 0 && hasChildren && (hovered || collapsed) && !editing && (
        <button
          className="collapse-btn nodrag nopan"
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: borderColor }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            updateNodeData(id, { collapsed: !collapsed })
          }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      )}

      {hovered && !editing && !collapsed && (
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
