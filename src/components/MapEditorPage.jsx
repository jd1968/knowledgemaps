import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { useMindMapStore } from '../store/useMindMapStore'
import MapHeaderBlock from './MapHeaderBlock'
import MapPropertiesModal from './MapPropertiesModal'
import { NodeIconDisplay } from './NodeIcon'
import MarkdownEditor, { markdownComponents, urlTransform } from './MarkdownEditor'
import { ImageLibraryTrigger } from '../image-library'

const HomeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
    <polyline points="9 21 9 12 15 12 15 21" />
  </svg>
)

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const REGION_TYPE_LABELS = {
  card: 'Card',
  image: 'Image',
  diagram: 'Diagram',
}

const CARD_SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL']
const CARD_SIZE_HEIGHTS = {
  XS: 80,
  S: 140,
  M: 200,
  L: 300,
  XL: 400,
}

function CardDetailModal({ card, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="node-modal-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="node-modal map-editor-card-detail-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="node-modal-header">
          <div className="node-modal-header-left">
            <span className="node-modal-header-title">{card.title}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="node-modal-body">
          <div className="map-editor-card-detail-modal__content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
              urlTransform={urlTransform}
            >
              {card.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

function RegionCardItem({ card, cardSize, isEditMode, onEdit, onDelete }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const contentRef = useRef(null)
  const showContent = cardSize !== 'XS' && !!card.content

  useEffect(() => {
    if (!showContent) {
      setIsOverflowing(false)
      return
    }
    const el = contentRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [card.content, cardSize, showContent])

  return (
    <>
      <article
        className="map-editor-region-card"
        style={{ '--card-height': `${CARD_SIZE_HEIGHTS[cardSize] || CARD_SIZE_HEIGHTS.S}px`, height: `${CARD_SIZE_HEIGHTS[cardSize] || CARD_SIZE_HEIGHTS.S}px` }}
      >
        <div className="map-editor-region-card__header">
          <div className="map-editor-region-card__title-row">
            {card.iconUrl && (
              <NodeIconDisplay iconUrl={card.iconUrl} className="map-editor-region-card__icon" />
            )}
            <h3 className="map-editor-region-card__title">{card.title}</h3>
          </div>
          {isEditMode && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onEdit}
              >
                Properties
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => {
                  if (window.confirm(`Delete card "${card.title}"?`)) onDelete()
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
        {showContent ? (
          <div className="map-editor-region-card__content-wrap">
            <div
              ref={contentRef}
              className={`map-editor-region-card__content${isOverflowing ? ' map-editor-region-card__content--truncated' : ''}`}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                urlTransform={urlTransform}
              >
                {card.content}
              </ReactMarkdown>
            </div>
            {isOverflowing && (
              <button
                type="button"
                className="map-editor-region-card__show-more"
                onClick={(e) => { e.stopPropagation(); setDetailOpen(true) }}
              >
                show more...
              </button>
            )}
          </div>
        ) : null}
      </article>
      {detailOpen && <CardDetailModal card={card} onClose={() => setDetailOpen(false)} />}
    </>
  )
}

function RegionInsertControls({ onInsert }) {
  return (
    <div className="map-editor-region-insert">
      <span className="map-editor-region-insert__label">Add region</span>
      <div className="map-editor-region-insert__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onInsert('card')}>Card</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onInsert('image')}>Image</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onInsert('diagram')}>Diagram</button>
      </div>
    </div>
  )
}

export default function MapEditorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mapId } = useParams()
  const loadMap = useMindMapStore((s) => s.loadMap)
  const currentMapName = useMindMapStore((s) => s.currentMapName)
  const breadcrumbs = useMindMapStore((s) => s.breadcrumbs)
  const regions = useMindMapStore((s) => s.currentMapRegions)
  const insertMapRegion = useMindMapStore((s) => s.insertMapRegion)
  const setMapRegions = useMindMapStore((s) => s.setMapRegions)
  const [mapPropertiesOpen, setMapPropertiesOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingRegionId, setEditingRegionId] = useState(null)
  const [regionDraftTitle, setRegionDraftTitle] = useState('')
  const [regionDraftContent, setRegionDraftContent] = useState('')
  const [regionDraftCardSize, setRegionDraftCardSize] = useState('S')
  const [editingCardRegionId, setEditingCardRegionId] = useState(null)
  const [editingCardId, setEditingCardId] = useState(null)
  const [cardDraftTitle, setCardDraftTitle] = useState('')
  const [cardDraftContent, setCardDraftContent] = useState('')
  const [cardDraftIconUrl, setCardDraftIconUrl] = useState('')

  useEffect(() => {
    const nextBreadcrumbs = location.state?.breadcrumbs ?? []
    loadMap(mapId, nextBreadcrumbs).then((result) => {
      if (!result?.success) navigate('/', { replace: true })
    })
  }, [loadMap, location.state, mapId, navigate])

  const isInSubmap = breadcrumbs.length > 0
  const parent = isInSubmap ? breadcrumbs[breadcrumbs.length - 1] : null
  const handleInsertRegion = (index, type) => {
    insertMapRegion(index, {
      type,
      title: `Untitled ${REGION_TYPE_LABELS[type]} Region`,
      iconUrl: '',
      content: '',
    })
  }
  const openRegionProperties = (region) => {
    setEditingRegionId(region.id)
    setRegionDraftTitle(region.title || '')
    setRegionDraftContent(region.content || '')
    setRegionDraftCardSize(region.cardSize || 'S')
  }
  const closeRegionProperties = () => {
    setEditingRegionId(null)
    setRegionDraftTitle('')
    setRegionDraftContent('')
    setRegionDraftCardSize('S')
  }
  useEffect(() => {
    if (!editingRegionId) return
    const handler = (e) => { if (e.key === 'Escape') closeRegionProperties() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingRegionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const openCardProperties = (regionId, card = null) => {
    setEditingCardRegionId(regionId)
    setEditingCardId(card?.id || null)
    setCardDraftTitle(card?.title || '')
    setCardDraftContent(card?.content || '')
    setCardDraftIconUrl(card?.iconUrl || '')
  }
  const closeCardProperties = () => {
    setEditingCardRegionId(null)
    setEditingCardId(null)
    setCardDraftTitle('')
    setCardDraftContent('')
    setCardDraftIconUrl('')
  }
  useEffect(() => {
    if (!editingCardRegionId) return
    const handler = (e) => { if (e.key === 'Escape') closeCardProperties() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingCardRegionId])
  const saveRegionProperties = () => {
    if (!editingRegionId) return
    setMapRegions(regions.map((region) => (
      region.id === editingRegionId
        ? {
            ...region,
            title: regionDraftTitle.trim() || 'Untitled Region',
            content: regionDraftContent,
            cardSize: region.type === 'card' ? regionDraftCardSize : region.cardSize,
          }
        : region
    )))
    closeRegionProperties()
  }
  const saveCardProperties = () => {
    if (!editingCardRegionId) return
    setMapRegions(regions.map((region) => {
      if (region.id !== editingCardRegionId) return region
      const nextCard = {
        id: editingCardId || `region-card-${uuidv4().slice(0, 8)}`,
        title: cardDraftTitle.trim() || 'Untitled Card',
        content: cardDraftContent,
        iconUrl: cardDraftIconUrl,
      }
      const existingCards = Array.isArray(region.cards) ? region.cards : []
      return {
        ...region,
        cards: editingCardId
          ? existingCards.map((card) => (card.id === editingCardId ? { ...card, ...nextCard } : card))
          : [...existingCards, nextCard],
      }
    }))
    closeCardProperties()
  }
  const deleteCard = () => {
    if (!editingCardRegionId || !editingCardId) return
    setMapRegions(regions.map((region) => {
      if (region.id !== editingCardRegionId) return region
      return {
        ...region,
        cards: (region.cards || []).filter((card) => card.id !== editingCardId),
      }
    }))
    closeCardProperties()
  }

  return (
    <>
      <div className="map-editor-page">
        <div className="map-editor-page__toolbar">
          <button
            className="toolbar-home-btn"
            onClick={() => navigate('/')}
            title="Home"
            aria-label="Home"
          >
            <HomeIcon />
          </button>

          <div className="toolbar-breadcrumb map-editor-page__breadcrumb">
            {parent ? (
              <>
                <button
                  className="toolbar-back-crumb"
                  onClick={() => navigate(`/map/${parent.mapId}`, { state: { breadcrumbs: breadcrumbs.slice(0, -1) } })}
                  title={`Back to ${parent.mapName}`}
                  aria-label={`Back to ${parent.mapName}`}
                >
                  <BackIcon />
                  <span className="toolbar-back-crumb-name">{parent.mapName}</span>
                </button>
                <span className="toolbar-crumb-divider" aria-hidden="true">|</span>
                <span className="toolbar-crumb-current">{currentMapName || 'Untitled Map'}</span>
              </>
            ) : (
              <span className="map-editor-page__map-name">{currentMapName || 'Untitled Map'}</span>
            )}
          </div>

          <div className="map-editor-page__toolbar-actions">
            <label className="edit-mode-toggle" title={isEditMode ? 'Disable editing' : 'Enable editing'}>
              <input type="checkbox" checked={isEditMode} onChange={() => {
                setIsEditMode((prev) => {
                  const next = !prev
                  if (!next) {
                    setMapPropertiesOpen(false)
                    closeRegionProperties()
                    closeCardProperties()
                  }
                  return next
                })
              }} />
              <span className="edit-mode-toggle__track">
                <span className="edit-mode-toggle__thumb" />
              </span>
              <span className="edit-mode-toggle__label">Edit</span>
            </label>
            {isEditMode && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setMapPropertiesOpen(true)}
              >
                Properties
              </button>
            )}
          </div>
        </div>

        <div className="map-editor-page__client">
          <div className="map-editor-page__content">
            <div className="map-editor-page__header">
              <MapHeaderBlock />
            </div>
            <div className="map-editor-page__client-inner">
              <div className="map-editor-regions">
                {isEditMode && (
                  <RegionInsertControls onInsert={(type) => handleInsertRegion(0, type)} />
                )}

                {regions.length === 0 ? (
                  <div className="map-editor-regions__empty">
                    <h2 className="map-editor-regions__empty-title">No regions yet</h2>
                    <p className="map-editor-regions__empty-body">
                      Add your first region above to start building the new editor layout for this map.
                    </p>
                    <p className="map-editor-page__meta">Map ID: {mapId}</p>
                  </div>
                ) : (
                  regions.map((region, index) => (
                    <div key={region.id} className="map-editor-region-stack">
                      {isEditMode && index > 0 && (
                        <RegionInsertControls onInsert={(type) => handleInsertRegion(index, type)} />
                      )}
                      <section className="map-editor-region" aria-label={region.title}>
                        <div className="map-editor-region__header">
                          <div className="map-editor-region__title-wrap">
                            {region.iconUrl && (
                              <NodeIconDisplay iconUrl={region.iconUrl} className="map-editor-region__icon" />
                            )}
                            <div className="map-editor-region__title-block">
                              <h2 className="map-editor-region__title">{region.title}</h2>
                            </div>
                          </div>
                          {isEditMode && (
                            <div className="map-editor-region__actions">
                              {region.type === 'card' && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => openCardProperties(region.id)}
                                >
                                  Add card
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => openRegionProperties(region)}
                              >
                                Properties
                              </button>
                            </div>
                          )}
                        </div>
                        {region.content ? (
                          <div className="map-editor-region__content">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                              urlTransform={urlTransform}
                            >
                              {region.content}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                        {region.type === 'card' && Array.isArray(region.cards) && region.cards.length > 0 && (
                          <div className="map-editor-region-cards">
                            {region.cards.map((card) => (
                              <RegionCardItem
                                key={card.id}
                                card={card}
                                cardSize={region.cardSize || 'S'}
                                isEditMode={isEditMode}
                                onEdit={() => openCardProperties(region.id, card)}
                                onDelete={() => {
                                  setMapRegions(regions.map((r) =>
                                    r.id !== region.id ? r : { ...r, cards: r.cards.filter((c) => c.id !== card.id) }
                                  ))
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  ))
                )}

                {isEditMode && regions.length > 0 && (
                  <RegionInsertControls onInsert={(type) => handleInsertRegion(regions.length, type)} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <MapPropertiesModal open={isEditMode && mapPropertiesOpen} onClose={() => setMapPropertiesOpen(false)} />
      {isEditMode && editingRegionId && (
        <div className="node-modal-overlay">
          <div className="node-modal map-editor-region-modal" onPointerDown={(event) => event.stopPropagation()}>
            <div className="node-modal-header">
              <div className="node-modal-header-left">
                <span className="node-modal-header-title">Region Properties</span>
              </div>
              <button className="icon-btn" onClick={closeRegionProperties} aria-label="Close">x</button>
            </div>

            <div className="node-modal-body">
              <div className="field">
                <label className="field-label">Title</label>
                <input
                  className="field-input"
                  value={regionDraftTitle}
                  onChange={(event) => setRegionDraftTitle(event.target.value)}
                  placeholder="Region title..."
                  autoFocus
                />
              </div>

              <div className="field field--grow">
                <label className="field-label">Content</label>
                <div className="map-editor-region-modal__markdown">
                  <MarkdownEditor
                    content={regionDraftContent}
                    onChange={(next) => setRegionDraftContent(next)}
                    editable={true}
                  />
                </div>
              </div>

              {regions.find((region) => region.id === editingRegionId)?.type === 'card' && (
                <div className="field">
                  <label className="field-label">Card Size</label>
                  <select
                    className="field-input"
                    value={regionDraftCardSize}
                    onChange={(event) => setRegionDraftCardSize(event.target.value)}
                  >
                    {CARD_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="node-modal-footer">
              <button className="btn btn--secondary btn--sm" onClick={closeRegionProperties}>
                Cancel
              </button>
              <button className="btn btn--primary btn--sm" onClick={saveRegionProperties}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {isEditMode && editingCardRegionId && (
        <div className="node-modal-overlay">
          <div className="node-modal map-editor-region-modal" onPointerDown={(event) => event.stopPropagation()}>
            <div className="node-modal-header">
              <div className="node-modal-header-left">
                <span className="node-modal-header-title">{editingCardId ? 'Card Properties' : 'New Card'}</span>
              </div>
              <button className="icon-btn" onClick={closeCardProperties} aria-label="Close">x</button>
            </div>

            <div className="node-modal-body">
              <div className="field">
                <label className="field-label">Title</label>
                <input
                  className="field-input"
                  value={cardDraftTitle}
                  onChange={(event) => setCardDraftTitle(event.target.value)}
                  placeholder="Card title..."
                  autoFocus
                />
              </div>

              <div className="field">
                <label className="field-label">Icon</label>
                <div className="map-properties-icon-row">
                  <div className="map-properties-icon-preview" aria-hidden="true">
                    {cardDraftIconUrl
                      ? <NodeIconDisplay iconUrl={cardDraftIconUrl} className="map-properties-icon-image" />
                      : <span className="map-properties-icon-placeholder">No icon</span>}
                  </div>
                  <div className="map-properties-icon-actions">
                    <ImageLibraryTrigger onSelect={(url) => setCardDraftIconUrl(url)} />
                    {cardDraftIconUrl && (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCardDraftIconUrl('')}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="field field--grow">
                <label className="field-label">Content</label>
                <div className="map-editor-region-modal__markdown">
                  <MarkdownEditor
                    content={cardDraftContent}
                    onChange={(next) => setCardDraftContent(next)}
                    editable={true}
                  />
                </div>
              </div>
            </div>

            <div className="node-modal-footer">
              {editingCardId && (
                <button className="btn btn--danger btn--sm" onClick={() => {
                  if (window.confirm(`Delete card "${cardDraftTitle || 'this card'}"?`)) deleteCard()
                }}>
                  Delete
                </button>
              )}
              <button className="btn btn--secondary btn--sm" onClick={closeCardProperties}>
                Cancel
              </button>
              <button className="btn btn--primary btn--sm" onClick={saveCardProperties}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
