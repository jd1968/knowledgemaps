import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOnViewportChange } from '@xyflow/react'
import { useMindMapStore } from '../store/useMindMapStore'
import NodeModal from './NodeModal'

const POPUP_WIDTH = 284
const MARGIN = 14
const LEVEL_LABELS = { 0: 'Root', 1: 'Main Topic', 2: 'Subtopic', 3: 'Detail' }

function getPopupPos(rect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const minTop = 64 // below toolbar
  const clampTop = (t) => Math.max(minTop, Math.min(t, vh - 220))

  // Prefer right of node
  if (rect.right + MARGIN + POPUP_WIDTH <= vw - 16)
    return { left: rect.right + MARGIN, top: clampTop(rect.top) }

  // Try left of node
  if (rect.left - MARGIN - POPUP_WIDTH >= 16)
    return { left: rect.left - MARGIN - POPUP_WIDTH, top: clampTop(rect.top) }

  // Below node (centered on it)
  return {
    left: Math.max(16, Math.min(rect.left + (rect.width - POPUP_WIDTH) / 2, vw - POPUP_WIDTH - 16)),
    top: Math.min(rect.bottom + MARGIN, vh - 220),
  }
}

export default function NodePopup() {
  const nodes       = useMindMapStore((s) => s.nodes)
  const selectedNodeId = useMindMapStore((s) => s.selectedNodeId)
  const deselectNode   = useMindMapStore((s) => s.deselectNode)

  const popupRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [showModal, setShowModal] = useState(false)

  // Hide modal when selection changes
  useEffect(() => { setShowModal(false) }, [selectedNodeId])

  const updatePos = useCallback(() => {
    if (!selectedNodeId) { setPos(null); return }
    const el = document.querySelector(`.react-flow__node[data-id="${selectedNodeId}"]`)
    if (el) setPos(getPopupPos(el.getBoundingClientRect()))
  }, [selectedNodeId])

  // Recalculate on selection change
  useLayoutEffect(updatePos, [updatePos])

  // Recalculate on pan/zoom and resize
  useOnViewportChange({ onChange: updatePos })
  useEffect(() => {
    window.addEventListener('resize', updatePos)
    return () => window.removeEventListener('resize', updatePos)
  }, [updatePos])

  // Close when clicking outside (toolbar, etc.) — pane clicks handled by onPaneClick in canvas
  useEffect(() => {
    if (!selectedNodeId) return
    const onPointerDown = (e) => {
      if (popupRef.current?.contains(e.target)) return
      if (e.target.closest?.('.react-flow__node')) return
      if (e.target.closest?.('.react-flow__pane')) return
      if (e.target.closest?.('.node-modal-overlay')) return
      deselectNode()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [selectedNodeId, deselectNode])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  if (!selectedNode || !pos) return null

  const { title, level, overview, isSubmap } = selectedNode.data
  const levelLabel = LEVEL_LABELS[Math.min(level ?? 0, 3)] || 'Node'

  return createPortal(
    <>
      {!showModal && (
        <div
          ref={popupRef}
          className="node-popup"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="node-popup-header">
            <div className="node-popup-badges">
              <span className="level-badge" data-level={Math.min(level ?? 0, 3)}>
                {levelLabel} · L{level}
              </span>
              {isSubmap && <span className="submap-badge">Submap</span>}
            </div>
            <div className="node-popup-title">{title || 'Untitled'}</div>
          </div>

          <div className="node-popup-overview">
            {overview
              ? <p>{overview}</p>
              : <p className="node-popup-empty">No overview yet</p>
            }
          </div>

          <div className="node-popup-footer">
            <button
              className="btn btn--primary btn--sm"
              onClick={() => setShowModal(true)}
            >
              More →
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <NodeModal
          node={selectedNode}
          onClose={() => { setShowModal(false); deselectNode() }}
        />
      )}
    </>,
    document.body
  )
}
