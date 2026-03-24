import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useMindMapStore } from '../store/useMindMapStore'
import MarkdownEditor, { markdownComponents, urlTransform } from './MarkdownEditor'
import { NodeIconDisplay, NodeIconUpload } from './NodeIcon'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function buildDFSOrder(nodes, edges) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = new Map()
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, [])
    childrenOf.get(e.source).push(e.target)
  }
  const root = nodes.find((n) => n.data?.level === 0) ?? nodes[0]
  const result = []
  const visit = (nodeId, depth) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    result.push({ node, depth })
    for (const childId of (childrenOf.get(nodeId) ?? [])) visit(childId, depth + 1)
  }
  if (root) visit(root.id, 0)
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
    if (hasChildren && (node.data.nodeType === 'group' || node.data.nodeType === 'folder')) {
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

function FeedCard({ node, nodeMap, parentMap, onSave, onEditStart, onEditEnd, onGoToMap, onIconSave }) {
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
  const typeLabel = node.data.nodeType !== 'folder' ? node.data.nodeType : null
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

/* ── FeedSection (recursive group renderer) ───────────────────────── */

function FeedSection({ items, paletteIndex = 0, cardProps }) {
  return items.map((item) => {
    if (item.type === 'card') {
      return <FeedCard key={item.node.id} node={item.node} {...cardProps} />
    }
    // group
    const title = item.node.data.longTitle || item.node.data.title
    return (
      <div key={item.node.id} className="feed-group-section">
        <div className="feed-group-header" data-level={item.node.data.level}>
          {title}
        </div>
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
              nodeType: node.data.nodeType ?? (node.data.isSubmap ? 'submap' : 'folder'),
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

  if (loading) return <div className="feed-view"><div className="feed-empty"><p>Loading feed…</p></div></div>
  if (error)   return <div className="feed-view"><div className="feed-empty"><p>{error}</p></div></div>
  if (!currentMapId) return <div className="feed-view"><div className="feed-empty"><p>No map selected.</p></div></div>
  if (orderedNodes.length === 0) return <div className="feed-view"><div className="feed-empty"><p>No nodes found in this map.</p></div></div>

  const cardProps = { nodeMap, parentMap, onSave: handleSave, onEditStart: handleEditStart, onEditEnd: handleEditEnd, onGoToMap: handleGoToMap, onIconSave: handleIconSave }

  return (
    <div className="feed-view">
      <div className="feed-view__inner">
        <FeedSection items={renderTree} cardProps={cardProps} />
      </div>

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
