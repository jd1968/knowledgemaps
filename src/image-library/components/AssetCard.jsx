import React from 'react'

export function AssetCard({ asset, onSelect }) {
  return (
    <button
      onClick={() => onSelect(asset.public_url)}
      className="il-card"
      title={asset.name}
      type="button"
    >
      <div className="il-card-thumb">
        <img
          src={asset.thumbnail_url}
          alt={asset.name}
          loading="lazy"
          draggable={false}
        />
      </div>
      <div className="il-card-meta">
        <span className="il-card-name">{asset.name}</span>
        {asset.tags?.length > 0 && (
          <span className="il-card-tags">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t.id} className="il-tag">{t.name}</span>
            ))}
          </span>
        )}
      </div>
    </button>
  )
}
