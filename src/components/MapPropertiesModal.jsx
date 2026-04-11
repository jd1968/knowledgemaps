import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import { NodeIconDisplay } from './NodeIcon'
import { ImageLibraryTrigger } from '../image-library'
import MarkdownEditor from './MarkdownEditor'

export default function MapPropertiesModal({ open, onClose }) {
  const currentMapName = useMindMapStore((s) => s.currentMapName)
  const currentMapIconUrl = useMindMapStore((s) => s.currentMapIconUrl)
  const currentMapContent = useMindMapStore((s) => s.currentMapContent)
  const setMapProperties = useMindMapStore((s) => s.setMapProperties)

  const [name, setName] = useState(currentMapName || '')
  const [iconUrl, setIconUrl] = useState(currentMapIconUrl || '')
  const [content, setContent] = useState(currentMapContent || '')

  useEffect(() => {
    if (!open) return
    setName(currentMapName || '')
    setIconUrl(currentMapIconUrl || '')
    setContent(currentMapContent || '')
  }, [open, currentMapName, currentMapIconUrl, currentMapContent])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const resolvedName = useMemo(() => name.trim() || 'Untitled Map', [name])

  if (!open) return null

  return createPortal(
    <div
      className="node-modal-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="node-modal map-properties-modal" onPointerDown={(event) => event.stopPropagation()}>
        <div className="node-modal-header">
          <div className="node-modal-header-left">
            <span className="node-modal-header-title">Map Properties</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">x</button>
        </div>

        <div className="node-modal-body">
          <div className="field">
            <label className="field-label">Map Name</label>
            <input
              className="field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Map name..."
              autoFocus
            />
          </div>

          <div className="field">
            <label className="field-label">Icon</label>
            <div className="map-properties-icon-row">
              <div className="map-properties-icon-preview" aria-hidden="true">
                {iconUrl ? <NodeIconDisplay iconUrl={iconUrl} className="map-properties-icon-image" /> : <span className="map-properties-icon-placeholder">No icon</span>}
              </div>
              <div className="map-properties-icon-actions">
                <ImageLibraryTrigger onSelect={(url) => setIconUrl(url)} />
                {iconUrl && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setIconUrl('')}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="field field--grow">
            <label className="field-label">Map Content</label>
            <div className="map-properties-markdown-wrap">
              <MarkdownEditor
                content={content}
                onChange={(next) => setContent(next)}
                editable={true}
              />
            </div>
          </div>
        </div>

        <div className="node-modal-footer">
          <button className="btn btn--secondary btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => {
              setMapProperties({ name: resolvedName, iconUrl, content })
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
