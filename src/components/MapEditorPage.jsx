import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import MapHeaderBlock from './MapHeaderBlock'
import MapPropertiesModal from './MapPropertiesModal'

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

export default function MapEditorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mapId } = useParams()
  const loadMap = useMindMapStore((s) => s.loadMap)
  const currentMapName = useMindMapStore((s) => s.currentMapName)
  const breadcrumbs = useMindMapStore((s) => s.breadcrumbs)
  const [mapPropertiesOpen, setMapPropertiesOpen] = useState(false)

  useEffect(() => {
    const nextBreadcrumbs = location.state?.breadcrumbs ?? []
    loadMap(mapId, nextBreadcrumbs).then((result) => {
      if (!result?.success) navigate('/', { replace: true })
    })
  }, [loadMap, location.state, mapId, navigate])

  const isInSubmap = breadcrumbs.length > 0
  const parent = isInSubmap ? breadcrumbs[breadcrumbs.length - 1] : null

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
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setMapPropertiesOpen(true)}
            >
              Properties
            </button>
          </div>
        </div>

        <div className="map-editor-page__client">
          <div className="map-editor-page__content">
            <div className="map-editor-page__header">
              <MapHeaderBlock />
            </div>
            <div className="map-editor-page__client-inner">
              <span className="map-editor-page__eyebrow">New editor</span>
              <h1 className="map-editor-page__title">Map editor scaffold</h1>
              <p className="map-editor-page__body">
                This is the new map editor area. The sticky toolbar above is now separate from the legacy map page.
              </p>
              <p className="map-editor-page__meta">Map ID: {mapId}</p>
            </div>
          </div>
        </div>
      </div>

      <MapPropertiesModal open={mapPropertiesOpen} onClose={() => setMapPropertiesOpen(false)} />
    </>
  )
}
