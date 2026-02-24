import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'

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

// Build ancestor titles for a node, skipping root (level 0).
// Returns a collapsed list of titles if depth > 3.
function getAncestorCrumbs(nodeId, nodeMap, parentMap) {
  const ancestors = []
  let current = nodeId
  while (true) {
    const parentId = parentMap.get(current)
    if (!parentId) break
    const parent = nodeMap.get(parentId)
    if (!parent) break
    ancestors.unshift(parent.data.title)
    current = parentId
  }
  if (ancestors.length === 0) return null
  if (ancestors.length <= 3) return ancestors
  // Collapse: first … last
  return [ancestors[0], '…', ancestors[ancestors.length - 1]]
}

/* ── FeedCard ──────────────────────────────────────────────────────── */

function FeedCard({ node, index, nodeMap, parentMap }) {
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    if (!contentRef.current || expanded) return
    setIsClamped(contentRef.current.scrollHeight > contentRef.current.clientHeight + 2)
  }, [node.data.content, expanded])

  const crumbs = getAncestorCrumbs(node.id, nodeMap, parentMap)
  const typeLabel = node.data.nodeType !== 'folder' ? node.data.nodeType : null

  return (
    <div className="feed-card" style={{ animationDelay: `${(index % BATCH_SIZE) * 40}ms` }}>
      {crumbs && (
        <div className="feed-card__breadcrumb" aria-label="Location">
          {crumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span className="feed-card__breadcrumb-sep" aria-hidden="true"> › </span>}
              <span className={crumb === '…' ? 'feed-card__breadcrumb-ellipsis' : 'feed-card__breadcrumb-crumb'}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="feed-card__header">
        <h3 className="feed-card__title">{node.data.title}</h3>
        {typeLabel && <span className="feed-card__type-badge">{typeLabel}</span>}
      </div>

      <div className="feed-card__content-wrap">
        <div
          ref={contentRef}
          className={`feed-card__content${expanded ? ' feed-card__content--expanded' : ''}`}
          dangerouslySetInnerHTML={{ __html: node.data.content }}
        />
        {!expanded && isClamped && (
          <button className="feed-card__show-more" onClick={() => setExpanded(true)}>
            Show more…
          </button>
        )}
        {expanded && (
          <button className="feed-card__show-more" onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

/* ── FeedView ──────────────────────────────────────────────────────── */

export default function FeedView() {
  const nodes = useMindMapStore((s) => s.nodes)
  const edges = useMindMapStore((s) => s.edges)
  const [feedItems, setFeedItems] = useState([])
  const loaderRef = useRef(null)

  // Lookup maps — recomputed only when nodes/edges change
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const parentMap = useMemo(() => {
    const m = new Map()
    for (const e of edges) m.set(e.target, e.source)
    return m
  }, [edges])

  // Only nodes that have real content
  const contentNodes = useMemo(
    () => nodes.filter(
      (n) => n.data.level > 0 && !n.data.isSubmap && n.data.nodeType !== 'group' && hasVisibleContent(n.data.content)
    ),
    [nodes]
  )

  useEffect(() => {
    if (contentNodes.length > 0) {
      setFeedItems(randomBatch(contentNodes))
    }
  }, [nodes]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (contentNodes.length === 0) {
    return (
      <div className="feed-view">
        <div className="feed-empty">
          <p>No nodes with content to show in this map.</p>
        </div>
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
          />
        ))}
        <div ref={loaderRef} className="feed-loader" aria-hidden="true" />
      </div>
    </div>
  )
}
