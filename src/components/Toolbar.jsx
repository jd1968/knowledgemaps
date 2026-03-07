import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMindMapStore } from '../store/useMindMapStore'
import { useAuth } from '../contexts/AuthContext'
import MapTextModal from './MapTextModal'

/* ── Icons ─────────────────────────────────────────────────────────── */

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const UndoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7v6h6" />
    <path d="M3 13C5.4 7.4 11 4 17 4a9 9 0 0 1 0 18H9" />
  </svg>
)

const RedoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 7v6h-6" />
    <path d="M21 13C18.6 7.4 13 4 7 4a9 9 0 0 0 0 18h8" />
  </svg>
)

const NewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const OpenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

const SaveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
)

const SignOutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const MenuIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M3 12h18M3 6h18M3 18h18" />
  </svg>
)

const TreeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

const FeedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="14" width="18" height="7" rx="2" />
  </svg>
)

const TextViewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
)


/* ── SaveStatusDot ──────────────────────────────────────────────────── */

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
      <span className="save-dot" style={{ background: info.color }} />
      <span className="save-status-label">{info.label}</span>
    </span>
  )
}

/* ── Toolbar ────────────────────────────────────────────────────────── */

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
    isFeedMode,
    toggleFeedMode,
    breadcrumbs,
    navigateBack,
  } = useMindMapStore()
  const { user, signOut } = useAuth()

  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const [newMapDialogOpen, setNewMapDialogOpen] = useState(false)
  const [newMapName, setNewMapName] = useState('')
