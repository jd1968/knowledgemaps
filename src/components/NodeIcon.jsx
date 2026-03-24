import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BUCKET, STORAGE_PREFIX, fetchBlobUrl } from './MarkdownEditor'

/* Renders a node icon stored as a storage: reference */
export function NodeIconDisplay({ iconUrl, className, style }) {
  const filePath = iconUrl?.startsWith('storage:')
    ? iconUrl.slice(iconUrl.indexOf('/', 'storage:'.length) + 1)
    : null

  const [blobUrl, setBlobUrl] = useState(null)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    fetchBlobUrl(filePath).then((url) => { if (!cancelled && url) setBlobUrl(url) })
    return () => { cancelled = true }
  }, [filePath])

  if (!blobUrl) return null
  return <img src={blobUrl} alt="" className={className} style={style} />
}

/* Upload button — calls onUpload(storageRef) on success */
export function NodeIconUpload({ iconUrl, onUpload, className, children }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `icons/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file)
      if (!error) onUpload(`${STORAGE_PREFIX}${path}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <button
        className={className}
        title={iconUrl ? 'Replace icon' : 'Add icon'}
        disabled={uploading}
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {uploading ? '…' : children}
      </button>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
    </>
  )
}
