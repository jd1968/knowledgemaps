import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabaseClient } from '../image-library/lib/supabase'
import { useAssets, useTags } from '../image-library/hooks/useAssets'
import { ImageUploader } from '../image-library/components/ImageUploader'
import { TagFilter } from '../image-library/components/TagFilter'
import { generateThumbnail, getImageDimensions } from '../image-library/lib/thumbnail'
import { injectImageLibraryStyles } from '../image-library'

const ASSETS_BUCKET = 'assets'
const THUMBS_BUCKET = 'thumbnails'

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
  const [replacing, setReplacing] = useState(false)
  const [replaceProgress, setReplaceProgress] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const replaceInputRef = useRef()

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

  const handleReplace = async (file) => {
    if (!file || !selectedAsset) return
    setReplacing(true)
    setSaveError(null)
    const supabase = getSupabaseClient()
    try {
      const id = selectedAsset.id
      const oldPublicUrl = selectedAsset.public_url
      const oldThumbnailUrl = selectedAsset.thumbnail_url
      const ext = file.name.split('.').pop().toLowerCase()
      const version = Date.now()
      const assetPath = `${id}/original-${version}.${ext}`
      const thumbExt = file.type === 'image/svg+xml' ? ext : 'webp'
      const thumbPath = `${id}/thumb-${version}.${thumbExt}`

      setReplaceProgress('Generating thumbnail…')
      const thumbBlob = await generateThumbnail(file)
      const { width, height } = await getImageDimensions(file)

      setReplaceProgress('Uploading original…')
      const { error: assetErr } = await supabase.storage
        .from(ASSETS_BUCKET)
        .upload(assetPath, file, { contentType: file.type, upsert: false })
      if (assetErr) throw assetErr

      setReplaceProgress('Uploading thumbnail…')
      const { error: thumbErr } = await supabase.storage
        .from(THUMBS_BUCKET)
        .upload(thumbPath, thumbBlob, { contentType: thumbBlob.type || 'image/webp', upsert: false })
      if (thumbErr) throw thumbErr

      // Remove old storage files
      if (selectedAsset.storage_path) {
        await supabase.storage.from(ASSETS_BUCKET).remove([selectedAsset.storage_path])
      }
      if (selectedAsset.thumbnail_path) {
        await supabase.storage.from(THUMBS_BUCKET).remove([selectedAsset.thumbnail_path])
      }

      const { data: assetUrlData } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(assetPath)
      const { data: thumbUrlData } = supabase.storage.from(THUMBS_BUCKET).getPublicUrl(thumbPath)
      const newPublicUrl = assetUrlData.publicUrl
      const newThumbnailUrl = thumbUrlData.publicUrl

      setReplaceProgress('Saving…')
      const { error: dbErr } = await supabase
        .from('assets')
        .update({
          storage_path: assetPath,
          thumbnail_path: thumbPath,
          public_url: newPublicUrl,
          thumbnail_url: newThumbnailUrl,
          format: ext,
          file_size: file.size,
          width,
          height,
        })
        .eq('id', id)
      if (dbErr) throw dbErr

      // Update any maps that reference the old URL
      if (oldPublicUrl) {
        setReplaceProgress('Updating maps…')
        const { data: maps } = await supabase.from('maps').select('id, data')
        const mapsToUpdate = (maps || []).filter(
          (m) => m.data && JSON.stringify(m.data).includes(oldPublicUrl)
        )
        for (const map of mapsToUpdate) {
          const newData = JSON.parse(
            JSON.stringify(map.data)
              .replaceAll(oldPublicUrl, newPublicUrl)
              .replaceAll(oldThumbnailUrl, newThumbnailUrl)
          )
          await supabase.from('maps').update({ data: newData }).eq('id', map.id)
        }
      }

      refresh()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setReplacing(false)
      setReplaceProgress(null)
      if (replaceInputRef.current) replaceInputRef.current.value = ''
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
                  {replaceProgress && <p className="illib-detail__progress">{replaceProgress}</p>}

                  <div className="illib-detail__actions">
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={handleDelete}
                      disabled={deleting || saving || replacing}
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <input
                      ref={replaceInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => handleReplace(e.target.files?.[0])}
                    />
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => replaceInputRef.current?.click()}
                      disabled={saving || deleting || replacing}
                    >
                      {replacing ? replaceProgress || 'Replacing…' : 'Replace image'}
                    </button>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={handleSave}
                      disabled={saving || deleting || replacing}
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
