import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  return <img src={blobUrl} alt="" draggable={false} className={className} style={style} />
}

/* Upload label — the file input is portalled to document.body to escape React
   Flow's event capture. A native 'change' listener is used instead of React's
   onChange because React 18 event delegation doesn't reach portals outside
   the app root. */
export function NodeIconUpload({ iconUrl, onUpload, className, children }) {
  const inputId = useRef(`niu-${Math.random().toString(36).slice(2)}`)
  const [inputEl, setInputEl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const onUploadRef = useRef(onUpload)
  useEffect(() => { onUploadRef.current = onUpload }, [onUpload])

  useEffect(() => {
    if (!inputEl) return
    const handler = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''
      setUploading(true)
      try {
        const ext = file.name.split('.').pop()
        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, file)
        if (error) { console.error('[NodeIconUpload]', error); return }
        onUploadRef.current(`${STORAGE_PREFIX}${path}`)
      } finally {
        setUploading(false)
      }
    }
    inputEl.addEventListener('change', handler)
    return () => inputEl.removeEventListener('change', handler)
  }, [inputEl])

  return (
    <>
      <label
        htmlFor={inputId.current}
        className={className}
        title={iconUrl ? 'Replace icon' : 'Add icon'}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ cursor: uploading ? 'wait' : 'pointer' }}
      >
        {uploading ? '…' : children}
      </label>
      {createPortal(
        <input
          ref={setInputEl}
          id={inputId.current}
          type="file"
          accept="image/*"
          disabled={uploading}
          style={{ display: 'none' }}
        />,
        document.body
      )}
    </>
  )
}
