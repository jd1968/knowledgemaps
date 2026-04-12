import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SettingsModal from './SettingsModal'
import ImageLibraryPage from './ImageLibraryPage'

const fmt = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return 'Today · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}

export default function HomePage() {
  const { newMap, saveMap } = useMindMapStore()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('maps')

  // Maps state
  const [maps, setMaps] = useState([])
  const [fetchingMaps, setFetchingMaps] = useState(true)
  const [opening, setOpening] = useState(null)

  // Diagrams state
  const [diagrams, setDiagrams] = useState([])
  const [fetchingDiagrams, setFetchingDiagrams] = useState(false)
  const [diagramsFetched, setDiagramsFetched] = useState(false)
  const [diagramsError, setDiagramsError] = useState(null)
  const [deletingDiagramId, setDeletingDiagramId] = useState(null)
  const [creatingDiagram, setCreatingDiagram] = useState(false)

  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('maps')
        .select('id, name, updated_at, last_visited_at')
        .eq('user_id', user.id)
        .order('last_visited_at', { ascending: false, nullsFirst: false })
        .limit(12)
      setMaps(data || [])
      setFetchingMaps(false)
    })()
  }, [user.id])

  const fetchDiagrams = async () => {
    setFetchingDiagrams(true)
    setDiagramsError(null)
    const { data, error } = await supabase
      .from('diagrams')
      .select('id, name, updated_at')
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('diagrams fetch error:', error)
      setDiagramsError(error.message)
    }
    setDiagrams(data || [])
    setFetchingDiagrams(false)
    setDiagramsFetched(true)
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    if (tab === 'diagrams' && !diagramsFetched) {
      fetchDiagrams()
    }
  }

  const handleOpen = (mapId) => {
    setOpening(mapId)
    navigate(`/map/${mapId}`)
  }

  const handleOpenLegacy = (mapId) => {
    navigate(`/legacymap/${mapId}`)
  }

  const handleNew = async () => {
    setOpening('new')
    newMap()
    const result = await saveMap()
    if (result.success) {
      const { currentMapId } = useMindMapStore.getState()
      navigate(`/map/${currentMapId}`)
    } else {
      setOpening(null)
      alert('Failed to create map')
    }
  }

  const handleNewDiagram = async () => {
    setCreatingDiagram(true)
    const { data, error } = await supabase
      .from('diagrams')
      .insert({ name: 'Untitled Diagram', data: { shapes: [], connections: [] } })
      .select('id')
      .single()
    if (error || !data) {
      setCreatingDiagram(false)
      alert('Failed to create diagram')
      return
    }
    navigate(`/diagram/${data.id}`)
  }

  const handleOpenDiagram = (diagramId) => {
    navigate(`/diagram/${diagramId}`)
  }

  const handleDeleteDiagram = async (diagramId, e) => {
    e.stopPropagation()
    if (!confirm('Delete this diagram?')) return
    setDeletingDiagramId(diagramId)
    await supabase.from('diagrams').delete().eq('id', diagramId)
    setDiagrams((prev) => prev.filter((d) => d.id !== diagramId))
    setDeletingDiagramId(null)
  }

  const avatarUrl = user?.user_metadata?.avatar_url
  const initial = (user?.user_metadata?.full_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  return (
    <>
    <div className={`home-page${activeTab === 'images' ? ' home-page--images' : ''}`}>
      <div className="home-page__inner">

        <header className="home-page__header">
          <span className="home-page__brand">Knowledge Maps</span>
          <div className="home-page__user">
            <button
              className="icon-btn"
              onClick={() => setShowSettings(true)}
              title="Settings"
              aria-label="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {avatarUrl
              ? <img className="user-avatar" src={avatarUrl} alt="" />
              : <div className="user-avatar user-avatar--initials">{initial}</div>
            }
          </div>
        </header>

        <div className="home-tabs">
          <button
            className={`home-tab${activeTab === 'maps' ? ' home-tab--active' : ''}`}
            onClick={() => handleTabChange('maps')}
          >
            Maps
          </button>
          <button
            className={`home-tab${activeTab === 'diagrams' ? ' home-tab--active' : ''}`}
            onClick={() => handleTabChange('diagrams')}
          >
            Diagrams
          </button>
          <button
            className={`home-tab${activeTab === 'images' ? ' home-tab--active' : ''}`}
            onClick={() => handleTabChange('images')}
          >
            Images
          </button>
        </div>

        {activeTab === 'maps' && (
          <>
            <div className="home-page__actions">
              <button
                className="btn btn--primary home-page__new-btn"
                onClick={handleNew}
                disabled={!!opening}
              >
                + New Map
              </button>
            </div>

            <section>
              <h2 className="home-page__section-title">Recent</h2>
              {fetchingMaps ? (
                <p className="home-page__state">Loading…</p>
              ) : maps.length === 0 ? (
                <p className="home-page__state">No maps yet.</p>
              ) : (
                <div className="home-page__grid">
                  {maps.map((map) => (
                    <article
                      key={map.id}
                      className={`home-map-tile${opening === map.id ? ' home-map-tile--opening' : ''}`}
                    >
                      <button
                        type="button"
                        className="home-map-tile__main"
                        onClick={() => handleOpen(map.id)}
                        disabled={!!opening}
                      >
                        <span className="home-map-tile__name">{map.name}</span>
                        <span className="home-map-tile__date">{fmt(map.last_visited_at ?? map.updated_at)}</span>
                      </button>
                      <div className="home-map-tile__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm home-map-tile__legacy-btn"
                          onClick={() => handleOpenLegacy(map.id)}
                          disabled={!!opening}
                        >
                          Legacy
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === 'diagrams' && (
          <>
            <div className="home-page__actions">
              <button
                className="btn btn--primary home-page__new-btn"
                onClick={handleNewDiagram}
                disabled={creatingDiagram}
              >
                + New Diagram
              </button>
            </div>

            <section>
              {fetchingDiagrams ? (
                <p className="home-page__state">Loading…</p>
              ) : diagramsError ? (
                <p className="home-page__state home-page__state--error">Error: {diagramsError}</p>
              ) : diagrams.length === 0 ? (
                <p className="home-page__state">No diagrams yet — create your first one below.</p>
              ) : (
                <div className="home-page__grid">
                  {diagrams.map((diagram) => (
                    <article key={diagram.id} className="home-map-tile">
                      <button
                        type="button"
                        className="home-map-tile__main"
                        onClick={() => handleOpenDiagram(diagram.id)}
                      >
                        <span className="home-map-tile__name">{diagram.name}</span>
                        <span className="home-map-tile__date">{fmt(diagram.updated_at)}</span>
                      </button>
                      <div className="home-map-tile__actions">
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={(e) => handleDeleteDiagram(diagram.id, e)}
                          disabled={deletingDiagramId === diagram.id}
                          aria-label="Delete diagram"
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

          </>
        )}

      </div>

      {activeTab === 'images' && <ImageLibraryPage embedded />}
    </div>
    <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}
