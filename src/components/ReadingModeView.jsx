import { useCallback, useEffect, useRef, useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'

const truncate = (str, max = 25) => {
  if (!str) return 'Untitled'
  return str.length > max ? str.slice(0, max).trimEnd() + '…' : str
}

const ReadingModeView = () => {
  const {
    nodes,
    edges,
    readingModeNodeId,
    navigateReadingToChild,
    navigateReadingToSibling,
    navigateToSubmap,
  } = useMindMapStore()

  const [visible, setVisible] = useState(true)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const prevNodeIdRef = useRef(readingModeNodeId)
  const outlineActiveRef = useRef(null)
  const outlineRef = useRef(null)

  // Fade transition when node changes
  useEffect(() => {
    if (prevNodeIdRef.current === readingModeNodeId) return
    prevNodeIdRef.current = readingModeNodeId
    setVisible(false)
    const id = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(id)
  }, [readingModeNodeId])

  // Scroll outline active item into view when panel opens or node changes
  useEffect(() => {
    if (!outlineOpen) return
    const id = setTimeout(() => {
      outlineActiveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    return () => clearTimeout(id)
  }, [outlineOpen, readingModeNodeId])

  // Close outline on outside click
  useEffect(() => {
    if (!outlineOpen) return
    const handler = (e) => {
      if (outlineRef.current && !outlineRef.current.contains(e.target)) {
        setOutlineOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [outlineOpen])

  // Build lookup maps
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })

  const childrenOf = {}
  const parentOf = {}
  edges.forEach(e => {
    if (!childrenOf[e.source]) childrenOf[e.source] = []
    childrenOf[e.source].push(e.target)
    parentOf[e.target] = e.source
  })

  // Resolve current node
  const rootNode = nodes.find(n => n.data?.level === 0) ?? nodes[0]
  const currentNode = readingModeNodeId ? nodeById[readingModeNodeId] : rootNode

  // Navigate directly to any node, rebuilding a clean drill history
  const navigateDirect = useCallback((targetId) => {
    const ancestorPath = []
    let cur = parentOf[targetId]
    while (cur !== undefined) {
      ancestorPath.unshift(cur)
      cur = parentOf[cur]
    }
    const history = ancestorPath.map(nodeId => ({ nodeId, via: 'drill' }))
    useMindMapStore.setState({ readingModeNodeId: targetId, readingModeHistory: history })
    setOutlineOpen(false)
  }, [parentOf])

  if (!currentNode) {
    return (
      <div className="reading-mode-view">
        <div className="reading-mode-scroll">
          <div className="reading-card">
            <p className="reading-content-empty">No map content found.</p>
          </div>
        </div>
      </div>
    )
  }

  // Children
  const childIds = childrenOf[currentNode.id] ?? []
  const children = childIds
    .map(id => nodeById[id])
    .filter(Boolean)
    .sort((a, b) => (a.data?.title || '').localeCompare(b.data?.title || ''))

  // Siblings
  const parentId = parentOf[currentNode.id]
  const siblings = parentId
    ? (childrenOf[parentId] ?? [])
        .map(id => nodeById[id])
        .filter(Boolean)
        .sort((a, b) => (a.data?.title || '').localeCompare(b.data?.title || ''))
    : []
  const siblingIds = siblings.map(n => n.id)
  const siblingIndex = siblingIds.indexOf(currentNode.id)
  const nextSiblingId = siblingIndex >= 0 && siblingIndex < siblingIds.length - 1
    ? siblingIds[siblingIndex + 1]
    : null

  // Build flat outline list (depth-first)
  const buildOutline = () => {
    const result = []
    const visit = (nodeId, depth) => {
      const node = nodeById[nodeId]
      if (!node) return
      const kids = (childrenOf[nodeId] ?? [])
        .map(id => nodeById[id])
        .filter(Boolean)
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      result.push({ node, depth })
      kids.forEach(k => visit(k.id, depth + 1))
    }
    if (rootNode) visit(rootNode.id, 0)
    return result
  }

  const outlineNodes = outlineOpen ? buildOutline() : []

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === 'Escape') {
        if (outlineOpen) { setOutlineOpen(false); return }
        if (parentId) navigateDirect(parentId)
        return
      }
      if ((e.key === 'ArrowRight' || e.key === 'n') && nextSiblingId) {
        navigateReadingToSibling(nextSiblingId)
      } else if (e.key === 'Backspace') {
        if (parentId) navigateDirect(parentId)
      } else if (e.key === 'Enter' && children.length > 0) {
        const first = children[0]
        if (first.data?.isSubmap && first.data?.submapId) {
          navigateToSubmap(first.data.submapId)
        } else {
          navigateReadingToChild(first.id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [nextSiblingId, children, parentId, outlineOpen,
      navigateReadingToSibling, navigateReadingToChild, navigateToSubmap, navigateDirect])

  const handleChildClick = (child) => {
    if (child.data?.isSubmap && child.data?.submapId) {
      navigateToSubmap(child.data.submapId)
    } else {
      navigateReadingToChild(child.id)
    }
  }

  const contentHtml = currentNode.data?.content
  const hasContent = contentHtml && contentHtml !== '<p></p>' && contentHtml !== ''

  return (
    <div className="reading-mode-view">

      {/* Outline panel */}
      <div
        ref={outlineRef}
        className={`reading-outline-panel${outlineOpen ? ' reading-outline-panel--open' : ''}`}
        aria-hidden={!outlineOpen}
      >
        <div className="reading-outline-header">
          <span>Outline</span>
          <button className="reading-outline-close" onClick={() => setOutlineOpen(false)} aria-label="Close outline">✕</button>
        </div>
        <div className="reading-outline-list">
          {outlineNodes.map(({ node, depth }) => (
            <button
              key={node.id}
              ref={node.id === currentNode.id ? outlineActiveRef : null}
              className={`reading-outline-item${node.id === currentNode.id ? ' reading-outline-item--active' : ''}`}
              style={{ paddingLeft: `${14 + depth * 14}px` }}
              onClick={() => navigateDirect(node.id)}
            >
              {node.data?.title || 'Untitled'}
            </button>
          ))}
        </div>
      </div>

      <div className="reading-mode-scroll">
        <div className={`reading-card ${visible ? 'reading-card--visible' : 'reading-card--hidden'}`}>

          {/* Back + Breadcrumb row */}
          <div className="reading-nav-row">
            <button
              className={`reading-outline-toggle${outlineOpen ? ' reading-outline-toggle--open' : ''}`}
              onClick={() => setOutlineOpen(o => !o)}
              title="Toggle outline"
              aria-label="Toggle outline"
              aria-expanded={outlineOpen}
            >
              ☰
            </button>
            {parentId && (
              <button className="reading-back-btn" onClick={() => navigateDirect(parentId)}>
                ← {nodeById[parentId]?.data?.title || 'Back'}
              </button>
            )}
          </div>

          {/* Node title */}
          <h1 className="reading-title">
            {currentNode.data?.title || <span className="reading-content-empty">Untitled</span>}
          </h1>

          {/* Rich text content */}
          {hasContent && (
            <div
              className="reading-content"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          )}

          {/* Children */}
          {children.length > 0 && (
            <div className="reading-children-pills">
              {children.map(child => {
                const hasChildContent = !!(child.data?.content && child.data.content !== '<p></p>' && child.data.content !== '')
                return (
                  <button
                    key={child.id}
                    className="reading-child-pill"
                    onClick={() => handleChildClick(child)}
                  >
                    {child.data?.title || 'Untitled'}
                    {hasChildContent && <span className="reading-child-has-content">≡</span>}
                  </button>
                )
              })}
            </div>
          )}


        </div>
      </div>

      {/* Sibling navigation — sticky footer */}
      {nextSiblingId && (
        <div className="reading-siblings">
          <div />
          <div>
            <button className="reading-sibling-btn" onClick={() => navigateReadingToSibling(nextSiblingId)}>
              {truncate(nodeById[nextSiblingId]?.data?.title)} →
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

export default ReadingModeView
