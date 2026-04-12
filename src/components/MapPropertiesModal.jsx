import { useEffect, useMemo, useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'
import { NodeIconDisplay } from './NodeIcon'
import { ImageLibraryTrigger } from '../image-library'
import MarkdownEditor from './MarkdownEditor'
import PropertiesPanel from './PropertiesPanel'

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

  const resolvedName = useMemo(() => name.trim() || 'Untitled Map', [name])

  const handleSave = () => {
    setMapProperties({ name: resolvedName, iconUrl, content })
    onClose()
  }

  return (
    <PropertiesPanel
      open={open}
      title="Map Properties"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary btn--sm" onClick={handleSave}>Save</button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">Map Name</label>
        <input
          className="field-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Map name..."
          autoFocus
        />
      </div>

      <div className="field">
        <label className="field-label">Icon</label>
        <div className="map-properties-icon-row">
          <div className="map-properties-icon-preview" aria-hidden="true">
            {iconUrl
              ? <NodeIconDisplay iconUrl={iconUrl} className="map-properties-icon-image" />
              : <span className="map-properties-icon-placeholder">No icon</span>}
          </div>
          <div className="map-properties-icon-actions">
            <ImageLibraryTrigger onSelect={(url) => setIconUrl(url)} />
            {iconUrl && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setIconUrl('')}>
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
    </PropertiesPanel>
  )
}
