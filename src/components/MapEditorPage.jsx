import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import MapHeaderBlock from './MapHeaderBlock'
import MapPropertiesModal from './MapPropertiesModal'
import { NodeIconDisplay } from './NodeIcon'
import MarkdownEditor, { markdownComponents, urlTransform } from './MarkdownEditor'

const HomeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
    <polyline points="9 21 9 12 15 12 15 21" />
  </svg>
)

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const REGION_TYPE_LABELS = {
  card: 'Card',
  image: 'Image',
  diagram: 'Diagram',
}

function RegionInsertControls({ onInsert }) {
  return (
    <div className="map-editor-region-insert">
      <span className="map-editor-region-insert__label">Add region</span>
      <div className="map-editor-region-insert__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onInsert('card')}>Card</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onInsert('image')}>Image</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onInsert('diagram')}>Diagram</button>
      </div>
    </div>
  )
}

export default function MapEditorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mapId } = useParams()
  const loadMap = useMindMapStore((s) => s.loadMap)
  const currentMapName = useMindMapStore((s) => s.currentMapName)
  const breadcrumbs = useMindMapStore((s) => s.breadcrumbs)
  const regions = useMindMapStore((s) => s.currentMapRegions)
  const insertMapRegion = useMindMapStore((s) => s.insertMapRegion)
  const setMapRegions = useMindMapStore((s) => s.setMapRegions)
  const [mapPropertiesOpen, setMapPropertiesOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(true)
  const [editingRegionId, setEditingRegionId] = useState(null)
  const [regionDraftTitle, setRegionDraftTitle] = useState('')
  const [regionDraftContent, setRegionDraftContent] = useState('')

  useEffect(() => {
    const nextBreadcrumbs = location.state?.breadcrumbs ?? []
    loadMap(mapId, nextBreadcrumbs).then((result) => {
      if (!result?.success) navigate('/', { replace: true })
    })
  }, [loadMap, location.state, mapId, navigate])

  const isInSubmap = breadcrumbs.length > 0
  const parent = isInSubmap ? breadcrumbs[breadcrumbs.length - 1] : null
  const handleInsertRegion = (index, type) => {
    insertMapRegion(index, {
      type,
      title: `Untitled ${REGION_TYPE_LABELS[type]} Region`,
      iconUrl: '',
      content: '',
    })
  }
  const openRegionProperties = (region) => {
    setEditingRegionId(region.id)
    setRegionDraftTitle(region.title || '')
    setRegionDraftContent(region.content || '')
  }
  const closeRegionProperties = () => {
    setEditingRegionId(null)
    setRegionDraftTitle('')
    setRegionDraftContent('')
  }
  const saveRegionProperties = () => {
    if (!editingRegionId) return
    setMapRegions(regions.map((region) => (
      region.id === editingRegionId
        ? {
            ...region,
            title: regionDraftTitle.trim() || 'Untitled Region',
            content: regionDraftContent,
          }
        : region
    )))
    closeRegionProperties()
  }

  return (
    <>
      <div className="map-editor-page">
        <div className="map-editor-page__toolbar">
          <button
            className="toolbar-home-btn"
            onClick={() => navigate('/')}
            title="Home"
            aria-label="Home"
          >
            <HomeIcon />
          </button>

          <div className="toolbar-breadcrumb map-editor-page__breadcrumb">
            {parent ? (
              <>
                <button
                  className="toolbar-back-crumb"
                  onClick={() => navigate(`/editor/${parent.mapId}`, { state: { breadcrumbs: breadcrumbs.slice(0, -1) } })}
                  title={`Back to ${parent.mapName}`}
                  aria-label={`Back to ${parent.mapName}`}
                >
                  <BackIcon />
                  <span className="toolbar-back-crumb-name">{parent.mapName}</span>
                </button>
                <span className="toolbar-crumb-divider" aria-hidden="true">|</span>
                <span className="toolbar-crumb-current">{currentMapName || 'Untitled Map'}</span>
              </>
            ) : (
              <span className="map-editor-page__map-name">{currentMapName || 'Untitled Map'}</span>
            )}
          </div>

          <div className="map-editor-page__toolbar-actions">
            <label className="edit-mode-toggle" title={isEditMode ? 'Disable editing' : 'Enable editing'}>
              <input type="checkbox" checked={isEditMode} onChange={() => {
                setIsEditMode((prev) => {
                  const next = !prev
                  if (!next) {
                    setMapPropertiesOpen(false)
                    closeRegionProperties()
                  }
                  return next
                })
              }} />
              <span className="edit-mode-toggle__track">
                <span className="edit-mode-toggle__thumb" />
              </span>
              <span className="edit-mode-toggle__label">Edit</span>
            </label>
            {isEditMode && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setMapPropertiesOpen(true)}
              >
                Properties
              </button>
            )}
          </div>
        </div>

        <div className="map-editor-page__client">
          <div className="map-editor-page__content">
            <div className="map-editor-page__header">
              <MapHeaderBlock />
            </div>
            <div className="map-editor-page__client-inner">
              <div className="map-editor-regions">
                {isEditMode && (
                  <RegionInsertControls onInsert={(type) => handleInsertRegion(0, type)} />
                )}

                {regions.length === 0 ? (
                  <div className="map-editor-regions__empty">
                    <h2 className="map-editor-regions__empty-title">No regions yet</h2>
                    <p className="map-editor-regions__empty-body">
                      Add your first region above to start building the new editor layout for this map.
                    </p>
                    <p className="map-editor-page__meta">Map ID: {mapId}</p>
                  </div>
                ) : (
                  regions.map((region, index) => (
                    <div key={region.id} className="map-editor-region-stack">
                      {isEditMode && index > 0 && (
                        <RegionInsertControls onInsert={(type) => handleInsertRegion(index, type)} />
                      )}
                      <section className="map-editor-region" aria-label={region.title}>
                        <div className="map-editor-region__header">
                          <div className="map-editor-region__title-wrap">
                            {region.iconUrl && (
                              <NodeIconDisplay iconUrl={region.iconUrl} className="map-editor-region__icon" />
                            )}
                            <div className="map-editor-region__title-block">
                              <h2 className="map-editor-region__title">{region.title}</h2>
                            </div>
                          </div>
                          {isEditMode && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => openRegionProperties(region)}
                            >
                              Properties
                            </button>
                          )}
                        </div>
                        {region.content ? (
                          <div className="map-editor-region__content">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                              urlTransform={urlTransform}
                            >
                              {region.content}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                      </section>
                    </div>
                  ))
                )}

                {isEditMode && regions.length > 0 && (
                  <RegionInsertControls onInsert={(type) => handleInsertRegion(regions.length, type)} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <MapPropertiesModal open={isEditMode && mapPropertiesOpen} onClose={() => setMapPropertiesOpen(false)} />
      {isEditMode && editingRegionId && (
        <div
          className="node-modal-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeRegionProperties()
          }}
        >
          <div className="node-modal map-editor-region-modal" onPointerDown={(event) => event.stopPropagation()}>
            <div className="node-modal-header">
              <div className="node-modal-header-left">
                <span className="node-modal-header-title">Region Properties</span>
              </div>
              <button className="icon-btn" onClick={closeRegionProperties} aria-label="Close">x</button>
            </div>

            <div className="node-modal-body">
              <div className="field">
                <label className="field-label">Title</label>
                <input
                  className="field-input"
                  value={regionDraftTitle}
                  onChange={(event) => setRegionDraftTitle(event.target.value)}
                  placeholder="Region title..."
                  autoFocus
                />
              </div>

              <div className="field field--grow">
                <label className="field-label">Content</label>
                <div className="map-editor-region-modal__markdown">
                  <MarkdownEditor
                    content={regionDraftContent}
                    onChange={(next) => setRegionDraftContent(next)}
                    editable={true}
                  />
                </div>
              </div>
            </div>

            <div className="node-modal-footer">
              <button className="btn btn--secondary btn--sm" onClick={closeRegionProperties}>
                Cancel
              </button>
              <button className="btn btn--primary btn--sm" onClick={saveRegionProperties}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
