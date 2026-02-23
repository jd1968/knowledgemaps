import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function SubmapChoiceModal({
  open,
  onClose,
  onCreateNew,
  onSelectExisting,
  currentMapId,
  existingDisabledReason = '',
}) {
  const { user } = useAuth()
  const [step, setStep] = useState('choice')
  const [maps, setMaps] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('choice')
    setError('')
    setMaps([])
  }, [open])

  const loadMaps = async () => {
    if (!user?.id) return
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchErr } = await supabase
        .from('maps')
        .select('id, name, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
      if (fetchErr) throw fetchErr
      setMaps((data || []).filter((m) => m.id !== currentMapId))
      setStep('existing')
    } catch (e) {
      setError(e.message || 'Failed to load maps.')
    } finally {
      setLoading(false)
    }
  }

  const emptyMessage = useMemo(
    () => (currentMapId ? 'No other saved maps found.' : 'No saved maps found.'),
    [currentMapId]
  )

  if (!open) return null

  return createPortal(
    <div className="submap-choice-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="submap-choice-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="submap-choice-header">
          <h3>Set Submap Target</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === 'choice' ? (
          <div className="submap-choice-body">
            <p>Choose whether this node should link to a brand-new submap or an existing map.</p>
            {existingDisabledReason && (
              <p className="submap-choice-warning">{existingDisabledReason}</p>
            )}
            <div className="submap-choice-actions">
              <button className="btn btn--primary btn--sm" onClick={onCreateNew}>
                Create New Submap
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={loadMaps}
                disabled={!!existingDisabledReason}
              >
                Use Existing Map
              </button>
              <button className="btn btn--secondary btn--sm" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="submap-choice-body">
            <p>Select an existing map to link as the submap.</p>
            {loading && <div className="modal-state">Loading…</div>}
            {error && <div className="modal-state modal-state--error">{error}</div>}
            {!loading && !error && maps.length === 0 && (
              <div className="modal-state modal-state--empty">{emptyMessage}</div>
            )}
            {!loading && !error && maps.length > 0 && (
              <ul className="submap-choice-list">
                {maps.map((map) => (
                  <li key={map.id}>
                    <button
                      className="submap-choice-item"
                      onClick={() => onSelectExisting(map)}
                    >
                      <span className="submap-choice-item-name">{map.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="submap-choice-actions">
              <button className="btn btn--secondary btn--sm" onClick={() => setStep('choice')}>
                Back
              </button>
              <button className="btn btn--secondary btn--sm" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
