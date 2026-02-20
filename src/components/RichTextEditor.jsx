import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'

const ToolbarButton = ({ onClick, active, title, children }) => (
  <button
    type="button"
    onMouseDown={(e) => {
      e.preventDefault() // prevent editor from losing focus
      onClick()
    }}
    className={`editor-btn${active ? ' active' : ''}`}
    title={title}
  >
    {children}
  </button>
)

const EditorToolbar = ({ editor }) => {
  if (!editor) return null

  return (
    <div className="editor-toolbar">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Bold"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Italic"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Underline"
      >
        <u>U</u>
      </ToolbarButton>

      <div className="editor-toolbar-sep" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>

      <div className="editor-toolbar-sep" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Bullet list"
      >
        •≡
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Ordered list"
      >
        1≡
      </ToolbarButton>

      <div className="editor-toolbar-sep" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')}
        title="Inline code"
      >
        {'<>'}
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        title="Code block"
      >
        {'{ }'}
      </ToolbarButton>

      <div className="editor-toolbar-sep" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Blockquote"
      >
        ❝
      </ToolbarButton>
    </div>
  )
}

const RichTextEditor = ({ content, onChange, editable = true }) => {
  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: content || '',
    editable,
    onUpdate: ({ editor }) => {
      if (editable) onChange?.(editor.getHTML())
    },
    editorProps: {
      attributes: { class: 'prose-editor' },
    },
  })

  // Sync editable flag when it changes
  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
  }, [editor, editable])

  // Sync content when switching between nodes
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current !== (content || '')) {
      editor.commands.setContent(content || '', false)
    }
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`rich-text-editor${editable ? '' : ' rich-text-editor--readonly'}`}>
      {editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}

export default RichTextEditor
