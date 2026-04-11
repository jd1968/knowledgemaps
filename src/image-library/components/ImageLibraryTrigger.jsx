import React, { useState } from 'react'
import { ImageLibrary } from './ImageLibrary'

/**
 * Drop-in trigger button that opens the image library modal.
 * Accepts an optional custom `children` to use as the trigger element.
 *
 * @example
 * <ImageLibraryTrigger onSelect={(url) => setImageUrl(url)} />
 *
 * @example
 * <ImageLibraryTrigger onSelect={(url) => setImageUrl(url)}>
 *   <button>Pick logo</button>
 * </ImageLibraryTrigger>
 */
export function ImageLibraryTrigger({ onSelect, children, className, style }) {
  const [open, setOpen] = useState(false)

  const handleSelect = (url) => {
    onSelect?.(url)
    setOpen(false)
  }

  const trigger = children ? (
    React.cloneElement(React.Children.only(children), {
      onClick: () => setOpen(true),
    })
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 11px',
        borderRadius: 7,
        border: '1px solid #cec4b3',
        background: '#f9f6f1',
        color: '#1c1917',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      Image Library
    </button>
  )

  return (
    <>
      {trigger}
      <ImageLibrary open={open} onClose={() => setOpen(false)} onSelect={handleSelect} />
    </>
  )
}
