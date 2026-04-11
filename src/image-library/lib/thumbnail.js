const THUMB_MAX = 240
const THUMB_QUALITY = 0.82
const THUMB_FORMAT = 'image/webp'

/**
 * Generates a WebP thumbnail from a File using the Canvas API.
 * SVGs are passed through as-is (resolution independent).
 * Returns a Blob.
 */
export async function generateThumbnail(file) {
  if (file.type === 'image/svg+xml') {
    return file // SVGs don't need rasterising
  }

  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap

  const scale = Math.min(THUMB_MAX / width, THUMB_MAX / height, 1)
  const thumbW = Math.round(width * scale)
  const thumbH = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = thumbW
  canvas.height = thumbH

  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, thumbW, thumbH)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      THUMB_FORMAT,
      THUMB_QUALITY
    )
  })
}

/**
 * Reads image dimensions from a File without uploading it.
 */
export function getImageDimensions(file) {
  return new Promise((resolve) => {
    if (file.type === 'image/svg+xml') {
      resolve({ width: null, height: null })
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: null, height: null })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}
