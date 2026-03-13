import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SettingsModal from './SettingsModal'

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
  const [maps, setMaps] = useState([])
  const [fetching, setFetching] = useState(true)
  const [opening, setOpening] = useState(null)
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
      setFetching(false)
    })()
  }, [user.id])

  const handleOpen = (mapId) => {
    navigate(`/map/${mapId}`)
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

  const avatarUrl = user?.user_metadata?.avatar_url
  const initial = (user?.user_metadata?.full_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  return (
    <>
    <div className="home-page">
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

        <section>
          <h2 className="home-page__section-title">Recent</h2>
          {fetching ? (
            <p className="home-page__state">Loading…</p>
          ) : maps.length === 0 ? (
            <p className="home-page__state">No maps yet — create your first one below.</p>
          ) : (
            <div className="home-page__grid">
              {maps.map((map) => (
                <button
                  key={map.id}
                  className={`home-map-tile${opening === map.id ? ' home-map-tile--opening' : ''}`}
                  onClick={() => handleOpen(map.id)}
                  disabled={!!opening}
                >
                  <span className="home-map-tile__name">{map.name}</span>
                  <span className="home-map-tile__date">{fmt(map.last_visited_at ?? map.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="home-page__actions">
          <button
            className="btn btn--primary home-page__new-btn"
            onClick={handleNew}
            disabled={!!opening}
          >
            + New Map
          </button>
        </div>

      </div>
    </div>
    {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
