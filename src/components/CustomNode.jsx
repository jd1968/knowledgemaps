import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { useNavigate } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import SubmapChoiceModal from './SubmapChoiceModal'
import { NodeIconDisplay, NodeIconUpload } from './NodeIcon'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents, urlTransform } from './MarkdownEditor'

const LEVEL_CONFIG = {
  0: { width: 220, height: null, fontSize: '22px', fontWeight: '700' },
  1: { width: 190, height: null,  fontSize: '18px', fontWeight: '600' },
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

const CONVERT_LABELS = { node: 'Node', pointer: 'Pointer', submap: '↗ Submap' }

const CustomNode = memo(({ id, data, selected }) => {
  const setOpenMenuNodeId     = useMindMapStore((state) => state.setOpenMenuNodeId)
  const addChildNode          = useMindMapStore((state) => state.addChildNode)
  const updateNodeData        = useMindMapStore((state) => state.updateNodeData)
  const deleteNode            = useMindMapStore((state) => state.deleteNode)
  const deselectNode          = useMindMapStore((state) => state.deselectNode)
  const setEdgeType           = useMindMapStore((state) => state.setEdgeType)
  const convertToSubmap       = useMindMapStore((state) => state.convertToSubmap)
  const pushHistory           = useMindMapStore((state) => state.pushHistory)
  const selectNode            = useMindMapStore((state) => state.selectNode)
  const openNodeModal         = useMindMapStore((state) => state.openNodeModal)
  const isEditMode            = useMindMapStore((state) => state.isEditMode)
  const reparentNode          = useMindMapStore((state) => state.reparentNode)
  const reparentSourceNodeId  = useMindMapStore((state) => state.reparentSourceNodeId)
  const setReparentSourceNodeId = useMindMapStore((state) => state.setReparentSourceNodeId)
  const clearReparentMode     = useMindMapStore((state) => state.clearReparentMode)
  const currentMapId          = useMindMapStore((state) => state.currentMapId)
  const currentMapName        = useMindMapStore((state) => state.currentMapName)
  const breadcrumbs           = useMindMapStore((state) => state.breadcrumbs)
  const isDirty               = useMindMapStore((state) => state.isDirty)
  const saveMap               = useMindMapStore((state) => state.saveMap)
  const scheduleAutosave      = useMindMapStore((state) => state.scheduleAutosave)
  const navigate              = useNavigate()

  const [hovered, setHovered]             = useState(false)
  const [editing, setEditing]             = useState(false)
  const [draft, setDraft]                 = useState('')
  const [showConvertMenu, setShowConvertMenu] = useState(false)
  const [converting, setConverting]       = useState(false)
  const [showSubmapChoice, setShowSubmapChoice] = useState(false)
  const [menuHovered, setMenuHovered]     = useState(false)
  const inputRef       = useRef(null)
  const selectTimerRef = useRef(null)
  const nodeRef        = useRef(null)
  const menuHideTimerRef = useRef(null)

  const { title, level, l1Color, hasChildren, isSubmap, submapId, hasNotes, nodeType, groupSize, content, isTodo = false, iconUrl = '', imageUrl = '', imageBorder = false, textSize = 'm', showContents = false } = data
  const cfg         = getConfig(level)
  const borderColor = l1Color ?? '#94a3b8'
  const TEXT_SIZES  = { s: 14, m: 22, l: 36 }
  const isParent    = !!groupSize
  // Depth tint only for parent nodes; each level adds 0.04, min 0.05
  const bgAlpha     = isParent ? 0.05 + Math.max(0, level - 1) * 0.04 : 0
  const width       = nodeType === 'text' ? 'auto' : (groupSize?.width ?? '100%')
  const height      = (nodeType === 'pointer' || nodeType === 'text') ? null : (groupSize?.height ?? '100%')
  const hasPointerContent = nodeType === 'pointer' && content && content.trim() !== ''
  const isReparentSource = reparentSourceNodeId === id
  const showFloatingActions = isEditMode && !editing
  const isActionMenuVisible = hovered || menuHovered || showConvertMenu || isReparentSource

  const showActionMenu = useCallback(() => {
    if (menuHideTimerRef.current) {
      clearTimeout(menuHideTimerRef.current)
      menuHideTimerRef.current = null
    }
    setHovered(true)
  }, [])

  const hideActionMenuWithDelay = useCallback(() => {
    if (menuHideTimerRef.current) clearTimeout(menuHideTimerRef.current)
    menuHideTimerRef.current = setTimeout(() => {
      setHovered(false)
      setMenuHovered(false)
      menuHideTimerRef.current = null
    }, 180)
  }, [])

  useEffect(() => {
    return () => {
      if (menuHideTimerRef.current) clearTimeout(menuHideTimerRef.current)
    }
  }, [])

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

  // Close menus when the user clicks outside the node (capture phase bypasses stopPropagation)
  useEffect(() => {
    if (!showConvertMenu) return
    const handler = (e) => {
      if (nodeRef.current?.contains(e.target)) return
      setShowConvertMenu(false)
      setOpenMenuNodeId(null)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [showConvertMenu, setOpenMenuNodeId])

  const handleDelete = useCallback(() => {
    if (!confirm(`Delete "${title || 'Untitled'}"?`)) return
    deleteNode(id)
    deselectNode()
  }, [title, id, deleteNode, deselectNode])

  const handleConvert = useCallback(async (newType) => {
    if (newType === nodeType) { setShowConvertMenu(false); return }

    if (newType === 'submap') {
      setShowConvertMenu(false)
      setOpenMenuNodeId(null)
      setShowSubmapChoice(true)
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
    setShowConvertMenu(false); setOpenMenuNodeId(null)
  }, [nodeType, title, id, hasChildren, convertToSubmap, updateNodeData, setEdgeType, setOpenMenuNodeId])

  const handleCreateNewSubmap = useCallback(async () => {
    setConverting(true)
    const result = await convertToSubmap(id)
    setConverting(false)
    if (!result.success) {
      alert('Failed to convert to submap. Please try again.')
      return
    }
    setShowSubmapChoice(false)
  }, [convertToSubmap, id])

  const handleLinkExistingSubmap = useCallback((map) => {
    if (hasChildren) {
      alert('This node already has children. You can only create a new submap for it.')
      return
    }
    if (nodeType === 'pointer') setEdgeType(id, 'straight-center')
    updateNodeData(id, {
      isSubmap: true,
      submapId: map.id,
      nodeType: 'submap',
      title: title?.trim() ? title : map.name,
    })
    setShowSubmapChoice(false)
  }, [hasChildren, id, nodeType, setEdgeType, title, updateNodeData])

  const handleToggleTodo = useCallback(() => {
    pushHistory()
    updateNodeData(id, { isTodo: !isTodo })
    setShowConvertMenu(false)
    setOpenMenuNodeId(null)
  }, [id, isTodo, pushHistory, setOpenMenuNodeId, updateNodeData])

  const handleToggleReparentMode = useCallback(() => {
    if (isReparentSource) {
      clearReparentMode()
      return
    }
    setShowConvertMenu(false)
    setOpenMenuNodeId(null)
    setReparentSourceNodeId(id)
  }, [clearReparentMode, id, isReparentSource, setOpenMenuNodeId, setReparentSourceNodeId])

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
      ref={nodeRef}
      onMouseEnter={showActionMenu}
      onMouseLeave={hideActionMenuWithDelay}
      onPointerDown={(e) => {
        if (reparentSourceNodeId) return
        const startX = e.clientX
        const startY = e.clientY
        document.addEventListener('pointerup', (e2) => {
          const dx = e2.clientX - startX
          const dy = e2.clientY - startY
          if (dx * dx + dy * dy < 25) {
            clearTimeout(selectTimerRef.current)
            selectTimerRef.current = setTimeout(() => {
              if (isEditMode) selectNode(id)
              else openNodeModal(id)
            }, 300)
          }
        }, { once: true })
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (!reparentSourceNodeId) return
        if (id === reparentSourceNodeId) {
          clearReparentMode()
          return
        }
        pushHistory()
        reparentNode(reparentSourceNodeId, id)
        clearReparentMode()
      }}
      onDoubleClick={(e) => {
        if (!isEditMode) return
        if (nodeType === 'note' || nodeType === 'card') return
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
          : nodeType === 'image' || nodeType === 'text'
            ? 'transparent'
          : nodeType === 'note'
            ? '#fef9c3'
          : nodeType === 'pointer'
            ? blendWithWhite(borderColor, 0.05)
          : isSubmap || !isParent
            ? '#ffffff'
          : blendWithWhite(borderColor, bgAlpha),
        border: level === 0
          ? 'none'
          : nodeType === 'text'
            ? 'none'
          : nodeType === 'image'
            ? (imageBorder ? `1.5px solid ${borderColor}` : 'none')
          : nodeType === 'note'
            ? 'none'
          : isParent
            ? `2px solid ${borderColor}60`
          : nodeType === 'pointer'
            ? `1px solid ${borderColor}40`
            : `2px ${isSubmap ? 'dashed' : 'solid'} ${borderColor}`,
        ...(nodeType === 'pointer' ? { borderLeft: `3px solid ${borderColor}` } : {}),
        borderRadius: level === 0 ? '50px' : nodeType === 'note' ? '1px 1px 1px 4px' : isParent ? '12px' : nodeType === 'pointer' ? '8px' : '10px',
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        color: level === 0 ? '#ffffff' : '#1c1917',
        cursor: reparentSourceNodeId ? 'copy' : (editing ? 'text' : 'pointer'),
        boxShadow: nodeType === 'image' || nodeType === 'text'
          ? (selected ? `0 0 0 2px ${borderColor}60` : hovered ? `0 0 0 1.5px ${borderColor}40` : 'none')
          : selected
            ? `0 0 0 3px ${borderColor}40, 2px 4px 14px rgba(0,0,0,0.18)`
            : hovered
              ? `0 0 0 2px ${borderColor}70, 2px 4px 10px rgba(0,0,0,0.12)`
              : (nodeType === 'note')
                ? '3px 4px 10px rgba(0,0,0,0.18), 1px 1px 0 rgba(0,0,0,0.06)'
                : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s ease',
        userSelect: 'none',
        position: 'relative',
        boxSizing: 'border-box',
        ...(isReparentSource ? { boxShadow: `0 0 0 3px #b4530980, 2px 4px 14px rgba(0,0,0,0.18)` } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} style={centerHandle} />

      {nodeType !== 'text' && (
        <NodeResizer
          isVisible={isEditMode && (selected || hovered)}
          minWidth={60}
          minHeight={30}
          onResizeEnd={() => scheduleAutosave()}
        />
      )}

      {!editing && isTodo && (
        <span className="node-todo-indicator" title="Marked as To Do">
          To Do
        </span>
      )}

      {/* Image node body */}
      {nodeType === 'image' && (
        <div className="image-node-body">
          {imageUrl ? (
            <>
              <NodeIconDisplay iconUrl={imageUrl} className="image-node-img" />
              {isEditMode && hovered && (
                <>
                  <NodeIconUpload
                    iconUrl={imageUrl}
                    onUpload={(url) => updateNodeData(id, { imageUrl: url })}
                    className="image-node-replace nodrag nopan"
                  >
                    Replace
                  </NodeIconUpload>
                  <button
                    className="image-node-border-toggle nodrag nopan"
                    title={imageBorder ? 'Hide border' : 'Show border'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); updateNodeData(id, { imageBorder: !imageBorder }) }}
                  >
                    {imageBorder ? '⊟' : '⊞'}
                  </button>
                </>
              )}
            </>
          ) : (
            <NodeIconUpload
              iconUrl=""
              onUpload={(url) => updateNodeData(id, { imageUrl: url })}
              className="image-node-placeholder nodrag nopan"
            >
              <svg width="28" height="28" viewBox="0 0 24 22" fill="none" style={{ opacity: 0.35 }}>
                <rect x="1" y="1" width="22" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="7" cy="7.5" r="2" fill="currentColor" opacity="0.6" />
                <path d="M1 16l6-5 4 4 4-4 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span>Add image</span>
            </NodeIconUpload>
          )}
        </div>
      )}

      {/* Sticky note body */}
      {nodeType === 'note' && (
        <div className="sticky-note-body">
          {title?.trim() && (
            <div className="sticky-note-title">{title}</div>
          )}
          {content?.trim() ? (
            <div className="sticky-note-text sticky-note-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>{content}</ReactMarkdown>
            </div>
          ) : !title?.trim() && (
            <p className="sticky-note-text"><span className="sticky-note-placeholder">Click to edit…</span></p>
          )}
        </div>
      )}

      {/* Card node body */}
      {nodeType === 'card' && (
        <div className="card-node-body">
          {title?.trim() && (
            <div className="card-node-title">{title}</div>
          )}
          {showContents && content?.trim() ? (
            <div className="card-node-content card-node-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>{content}</ReactMarkdown>
            </div>
          ) : !title?.trim() && (
            <p className="card-node-content"><span className="card-node-placeholder">Click to edit…</span></p>
          )}
        </div>
      )}

      {/* Text node body */}
      {nodeType === 'text' && (
        <div className="text-node-body">
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
              style={{ fontSize: TEXT_SIZES[textSize], fontWeight: 600, color: borderColor, background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', width: '100%', minWidth: 60 }}
            />
          ) : (
            <span className="text-node-label" style={{ fontSize: TEXT_SIZES[textSize], color: borderColor }}>
              {title?.trim() || <span style={{ opacity: 0.35 }}>Text</span>}
            </span>
          )}
          {isEditMode && hovered && !editing && (
            <div className="text-node-size-toggle nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
              {['s', 'm', 'l'].map((s) => (
                <button
                  key={s}
                  className={`text-node-size-btn${textSize === s ? ' text-node-size-btn--active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); updateNodeData(id, { textSize: s }) }}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
                color: '#1c1917',
                fontFamily: 'inherit',
                padding: '8px 10px 4px',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <>
              {title?.trim() && (
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#1c1917', padding: '8px 10px 4px', lineHeight: '1.3', wordBreak: 'break-word' }}>
                  {title}
                </div>
              )}
              <div
                className="pointer-content"
                style={{ fontSize: '11px', fontWeight: 400, color: '#57534e', padding: '0 10px 8px', maxHeight: '120px', overflow: 'hidden', lineHeight: '1.4' }}
              >
                {hasPointerContent
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  : <p style={{ margin: 0, color: '#94a3b8' }}>No content yet</p>
                }
              </div>
            </>
          )}
        </div>
      ) : nodeType !== 'image' && nodeType !== 'note' && nodeType !== 'card' && nodeType !== 'text' && (!isParent || !!title?.trim()) && (
        <div style={{
          flex: (isParent || showContents) ? '0 0 auto' : 1,
          display: 'flex',
          flexDirection: 'row',
          alignItems: (showContents || isParent || hasChildren || iconUrl) ? 'flex-start' : 'center',
          justifyContent: (isParent || hasChildren || iconUrl || showContents) ? 'flex-start' : 'center',
          padding: isParent ? '10px 14px' : showContents ? (iconUrl && !editing ? '10px 14px 4px 8px' : '10px 14px 4px') : (iconUrl && !editing ? '10px 14px 10px 8px' : '10px 14px'),
          textAlign: (isParent || hasChildren || iconUrl || showContents) ? 'left' : 'center',
          wordBreak: 'break-word',
          lineHeight: '1.35',
          position: 'relative',
          pointerEvents: isParent ? 'none' : 'auto',
        }}>
          {!editing && iconUrl && (
            <NodeIconDisplay iconUrl={iconUrl} className="node-icon" />
          )}
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
                textAlign: isParent ? 'left' : 'center',
                fontFamily: 'inherit',
                lineHeight: 'inherit',
                padding: 0,
              }}
            />
          ) : (
            <span>{title || 'Untitled'}</span>
          )}
          {!editing && hasNotes && !showContents && (
            <span style={{
              position: 'absolute',
              top: '4px',
              right: '5px',
              fontSize: '12px',
              fontWeight: 700,
              color: `${borderColor}80`,
              lineHeight: 1,
              pointerEvents: 'none',
            }}>≡</span>
          )}
        </div>
      )}

      {showContents && content?.trim() && nodeType !== 'image' && nodeType !== 'note' && nodeType !== 'card' && nodeType !== 'text' && nodeType !== 'pointer' && !editing && (
        <div className="node-contents-body node-contents-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>{content}</ReactMarkdown>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={centerHandle} />

      {showFloatingActions && (
        <div
          className={`node-floating-menu nodrag nopan${isActionMenuVisible ? '' : ' node-floating-menu--hidden'}`}
          onMouseEnter={() => {
            if (menuHideTimerRef.current) {
              clearTimeout(menuHideTimerRef.current)
              menuHideTimerRef.current = null
            }
            setMenuHovered(true)
            setHovered(true)
          }}
          onMouseLeave={hideActionMenuWithDelay}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {isSubmap && submapId && (
            <button
              className="submap-open-btn node-floating-btn nodrag nopan"
              title="Open submap"
              style={{ background: borderColor }}
              onClick={async (e) => {
                e.stopPropagation()
                if (isDirty && currentMapId) await saveMap()
                const newCrumbs = [...breadcrumbs, { mapId: currentMapId, mapName: currentMapName }]
                navigate(`/map/${submapId}`, { state: { breadcrumbs: newCrumbs } })
              }}
            >
              ↗
            </button>
          )}

          {!isSubmap && nodeType !== 'note' && nodeType !== 'card' && nodeType !== 'pointer' && nodeType !== 'image' && nodeType !== 'text' && (
            <button
              className="add-child-btn node-floating-btn nodrag nopan"
              title="Add child node"
              style={{ background: borderColor }}
              onClick={(e) => {
                e.stopPropagation()
                const newId = addChildNode(id, 'node')
                if (newId) { selectNode(newId); openNodeModal(newId) }
              }}
            >
              +
            </button>
          )}

          {level > 0 && nodeType !== 'image' && nodeType !== 'note' && nodeType !== 'card' && nodeType !== 'text' && (
            <NodeIconUpload
              iconUrl={iconUrl}
              onUpload={(url) => updateNodeData(id, { iconUrl: url })}
              className="node-icon-upload-btn node-floating-btn nodrag nopan"
            >
              ⊕
            </NodeIconUpload>
          )}

          {level > 0 && !isSubmap && (
            <button
              className="node-convert-btn node-floating-btn nodrag nopan"
              title="Convert type"
              style={{ background: borderColor }}
              onClick={(e) => { e.stopPropagation(); const next = !showConvertMenu; setShowConvertMenu(next); setOpenMenuNodeId(next ? id : null) }}
            >
              ⇄
            </button>
          )}

          {level > 0 && (
            <button
              className={`node-todo-btn node-floating-btn nodrag nopan${isTodo ? ' node-todo-btn--active' : ''}`}
              title={isTodo ? 'Unmark To Do' : 'Mark as To Do'}
              onClick={(e) => { e.stopPropagation(); handleToggleTodo() }}
            >
              ✓
            </button>
          )}

          {level > 0 && (
            <button
              className={`node-reparent-btn node-floating-btn nodrag nopan${isReparentSource ? ' node-reparent-btn--active' : ''}`}
              title={isReparentSource ? 'Cancel reparent' : 'Reparent node'}
              onClick={(e) => { e.stopPropagation(); handleToggleReparentMode() }}
            >
              ⇢
            </button>
          )}

          <button
            className="node-edit-btn node-floating-btn nodrag nopan"
            title="Edit node"
            onClick={(e) => { e.stopPropagation(); openNodeModal(id) }}
          >
            ✎
          </button>

          {level > 0 && (
            <button
              className="node-delete-btn node-floating-btn nodrag nopan"
              title="Delete node"
              onClick={(e) => { e.stopPropagation(); handleDelete() }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Convert menu panel */}
      {showConvertMenu && (
        <div className="node-convert-menu nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
          <span className="node-convert-menu-label">Convert to</span>
          {['node', 'pointer', 'submap'].map((t) => (
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
          <button
            className="node-convert-menu-item node-convert-menu-item--todo"
            onClick={(e) => { e.stopPropagation(); handleToggleTodo() }}
          >
            {isTodo ? 'Unmark To Do' : 'Mark as To Do'}
          </button>
        </div>
      )}

      <SubmapChoiceModal
        open={showSubmapChoice}
        onClose={() => setShowSubmapChoice(false)}
        onCreateNew={handleCreateNewSubmap}
        onSelectExisting={handleLinkExistingSubmap}
        currentMapId={currentMapId}
        existingDisabledReason={hasChildren ? 'This node has children, so an existing map cannot be selected.' : ''}
      />
    </div>
  )
})

CustomNode.displayName = 'CustomNode'

export default CustomNode
