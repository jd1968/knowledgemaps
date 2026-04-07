import { BaseEdge } from '@xyflow/react'

const strokeFor = (relType, selected) => {
  if (relType === 'master-detail') return selected ? '#c62828' : '#e53935'
  return selected ? '#3a6fd8' : '#5b8dee'
}

export default function RelationshipEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }) {
  const relType = data?.relType === 'master-detail' ? 'master-detail' : 'lookup'
  const stroke = strokeFor(relType, selected)
  const markerStartId = `${id}-${relType}-${selected ? 'sel' : 'base'}-start`
  const markerEndId = `${id}-${relType}-${selected ? 'sel' : 'base'}-end`
  const markerStroke = relType === 'master-detail'
    ? (selected ? '#c62828' : '#e53935')
    : (selected ? '#3a6fd8' : '#5b8dee')
  const markerStrokeWidth = selected ? 2.5 : 2

  return (
    <>
      <defs>
        {relType === 'master-detail' ? (
          <>
            <marker id={markerStartId} markerUnits="userSpaceOnUse" viewBox="-5 0 25 20" markerWidth="25" markerHeight="20" refX="0" refY="10" orient="auto">
              <path d="M 7 4 L 7 16 M 12 4 L 12 16" fill="none" stroke={markerStroke} strokeWidth={markerStrokeWidth} strokeLinecap="round" />
            </marker>
            <marker id={markerEndId} markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
              <circle cx="6" cy="10" r="5" fill="#fff" stroke={markerStroke} strokeWidth={markerStrokeWidth} />
              <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke={markerStroke} strokeWidth={markerStrokeWidth} strokeLinecap="round" />
            </marker>
          </>
        ) : (
          <>
            <marker id={markerStartId} markerUnits="userSpaceOnUse" viewBox="-5 0 27 20" markerWidth="27" markerHeight="20" refX="0" refY="10" orient="auto">
              <path d="M 7 4 L 7 16" fill="none" stroke={markerStroke} strokeWidth={markerStrokeWidth} strokeLinecap="round" />
              <circle cx="16" cy="10" r="5" fill="#fff" stroke={markerStroke} strokeWidth={markerStrokeWidth} />
            </marker>
            <marker id={markerEndId} markerUnits="userSpaceOnUse" viewBox="0 0 25 20" markerWidth="25" markerHeight="20" refX="20" refY="10" orient="auto">
              <circle cx="6" cy="10" r="5" fill="#fff" stroke={markerStroke} strokeWidth={markerStrokeWidth} />
              <path d="M 12 10 L 20 4 M 12 10 L 20 16" fill="none" stroke={markerStroke} strokeWidth={markerStrokeWidth} strokeLinecap="round" />
            </marker>
          </>
        )}
      </defs>
      <BaseEdge
        id={id}
        path={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`}
        style={{ stroke, strokeWidth: selected ? 2.5 : 2.2 }}
        markerStart={`url(#${markerStartId})`}
        markerEnd={`url(#${markerEndId})`}
      />
    </>
  )
}
