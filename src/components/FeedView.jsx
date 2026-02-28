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

function FeedCard({ node, index, nodeMap, parentMap, onSave }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [localTitle, setLocalTitle] = useState(node.data.title)
  const [localContent, setLocalContent] = useState(node.data.content)
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const contentRef = useRef(null)
  const titleInputRef = useRef(null)
  const contentCancelledRef = useRef(false)
  const contentConfirmedRef = useRef(false)

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select()
  }, [editingTitle])

  useEffect(() => {
    if (!editingContent) return
    const handler = (e) => { if (e.key === 'Escape') cancelContent() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingContent]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!contentRef.current || expanded || editingContent) return
    setIsClamped(contentRef.current.scrollHeight > contentRef.current.clientHeight + 2)
  }, [localContent, expanded, editingContent])

  const commitTitle = () => {
    setEditingTitle(false)
    const trimmed = localTitle.trim() || node.data.title
    setLocalTitle(trimmed)
    if (trimmed !== node.data.title) onSave(node, { title: trimmed })
  }

  const cancelTitle = () => {
    setLocalTitle(node.data.title)
    setEditingTitle(false)
  }

  const commitContent = (html) => {
    if (contentCancelledRef.current) { contentCancelledRef.current = false; return }
    if (contentConfirmedRef.current) { contentConfirmedRef.current = false; return }
    setEditingContent(false)
    setLocalContent(html)
    if (html !== node.data.content) onSave(node, { content: html })
  }

  const confirmContent = () => {
    contentConfirmedRef.current = true
    setEditingContent(false)
    if (localContent !== node.data.content) onSave(node, { content: localContent })
  }

  const cancelContent = () => {
    contentCancelledRef.current = true
    setLocalContent(node.data.content)
    setEditingContent(false)
  }

  const crumbs = getAncestorCrumbs(node.id, nodeMap, parentMap)
  const typeLabel = node.data.nodeType !== 'folder' ? node.data.nodeType : null

  return (
    <div className={`feed-card${editingContent ? ' feed-card--editing' : ''}`}
      style={{ animationDelay: `${(index % BATCH_SIZE) * 40}ms` }}>

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
          <div className="feed-card__title-edit-row">
            <input
              ref={titleInputRef}
              className="feed-card__title-input"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
                if (e.key === 'Escape') cancelTitle()
              }}
            />
            <button className="feed-card__inline-btn feed-card__inline-btn--confirm" onMouseDown={(e) => e.preventDefault()} onClick={commitTitle} title="Confirm">✓</button>
            <button className="feed-card__inline-btn feed-card__inline-btn--cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancelTitle} title="Cancel">✕</button>
          </div>
        ) : (
          <h3
            className="feed-card__title feed-card__title--editable"
            onClick={() => setEditingTitle(true)}
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
            onBlur={commitContent}
            onEscape={cancelContent}
            editable
          />
          <div className="feed-card__edit-actions">
            <button className="feed-card__action-btn feed-card__action-btn--confirm" onMouseDown={(e) => e.preventDefault()} onClick={confirmContent} title="Save">✓</button>
            <button className="feed-card__action-btn feed-card__action-btn--cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancelContent} title="Cancel">✕</button>
          </div>
        </div>
      ) : (
        <div
          className="feed-card__content-wrap feed-card__content-wrap--clickable"
          onClick={() => setEditingContent(true)}
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
  const loaderRef = useRef(null)

  useEffect(() => {
    async function loadAll() {
      try {
        const [mapsResult, contentsResult] = await Promise.all([
          supabase.from('maps').select('id, name, data'),
          supabase.from('nodes').select('id, content'),
        ])

        if (mapsResult.error) throw mapsResult.error
        if (contentsResult.error) throw contentsResult.error

        const contentById = new Map(
          contentsResult.data.map((n) => [n.id, n.content || ''])
        )

        const mergedNodes = []
        const mergedEdges = []

        for (const map of mapsResult.data) {
          const mapNodes = map.data?.nodes || []
          const mapEdges = map.data?.edges || []

          mergedEdges.push(...mapEdges)

          for (const node of mapNodes) {
            const content = contentById.get(node.id) || ''
            mergedNodes.push({
              ...node,
              _feedMapId: map.id,
              data: {
                ...node.data,
                nodeType: node.data.nodeType ?? (node.data.isSubmap ? 'submap' : 'folder'),
                content,
              },
            })
          }
        }

        const initialContent = mergedNodes.filter(
          (n) => n.data.level > 0 && !n.data.isSubmap && n.data.nodeType !== 'group' && hasVisibleContent(n.data.content)
        )

        setAllNodes(mergedNodes)
        setAllEdges(mergedEdges)
        setFeedItems(randomBatch(initialContent))
      } catch (err) {
        console.error('Feed load failed:', err)
        setError('Failed to load feed.')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
  }, [])

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

  const handleSave = useCallback(async (node, changes) => {
    // Optimistically update allNodes so future batches reflect the edit
    setAllNodes((prev) => prev.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, ...changes } } : n
    ))

    // Keep the map canvas in sync if the node belongs to the currently loaded map
    if (node._feedMapId === currentMapId) {
      updateNodeData(node.id, changes)
    }

    try {
      // Update the nodes table (content and/or title)
      await supabase.from('nodes').update(changes).eq('id', node.id)

      // Title also lives in the map's JSONB structure — update that too
      if (changes.title !== undefined) {
        const { data: map } = await supabase
          .from('maps').select('data').eq('id', node._feedMapId).single()
        if (map) {
          const updatedNodes = map.data.nodes.map((n) =>
            n.id === node.id
              ? { ...n, data: { ...n.data, title: changes.title } }
              : n
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
  }, [])

  if (loading) {
    return (
      <div className="feed-view">
        <div className="feed-empty"><p>Loading feed…</p></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="feed-view">
        <div className="feed-empty"><p>{error}</p></div>
      </div>
    )
  }

  if (contentNodes.length === 0) {
    return (
      <div className="feed-view">
        <div className="feed-empty"><p>No nodes with content found across your maps.</p></div>
      </div>
    )
  }

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
          />
        ))}
        <div ref={loaderRef} className="feed-loader" aria-hidden="true" />
      </div>
    </div>
  )
}
