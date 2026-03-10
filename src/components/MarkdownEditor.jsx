import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useRef, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function urlTransform(url) {
  if (url.startsWith('storage:')) return url
  return defaultUrlTransform(url)
}

const BUCKET = 'knowledge-files'
const STORAGE_PREFIX = `storage:${BUCKET}/`
const SIZE_WIDTHS = { s: '25%', m: '50%', l: '75%' }

// Session-scoped cache: filePath → blob URL (no expiry, freed when page closes)
const blobUrlCache = new Map()

async function fetchBlobUrl(filePath) {
  if (blobUrlCache.has(filePath)) return blobUrlCache.get(filePath)
  const { data, error } = await supabase.storage.from(BUCKET).download(filePath)
  if (error) { console.error('[StorageImage] download failed:', error.message); return null }
  const url = URL.createObjectURL(data)
  blobUrlCache.set(filePath, url)
  return url
}

// Returns the size key ('s','m','l','full') of the first storage image on the
// cursor's line, or null if there is no storage image on that line.
function detectSizeAtCursor(value, pos) {
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1
  const lineEnd = value.indexOf('\n', pos)
  const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd)
  const match = /!\[[^\]]*\]\(storage:[^#)]+(?:#([a-z]+))?\)/.exec(line)
  return match !== null ? (match[1] || 'full') : null
}

// Replaces the size fragment on the first storage image on the cursor's line.
function resizeImageOnLine(textarea, newSize) {
  const { value, selectionStart } = textarea
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const lineEnd = value.indexOf('\n', selectionStart)
  const lineEnd2 = lineEnd === -1 ? value.length : lineEnd
  const line = value.slice(lineStart, lineEnd2)
  const sizeFragment = newSize !== 'full' ? `#${newSize}` : ''
  const newLine = line.replace(
    /(!\[[^\]]*\]\(storage:[^#)]+)(?:#[a-z]+)?(\))/,
    `$1${sizeFragment}$2`
  )
  if (newLine === line) return
  const newValue = value.slice(0, lineStart) + newLine + value.slice(lineEnd2)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, newValue)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

// Downloads storage: images via authenticated Supabase client → blob URL.
// Requires private bucket + RLS SELECT policy for authenticated users.
function StorageImage({ src, alt, ...props }) {
  const isStorage = src?.startsWith('storage:')
  const hashIdx = isStorage ? src.indexOf('#') : -1
  const sizeKey = hashIdx >= 0 ? src.slice(hashIdx + 1) : null
  const srcClean = hashIdx >= 0 ? src.slice(0, hashIdx) : src
  const filePath = isStorage ? srcClean.slice(srcClean.indexOf('/', 'storage:'.length) + 1) : null
  const sizeStyle = sizeKey && SIZE_WIDTHS[sizeKey] ? { maxWidth: SIZE_WIDTHS[sizeKey] } : undefined

  const [blobUrl, setBlobUrl] = useState(() => filePath ? blobUrlCache.get(filePath) ?? null : null)
  const [imageReady, setImageReady] = useState(false)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    fetchBlobUrl(filePath).then(url => { if (!cancelled && url) setBlobUrl(url) })
    return () => { cancelled = true }
  }, [filePath])

  if (!isStorage) return src ? <img src={src} alt={alt} {...props} /> : null

  return (
    <>
      {!imageReady && (
        <span className="storage-image-loading">
          <span className="storage-image-spinner" />
          Loading image…
        </span>
      )}
      {blobUrl && (
        <img
          src={blobUrl}
          alt={alt}
          {...props}
          style={imageReady ? sizeStyle : { display: 'none' }}
          onLoad={() => setImageReady(true)}
        />
      )}
    </>
  )
}

export const markdownComponents = { img: StorageImage }

const ToolbarButton = ({ onClick, title, children }) => (
  <button
    type="button"
    onMouseDown={(e) => {
      e.preventDefault()
      onClick()
    }}
    className="editor-btn"
    title={title}
  >
    {children}
  </button>
)

function wrapSelection(textarea, before, after) {
  const { selectionStart: start, selectionEnd: end, value } = textarea
  const selected = value.slice(start, end)
  const newValue = value.slice(0, start) + before + selected + after + value.slice(end)
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  nativeInputValueSetter.call(textarea, newValue)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.selectionStart = start + before.length
  textarea.selectionEnd = end + before.length
  textarea.focus()
}

function prependLine(textarea, prefix) {
  const { selectionStart, value } = textarea
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart)
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  nativeInputValueSetter.call(textarea, newValue)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.selectionStart = selectionStart + prefix.length
  textarea.selectionEnd = selectionStart + prefix.length
  textarea.focus()
}

