import React, { useState, useRef, useCallback } from 'react'
import { useUpload } from '../hooks/useUpload'

export function ImageUploader({ onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [form, setForm] = useState({ name: '', tags: '' })
  const [pendingFile, setPendingFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const inputRef = useRef()

  const { upload, uploading, progress, error } = useUpload({
    onUploaded: (asset) => {
      setPendingFile(null)
      setPreview(null)
      setForm({ name: '', tags: '' })
      onUploaded?.(asset)
    },
  })

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    setPendingFile(file)
    setForm((f) => ({ ...f, name: file.name.replace(/\.[^.]+$/, '') }))
    const url = URL.createObjectURL(file)
    setPreview(url)
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    handleFile(file)
  }, [handleFile])

  const onDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const handleSubmit = async () => {
    if (!pendingFile) return
    await upload(pendingFile, {
      name: form.name,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    })
  }

  const cancel = () => {
    setPendingFile(null)
    setPreview(null)
    setForm({ name: '', tags: '' })
  }

  if (pendingFile) {
    return (
      <div className="il-uploader-form">
        <div className="il-uploader-preview">
          <img src={preview} alt="Preview" />
        </div>
        <div className="il-uploader-fields">
          <label className="il-label">
            Name
            <input
              className="il-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Asset name"
            />
          </label>
          <label className="il-label">
            Tags <span className="il-hint">(comma separated)</span>
            <input
              className="il-input"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="icon, logo, brand…"
            />
          </label>

          {error && <p className="il-error">{error}</p>}
          {progress && <p className="il-progress">{progress.step}</p>}

          <div className="il-uploader-actions">
            <button type="button" className="il-btn il-btn--ghost" onClick={cancel} disabled={uploading}>
              Cancel
            </button>
            <button type="button" className="il-btn il-btn--primary" onClick={handleSubmit} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`il-dropzone${dragging ? ' il-dropzone--active' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p className="il-dropzone-label">Drop an image or <span>browse</span></p>
      <p className="il-dropzone-hint">PNG, JPG, SVG, WebP</p>
    </div>
  )
}
