import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

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
    <div className="home-page">
      <div className="home-page__inner">

        <header className="home-page__header">
          <span className="home-page__brand">Knowledge Maps</span>
          <div className="home-page__user">
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
  )
}
