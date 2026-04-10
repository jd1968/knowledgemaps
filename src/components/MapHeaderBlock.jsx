import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMindMapStore } from '../store/useMindMapStore'
import { NodeIconDisplay } from './NodeIcon'
import { markdownComponents, urlTransform } from './MarkdownEditor'

export default function MapHeaderBlock() {
  const currentMapName = useMindMapStore((s) => s.currentMapName)
  const currentMapIconUrl = useMindMapStore((s) => s.currentMapIconUrl)
  const currentMapContent = useMindMapStore((s) => s.currentMapContent)

  const title = (currentMapName || 'Untitled Map').trim() || 'Untitled Map'
  const content = (currentMapContent || '').trim()

  return (
    <div className="map-header-block">
      <div className="map-header-title-row">
        {currentMapIconUrl && (
          <NodeIconDisplay iconUrl={currentMapIconUrl} className="map-header-icon" />
        )}
        <h1 className="map-header-title">{title}</h1>
      </div>
      {content && (
        <div className="map-header-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
            urlTransform={urlTransform}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}