const [textOpen, setTextOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

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
    setNewMapName('')
    setNewMapDialogOpen(true)
  }

  const confirmNewMap = () => {
    const name = newMapName.trim() || 'Untitled Map'
    setNewMapDialogOpen(false)
    newMap(name)
    saveMap(name)
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

  const isInSubmap = breadcrumbs.length > 0

  return (
    <>
{textOpen && <MapTextModal onClose={() => setTextOpen(false)} />}
    <div className="toolbar">
      {/* Left: map name always here — with back+parent when in a submap */}
      <div className="toolbar-breadcrumb">
        {isInSubmap ? (
          <>
            <button
              className="toolbar-back-crumb"
              onClick={() => navigateBack()}
              title={`Back to ${breadcrumbs[breadcrumbs.length - 1].mapName}`}
              aria-label={`Back to ${breadcrumbs[breadcrumbs.length - 1].mapName}`}
            >
              <BackIcon />
              <span className="toolbar-back-crumb-name">
                {breadcrumbs[breadcrumbs.length - 1].mapName}
              </span>
            </button>
            <span className="toolbar-crumb-divider" aria-hidden="true">|</span>
            <span className="toolbar-crumb-current">{currentMapName}</span>
          </>
        ) : (
          editingName ? (
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
          )
        )}
      </div>

      {/* Center: save status only */}
      <div className="toolbar-center">
        <SaveStatusDot status={saveStatus} />
      </div>

      {/* Right: actions */}
      <div className="toolbar-actions">
        <button
          className="btn btn--ghost btn--sm toolbar-desktop-only"
          onClick={undo}
          disabled={!isEditMode || past.length === 0}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <UndoIcon />
          <span className="btn-label">Undo</span>
        </button>
        <button
          className="btn btn--ghost btn--sm toolbar-desktop-only"
          onClick={redo}
          disabled={!isEditMode || future.length === 0}
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <RedoIcon />
          <span className="btn-label">Redo</span>
        </button>

        <label className="edit-mode-toggle" title={isEditMode ? 'Disable editing' : 'Enable editing'}>
          <input type="checkbox" checked={isEditMode} onChange={toggleEditMode} />
          <span className="edit-mode-toggle__track">
            <span className="edit-mode-toggle__thumb" />
          </span>
          <span className="edit-mode-toggle__label">Edit</span>
        </label>

        {/* Mode selector */}
        <select
          className="toolbar-mode-select"
          value={isFeedMode ? 'feed' : 'map'}
          onChange={(e) => {
            const mode = e.target.value
            if (mode === 'feed' && !isFeedMode) toggleFeedMode()
            else if (mode === 'map' && isFeedMode) toggleFeedMode()
          }}
          aria-label="View mode"
        >
          <option value="map">Map</option>
          <option value="feed">Feed</option>
          <option value="contents" disabled>Contents</option>
        </select>

        {/* Text view */}
        <button
          className={`btn btn--ghost btn--sm${textOpen ? ' btn--ghost-active' : ''}`}
          onClick={() => setTextOpen(o => !o)}
          title="View map as text (Markdown)"
          aria-label="View map as text"
          aria-pressed={textOpen}
        >
          <TextViewIcon />
          <span className="btn-label">Text</span>
        </button>

        <div className="toolbar-sep toolbar-sep--desktop-only" />

        {/* New / Open — desktop only, in overflow menu on mobile */}
        <button
          className="btn btn--ghost btn--sm toolbar-desktop-only"
          onClick={handleNew}
          title="New map"
          aria-label="New map"
        >
          <NewIcon />
          <span className="btn-label">New</span>
        </button>
        <button
          className="btn btn--ghost btn--sm toolbar-desktop-only"
          onClick={openMapList}
          title="Open a saved map"
          aria-label="Open map"
        >
          <OpenIcon />
          <span className="btn-label">Open</span>
        </button>

        {/* Save — always visible */}
        <button
          className="btn btn--primary btn--sm"
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          title="Save map"
          aria-label="Save map"
        >
          <SaveIcon />
          <span className="btn-label">
            {saveStatus === 'saving' ? 'Saving…' : 'Save'}
          </span>
        </button>

        <div className="toolbar-sep toolbar-sep--desktop-only" />

        {/* User avatar + sign out */}
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
            className="btn btn--ghost btn--sm toolbar-desktop-only"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <SignOutIcon />
            <span className="btn-label">Sign out</span>
          </button>
        </div>

        {/* Hamburger overflow menu — mobile only */}
        <div className="toolbar-menu-wrap toolbar-mobile-only" ref={menuRef}>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setMenuOpen((o) => !o)}
            title="More options"
            aria-label="More options"
            aria-expanded={menuOpen}
          >
            <MenuIcon />
          </button>
          {menuOpen && (
            <div className="toolbar-menu" role="menu">
              <button
                className="toolbar-menu-item"
                role="menuitem"
                onClick={() => { handleNew(); setMenuOpen(false) }}
              >
                <NewIcon /> New Map
              </button>
              <button
                className="toolbar-menu-item"
                role="menuitem"
                onClick={() => { openMapList(); setMenuOpen(false) }}
              >
                <OpenIcon /> Open
              </button>
              <button
                className="toolbar-menu-item"
                role="menuitem"
                onClick={() => { setTextOpen(true); setMenuOpen(false) }}
              >
                <TextViewIcon /> View as Text
              </button>
              <div className="toolbar-menu-sep" />
              <button
                className="toolbar-menu-item"
                role="menuitem"
                onClick={() => { signOut(); setMenuOpen(false) }}
              >
                <SignOutIcon /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {newMapDialogOpen && createPortal(
      <div
        className="submap-choice-overlay"
        onPointerDown={(e) => { if (e.target === e.currentTarget) setNewMapDialogOpen(false) }}
      >
        <div className="submap-choice-modal" onPointerDown={(e) => e.stopPropagation()}>
          <div className="submap-choice-header">
            <h3>New Map</h3>
            <button className="icon-btn" onClick={() => setNewMapDialogOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="submap-choice-body">
            <p>Enter a name for the new map.</p>
            <input
              className="new-map-name-input"
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
              placeholder="Map name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNewMap()
                if (e.key === 'Escape') setNewMapDialogOpen(false)
              }}
            />
            <div className="submap-choice-actions">
              <button className="btn btn--primary btn--sm" onClick={confirmNewMap}>
                Create
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => setNewMapDialogOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}

export default Toolbar
