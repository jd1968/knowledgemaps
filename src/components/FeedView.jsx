import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useMindMapStore } from '../store/useMindMapStore'
import MarkdownEditor, { markdownComponents, urlTransform } from './MarkdownEditor'
import { NodeIconDisplay, NodeIconUpload } from './NodeIcon'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const CANVAS_ONLY_TYPES = new Set(['image', 'text', 'note'])

function buildDFSOrder(nodes, edges) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = new Map()
  const hasParent = new Set()
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, [])
    childrenOf.get(e.source).push(e.target)
    hasParent.add(e.target)
  }
  const root = nodes.find((n) => n.data?.level === 0) ?? nodes[0]
  const result = []
  const visited = new Set()
  const visit = (nodeId, depth) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const node = nodeById.get(nodeId)
    if (!node) return
    if (!CANVAS_ONLY_TYPES.has(node.data?.nodeType)) result.push({ node, depth })
    for (const childId of (childrenOf.get(nodeId) ?? [])) visit(childId, depth + 1)
  }
  if (root) {
    visit(root.id, 0)
    // Also include level-1 nodes that have no parent edge (placed via toolbox without edge to root)
    nodes
      .filter(n => n.data?.level === 1 && !hasParent.has(n.id))
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
      .forEach(n => visit(n.id, 1))
  }
  return result
}

// Converts a flat DFS list (with depths) into a nested group/card tree
function buildRenderTree(orderedItems) {
  const root = { children: [] }
  const stack = [{ container: root, depth: -1 }]
  for (let i = 0; i < orderedItems.length; i++) {
    const { node, depth } = orderedItems[i]
    const hasChildren = i + 1 < orderedItems.length && orderedItems[i + 1].depth > depth
    while (stack.length > 1 && depth <= stack[stack.length - 1].depth) stack.pop()
    const parent = stack[stack.length - 1].container
    const nt = node.data.nodeType === 'folder' ? 'node' : node.data.nodeType
    if (hasChildren && (nt === 'group' || nt === 'node')) {
      const showSelfCard = node.data.level === 1 || node.data.content?.trim()
      const groupItem = { type: 'group', node, depth, children: showSelfCard ? [{ type: 'card', node }] : [] }
      parent.children.push(groupItem)
      stack.push({ container: groupItem, depth })
    } else {
      parent.children.push({ type: 'card', node })
    }
  }
  return root.children
}


function getAncestorCrumbs(nodeId, nodeMap, parentMap) {
  const ancestors = []
  let current = nodeId
  while (true) {
    const parentId = parentMap.get(current)
    if (!parentId) break
    const parent = nodeMap.get(parentId)
    if (!parent) break
    ancestors.unshift({ title: parent.data.title, isRoot: parent.data.level === 0 })
    current = parentId
  }
  return ancestors.length > 0 ? ancestors : null
}

/* ── FeedCard ──────────────────────────────────────────────────────── */

