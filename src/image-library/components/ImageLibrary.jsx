import React, { useState, useEffect, useCallback } from 'react'
import { AssetGrid } from './AssetGrid'
import { ImageUploader } from './ImageUploader'
import { TagFilter } from './TagFilter'
import { useAssets, useTags } from '../hooks/useAssets'

const STYLES = `
  .il-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(28, 25, 23, 0.4);
    backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    animation: il-fade-in 0.15s ease;
  }
  @keyframes il-fade-in { from { opacity: 0 } to { opacity: 1 } }

  .il-modal {
    background: #ffffff;
    border: 1px solid #e5ddd0;
    border-radius: 14px;
    width: 100%; max-width: 860px;
    max-height: 90vh;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.18);
    animation: il-slide-up 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1c1917;
  }
  @keyframes il-slide-up {
    from { opacity: 0; transform: translateY(12px) scale(0.98) }
    to   { opacity: 1; transform: translateY(0) scale(1) }
  }

  .il-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid #e5ddd0;
    flex-shrink: 0;
  }
  .il-title {
    font-size: 17px; font-weight: 700;
    color: #1c1917; margin: 0; flex: 1;
  }
  .il-close {
    background: none; border: none; cursor: pointer;
    color: #a8a29e; padding: 4px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    transition: color 0.15s, background 0.15s;
  }
  .il-close:hover { color: #1c1917; background: #f0ece3; }

  .il-tabs {
    display: flex; gap: 2px;
    padding: 14px 20px 0;
    flex-shrink: 0;
  }
  .il-tab {
    background: none; border: none; cursor: pointer;
    font-size: 13px; font-weight: 500;
    color: #a8a29e; padding: 6px 14px; border-radius: 8px;
    transition: color 0.15s, background 0.15s;
    font-family: inherit;
  }
  .il-tab:hover { color: #57534e; background: #f9f6f1; }
  .il-tab--active { color: #b45309; background: rgba(180,83,9,0.08); }

  .il-toolbar {
    display: flex; gap: 10px; align-items: center;
    padding: 14px 20px 10px;
    flex-shrink: 0;
  }
  .il-search {
    flex: 1;
    background: #ffffff; border: 1px solid #cec4b3;
    border-radius: 7px; padding: 8px 10px;
    font-size: 14px; color: #1c1917; outline: none;
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .il-search::placeholder { color: #a8a29e; }
  .il-search:focus { border-color: #b45309; }

  .il-tag-filter {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 0 20px 12px;
    flex-shrink: 0;
  }
  .il-tag-btn {
    background: #f9f6f1; border: 1px solid #e5ddd0;
    border-radius: 20px; padding: 3px 11px;
    font-size: 11px; font-weight: 500; color: #57534e;
    cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .il-tag-btn:hover { color: #1c1917; border-color: #cec4b3; }
  .il-tag-btn--active {
    background: rgba(180,83,9,0.08); border-color: rgba(180,83,9,0.3);
    color: #b45309;
  }

  .il-body {
    flex: 1; overflow-y: auto; padding: 0 20px 20px;
    scrollbar-width: thin; scrollbar-color: #e5ddd0 transparent;
  }

  .il-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .il-card {
    background: #f9f6f1; border: 1px solid #e5ddd0;
    border-radius: 10px; overflow: hidden;
    cursor: pointer; text-align: left;
    padding: 0; transition: border-color 0.15s, transform 0.1s;
    display: flex; flex-direction: column;
  }
  .il-card:hover { border-color: #b45309; transform: translateY(-1px); }
  .il-card--skeleton {
    height: 160px; animation: il-pulse 1.4s ease-in-out infinite;
    cursor: default;
  }
  @keyframes il-pulse {
    0%, 100% { opacity: 1 } 50% { opacity: 0.4 }
  }
  .il-card-thumb {
    background: #ffffff;
    display: flex; align-items: center; justify-content: center;
    height: 110px; overflow: hidden;
  }
  .il-card-thumb img {
    max-width: 100%; max-height: 100%;
    object-fit: contain; display: block;
  }
  .il-card-meta {
    padding: 8px 10px; display: flex; flex-direction: column; gap: 4px;
  }
  .il-card-name {
    font-size: 11px; font-weight: 500; color: #57534e;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: block;
  }
  .il-card-tags { display: flex; flex-wrap: wrap; gap: 3px; }
  .il-tag {
    font-size: 10px; background: #f0ece3;
    border: 1px solid #e5ddd0; border-radius: 4px;
    padding: 1px 5px; color: #a8a29e;
  }

  .il-empty {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 12px;
    padding: 60px 20px; color: #a8a29e; text-align: center;
  }
  .il-empty p { margin: 0; font-size: 13px; }

  /* Uploader */
  .il-dropzone {
    border: 2px dashed #e5ddd0; border-radius: 12px;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px;
    padding: 48px 20px; cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    color: #a8a29e; text-align: center;
  }
  .il-dropzone:hover, .il-dropzone--active {
    border-color: #b45309; background: rgba(180,83,9,0.04);
    color: #b45309;
  }
  .il-dropzone-label { margin: 0; font-size: 14px; font-weight: 500; }
  .il-dropzone-label span { color: #b45309; }
  .il-dropzone-hint { margin: 0; font-size: 12px; color: #a8a29e; }

  .il-uploader-form {
    display: flex; gap: 20px; align-items: flex-start;
  }
  .il-uploader-preview {
    flex-shrink: 0; width: 140px; height: 140px;
    background: #f9f6f1; border: 1px solid #e5ddd0;
    border-radius: 10px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .il-uploader-preview img {
    max-width: 100%; max-height: 100%; object-fit: contain;
  }
  .il-uploader-fields { flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .il-label {
    display: flex; flex-direction: column; gap: 5px;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: #a8a29e;
  }
  .il-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: #a8a29e; }
  .il-input {
    background: #ffffff; border: 1px solid #cec4b3;
    border-radius: 7px; padding: 8px 10px;
    font-size: 14px; color: #1c1917; outline: none;
    font-family: inherit; transition: border-color 0.15s;
    width: 100%;
  }
  .il-input:focus { border-color: #b45309; }
  .il-input::placeholder { color: #a8a29e; }

  .il-uploader-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .il-btn {
    border: none; border-radius: 7px; padding: 5px 11px;
    font-size: 13px; font-weight: 500; cursor: pointer;
    font-family: inherit; transition: all 0.15s;
  }
  .il-btn--ghost {
    background: #f9f6f1; color: #57534e;
    border: 1px solid #cec4b3;
  }
  .il-btn--ghost:hover { color: #1c1917; background: #f0ece3; }
  .il-btn--primary { background: #b45309; color: #fff; font-weight: 600; }
  .il-btn--primary:hover { background: #9a4508; }
  .il-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .il-error { color: #dc2626; font-size: 12px; margin: 0; }
  .il-progress { color: #b45309; font-size: 12px; margin: 0; }

  .il-divider { height: 1px; background: #e5ddd0; margin: 0 0 16px; }
`

