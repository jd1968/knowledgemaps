import React from 'react'

export function TagFilter({ tags, selected, onChange }) {
  if (tags.length === 0) return null

  const toggle = (id) => {
    onChange(
      selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]
    )
  }

  return (
    <div className="il-tag-filter">
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={`il-tag-btn${selected.includes(tag.id) ? ' il-tag-btn--active' : ''}`}
          onClick={() => toggle(tag.id)}
        >
          {tag.name}
        </button>
      ))}
    </div>
  )
}