function FeedCard({ node, nodeMap, parentMap, onSave, onEditStart, onEditEnd, onGoToMap, onIconSave, onDelete, onShowProps }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [localTitle, setLocalTitle] = useState(node.data.title)
  const [localLongTitle, setLocalLongTitle] = useState(node.data.longTitle || '')
  const [localContent, setLocalContent] = useState(node.data.content)
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const contentRef = useRef(null)
  const titleInputRef = useRef(null)

  // Always-current value refs — avoid stale closures in registered callbacks
  const localTitleRef = useRef(localTitle)
  useEffect(() => { localTitleRef.current = localTitle }, [localTitle])
  const localLongTitleRef = useRef(localLongTitle)
  useEffect(() => { localLongTitleRef.current = localLongTitle }, [localLongTitle])
  const localContentRef = useRef(localContent)
  useEffect(() => { localContentRef.current = localContent }, [localContent])

  // Flags to suppress double-save when blur fires after a manual confirm/cancel
  const titleHandledRef = useRef(false)
  const contentHandledRef = useRef(false)

  useEffect(() => {
    if (!contentRef.current || expanded || editingContent) return
    setIsClamped(contentRef.current.scrollHeight > contentRef.current.clientHeight + 2)
  }, [localContent, expanded, editingContent])

  // Escape cancels content editing regardless of focus
  useEffect(() => {
    if (!editingContent) return
    const handler = (e) => {
      if (e.key === 'Escape') cancelContent()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingContent]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Title ── */

  const commitTitleChanges = () => {
    const trimmedTitle = localTitleRef.current.trim() || node.data.title
    const trimmedLongTitle = localLongTitleRef.current.trim()
    setLocalTitle(trimmedTitle)
    setLocalLongTitle(trimmedLongTitle)
    const changes = {}
    if (trimmedTitle !== node.data.title) changes.title = trimmedTitle
    if (trimmedLongTitle !== (node.data.longTitle || '')) changes.longTitle = trimmedLongTitle
    if (Object.keys(changes).length > 0) onSave(node, changes)
  }

  const startTitleEdit = () => {
    if (!localLongTitle) setLocalLongTitle(localTitle)
    setEditingTitle(true)
    onEditStart(
      () => {  // confirm from fixed bar
        if (titleHandledRef.current) return
        titleHandledRef.current = true
        setEditingTitle(false)
        onEditEnd()
        commitTitleChanges()
      },
      () => {  // cancel from fixed bar
        if (titleHandledRef.current) return
        titleHandledRef.current = true
        setLocalTitle(node.data.title)
        setLocalLongTitle(node.data.longTitle || '')
        setEditingTitle(false)
        onEditEnd()
      }
    )
  }

  // Natural blur (clicking outside the title edit group, not via fixed bar)
  const commitTitleOnBlur = () => {
    if (titleHandledRef.current) { titleHandledRef.current = false; return }
    setEditingTitle(false)
    onEditEnd()
    commitTitleChanges()
  }

  const cancelTitleOnEscape = () => {
    if (titleHandledRef.current) return
    titleHandledRef.current = true
    setLocalTitle(node.data.title)
    setLocalLongTitle(node.data.longTitle || '')
    setEditingTitle(false)
    onEditEnd()
  }

  /* ── Content ── */

  const startContentEdit = () => {
    setEditingContent(true)
    onEditStart(
      () => {  // confirm from fixed bar
        if (contentHandledRef.current) return
        contentHandledRef.current = true
        setEditingContent(false)
        onEditEnd()
        if (localContentRef.current !== node.data.content) onSave(node, { content: localContentRef.current })
      },
      () => {  // cancel from fixed bar
        if (contentHandledRef.current) return
        contentHandledRef.current = true
        setLocalContent(node.data.content)
        setEditingContent(false)
        onEditEnd()
      }
    )
  }

  const cancelContent = () => {
    if (contentHandledRef.current) return
    contentHandledRef.current = true
    setLocalContent(node.data.content)
    setEditingContent(false)
    onEditEnd()
  }

  // Natural blur (clicking outside, not via fixed bar)
  const commitContentOnBlur = (md) => {
    if (contentHandledRef.current) { contentHandledRef.current = false; return }
    setEditingContent(false)
    onEditEnd()
    setLocalContent(md)
    if (md !== node.data.content) onSave(node, { content: md })
  }

  const crumbs = getAncestorCrumbs(node.id, nodeMap, parentMap)
  const rawType = node.data.nodeType === 'folder' ? 'node' : node.data.nodeType
  const typeLabel = rawType !== 'node' ? rawType : null
  const showBreadcrumbs = import.meta.env.FEED_SHOW_BREADCRUMBS !== 'false'

  return (
    <div
      className={`feed-card${(editingTitle || editingContent) ? ' feed-card--editing' : ''}`}
      style={{ animationDelay: '0ms' }}
    >
      {showBreadcrumbs && crumbs && (
        <div className="feed-card__breadcrumb" aria-label="Location">
          {crumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span className="feed-card__breadcrumb-sep" aria-hidden="true"> › </span>}
              <span className={crumb.isRoot ? 'feed-card__breadcrumb-root' : 'feed-card__breadcrumb-crumb'}>
                {crumb.title}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="feed-card__header">
        {node.data.iconUrl && !editingTitle && (
          <NodeIconDisplay iconUrl={node.data.iconUrl} className="feed-card__icon" />
        )}
        {editingTitle ? (
          <div
            className="feed-card__title-edit-group"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) commitTitleOnBlur()
            }}
          >
            <input
              className="feed-card__title-input feed-card__title-input--long"
              value={localLongTitle}
              onChange={(e) => setLocalLongTitle(e.target.value)}
              placeholder="Long title (shown on cards)…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') titleInputRef.current?.focus()
                if (e.key === 'Escape') cancelTitleOnEscape()
              }}
            />
            <input
              ref={titleInputRef}
              className="feed-card__title-input feed-card__title-input--short"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              placeholder="Short title (shown on map)…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
                if (e.key === 'Escape') cancelTitleOnEscape()
              }}
            />
          </div>
        ) : (
          <h3
            className="feed-card__title feed-card__title--editable"
            onClick={startTitleEdit}
            title="Click to edit"
          >
            {localLongTitle || localTitle}
          </h3>
        )}
        {typeLabel && !editingTitle && (
          <span className="feed-card__type-badge">{typeLabel}</span>
        )}
        {!editingTitle && !editingContent && (
          <div className="feed-card__actions">
            <NodeIconUpload
              iconUrl={node.data.iconUrl}
              onUpload={(url) => onIconSave(node, url)}
              className="feed-card__action-btn"
            >⊕</NodeIconUpload>
            <button className="feed-card__action-btn" onClick={startContentEdit} title="Edit">✎</button>
            <button className="feed-card__action-btn" onClick={() => onGoToMap(node.id)} title="Open in map">↗</button>
            <button className="feed-card__action-btn" onClick={() => onShowProps(node)} title="Properties">⋯</button>
            <button className="feed-card__action-btn feed-card__action-btn--delete" onClick={() => onDelete(node)} title="Delete node">✕</button>
          </div>
        )}
      </div>

      {editingContent ? (
        <div className="feed-card__editor-wrap">
          <MarkdownEditor
            content={localContent}
            onChange={setLocalContent}
            onBlur={commitContentOnBlur}
            onEscape={cancelContent}
            editable
          />
        </div>
      ) : (
        <div
          className="feed-card__content-wrap feed-card__content-wrap--clickable"
          onClick={startContentEdit}
          title="Click to edit"
        >
          <div
            ref={contentRef}
            className={`feed-card__content${expanded ? ' feed-card__content--expanded' : ''}`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>{localContent || ''}</ReactMarkdown>
          </div>
          {!expanded && isClamped && (
            <button
              className="feed-card__show-more"
              onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
            >
              Show more…
            </button>
          )}
          {expanded && (
            <button
              className="feed-card__show-more"
              onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── FeedGroupHeader ───────────────────────────────────────────────── */

function FeedGroupHeader({ node, cardProps }) {
  const { onSave, onEditStart, onEditEnd, onGoToMap, onIconSave, onDelete, onShowProps } = cardProps
  const [hovered, setHovered] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(node.data.title)
  const [localLongTitle, setLocalLongTitle] = useState(node.data.longTitle || '')
  const titleHandledRef = useRef(false)
  const longTitleInputRef = useRef(null)

  const localTitleRef = useRef(localTitle)
  useEffect(() => { localTitleRef.current = localTitle }, [localTitle])
  const localLongTitleRef = useRef(localLongTitle)
  useEffect(() => { localLongTitleRef.current = localLongTitle }, [localLongTitle])

  const commitTitle = () => {
    const trimmedTitle = localTitleRef.current.trim() || node.data.title
    const trimmedLongTitle = localLongTitleRef.current.trim()
    setLocalTitle(trimmedTitle)
    setLocalLongTitle(trimmedLongTitle)
    const changes = {}
    if (trimmedTitle !== node.data.title) changes.title = trimmedTitle
    if (trimmedLongTitle !== (node.data.longTitle || '')) changes.longTitle = trimmedLongTitle
    if (Object.keys(changes).length > 0) onSave(node, changes)
  }

  const startEdit = () => {
    if (!localLongTitle) setLocalLongTitle(localTitle)
    setEditingTitle(true)
    onEditStart(
      () => { if (titleHandledRef.current) return; titleHandledRef.current = true; setEditingTitle(false); onEditEnd(); commitTitle() },
      () => { if (titleHandledRef.current) return; titleHandledRef.current = true; setLocalTitle(node.data.title); setLocalLongTitle(node.data.longTitle || ''); setEditingTitle(false); onEditEnd() }
    )
    // focus after render
    setTimeout(() => longTitleInputRef.current?.focus(), 0)
  }

  const commitOnBlur = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (titleHandledRef.current) { titleHandledRef.current = false; return }
    setEditingTitle(false)
    onEditEnd()
    commitTitle()
  }

  const cancelOnEscape = () => {
    if (titleHandledRef.current) return
    titleHandledRef.current = true
    setLocalTitle(node.data.title)
    setLocalLongTitle(node.data.longTitle || '')
    setEditingTitle(false)
    onEditEnd()
  }

  const displayTitle = localLongTitle || localTitle

  return (
    <div
      className="feed-group-header-wrap"
      data-level={node.data.level}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {node.data.iconUrl && (
        <NodeIconDisplay iconUrl={node.data.iconUrl} className="feed-card__icon" />
      )}
      {editingTitle ? (
        <div
          className="feed-group-header__title-edit"
          onBlur={commitOnBlur}
        >
          <input
            ref={longTitleInputRef}
            className="feed-card__title-input feed-card__title-input--long"
            value={localLongTitle}
            onChange={(e) => setLocalLongTitle(e.target.value)}
            placeholder="Long title…"
            onKeyDown={(e) => { if (e.key === 'Escape') cancelOnEscape() }}
          />
          <input
            className="feed-card__title-input feed-card__title-input--short"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            placeholder="Short title (shown on map)…"
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') cancelOnEscape() }}
          />
        </div>
      ) : (
        <span className="feed-group-header__title">{displayTitle}</span>
      )}
      {(hovered || editingTitle) && (
        <div className="feed-card__actions feed-group-header__actions">
          <NodeIconUpload iconUrl={node.data.iconUrl} onUpload={(url) => onIconSave(node, url)} className="feed-card__action-btn">⊕</NodeIconUpload>
          <button className="feed-card__action-btn" onClick={startEdit} title="Edit title">✎</button>
          <button className="feed-card__action-btn" onClick={() => onGoToMap(node.id)} title="Open in map">↗</button>
          <button className="feed-card__action-btn" onClick={() => onShowProps(node)} title="Properties">⋯</button>
          <button className="feed-card__action-btn feed-card__action-btn--delete" onClick={() => onDelete(node)} title="Delete node">✕</button>
        </div>
      )}
    </div>
  )
}

/* ── NodePropertiesDialog ──────────────────────────────────────────── */

// Fields computed/injected by the canvas — shown read-only
const COMPUTED_DATA_FIELDS = new Set(['l1Color','hasChildren','hasNotes','allDescendantsCollapsed','hasCollapsibleDescendants','key'])
const NODE_TYPES = ['node','group','note','image','text','pointer','submap','folder']
const TEXT_SIZES = ['s','m','l']

function NodePropertiesDialog({ node, allNodes, allEdges, onClose, onSaveProps }) {
  const nodeById = new Map(allNodes.map(n => [n.id, n]))
  const parentEdge = allEdges.find(e => e.target === node.id)
  const childEdges = allEdges.filter(e => e.source === node.id)
  const parentNode = parentEdge ? nodeById.get(parentEdge.source) : null

  // Editable state
  const [data, setData] = useState({ ...node.data })
  const [pos, setPos] = useState({ x: node.position?.x ?? 0, y: node.position?.y ?? 0 })
  const [styleW, setStyleW] = useState(node.style?.width ?? '')
  const [styleH, setStyleH] = useState(node.style?.height ?? '')
  const [saving, setSaving] = useState(false)

  const setField = (key, value) => setData(d => ({ ...d, [key]: value }))

  const hasChanges = JSON.stringify(data) !== JSON.stringify(node.data)
    || pos.x !== (node.position?.x ?? 0) || pos.y !== (node.position?.y ?? 0)
    || String(styleW) !== String(node.style?.width ?? '')
    || String(styleH) !== String(node.style?.height ?? '')

  const handleApply = async () => {
    setSaving(true)
    const style = {}
    if (styleW !== '') style.width = Number(styleW)
    if (styleH !== '') style.height = Number(styleH)
    await onSaveProps(node, { data, position: pos, style: Object.keys(style).length ? style : node.style })
    setSaving(false)
    onClose()
  }

  // Diagnostics use the live editable data
  const diagnostics = []
  const nt = data?.nodeType
  if (data?.level === 0) diagnostics.push({ type: 'info', msg: 'Root node — hidden on canvas (level 0)' })
  if (CANVAS_ONLY_TYPES.has(nt)) diagnostics.push({ type: 'warn', msg: `Type "${nt}" is canvas-only — excluded from feed, contents and text views` })
  if (data?.level === 1 && !parentEdge) diagnostics.push({ type: 'warn', msg: 'No parent edge — placed via toolbox without connection to root (shows on canvas via level attribute)' })
  if (nt === 'folder') diagnostics.push({ type: 'warn', msg: "Legacy type 'folder' — treated as 'node'" })
  if (data?.isSubmap) diagnostics.push({ type: 'info', msg: 'Submap node — clicking opens a linked map' })
  if (!data?.title?.trim()) diagnostics.push({ type: 'warn', msg: 'No title set' })
  if (diagnostics.length === 0) diagnostics.push({ type: 'ok', msg: 'No display issues detected' })

  const ReadRow = ({ label, value }) => (
    <tr>
      <td className="node-props__label">{label}</td>
      <td className="node-props__value node-props__value--mono">{value == null ? <em style={{color:'#94a3b8'}}>—</em> : String(value)}</td>
    </tr>
  )

  const renderDataField = (key, value) => {
    if (COMPUTED_DATA_FIELDS.has(key)) {
      if (typeof value === 'object' && value !== null) return <ReadRow key={key} label={key} value={JSON.stringify(value)} />
      return <ReadRow key={key} label={key} value={value === false ? 'false' : value === true ? 'true' : value} />
    }
    if (key === 'nodeType') return (
      <tr key={key}>
        <td className="node-props__label">nodeType</td>
        <td className="node-props__value">
          <select className="node-props__input" value={data.nodeType ?? ''} onChange={e => setField('nodeType', e.target.value)}>
            {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
      </tr>
    )
    if (key === 'textSize') return (
      <tr key={key}>
        <td className="node-props__label">textSize</td>
        <td className="node-props__value">
          <select className="node-props__input" value={data.textSize ?? 'm'} onChange={e => setField('textSize', e.target.value)}>
            {TEXT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
      </tr>
    )
    if (key === 'level') return (
      <tr key={key}>
        <td className="node-props__label">level</td>
        <td className="node-props__value">
          <input className="node-props__input node-props__input--num" type="number" value={data.level ?? 0} onChange={e => setField('level', parseInt(e.target.value) || 0)} />
        </td>
      </tr>
    )
    if (key === 'content') return (
      <tr key={key}>
        <td className="node-props__label">content</td>
        <td className="node-props__value">
          <textarea className="node-props__input node-props__input--textarea" value={data.content ?? ''} onChange={e => setField('content', e.target.value)} rows={3} />
        </td>
      </tr>
    )
    if (typeof value === 'boolean' || key === 'isTodo' || key === 'imageBorder') return (
      <tr key={key}>
        <td className="node-props__label">{key}</td>
        <td className="node-props__value">
          <input type="checkbox" checked={!!data[key]} onChange={e => setField(key, e.target.checked)} />
        </td>
      </tr>
    )
    if (typeof value === 'object' && value !== null) return <ReadRow key={key} label={key} value={JSON.stringify(value)} />
    return (
      <tr key={key}>
        <td className="node-props__label">{key}</td>
        <td className="node-props__value">
          <input className="node-props__input" type="text" value={data[key] ?? ''} onChange={e => setField(key, e.target.value)} />
        </td>
      </tr>
    )
  }

  return (
    <div className="node-props-overlay" onClick={onClose}>
      <div className="node-props-dialog" onClick={e => e.stopPropagation()}>
        <div className="node-props-dialog__header">
          <span className="node-props-dialog__title">Node Properties</span>
          <button className="node-props-dialog__close" onClick={onClose}>✕</button>
        </div>

        <div className="node-props-dialog__body">
          <section className="node-props-section">
            <h4>Identity</h4>
            <table className="node-props__table"><tbody>
              <ReadRow label="ID" value={node.id} />
              <ReadRow label="RF type" value={node.type} />
            </tbody></table>
          </section>

          <section className="node-props-section">
            <h4>Data</h4>
            <table className="node-props__table"><tbody>
              {Object.entries(node.data ?? {}).map(([k, v]) => renderDataField(k, v))}
            </tbody></table>
          </section>

          <section className="node-props-section">
            <h4>Position &amp; Size</h4>
            <table className="node-props__table"><tbody>
              <tr>
                <td className="node-props__label">x</td>
                <td className="node-props__value"><input className="node-props__input node-props__input--num" type="number" value={pos.x} onChange={e => setPos(p => ({ ...p, x: parseFloat(e.target.value) || 0 }))} /></td>
              </tr>
              <tr>
                <td className="node-props__label">y</td>
                <td className="node-props__value"><input className="node-props__input node-props__input--num" type="number" value={pos.y} onChange={e => setPos(p => ({ ...p, y: parseFloat(e.target.value) || 0 }))} /></td>
              </tr>
              <tr>
                <td className="node-props__label">style width</td>
                <td className="node-props__value"><input className="node-props__input node-props__input--num" type="number" placeholder="auto" value={styleW} onChange={e => setStyleW(e.target.value)} /></td>
              </tr>
              <tr>
                <td className="node-props__label">style height</td>
                <td className="node-props__value"><input className="node-props__input node-props__input--num" type="number" placeholder="auto" value={styleH} onChange={e => setStyleH(e.target.value)} /></td>
              </tr>
              {node.measured?.width  != null && <ReadRow label="measured w" value={node.measured.width?.toFixed(1)} />}
              {node.measured?.height != null && <ReadRow label="measured h" value={node.measured.height?.toFixed(1)} />}
            </tbody></table>
          </section>

          <section className="node-props-section">
            <h4>Connections</h4>
            <table className="node-props__table"><tbody>
              <ReadRow label="parent" value={parentNode ? (parentNode.data?.title || parentNode.id) : parentEdge ? parentEdge.source : '— none —'} />
              <ReadRow label="children" value={childEdges.length} />
              {childEdges.length > 0 && (
                <tr>
                  <td className="node-props__label">child nodes</td>
                  <td className="node-props__value" style={{ fontSize: 12 }}>
                    {childEdges.map(e => {
                      const cn = nodeById.get(e.target)
                      return <div key={e.target} className="node-props__value--mono">{cn?.data?.title || e.target}</div>
                    })}
                  </td>
                </tr>
              )}
            </tbody></table>
          </section>

          <section className="node-props-section">
            <h4>Display diagnostics</h4>
            <ul className="node-props__diagnostics">
              {diagnostics.map((d, i) => (
                <li key={i} className={`node-props__diag node-props__diag--${d.type}`}>{d.msg}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="node-props-dialog__footer">
          <button className="node-props__btn node-props__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="node-props__btn node-props__btn--apply" disabled={!hasChanges || saving} onClick={handleApply}>
            {saving ? 'Saving…' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── FeedSection (recursive group renderer) ───────────────────────── */

function FeedSection({ items, paletteIndex = 0, cardProps }) {
  return items.map((item) => {
    if (item.type === 'card') {
      return <FeedCard key={item.node.id} node={item.node} {...cardProps} />
    }
    // group
    return (
      <div key={item.node.id} className="feed-group-section">
        <FeedGroupHeader node={item.node} cardProps={cardProps} />
        {item.node.data.content?.trim() && (
          <div className="feed-group-section__inline-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>
              {item.node.data.content}
            </ReactMarkdown>
          </div>
        )}
        {item.children.length > 0 && (
          <div className="feed-group-section__body">
            <FeedSection items={item.children} paletteIndex={paletteIndex + 1} cardProps={cardProps} />
          </div>
        )}
      </div>
    )
  })
}

/* ── FeedView ──────────────────────────────────────────────────────── */

export default function FeedView() {
  const currentMapId = useMindMapStore((s) => s.currentMapId)
  const updateNodeData = useMindMapStore((s) => s.updateNodeData)
  const focusNode = useMindMapStore((s) => s.focusNode)
  const [, setSearchParams] = useSearchParams()

  const [allNodes, setAllNodes] = useState([])
  const [allEdges, setAllEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeEditActions, setActiveEditActions] = useState(null)
  const [propsNode, setPropsNode] = useState(null)

  useEffect(() => {
    if (!currentMapId) {
      setAllNodes([])
      setAllEdges([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    async function loadAll() {
      try {
        const [mapResult, contentsResult] = await Promise.all([
          supabase.from('maps').select('id, name, data').eq('id', currentMapId).single(),
          supabase.from('nodes').select('id, content, long_title').eq('map_id', currentMapId),
        ])

        if (mapResult.error) throw mapResult.error
        if (contentsResult.error) throw contentsResult.error

        const nodeDataById = new Map(
          contentsResult.data.map((n) => [n.id, { content: n.content || '', longTitle: n.long_title || '' }])
        )

        const map = mapResult.data
        const mapNodes = map.data?.nodes || []
        const mapEdges = map.data?.edges || []

        const mergedNodes = mapNodes.map((node) => {
          const { content, longTitle } = nodeDataById.get(node.id) ?? { content: '', longTitle: '' }
          return {
            ...node,
            _feedMapId: map.id,
            data: {
              ...node.data,
              nodeType: node.data.nodeType ?? (node.data.isSubmap ? 'submap' : 'node'),
              content,
              longTitle,
            },
          }
        })

        setAllNodes(mergedNodes)
        setAllEdges(mapEdges)
      } catch (err) {
        console.error('Feed load failed:', err)
        setError('Failed to load feed.')
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [currentMapId])

  const nodeMap = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes])
  const parentMap = useMemo(() => {
    const m = new Map()
    for (const e of allEdges) m.set(e.target, e.source)
    return m
  }, [allEdges])

  const orderedNodes = useMemo(
    () => buildDFSOrder(allNodes, allEdges),
    [allNodes, allEdges]
  )

  const renderTree = useMemo(() => buildRenderTree(orderedNodes), [orderedNodes])

  const handleEditStart = useCallback((confirm, cancel) => {
    setActiveEditActions({ confirm, cancel })
  }, [])

  const handleEditEnd = useCallback(() => {
    setActiveEditActions(null)
  }, [])

  const handleGoToMap = useCallback((nodeId) => {
    focusNode(nodeId)
    setSearchParams({}, { replace: true })
  }, [focusNode, setSearchParams])

  const handleSave = useCallback(async (node, changes) => {
    setAllNodes((prev) => prev.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, ...changes } } : n
    ))
    if (node._feedMapId === currentMapId) {
      updateNodeData(node.id, changes)
    }
    try {
      const nodeTableChanges = {}
      if (changes.content !== undefined) nodeTableChanges.content = changes.content
      if (changes.longTitle !== undefined) nodeTableChanges.long_title = changes.longTitle
      if (Object.keys(nodeTableChanges).length > 0) {
        await supabase.from('nodes').update(nodeTableChanges).eq('id', node.id)
      }
      const mapDataChanges = {}
      if (changes.title !== undefined) mapDataChanges.title = changes.title
      if (changes.iconUrl !== undefined) mapDataChanges.iconUrl = changes.iconUrl
      if (Object.keys(mapDataChanges).length > 0) {
        const { data: map } = await supabase
          .from('maps').select('data').eq('id', node._feedMapId).single()
        if (map) {
          const updatedNodes = map.data.nodes.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, ...mapDataChanges } } : n
          )
          await supabase
            .from('maps')
            .update({ data: { ...map.data, nodes: updatedNodes } })
            .eq('id', node._feedMapId)
        }
      }
    } catch (err) {
      console.error('Feed save failed:', err)
    }
  }, [currentMapId, updateNodeData])

  const handleIconSave = useCallback((node, iconUrl) => {
    handleSave(node, { iconUrl })
  }, [handleSave])

  const handleDelete = useCallback(async (node) => {
    if (!confirm(`Delete "${node.data.title || 'Untitled'}"?`)) return
    // Update local feed state immediately
    setAllNodes((prev) => prev.filter((n) => n.id !== node.id))
    setAllEdges((prev) => prev.filter((e) => e.source !== node.id && e.target !== node.id))
    // If this node is in the currently open map, update the store too
    if (node._feedMapId === currentMapId) {
      useMindMapStore.setState((state) => ({
        nodes: state.nodes.filter((n) => n.id !== node.id),
        edges: state.edges.filter((e) => e.source !== node.id && e.target !== node.id),
        isDirty: true,
      }))
    }
    // Persist: remove from nodes table and from map data
    try {
      await supabase.from('nodes').delete().eq('id', node.id)
      const { data: map } = await supabase
        .from('maps').select('data').eq('id', node._feedMapId).single()
      if (map) {
        const updatedNodes = map.data.nodes.filter((n) => n.id !== node.id)
        const updatedEdges = (map.data.edges || []).filter(
          (e) => e.source !== node.id && e.target !== node.id
        )
        await supabase
          .from('maps')
          .update({ data: { ...map.data, nodes: updatedNodes, edges: updatedEdges } })
          .eq('id', node._feedMapId)
      }
    } catch (err) {
      console.error('Feed delete failed:', err)
    }
  }, [currentMapId])

  const handleSaveProps = useCallback(async (node, { data: newData, position, style }) => {
    // 1. Update local feed state
    setAllNodes(prev => prev.map(n => n.id === node.id
      ? { ...n, position, style, data: newData }
      : n
    ))
    // 2. Update store if this is the current map
    if (node._feedMapId === currentMapId) {
      useMindMapStore.setState(state => ({
        nodes: state.nodes.map(n => n.id === node.id
          ? { ...n, position, style, data: { ...n.data, ...newData } }
          : n
        ),
        isDirty: true,
      }))
    }
    // 3. Persist to nodes table (content + longTitle)
    try {
      const nodeTableChanges = {}
      if (newData.content !== node.data.content) nodeTableChanges.content = newData.content
      if (newData.longTitle !== node.data.longTitle) nodeTableChanges.long_title = newData.longTitle
      if (Object.keys(nodeTableChanges).length > 0) {
        await supabase.from('nodes').update(nodeTableChanges).eq('id', node.id)
      }
      // 4. Persist position, style, and all data fields to map data
      const { data: map } = await supabase.from('maps').select('data').eq('id', node._feedMapId).single()
      if (map) {
        const { content: _c, longTitle: _lt, ...mapDataFields } = newData
        const updatedNodes = map.data.nodes.map(n =>
          n.id === node.id
            ? { ...n, position, ...(style ? { style } : {}), data: { ...n.data, ...mapDataFields } }
            : n
        )
        await supabase.from('maps').update({ data: { ...map.data, nodes: updatedNodes } }).eq('id', node._feedMapId)
      }
    } catch (err) {
      console.error('Props save failed:', err)
    }
  }, [currentMapId])

  if (loading) return <div className="feed-view"><div className="feed-empty"><p>Loading feed…</p></div></div>
  if (error)   return <div className="feed-view"><div className="feed-empty"><p>{error}</p></div></div>
  if (!currentMapId) return <div className="feed-view"><div className="feed-empty"><p>No map selected.</p></div></div>
  if (orderedNodes.length === 0) return <div className="feed-view"><div className="feed-empty"><p>No nodes found in this map.</p></div></div>

  const cardProps = { nodeMap, parentMap, onSave: handleSave, onEditStart: handleEditStart, onEditEnd: handleEditEnd, onGoToMap: handleGoToMap, onIconSave: handleIconSave, onDelete: handleDelete, onShowProps: setPropsNode }

  return (
    <div className="feed-view">
      <div className="feed-view__inner">
        <FeedSection items={renderTree} cardProps={cardProps} />
      </div>

      {propsNode && (
        <NodePropertiesDialog
          node={propsNode}
          allNodes={allNodes}
          allEdges={allEdges}
          onClose={() => setPropsNode(null)}
          onSaveProps={handleSaveProps}
        />
      )}

      {activeEditActions && (
        <div className="feed-edit-bar">
          <button
            className="feed-edit-bar__btn feed-edit-bar__btn--cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={activeEditActions.cancel}
            aria-label="Cancel edit"
          >
            ✕
          </button>
          <button
            className="feed-edit-bar__btn feed-edit-bar__btn--confirm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={activeEditActions.confirm}
            aria-label="Save edit"
          >
            ✓
          </button>
        </div>
      )}
    </div>
  )
}
