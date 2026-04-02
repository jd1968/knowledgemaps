export const computeNodeLayouts = ({
  nodes,
  edges,
  rootId,
  getNodeSize,
  padding,
}) => {
  const parentChildrenMap = {}
  edges.forEach((e) => {
    if (!parentChildrenMap[e.source]) parentChildrenMap[e.source] = []
    parentChildrenMap[e.source].push(e.target)
  })

  const parentIdSet = new Set(
    Object.keys(parentChildrenMap).filter((id) => id !== rootId && parentChildrenMap[id].length > 0)
  )

  const nodeById = {}
  nodes.forEach((n) => { nodeById[n.id] = n })

  const nestDepth = {}
  const computeDepth = (id) => {
    if (id in nestDepth) return nestDepth[id]
    let max = 0
    ;(parentChildrenMap[id] || []).forEach((childId) => {
      if (parentIdSet.has(childId)) max = Math.max(max, computeDepth(childId) + 1)
    })
    nestDepth[id] = max
    return max
  }
  parentIdSet.forEach((id) => computeDepth(id))

  const layouts = {}
  Array.from(parentIdSet)
    .sort((a, b) => (nestDepth[a] ?? 0) - (nestDepth[b] ?? 0))
    .forEach((parentId) => {
      const parentNode = nodeById[parentId]
      const childIds = parentChildrenMap[parentId] || []

      const allDescendantIds = []
      const collectDescendants = (ids) => {
        ids.forEach((cid) => {
          allDescendantIds.push(cid)
          if (parentIdSet.has(cid) && layouts[cid]) return
          const grandkids = parentChildrenMap[cid]
          if (grandkids?.length) collectDescendants(grandkids)
        })
      }
      collectDescendants(childIds)

      const descendants = allDescendantIds.map((id) => nodeById[id]).filter(Boolean)
      if (descendants.length === 0) {
        layouts[parentId] = {
          x: parentNode?.position?.x ?? 0,
          y: parentNode?.position?.y ?? 0,
          width: 220,
          height: 80,
        }
        return
      }

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      descendants.forEach((child) => {
        if (parentIdSet.has(child.id) && layouts[child.id]) {
          const nested = layouts[child.id]
          minX = Math.min(minX, nested.x)
          minY = Math.min(minY, nested.y)
          maxX = Math.max(maxX, nested.x + nested.width)
          maxY = Math.max(maxY, nested.y + nested.height)
          return
        }

        const size = getNodeSize(child)
        minX = Math.min(minX, child.position.x)
        minY = Math.min(minY, child.position.y)
        maxX = Math.max(maxX, child.position.x + size.width)
        maxY = Math.max(maxY, child.position.y + size.height)
      })

      const anchorX = parentNode?.position?.x ?? (minX - padding.left)
      const anchorY = parentNode?.position?.y ?? (minY - padding.top)
      const x = Math.min(anchorX, minX - padding.left)
      const y = Math.min(anchorY, minY - padding.top)

      layouts[parentId] = {
        x,
        y,
        width: Math.max(220, (maxX - x) + padding.right),
        height: Math.max(80, (maxY - y) + padding.bottom),
      }
    })

  return { layouts, parentChildrenMap, parentIdSet }
}
