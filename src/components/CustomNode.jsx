import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, useViewport, useReactFlow } from '@xyflow/react'
import { useNavigate } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import SubmapChoiceModal from './SubmapChoiceModal'
import { NodeIconDisplay, NodeIconUpload } from './NodeIcon'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents, urlTransform } from './MarkdownEditor'


// Blend a hex colour with white at the given opacity (0–1), returning an opaque rgb()
const blendWithWhite = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(255 * (1 - alpha) + r * alpha)}, ${Math.round(255 * (1 - alpha) + g * alpha)}, ${Math.round(255 * (1 - alpha) + b * alpha)})`
}

const CONVERT_LABELS = { card: 'Card', object: 'Object', relationship: 'Relationship', pointer: 'Pointer', diagram: 'Diagram', submap: '↗ Submap' }
const OBJECT_TYPE_FILLS = {
  Standard: '#f1f3f7',
  Packaged: '#e9fbff',
  Custom: '#ffeef6',
}

// Eight resize handle positions: corners + edge midpoints
const HANDLES = [
  { dir: 'nw', cursor: 'nwse-resize', style: { top: 0,    left: 0,    transform: 'translate(-50%,-50%)' } },
  { dir: 'n',  cursor: 'ns-resize',   style: { top: 0,    left: '50%',transform: 'translate(-50%,-50%)' } },
  { dir: 'ne', cursor: 'nesw-resize', style: { top: 0,    right: 0,   transform: 'translate(50%,-50%)' } },
  { dir: 'e',  cursor: 'ew-resize',   style: { top: '50%',right: 0,   transform: 'translate(50%,-50%)' } },
  { dir: 'se', cursor: 'nwse-resize', style: { bottom: 0, right: 0,   transform: 'translate(50%,50%)' } },
  { dir: 's',  cursor: 'ns-resize',   style: { bottom: 0, left: '50%',transform: 'translate(-50%,50%)' } },
  { dir: 'sw', cursor: 'nesw-resize', style: { bottom: 0, left: 0,    transform: 'translate(-50%,50%)' } },
  { dir: 'w',  cursor: 'ew-resize',   style: { top: '50%',left: 0,    transform: 'translate(-50%,-50%)' } },
]

const MIN_W = 60
const MIN_H = 30
const VIEW_MODE_PASSIVE_NODE_TYPES = new Set(['card', 'image', 'note', 'text'])

function ResizeHandles({ nodeId, visible }) {
  const { getNode, setNodes } = useReactFlow()
  const { zoom } = useViewport()
  const dragRef = useRef(null)

  const onPointerDown = useCallback((e, dir) => {
    if (!visible) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    const node = getNode(nodeId)
    if (!node) return

    const startX = e.clientX
    const startY = e.clientY
    const startW = node.measured?.width  ?? node.style?.width  ?? 160
    const startH = node.measured?.height ?? node.style?.height ?? 80
    const startPX = node.position.x
    const startPY = node.position.y

    dragRef.current = { dir, startX, startY, startW, startH, startPX, startPY }
  }, [visible, nodeId, getNode])

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current
    if (!drag) return
    e.stopPropagation()

    const scale = zoom || 1
    const dx = (e.clientX - drag.startX) / scale
    const dy = (e.clientY - drag.startY) / scale
    const { dir, startW, startH, startPX, startPY } = drag

    let w = startW, h = startH, x = startPX, y = startPY

    if (dir.includes('e')) w = Math.max(MIN_W, startW + dx)
    if (dir.includes('s')) h = Math.max(MIN_H, startH + dy)
    if (dir.includes('w')) { w = Math.max(MIN_W, startW - dx); x = startPX + (startW - w) }
    if (dir.includes('n')) { h = Math.max(MIN_H, startH - dy); y = startPY + (startH - h) }

    setNodes((nodes) => nodes.map((n) => n.id !== nodeId ? n : {
      ...n,
      position: { x, y },
      style: { ...(n.style || {}), width: w, height: h },
      data: { ...n.data, size: { width: w, height: h }, sizeMode: 'manual' },
    }))
  }, [nodeId, zoom, setNodes])

  const onPointerUp = useCallback((e) => {
    if (!dragRef.current) return
    e.stopPropagation()
    dragRef.current = null

    // Snap on release
    setNodes((nodes) => nodes.map((n) => {
      if (n.id !== nodeId) return n
      const w = Math.max(MIN_W, Math.round((n.style?.width  ?? 160) / 10) * 10)
      const h = Math.max(MIN_H, Math.round((n.style?.height ?? 80)  / 10) * 10)
      const x = Math.round(n.position.x / 10) * 10
      const y = Math.round(n.position.y / 10) * 10
      return {
        ...n,
        position: { x, y },
        style: { ...(n.style || {}), width: w, height: h },
        data: { ...n.data, size: { width: w, height: h }, sizeMode: 'manual' },
      }
    }))
    // Mark dirty and trigger autosave via store without subscribing to it
    const store = useMindMapStore.getState()
    store.scheduleAutosave?.()
  }, [nodeId, setNodes])

  if (!visible) return null

  return (
    <>
      {HANDLES.map(({ dir, cursor, style }) => (
        <div
          key={dir}
          className="km-resize-handle nopan nodrag"
          style={{ ...style, cursor, position: 'absolute', zIndex: 20 }}
          onPointerDown={(e) => onPointerDown(e, dir)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ))}
    </>
  )
}

const CustomNode = memo(({ id, data, selected }) => {
  const addChildNode          = useMindMapStore((state) => state.addChildNode)
  const updateNodeData        = useMindMapStore((state) => state.updateNodeData)
  const deleteNode            = useMindMapStore((state) => state.deleteNode)
  const setEdgeType           = useMindMapStore((state) => state.setEdgeType)
  const convertToSubmap       = useMindMapStore((state) => state.convertToSubmap)
  const pushHistory           = useMindMapStore((state) => state.pushHistory)
  const openNodeModal         = useMindMapStore((state) => state.openNodeModal)
  const isEditMode            = useMindMapStore((state) => state.isEditMode)
  const reparentNode          = useMindMapStore((state) => state.reparentNode)
  const reparentSourceNodeId  = useMindMapStore((state) => state.reparentSourceNodeId)
  const setReparentSourceNodeId = useMindMapStore((state) => state.setReparentSourceNodeId)
  const clearReparentMode     = useMindMapStore((state) => state.clearReparentMode)
  const copySizeSourceNodeId  = useMindMapStore((state) => state.copySizeSourceNodeId)
  const setCopySizeSourceNodeId = useMindMapStore((state) => state.setCopySizeSourceNodeId)
  const clearCopySizeMode     = useMindMapStore((state) => state.clearCopySizeMode)
  const applySizeFromSourceToTarget = useMindMapStore((state) => state.applySizeFromSourceToTarget)
  const currentMapId          = useMindMapStore((state) => state.currentMapId)
  const currentMapName        = useMindMapStore((state) => state.currentMapName)
  const breadcrumbs           = useMindMapStore((state) => state.breadcrumbs)
  const isDirty               = useMindMapStore((state) => state.isDirty)
  const saveMap               = useMindMapStore((state) => state.saveMap)

  const openDiagramEditor      = useMindMapStore((state) => state.openDiagramEditor)
  const navigate              = useNavigate()

  const { zoom: viewportZoom } = useViewport()
  const zoom = Math.max(viewportZoom, 0.05)

  const [hovered, setHovered]             = useState(false)
  const [editing, setEditing]             = useState(false)
  const [draft, setDraft]                 = useState('')
  const [showSubmapChoice, setShowSubmapChoice] = useState(false)
  const inputRef       = useRef(null)
  const nodeRef        = useRef(null)

  const { title, level, l1Color, hasChildren, hasNotes, isSubmap, submapId, nodeType, groupSize, content, objectType = 'Standard', backgroundMode = 'theme', isTodo = false, iconUrl = '', imageUrl = '', imageBorder = false, textSize = 'm', diagramSnapshot = '' } = data
  const shouldShowContents = !!content?.trim() && nodeType !== 'image' && nodeType !== 'note' && nodeType !== 'diagram' && nodeType !== 'text' && nodeType !== 'pointer' && nodeType !== 'relationship'

  const borderColor = l1Color ?? '#94a3b8'
  const TEXT_SIZES  = { s: 14, m: 22, l: 36 }
  const isParent    = !!groupSize
  // Depth tint only for parent nodes; each level adds 0.04, min 0.05
  const bgAlpha     = isParent ? 0.05 + Math.max(0, level - 1) * 0.04 : 0
  const width       = nodeType === 'text' ? 'auto' : (groupSize?.width ?? '100%')
  const height      = nodeType === 'text' ? null : (groupSize?.height ?? '100%')
  const hasPointerContent = nodeType === 'pointer' && content && content.trim() !== ''
  const isReparentSource = reparentSourceNodeId === id
  const isCopySizeSource = copySizeSourceNodeId === id
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
  }, [title, id, deleteNode])

  const handleCreateNewSubmap = useCallback(async () => {
    const result = await convertToSubmap(id)
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
  }, [id, isTodo, pushHistory, updateNodeData])

  const handleToggleReparentMode = useCallback(() => {
    if (isReparentSource) {
      clearReparentMode()
      return
    }
    clearCopySizeMode()
    setReparentSourceNodeId(id)
  }, [clearCopySizeMode, clearReparentMode, id, isReparentSource, setReparentSourceNodeId])

  const handleToggleCopySizeMode = useCallback(() => {
    if (isCopySizeSource) {
      clearCopySizeMode()
      return
    }
    setCopySizeSourceNodeId(id)
  }, [clearCopySizeMode, id, isCopySizeSource, setCopySizeSourceNodeId])

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}

      onClick={(e) => {
        if (!isEditMode && VIEW_MODE_PASSIVE_NODE_TYPES.has(nodeType)) {
          e.stopPropagation()
          return
        }
        if (copySizeSourceNodeId) {
          e.stopPropagation()
          if (id === copySizeSourceNodeId) {
            clearCopySizeMode()
            return
          }
          pushHistory()
          applySizeFromSourceToTarget(copySizeSourceNodeId, id)
          clearCopySizeMode()
          return
        }
        if (reparentSourceNodeId) {
          e.stopPropagation()
          if (id === reparentSourceNodeId) {
            clearReparentMode()
            return
          }
          pushHistory()
          reparentNode(reparentSourceNodeId, id)
          clearReparentMode()
        }
        // Otherwise let the event propagate so React Flow can update selection (edit mode) or
        // MindMapCanvas onNodeClick opens the modal (view mode).
      }}
      onDoubleClick={(e) => {
        if (nodeType === 'diagram') { e.stopPropagation(); openDiagramEditor(id); return }
        e.stopPropagation()
        openNodeModal(id)
      }}
      style={{
        width,
        ...(height ? { height } : {}),
        display: 'flex',
        flexDirection: 'column',
        background: level === 0
          ? '#3a3a3a'
          : nodeType === 'image' || nodeType === 'text' || nodeType === 'object'
            ? 'transparent'
          : nodeType === 'note'
            ? '#fef9c3'
          : nodeType === 'object'
            ? '#eef3fd'
          : nodeType === 'relationship'
            ? '#f8fafc'
          : nodeType === 'pointer'
            ? blendWithWhite(borderColor, 0.05)
          : nodeType === 'card' && backgroundMode === 'canvas'
            ? '#ffffff'
          : isSubmap || !isParent
            ? '#ffffff'
          : blendWithWhite(borderColor, bgAlpha),
        border: level === 0
          ? 'none'
          : nodeType === 'text'
            ? 'none'
          : nodeType === 'image' || nodeType === 'object'
            ? (imageBorder ? `1.5px solid ${borderColor}` : 'none')
          : nodeType === 'relationship'
            ? `1.5px dashed ${borderColor}70`
          : nodeType === 'note'
            ? 'none'
          : isParent
            ? `2px solid ${borderColor}60`
          : nodeType === 'pointer'
            ? `1px solid ${borderColor}40`
            : `2px ${isSubmap ? 'dashed' : 'solid'} ${borderColor}`,
        ...(nodeType === 'pointer' ? { borderLeft: `3px solid ${borderColor}` } : {}),
        borderRadius: level === 0 ? '50px' : nodeType === 'note' ? '10px' :isParent ? '12px' : nodeType === 'pointer' ? '8px' : '10px',
        fontSize: '13px',
        fontWeight: '500',
        color: level === 0 ? '#ffffff' : '#1c1917',
        cursor: (reparentSourceNodeId || copySizeSourceNodeId) ? 'copy' : (editing ? 'text' : 'pointer'),
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
        ...(isCopySizeSource ? { boxShadow: `0 0 0 3px #7c3aed80, 2px 4px 14px rgba(0,0,0,0.18)` } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} style={centerHandle} />

      {nodeType !== 'text' && (
        <ResizeHandles nodeId={id} visible={isEditMode && selected} />
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

      {nodeType === 'diagram' && (
        <div className="diagram-node-body">
          {diagramSnapshot ? (
            <img src={diagramSnapshot} alt="Diagram snapshot" className="diagram-node-preview" />
          ) : (
            <div className="diagram-node-placeholder">Open editor to create diagram</div>
          )}
        </div>
      )}

      {nodeType === 'object' && (
        <div
          className="object-node-body"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 12,
            background: OBJECT_TYPE_FILLS[objectType] || OBJECT_TYPE_FILLS.Standard,
            border: `1.5px solid ${selected ? '#5b8dee' : '#c0cfe8'}`,
            boxShadow: selected
              ? '0 2px 8px rgba(91,141,238,0.25)'
              : hovered
                ? '0 1px 6px rgba(91,141,238,0.16)'
                : '0 1px 3px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            padding: '8px 10px',
            fontSize: 13,
            lineHeight: 1.3,
            color: '#2d3a5c',
            wordBreak: 'break-word',
          }}
        >
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
                fontWeight: 500,
                color: 'inherit',
                fontFamily: 'inherit',
                lineHeight: 'inherit',
                padding: 0,
              }}
            />
          ) : (
            <span>{title || data.name || 'Object'}</span>
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
      ) : nodeType !== 'image' && nodeType !== 'note' && nodeType !== 'diagram' && nodeType !== 'object' && nodeType !== 'text' && (!isParent || !!title?.trim()) && (
        <div
          style={{
            flex: (isParent || shouldShowContents) ? '0 0 auto' : 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: (hasChildren || shouldShowContents) ? 'flex-start' : 'center',
            minHeight: 0,
            pointerEvents: isParent ? 'none' : 'auto',
          }}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: (isParent || hasChildren || iconUrl || shouldShowContents) ? 'flex-start' : 'center',
            padding: isParent ? '10px 14px' : shouldShowContents ? (iconUrl && !editing ? '10px 14px 4px 8px' : '10px 14px 4px') : (iconUrl && !editing ? '10px 14px 10px 8px' : '10px 14px'),
            textAlign: (isParent || hasChildren || iconUrl || shouldShowContents) ? 'left' : 'center',
            wordBreak: 'break-word',
            lineHeight: '1.35',
            position: 'relative',
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
            {!editing && hasNotes && !shouldShowContents && (
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
        </div>
      )}

      {shouldShowContents && !editing && (
        <div className="node-contents-body node-contents-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>{content}</ReactMarkdown>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={centerHandle} />

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
