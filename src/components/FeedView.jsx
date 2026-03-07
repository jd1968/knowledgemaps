import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMindMapStore } from '../store/useMindMapStore'
import RichTextEditor from './RichTextEditor'

const BATCH_SIZE = 10

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function randomBatch(nodes) {
  return shuffle(nodes).slice(0, BATCH_SIZE)
}

function hasVisibleContent(content) {
  if (!content) return false
  return content.replace(/<[^>]+>/g, '').trim() !== ''
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

function FeedCard({ node, index, nodeMap, parentMap, onSave, onEditStart, onEditEnd }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [localTitle, setLocalTitle] = useState(node.data.title)
  const [localContent, setLocalContent] = useState(node.data.content)
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const contentRef = useRef(null)
  const titleInputRef = useRef(null)

  // Always-current value refs — avoid stale closures in registered callbacks
  const localTitleRef = useRef(localTitle)
  useEffect(() => { localTitleRef.current = localTitle }, [localTitle])
  const localContentRef = useRef(localContent)
  useEffect(() => { localContentRef.current = localContent }, [localContent])

  // Flags to suppress double-save when blur fires after a manual confirm/cancel
  const titleHandledRef = useRef(false)
  const contentHandledRef = useRef(false)

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select()
  }, [editingTitle])

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

  const startTitleEdit = () => {
    setEditingTitle(true)
    onEditStart(
      () => {  // confirm from fixed bar
        if (titleHandledRef.current) return
        titleHandledRef.current = true
        setEditingTitle(false)
        onEditEnd()
        const trimmed = localTitleRef.current.trim() || node.data.title
        setLocalTitle(trimmed)
        if (trimmed !== node.data.title) onSave(node, { title: trimmed })
      },
      () => {  // cancel from fixed bar
        if (titleHandledRef.current) return
        titleHandledRef.current = true
        setLocalTitle(node.data.title)
        setEditingTitle(false)
        onEditEnd()
      }
    )
  }

  // Natural blur (clicking outside, not via fixed bar)
  const commitTitleOnBlur = () => {
    if (titleHandledRef.current) { titleHandledRef.current = false; return }
    setEditingTitle(false)
    onEditEnd()
    const trimmed = localTitleRef.current.trim() || node.data.title
    setLocalTitle(trimmed)
    if (trimmed !== node.data.title) onSave(node, { title: trimmed })
  }

  const cancelTitleOnEscape = () => {
    if (titleHandledRef.current) return
    titleHandledRef.current = true
    setLocalTitle(node.data.title)
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
  const commitContentOnBlur = (html) => {
    if (contentHandledRef.current) { contentHandledRef.current = false; return }
    setEditingContent(false)
    onEditEnd()
    setLocalContent(html)
    if (html !== node.data.content) onSave(node, { content: html })
  }

  const crumbs = getAncestorCrumbs(node.id, nodeMap, parentMap)
  const typeLabel = node.data.nodeType !== 'folder' ? node.data.nodeType : null

  return (
    <div
      className={`feed-card${(editingTitle || editingContent) ? ' feed-card--editing' : ''}`}
      style={{ animationDelay: `${(index % BATCH_SIZE) * 40}ms` }}
    >
      {crumbs && (
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
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="feed-card__title-input"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitleOnBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur()
              if (e.key === 'Escape') cancelTitleOnEscape()
            }}
          />
        ) : (
          <h3
            className="feed-card__title feed-card__title--editable"
            onClick={startTitleEdit}
            title="Click to edit"
          >
            {localTitle}
          </h3>
        )}
        {typeLabel && !editingTitle && (
          <span className="feed-card__type-badge">{typeLabel}</span>
        )}
      </div>

      {editingContent ? (
        <div className="feed-card__editor-wrap">
          <RichTextEditor
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
            dangerouslySetInnerHTML={{ __html: localContent }}
          />
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

/* ── FeedView ──────────────────────────────────────────────────────── */

export default function FeedView() {
  const currentMapId = useMindMapStore((s) => s.currentMapId)
  const updateNodeData = useMindMapStore((s) => s.updateNodeData)

  const [allNodes, setAllNodes] = useState([])
  const [allEdges, setAllEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [feedItems, setFeedItems] = useState([])
  const [activeEditActions, setActiveEditActions] = useState(null)
  const loaderRef = useRef(null)

  useEffect(() => {
    if (!currentMapId) {
      setAllNodes([])
      setAllEdges([])
      setFeedItems([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    async function loadAll() {
      try {
        const [mapResult, contentsResult] = await Promise.all([
          supabase.from('maps').select('id, name, data').eq('id', currentMapId).single(),
          supabase.from('nodes').select('id, content').eq('map_id', currentMapId),
        ])

        if (mapResult.error) throw mapResult.error
        if (contentsResult.error) throw contentsResult.error

        const contentById = new Map(
          contentsResult.data.map((n) => [n.id, n.content || ''])
        )

        const map = mapResult.data
        const mapNodes = map.data?.nodes || []
        const mapEdges = map.data?.edges || []

        const mergedNodes = mapNodes.map((node) => ({
          ...node,
          _feedMapId: map.id,
          data: {
            ...node.data,
            nodeType: node.data.nodeType ?? (node.data.isSubmap ? 'submap' : 'folder'),
            content: contentById.get(node.id) || '',
          },
        }))

        const initialContent = mergedNodes.filter(
          (n) => n.data.level > 0 && !n.data.isSubmap && n.data.nodeType !== 'group' && hasVisibleContent(n.data.content)
        )

        setAllNodes(mergedNodes)
        setAllEdges(mapEdges)
        setFeedItems(randomBatch(initialContent))
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

  const contentNodes = useMemo(
    () => allNodes.filter(
      (n) => n.data.level > 0 && !n.data.isSubmap && n.data.nodeType !== 'group' && hasVisibleContent(n.data.content)
    ),
    [allNodes]
  )

  const loadMore = useCallback(() => {
    if (contentNodes.length === 0) return
    setFeedItems((prev) => [...prev, ...randomBatch(contentNodes)])
  }, [contentNodes])

  useEffect(() => {
    const el = loaderRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const handleEditStart = useCallback((confirm, cancel) => {
    setActiveEditActions({ confirm, cancel })
  }, [])

  const handleEditEnd = useCallback(() => {
    setActiveEditActions(null)
  }, [])

  const handleSave = useCallback(async (node, changes) => {
    setAllNodes((prev) => prev.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, ...changes } } : n
    ))
    if (node._feedMapId === currentMapId) {
      updateNodeData(node.id, changes)
    }
    try {
      await supabase.from('nodes').update(changes).eq('id', node.id)
      if (changes.title !== undefined) {
        const { data: map } = await supabase
          .from('maps').select('data').eq('id', node._feedMapId).single()
        if (map) {
          const updatedNodes = map.data.nodes.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, title: changes.title } } : n
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

  if (loading) return <div className="feed-view"><div className="feed-empty"><p>Loading feed…</p></div></div>
  if (error)   return <div className="feed-view"><div className="feed-empty"><p>{error}</p></div></div>
  if (!currentMapId) return <div className="feed-view"><div className="feed-empty"><p>No map selected.</p></div></div>
  if (contentNodes.length === 0) return <div className="feed-view"><div className="feed-empty"><p>No nodes with content found in this map.</p></div></div>

  return (
    <div className="feed-view">
      <div className="feed-view__inner">
        {feedItems.map((node, i) => (
          <FeedCard
            key={`${node.id}-${i}`}
            node={node}
            index={i}
            nodeMap={nodeMap}
            parentMap={parentMap}
            onSave={handleSave}
            onEditStart={handleEditStart}
            onEditEnd={handleEditEnd}
          />
        ))}
        <div ref={loaderRef} className="feed-loader" aria-hidden="true" />
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
