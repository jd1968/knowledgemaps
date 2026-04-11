import { useState, useCallback } from 'react'
import { getSupabaseClient } from '../lib/supabase'
import { generateThumbnail, getImageDimensions } from '../lib/thumbnail'

const ASSETS_BUCKET = 'assets'
const THUMBS_BUCKET = 'thumbnails'

export function useUpload({ onUploaded } = {}) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null) // { step, file }
  const [error, setError] = useState(null)

  const upload = useCallback(async (file, meta = {}) => {
    const supabase = getSupabaseClient()
    setUploading(true)
    setError(null)

    try {
      const id = crypto.randomUUID()
      const ext = file.name.split('.').pop().toLowerCase()
      const assetPath = `${id}/original.${ext}`
      const thumbExt = file.type === 'image/svg+xml' ? ext : 'webp'
      const thumbPath = `${id}/thumb.${thumbExt}`

      // 1. Generate thumbnail
      setProgress({ step: 'Generating thumbnail…', file: file.name })
      const thumbBlob = await generateThumbnail(file)

      // 2. Get dimensions
      const { width, height } = await getImageDimensions(file)

      // 3. Upload original
      setProgress({ step: 'Uploading original…', file: file.name })
      const { error: assetErr } = await supabase.storage
        .from(ASSETS_BUCKET)
        .upload(assetPath, file, { contentType: file.type, upsert: false })
      if (assetErr) throw assetErr

      // 4. Upload thumbnail
      setProgress({ step: 'Uploading thumbnail…', file: file.name })
      const { error: thumbErr } = await supabase.storage
        .from(THUMBS_BUCKET)
        .upload(thumbPath, thumbBlob, { contentType: thumbBlob.type || 'image/webp', upsert: false })
      if (thumbErr) throw thumbErr

      // 5. Get public URLs
      const { data: assetUrlData } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(assetPath)
      const { data: thumbUrlData } = supabase.storage.from(THUMBS_BUCKET).getPublicUrl(thumbPath)

      // 6. Insert DB record
      setProgress({ step: 'Saving metadata…', file: file.name })
      const tags = (meta.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean)

      const { data: asset, error: dbErr } = await supabase
        .from('assets')
        .insert({
          id,
          name: meta.name || file.name,
          description: meta.description || null,
          storage_path: assetPath,
          thumbnail_path: thumbPath,
          public_url: assetUrlData.publicUrl,
          thumbnail_url: thumbUrlData.publicUrl,
          format: ext,
          file_size: file.size,
          width,
          height,
          thumb_width: thumbBlob.width || null,
          thumb_height: thumbBlob.height || null,
          thumb_size: thumbBlob.size,
        })
        .select()
        .single()

      if (dbErr) throw dbErr

      // 7. Insert tags
      if (tags.length > 0) {
        // Upsert tags
        const { data: tagRows } = await supabase
          .from('tags')
          .upsert(tags.map((name) => ({ name })), { onConflict: 'name' })
          .select()

        if (tagRows?.length) {
          await supabase.from('asset_tags').insert(
            tagRows.map((t) => ({ asset_id: id, tag_id: t.id }))
          )
        }
      }

      onUploaded?.(asset)
      return asset
    } catch (err) {
      console.error('[ImageLibrary] Upload failed:', err)
      setError(err.message || 'Upload failed')
      return null
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }, [onUploaded])

  return { upload, uploading, progress, error }
}
