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

// Blend a hex colour with white at the given opacity (0–1), returning an opaque rgb()
const blendWithWhite = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(255 * (1 - alpha) + r * alpha)}, ${Math.round(255 * (1 - alpha) + g * alpha)}, ${Math.round(255 * (1 - alpha) + b * alpha)})`
}

const CustomNode = memo(({ id, data, selected }) => {
  const addChildNode = useMindMapStore((state) => state.addChildNode)
  const updateNodeData = useMindMapStore((state) => state.updateNodeData)
  const setDescendantsCollapsed = useMindMapStore((state) => state.setDescendantsCollapsed)
  const navigateToSubmap = useMindMapStore((state) => state.navigateToSubmap)
  const pushHistory = useMindMapStore((state) => state.pushHistory)
  const selectNode = useMindMapStore((state) => state.selectNode)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const selectTimerRef = useRef(null)
  const { title, level, l1Color, hasChildren, collapsed, hasCollapsibleDescendants, allDescendantsCollapsed, isSubmap, submapId, hasNotes, hasOverview } = data
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
      onPointerDown={(e) => {
        const startX = e.clientX
        const startY = e.clientY
        document.addEventListener('pointerup', (e2) => {
          const dx = e2.clientX - startX
          const dy = e2.clientY - startY
          if (dx * dx + dy * dy < 25) {
            clearTimeout(selectTimerRef.current)
            selectTimerRef.current = setTimeout(() => selectNode(id), 300)
          }
        }, { once: true })
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        clearTimeout(selectTimerRef.current) // cancel pending modal open
        startEditing()
      }}
      style={{
        width: cfg.width,
        ...(cfg.height ? { height: cfg.height } : {}),
        display: 'flex',
        flexDirection: 'column',
        background: isSubmap ? blendWithWhite(borderColor, 0.12) : '#ffffff',
        border: `2px ${isSubmap ? 'dashed' : 'solid'} ${borderColor}`,
        borderRadius: '10px',
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        color: '#0f172a',
        cursor: editing ? 'text' : 'pointer',
        boxShadow: selected
          ? `0 0 0 3px ${borderColor}40, 0 4px 12px rgba(0,0,0,0.10)`
          : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s ease',
        userSelect: 'none',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Handle type="target" position={Position.Left} style={centerHandle} />

      {/* Header — title */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 14px',
        textAlign: 'center',
        wordBreak: 'break-word',
        lineHeight: '1.35',
      }}>
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
              e.stopPropagation()
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
      </div>

      {/* Footer — content indicators */}
      {!editing && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
          height: 36,
          flexShrink: 0,
          padding: '0 8px',
          background: blendWithWhite(borderColor, 0.12),
          borderTop: `1px solid ${borderColor}30`,
          borderRadius: '0 0 8px 8px',
          fontSize: '24px',
          lineHeight: 1,
          opacity: 0.5,
          pointerEvents: 'none',
        }}>
          {hasOverview && <span title="Has overview">◎</span>}
          {hasNotes && <span title="Has notes">≡</span>}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={centerHandle} />

      {isSubmap && submapId && (
        <button
          className="submap-open-btn nodrag nopan"
          title="Open submap"
          style={{ background: borderColor }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); navigateToSubmap(submapId) }}
        >
          ↗
        </button>
      )}

      {!isSubmap && level !== 0 && hasChildren && (hovered || collapsed) && !editing && (
        <button
          className="collapse-btn nodrag nopan"
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: borderColor }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            updateNodeData(id, { collapsed: !collapsed })
          }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      )}

      {!editing && !collapsed && !isSubmap && (
        <button
          className="add-child-btn"
          title="Add child node"
          style={{ background: borderColor }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            addChildNode(id)
          }}
        >
          +
        </button>
      )}

      {!isSubmap && hovered && hasCollapsibleDescendants && !editing && (
        <button
          className="collapse-all-btn nodrag nopan"
          title={allDescendantsCollapsed ? 'Expand all' : 'Collapse all'}
          style={{ background: borderColor }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setDescendantsCollapsed(id, !allDescendantsCollapsed)
          }}
        >
          {allDescendantsCollapsed ? '▸▸' : '▾▾'}
        </button>
      )}
    </div>
  )
})

CustomNode.displayName = 'CustomNode'

export default CustomNode
