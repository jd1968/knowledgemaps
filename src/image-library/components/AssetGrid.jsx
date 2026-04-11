import React from 'react'
import { AssetCard } from './AssetCard'

export function AssetGrid({ assets, loading, onSelect }) {
  if (loading) {
    return (
      <div className="il-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="il-card il-card--skeleton" />
        ))}
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="il-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <p>No images found</p>
      </div>
    )
  }

  return (
    <div className="il-grid">
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} onSelect={onSelect} />
      ))}
    </div>
  )
}
