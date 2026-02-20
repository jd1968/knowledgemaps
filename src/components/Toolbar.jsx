import { useState } from 'react'
import { useMindMapStore } from '../store/useMindMapStore'
import { useAuth } from '../contexts/AuthContext'

const SaveStatusDot = ({ status }) => {
  const map = {
    saving: { color: '#f59e0b', label: 'Saving…' },
    saved: { color: '#22c55e', label: 'Saved' },
    error: { color: '#ef4444', label: 'Save failed' },
    idle: null,
  }
  const info = map[status]
  if (!info) return null
  return (
    <span className="save-status" style={{ color: info.color }}>
      <span
        className="save-dot"
        style={{ background: info.color }}
      />
      {info.label}
    </span>
  )
}

const Toolbar = () => {
  const {
    currentMapName,
    isDirty,
    past,
    future,
    saveStatus,
    undo,
    redo,
    saveMap,
    newMap,
    setMapName,
    openMapList,
    currentMapId,
    isEditMode,
    toggleEditMode,
  } = useMindMapStore()
  const { user, signOut } = useAuth()

  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState('')

  const handleNameClick = () => {
    setTempName(currentMapName)
    setEditingName(true)
  }

  const commitName = () => {
    if (tempName.trim()) setMapName(tempName.trim())
    setEditingName(false)
  }

  const handleNameKey = (e) => {
    if (e.key === 'Enter') commitName()
    if (e.key === 'Escape') setEditingName(false)
  }

  const handleNew = () => {
    if (isDirty && !confirm('You have unsaved changes. Create a new map anyway?'))
      return
    newMap()
  }

  const handleSave = async () => {
    let name = currentMapName
    if (!currentMapId) {
      const prompted = prompt('Map name:', currentMapName)
      if (prompted === null) return
      name = prompted.trim() || currentMapName
    }
    await saveMap(name)
  }

  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="#fbbf24" />
          <circle cx="4" cy="6" r="2" fill="#60a5fa" />
          <circle cx="20" cy="6" r="2" fill="#60a5fa" />
          <circle cx="4" cy="18" r="2" fill="#34d399" />
          <circle cx="20" cy="18" r="2" fill="#34d399" />
          <line x1="12" y1="12" x2="4" y2="6" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="12" y1="12" x2="20" y2="6" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="12" y1="12" x2="4" y2="18" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="12" y1="12" x2="20" y2="18" stroke="#94a3b8" strokeWidth="1.5" />
        </svg>
        <span className="toolbar-brand-name">Knowledge Maps</span>
      </div>

      <div className="toolbar-center">
        {editingName ? (
          <input
            className="map-name-input"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={commitName}
            onKeyDown={handleNameKey}
            autoFocus
          />
        ) : (
          <button
            className="map-name-btn"
            onClick={handleNameClick}
            title="Click to rename"
          >
            {currentMapName}
            {isDirty && <span className="dirty-dot" title="Unsaved changes" />}
          </button>
        )}
        <SaveStatusDot status={saveStatus} />
      </div>

      <div className="toolbar-actions">
        <button
          className="btn btn--ghost btn--sm"
          onClick={undo}
          disabled={!isEditMode || past.length === 0}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={redo}
          disabled={!isEditMode || future.length === 0}
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          ↪ Redo
        </button>
        <label className="edit-mode-toggle" title={isEditMode ? 'Disable editing' : 'Enable editing'}>
          <input type="checkbox" checked={isEditMode} onChange={toggleEditMode} />
          <span className="edit-mode-toggle__track">
            <span className="edit-mode-toggle__thumb" />
          </span>
          <span className="edit-mode-toggle__label">Edit Mode</span>
        </label>

        <div className="toolbar-sep" />

        <button
          className="btn btn--ghost btn--sm"
          onClick={handleNew}
          title="New map"
        >
          + New
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={openMapList}
          title="Open a saved map"
        >
          Open
        </button>
        <button
          className="btn btn--primary btn--sm"
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          title="Save map to Supabase"
        >
          {saveStatus === 'saving' ? 'Saving…' : 'Save'}
        </button>

        <div className="toolbar-sep" />

        <div className="user-info">
          {user?.user_metadata?.avatar_url ? (
            <img
              className="user-avatar"
              src={user.user_metadata.avatar_url}
              alt={user.user_metadata?.name || user.email}
              title={user.user_metadata?.name || user.email}
            />
          ) : (
            <div className="user-avatar user-avatar--initials" title={user?.email}>
              {(user?.user_metadata?.name || user?.email || '?')[0].toUpperCase()}
            </div>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={signOut}
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default Toolbar