let stylesInjected = false
export function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = STYLES
  document.head.appendChild(el)
  stylesInjected = true
}

export function ImageLibrary({ open, onClose, onSelect }) {
  const [tab, setTab] = useState('browse') // 'browse' | 'upload'
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState([])

  const { assets, loading, refresh } = useAssets({ search, tagIds: selectedTags })
  const tags = useTags()

  useEffect(() => { injectStyles() }, [])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSelect = useCallback((url) => {
    onSelect(url)
    onClose()
  }, [onSelect, onClose])

  const handleUploaded = useCallback((asset) => {
    setTab('browse')
    refresh()
  }, [refresh])

  if (!open) return null

  return (
    <div className="il-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="il-modal" role="dialog" aria-modal="true" aria-label="Image Library">
        {/* Header */}
        <div className="il-header">
          <p className="il-title">Image Library</p>
          <button className="il-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="il-tabs">
          <button
            className={`il-tab${tab === 'browse' ? ' il-tab--active' : ''}`}
            onClick={() => setTab('browse')}
          >
            Browse
          </button>
          <button
            className={`il-tab${tab === 'upload' ? ' il-tab--active' : ''}`}
            onClick={() => setTab('upload')}
          >
            Upload
          </button>
        </div>

        {/* Browse tab */}
        {tab === 'browse' && (
          <>
            <div className="il-toolbar">
              <input
                className="il-search"
                placeholder="Search by name, tag or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <TagFilter tags={tags} selected={selectedTags} onChange={setSelectedTags} />
            <div className="il-body">
              <AssetGrid assets={assets} loading={loading} onSelect={handleSelect} />
            </div>
          </>
        )}

        {/* Upload tab */}
        {tab === 'upload' && (
          <div className="il-body" style={{ paddingTop: 20 }}>
            <ImageUploader onUploaded={handleUploaded} />
          </div>
        )}
      </div>
    </div>
  )
}
