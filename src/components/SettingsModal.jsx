import { useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'

export default function SettingsModal({ onClose }) {
  const { settings, saveSettings } = useMindMapStore()
  const [initialZoom, setInitialZoom] = useState(settings.initialZoom)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const result = await saveSettings({ initialZoom })
    setSaving(false)
    if (result.success) {
      onClose()
    } else {
      setError('Failed to save settings. Please try again.')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <h3 className="settings-section__title">Map View</h3>
            <div className="settings-row">
              <div className="settings-row__info">
                <span className="settings-row__label">Initial zoom level</span>
                <span className="settings-row__hint">Maximum zoom used when a map is opened</span>
              </div>
              <div className="settings-row__control">
                <input
                  type="range"
                  min="0.2"
                  max="2"
                  step="0.05"
                  value={initialZoom}
                  onChange={e => setInitialZoom(parseFloat(e.target.value))}
                  className="settings-range"
                />
                <span className="settings-range__value">{Math.round(initialZoom * 100)}%</span>
              </div>
            </div>
          </div>
          {error && <p className="modal-state modal-state--error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