export default function MarkdownEditor({ content, onChange, onBlur, onEscape, editable = true }) {
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [imgSize, setImgSize] = useState('full')
  const [onStorageImage, setOnStorageImage] = useState(false)

  function syncCursorContext() {
    const ta = textareaRef.current
    if (!ta) return
    const detected = detectSizeAtCursor(ta.value, ta.selectionStart)
    if (detected !== null) {
      setOnStorageImage(true)
      setImgSize(detected)
    } else {
      setOnStorageImage(false)
    }
  }

  function handleSizeSelect(size) {
    setImgSize(size)
    const ta = textareaRef.current
    if (ta && onStorageImage) {
      resizeImageOnLine(ta, size)
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file)
      if (error) throw error
      const ta = textareaRef.current
      const pos = ta.selectionStart
      const before = (ta.value || '').slice(0, pos)
      const after = (ta.value || '').slice(pos)
      const alt = file.name.replace(/\.[^.]+$/, '')
      const sizeFragment = imgSize !== 'full' ? `#${imgSize}` : ''
      const insertion = `![${alt}](${STORAGE_PREFIX}${path}${sizeFragment})`
      onChange?.(before + insertion + after)
    } catch (err) {
      console.error('Image upload failed:', err)
      alert('Image upload failed. Check your Supabase Storage bucket.')
    } finally {
      setUploading(false)
    }
  }

  if (!editable) {
    return (
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>{content || ''}</ReactMarkdown>
      </div>
    )
  }

  const ta = () => textareaRef.current

  return (
    <div className="markdown-editor">
      <div className="editor-toolbar">
        <ToolbarButton title="Bold" onClick={() => wrapSelection(ta(), '**', '**')}><strong>B</strong></ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => wrapSelection(ta(), '_', '_')}><em>I</em></ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => wrapSelection(ta(), '__', '__')}><u>U</u></ToolbarButton>

        <div className="editor-toolbar-sep" />

        <ToolbarButton title="Heading 1" onClick={() => prependLine(ta(), '# ')}>H1</ToolbarButton>
        <ToolbarButton title="Heading 2" onClick={() => prependLine(ta(), '## ')}>H2</ToolbarButton>
        <ToolbarButton title="Heading 3" onClick={() => prependLine(ta(), '### ')}>H3</ToolbarButton>

        <div className="editor-toolbar-sep" />

        <ToolbarButton title="Bullet list" onClick={() => prependLine(ta(), '- ')}>•≡</ToolbarButton>
        <ToolbarButton title="Ordered list" onClick={() => prependLine(ta(), '1. ')}>1≡</ToolbarButton>

        <div className="editor-toolbar-sep" />

        <ToolbarButton title="Inline code" onClick={() => wrapSelection(ta(), '`', '`')}>{'<>'}</ToolbarButton>
        <ToolbarButton title="Code block" onClick={() => wrapSelection(ta(), '```\n', '\n```')}>{'{ }'}</ToolbarButton>

        <div className="editor-toolbar-sep" />

        <ToolbarButton title="Blockquote" onClick={() => prependLine(ta(), '> ')}>❝</ToolbarButton>

        <div className="editor-toolbar-sep" />

        <ToolbarButton title="Insert image" onClick={() => fileInputRef.current.click()}>
          {uploading ? '…' : 'IMG'}
        </ToolbarButton>
        <div className="editor-img-sizes" title={onStorageImage ? 'Resize image' : 'Size for next insert'}>
          {[['S','s','25%'], ['M','m','50%'], ['L','l','75%'], ['↔','full','Full']].map(([label, value, hint]) => (
            <button
              key={value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSizeSelect(value)}
              className={`editor-btn editor-img-size-btn${imgSize === value ? ' active' : ''}`}
              title={`${onStorageImage ? 'Resize to' : 'Insert at'} ${hint}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
      </div>
      <div className="markdown-editor__textarea-wrap">
        {uploading && (
          <div className="markdown-editor__upload-overlay">
            <span className="markdown-editor__upload-spinner" />
            Uploading image…
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="markdown-editor__textarea"
          value={content || ''}
          onChange={(e) => { onChange?.(e.target.value); syncCursorContext() }}
          onSelect={syncCursorContext}
          onClick={syncCursorContext}
          onKeyUp={syncCursorContext}
          onBlur={(e) => onBlur?.(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onEscape?.() }}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
            if (!item) return
            e.preventDefault()
            const file = item.getAsFile()
            if (file) handleImageUpload({ target: { files: [file], value: '' } })
          }}
          placeholder="Add notes (Markdown supported)…"
          rows={8}
        />
      </div>
    </div>
  )
}
