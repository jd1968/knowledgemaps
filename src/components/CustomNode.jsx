import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useMindMapStore } from '../store/useMindMapStore'

const LEVEL_CONFIG = {
  0: { width: 180, height: null, fontSize: '16px', fontWeight: '700' },
  1: { width: 170, height: null,  fontSize: '14px', fontWeight: '600' },
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

const CONVERT_LABELS = { folder: 'Folder', group: 'Group', note: 'Note', pointer: 'Pointer', submap: '↗ Submap' }

const CustomNode = memo(({ id, data, selected }) => {
  const addChildNode          = useMindMapStore((state) => state.addChildNode)
  const updateNodeData        = useMindMapStore((state) => state.updateNodeData)
  const deleteNode            = useMindMapStore((state) => state.deleteNode)
  const deselectNode          = useMindMapStore((state) => state.deselectNode)
  const setEdgeType           = useMindMapStore((state) => state.setEdgeType)
  const convertToSubmap       = useMindMapStore((state) => state.convertToSubmap)
  const setDescendantsCollapsed = useMindMapStore((state) => state.setDescendantsCollapsed)
  const navigateToSubmap      = useMindMapStore((state) => state.navigateToSubmap)
  const pushHistory           = useMindMapStore((state) => state.pushHistory)
  const selectNode            = useMindMapStore((state) => state.selectNode)
  const isEditMode            = useMindMapStore((state) => state.isEditMode)

  const [hovered, setHovered]             = useState(false)
  const [editing, setEditing]             = useState(false)
  const [draft, setDraft]                 = useState('')
  const [showConvertMenu, setShowConvertMenu] = useState(false)
  const [showAddMenu, setShowAddMenu]     = useState(false)
  const [converting, setConverting]       = useState(false)
  const inputRef       = useRef(null)
  const selectTimerRef = useRef(null)

  const { title, level, l1Color, hasChildren, collapsed, hasCollapsibleDescendants, allDescendantsCollapsed, isSubmap, submapId, hasNotes, nodeType, groupSize, content } = data
  const cfg         = getConfig(level)
  const borderColor = l1Color ?? '#94a3b8'
  const width       = groupSize?.width ?? cfg.width
  const height      = groupSize?.height ?? (nodeType === 'note' || nodeType === 'pointer' ? null : cfg.height)
  const showGroupHeader   = nodeType === 'group' && !!title?.trim()
  const hasPointerContent = nodeType === 'pointer' && content && content !== '<p></p>' && content !== ''

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

  const handleDelete = useCallback(() => {
    if (!confirm(`Delete "${title || 'Untitled'}"?`)) return
    deleteNode(id)
    deselectNode()
  }, [title, id, deleteNode, deselectNode])

  const handleConvert = useCallback(async (newType) => {
    if (newType === nodeType) { setShowConvertMenu(false); return }

    if (newType === 'submap') {
      if (!confirm(`Convert "${title}" to a submap?\n\nIts children will be moved into the new map.`)) return
      setConverting(true)
      const result = await convertToSubmap(id)
      setConverting(false)
      if (!result.success) alert('Failed to convert to submap. Please try again.')
      setShowConvertMenu(false)
      return
    }

    if ((newType === 'note' || newType === 'pointer') && hasChildren) {
      if (!confirm(`"${title}" has children. Converting to ${CONVERT_LABELS[newType]} will prevent adding more children, but existing ones will remain.\n\nContinue?`)) return
    }

    if (newType === 'pointer') {
      updateNodeData(id, { nodeType: 'pointer' })
      setEdgeType(id, 'pointer-edge')
    } else {
      if (nodeType === 'pointer') setEdgeType(id, 'straight-center')
      updateNodeData(id, { nodeType: newType })
    }
    setShowConvertMenu(false)
  }, [nodeType, title, id, hasChildren, convertToSubmap, updateNodeData, setEdgeType])

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
      onMouseLeave={() => { setHovered(false); setShowConvertMenu(false); setShowAddMenu(false) }}
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
        if (!isEditMode) return
        e.stopPropagation()
        clearTimeout(selectTimerRef.current) // cancel pending modal open
        startEditing()
      }}
      style={{
        width,
        ...(height ? { height } : {}),
        display: 'flex',
        flexDirection: 'column',
        background: level === 0
          ? '#3a3a3a'
          : nodeType === 'group'
            ? blendWithWhite(borderColor, 0.04)
            : isSubmap
              ? blendWithWhite(borderColor, 0.08)
            : nodeType === 'note'
              ? 'repeating-linear-gradient(to bottom, #ffffff 0px, #ffffff 17px, #e8edf2 17px, #e8edf2 18px)'
            : nodeType === 'pointer'
              ? blendWithWhite(borderColor, 0.05)
            : '#ffffff',
        border: level === 0
          ? 'none'
          : nodeType === 'note'
            ? `1px solid ${borderColor}90`
            : nodeType === 'group'
              ? `2px solid ${borderColor}90`
            : nodeType === 'pointer'
              ? `1px solid ${borderColor}40`
              : `2px ${isSubmap ? 'dashed' : 'solid'} ${borderColor}`,
        ...(nodeType === 'pointer' ? { borderLeft: `3px solid ${borderColor}` } : {}),
        borderRadius: level === 0 ? '50px' : nodeType === 'note' ? '2px' : nodeType === 'group' ? '12px' : nodeType === 'pointer' ? '8px' : '10px',
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        color: level === 0 ? '#ffffff' : '#0f172a',
        cursor: editing ? 'text' : 'pointer',
        boxShadow: selected
          ? `0 0 0 3px ${borderColor}40, 2px 4px 14px rgba(0,0,0,0.18)`
          : hovered
            ? `0 0 0 2px ${borderColor}70, 2px 4px 10px rgba(0,0,0,0.12)`
            : nodeType === 'note'
              ? '1px 2px 6px rgba(0,0,0,0.09)'
              : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s ease',
        userSelect: 'none',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Handle type="target" position={Position.Left} style={centerHandle} />

      {/* Header — title (or pointer callout layout) */}
      {nodeType === 'pointer' ? (
        <div style={{ flex: 1 }}>
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
                display: 'block',
                width: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: '11px',
                fontWeight: 600,
                color: '#0f172a',
                fontFamily: 'inherit',
                padding: '8px 10px 4px',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <>
              {title?.trim() && (
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a', padding: '8px 10px 4px', lineHeight: '1.3', wordBreak: 'break-word' }}>
                  {title}
                </div>
              )}
              <div
                className="pointer-content"
                style={{ fontSize: '11px', fontWeight: 400, color: '#334155', padding: '0 10px 8px', maxHeight: '120px', overflow: 'hidden', lineHeight: '1.4' }}
                dangerouslySetInnerHTML={{ __html: hasPointerContent ? content : '<p style="margin:0;color:#94a3b8">No content yet</p>' }}
              />
            </>
          )}
        </div>
      ) : (nodeType !== 'group' || showGroupHeader) && (
        <div style={{
          flex: nodeType === 'group' ? '0 0 auto' : 1,
          display: 'flex',
          alignItems: nodeType === 'group' ? 'flex-start' : 'center',
          justifyContent: nodeType === 'group' ? 'flex-start' : 'center',
          padding: nodeType === 'group' ? '8px 12px' : '10px 14px',
          textAlign: nodeType === 'group' ? 'left' : 'center',
          wordBreak: 'break-word',
          lineHeight: '1.35',
          position: 'relative',
          pointerEvents: nodeType === 'group' ? 'none' : 'auto',
          ...(nodeType === 'group'
            ? {
                margin: '6px',
                borderRadius: '8px',
                background: 'transparent',
                border: 'none',
              }
            : {}),
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
                textAlign: nodeType === 'group' ? 'left' : 'center',
                fontFamily: 'inherit',
                lineHeight: 'inherit',
                padding: 0,
              }}
            />
          ) : (
            <span style={nodeType === 'note' && !hasNotes ? { color: '#94a3b8' } : undefined}>
              {title || 'Untitled'}
            </span>
          )}
          {!editing && hasNotes && nodeType !== 'group' && (
            <span style={{
              position: 'absolute',
              top: '4px',
              right: '5px',
              fontSize: '9px',
              color: `${borderColor}90`,
              lineHeight: 1,
              pointerEvents: 'none',
            }}>≡</span>
          )}
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

      {!isSubmap && level !== 0 && hasChildren && (hovered || collapsed) && !editing && isEditMode && nodeType !== 'pointer' && (
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

      {!editing && !collapsed && !isSubmap && nodeType !== 'note' && nodeType !== 'pointer' && isEditMode && (
        <>
          <button
            className="add-child-btn"
            title="Add child node"
            style={{ background: showAddMenu ? borderColor : borderColor }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setShowAddMenu((v) => !v) }}
          >
            +
          </button>

          {showAddMenu && (
            <div
              className="node-add-menu nodrag nopan"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="node-convert-menu-label">Add as</span>
              {['folder', 'group', 'note', 'pointer'].map((t) => (
                <button
                  key={t}
                  className="node-convert-menu-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    const newId = addChildNode(id, t)
                    setShowAddMenu(false)
                    if (newId) selectNode(newId)
                  }}
                >
                  {CONVERT_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!isSubmap && hovered && hasCollapsibleDescendants && !editing && isEditMode && (
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

      {/* Convert-type glyph — top-left, shown on hover for non-root, non-submap nodes */}
      {(hovered || showConvertMenu) && isEditMode && level > 0 && !isSubmap && !editing && (
        <button
          className="node-convert-btn nodrag nopan"
          title="Convert type"
          style={{ background: borderColor }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setShowConvertMenu((v) => !v) }}
        >
          ⇄
        </button>
      )}

      {/* Delete glyph — top-right, shown on hover for non-root nodes */}
      {hovered && isEditMode && level > 0 && !editing && (
        <button
          className="node-delete-btn nodrag nopan"
          title="Delete node"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); handleDelete() }}
        >
          ✕
        </button>
      )}

      {/* Convert menu panel */}
      {showConvertMenu && (
        <div className="node-convert-menu nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
          <span className="node-convert-menu-label">Convert to</span>
          {['folder', 'group', 'note', 'pointer', 'submap'].map((t) => (
            <button
              key={t}
              className="node-convert-menu-item"
              disabled={nodeType === t || converting}
              onClick={(e) => { e.stopPropagation(); handleConvert(t) }}
            >
              {CONVERT_LABELS[t]}
              {nodeType === t ? ' ✓' : ''}
              {converting && t === 'submap' ? '…' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

CustomNode.displayName = 'CustomNode'

export default CustomNode
