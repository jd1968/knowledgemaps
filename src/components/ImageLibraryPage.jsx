import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabaseClient } from '../image-library/lib/supabase'
import { useAssets, useTags } from '../image-library/hooks/useAssets'
import { ImageUploader } from '../image-library/components/ImageUploader'
import { TagFilter } from '../image-library/components/TagFilter'
import { injectImageLibraryStyles } from '../image-library'

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const fmtBytes = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ImageLibraryPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('browse')
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const { assets, loading, refresh } = useAssets({ search, tagIds: selectedTags })
  const tags = useTags()

  useEffect(() => { injectImageLibraryStyles() }, [])

  // Initialise draft when selection changes
  useEffect(() => {
    if (!selectedAsset) { setDraft(null); return }
    setDraft({
      name: selectedAsset.name || '',
      description: selectedAsset.description || '',
      tags: (selectedAsset.tags || []).map((t) => t.name).join(', '),
    })
    setSaveError(null)
  }, [selectedAsset?.id])

  // Keep selected asset in sync after refresh
  useEffect(() => {
    if (!selectedAsset) return
    const updated = assets.find((a) => a.id === selectedAsset.id)
    if (updated) setSelectedAsset(updated)
  }, [assets]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (asset) => {
    setSelectedAsset((prev) => (prev?.id === asset.id ? null : asset))
  }

  const handleSave = async () => {
    if (!selectedAsset || !draft) return
    setSaving(true)
    setSaveError(null)
    const supabase = getSupabaseClient()
    try {
      const { error } = await supabase
        .from('assets')
        .update({
          name: draft.name.trim() || selectedAsset.name,
          description: draft.description.trim() || null,
        })
        .eq('id', selectedAsset.id)
      if (error) throw error

      const tagNames = draft.tags.split(',').map((t) => t.trim()).filter(Boolean)
      await supabase.from('asset_tags').delete().eq('asset_id', selectedAsset.id)
      if (tagNames.length > 0) {
        const { data: tagRows } = await supabase
          .from('tags')
          .upsert(tagNames.map((name) => ({ name })), { onConflict: 'name' })
          .select()
        if (tagRows?.length) {
          await supabase.from('asset_tags').insert(
            tagRows.map((t) => ({ asset_id: selectedAsset.id, tag_id: t.id }))
          )
        }
      }
      refresh()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedAsset) return
    if (!window.confirm(`Delete "${selectedAsset.name}"?\n\nThis permanently removes the image from storage and cannot be undone.`)) return
    setDeleting(true)
    const supabase = getSupabaseClient()
    try {
      if (selectedAsset.storage_path) {
        await supabase.storage.from('assets').remove([selectedAsset.storage_path])
      }
      if (selectedAsset.thumbnail_path) {
        await supabase.storage.from('thumbnails').remove([selectedAsset.thumbnail_path])
      }
      await supabase.from('assets').delete().eq('id', selectedAsset.id)
      setSelectedAsset(null)
      refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="illib-page">
      <div className="illib-toolbar">
        <button className="toolbar-home-btn" onClick={() => navigate('/')} title="Back to home" aria-label="Back to home">
          <BackIcon />
        </button>
        <span className="illib-toolbar__title">Image Library</span>
        <div className="illib-toolbar__spacer" />
        {!loading && (
          <span className="illib-toolbar__count">{assets.length} image{assets.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="illib-tabs">
        <button className={`il-tab${tab === 'browse' ? ' il-tab--active' : ''}`} onClick={() => setTab('browse')}>Browse</button>
        <button className={`il-tab${tab === 'upload' ? ' il-tab--active' : ''}`} onClick={() => setTab('upload')}>Upload</button>
      </div>

      {tab === 'upload' ? (
        <div className="illib-upload-area">
          <ImageUploader onUploaded={() => { refresh(); setTab('browse') }} />
        </div>
      ) : (
        <>
          <div className="illib-filter">
            <input
              className="il-search illib-search-input"
              placeholder="Search by name, tag or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <TagFilter tags={tags} selected={selectedTags} onChange={setSelectedTags} />
          </div>

          <div className="illib-layout">
            <div className="illib-grid-area">
              {loading ? (
                <div className="il-grid">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="il-card il-card--skeleton" />
                  ))}
                </div>
              ) : assets.length === 0 ? (
                <div className="il-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  <p>No images found</p>
                </div>
              ) : (
                <div className="il-grid">
                  {assets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className={`il-card illib-asset-card${selectedAsset?.id === asset.id ? ' illib-asset-card--selected' : ''}`}
                      onClick={() => handleSelect(asset)}
                    >
                      <div className="il-card-thumb">
                        <img src={asset.thumbnail_url} alt={asset.name} loading="lazy" draggable={false} />
                      </div>
                      <div className="il-card-meta">
                        <span className="il-card-name">{asset.name}</span>
                        {asset.tags?.length > 0 && (
                          <span className="il-card-tags">
                            {asset.tags.slice(0, 3).map((t) => (
                              <span key={t.id} className="il-tag">{t.name}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedAsset && (
              <aside className="illib-detail">
                <div className="illib-detail__close-row">
                  <span className="illib-detail__heading">Details</span>
                  <button className="icon-btn" onClick={() => setSelectedAsset(null)} aria-label="Close">×</button>
                </div>

                <div className="illib-detail__preview">
                  <img src={selectedAsset.thumbnail_url} alt={selectedAsset.name} draggable={false} />
                </div>

                <div className="illib-detail__fields">
                  <div className="field">
                    <label className="field-label">Name</label>
                    <input
                      className="field-input"
                      value={draft?.name ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Description</label>
                    <textarea
                      className="field-input illib-detail__textarea"
                      value={draft?.description ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Optional description…"
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Tags <span className="field-label-hint">(comma separated)</span></label>
                    <input
                      className="field-input"
                      value={draft?.tags ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                      placeholder="icon, logo, brand…"
                    />
                  </div>

                  <div className="illib-detail__meta">
                    {selectedAsset.format && (
                      <span className="illib-detail__meta-item">{selectedAsset.format.toUpperCase()}</span>
                    )}
                    {selectedAsset.width && selectedAsset.height && (
                      <span className="illib-detail__meta-item">{selectedAsset.width} × {selectedAsset.height}</span>
                    )}
                    {selectedAsset.file_size && (
                      <span className="illib-detail__meta-item">{fmtBytes(selectedAsset.file_size)}</span>
                    )}
                  </div>

                  {saveError && <p className="illib-detail__error">{saveError}</p>}

                  <div className="illib-detail__actions">
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={handleDelete}
                      disabled={deleting || saving}
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={handleSave}
                      disabled={saving || deleting}
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  )
}
