import { useEffect, useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const MapListModal = () => {
  const { isMapListOpen, closeMapList, loadMap, currentMapId } = useMindMapStore()
  const { user } = useAuth()
  const [maps, setMaps] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isMapListOpen) fetchMaps()
  }, [isMapListOpen])

  const fetchMaps = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('maps')
        .select('id, name, updated_at, created_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
      if (error) throw error
      setMaps(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoad = async (mapId) => {
    const result = await loadMap(mapId)
    if (result.success) {
      closeMapList()
    } else {
      alert('Failed to load map: ' + result.error?.message)
    }
  }

  const handleDelete = async (mapId, name, e) => {
    e.stopPropagation()
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('maps').delete().eq('id', mapId)
    if (error) {
      alert('Delete failed: ' + error.message)
    } else {
      setMaps((prev) => prev.filter((m) => m.id !== mapId))
    }
  }

  const fmt = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  if (!isMapListOpen) return null

  return (
    <div className="modal-overlay" onClick={closeMapList}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Open Map</h2>
          <button className="icon-btn" onClick={closeMapList} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {loading && <div className="modal-state">Loading…</div>}
          {error && <div className="modal-state modal-state--error">Error: {error}</div>}
          {!loading && !error && maps.length === 0 && (
            <div className="modal-state modal-state--empty">
              No saved maps yet. Save a map to see it here.
            </div>
          )}

          <ul className="map-list">
            {maps.map((map) => (
              <li
                key={map.id}
                className={`map-item${map.id === currentMapId ? ' map-item--current' : ''}`}
                onClick={() => handleLoad(map.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad(map.id)}
              >
                <div className="map-item-info">
                  <span className="map-item-name">{map.name}</span>
                  <span className="map-item-date">{fmt(map.updated_at)}</span>
                </div>
                <button
                  className="icon-btn icon-btn--danger"
                  onClick={(e) => handleDelete(map.id, map.name, e)}
                  title="Delete map"
                  aria-label="Delete"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default MapListModal
