import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useRef } from 'react'

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
  // Use execCommand for undo support, fall back to direct assignment
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

  if (!editable) {
    return (
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
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
      </div>
      <textarea
        ref={textareaRef}
        className="markdown-editor__textarea"
        value={content || ''}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={(e) => onBlur?.(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onEscape?.() }}
        placeholder="Add notes (Markdown supported)…"
        rows={8}
      />
    </div>
  )
}
