import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '../lib/supabase'

const HISTORY_LIMIT = 50

const ROOT_ID = 'root-' + uuidv4().slice(0, 8)

const initialNodes = [
  {
    id: ROOT_ID,
    type: 'mindmap',
    position: { x: 350, y: 250 },
    data: {
      title: 'Central Topic',
      key: ROOT_ID,
      level: 0,
      nodeType: 'folder',
      content: '',
    },
  },
]

export const useMindMapStore = create((set, get) => ({
  // ── Map data ─────────────────────────────────────────────────
  nodes: initialNodes,
  edges: [],
  selectedNodeId: null,
  pendingNewNodeId: null,

  // ── Map metadata ─────────────────────────────────────────────
  currentMapId: null,
  currentMapName: 'Untitled Map',
  isDirty: false,
  saveStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'error'

  // ── History ──────────────────────────────────────────────────
  past: [],
  future: [],

  // ── UI state ─────────────────────────────────────────────────
  isMapListOpen: false,
  autosaveTimer: null,
  fitViewTrigger: 0,
  isEditMode: false,
  openMenuNodeId: null,
  setOpenMenuNodeId: (id) => set({ openMenuNodeId: id }),

  setEditMode: (isEditMode) => set({ isEditMode }),
  toggleEditMode: () => set((state) => ({ isEditMode: !state.isEditMode })),

  // ── Submap navigation ─────────────────────────────────────────
  // Each entry: { mapId, mapName }  — the trail of maps above the current one
  breadcrumbs: [],

  // ── React Flow handlers ───────────────────────────────────────

  onNodesChange: (changes) => {
    const { isEditMode } = get()
    const effectiveChanges = isEditMode
      ? changes
      : changes.filter((c) => c.type === 'select' || c.type === 'dimensions')
    if (effectiveChanges.length === 0) return

    const hasNonSelectChange = effectiveChanges.some((c) => c.type !== 'select' && c.type !== 'dimensions')

    // Don't push position changes to history during drag (too noisy)
    // History is pushed in onNodeDragStart instead
    set((state) => ({
      nodes: applyNodeChanges(
        effectiveChanges.filter((c) => {
          if (c.type !== 'position') return true
          const node = state.nodes.find((n) => n.id === c.id)
          return node?.data?.nodeType !== 'group'
        }),
        state.nodes
      ),
      isDirty: hasNonSelectChange ? true : state.isDirty,
    }))
    // Debounce autosave (skip for selection-only changes)
    if (hasNonSelectChange) get().scheduleAutosave()
  },

  onEdgesChange: (changes) => {
    const { isEditMode } = get()
    const effectiveChanges = isEditMode
      ? changes
      : changes.filter((c) => c.type === 'select')
    if (effectiveChanges.length === 0) return

    const hasNonSelectChange = effectiveChanges.some((c) => c.type !== 'select')

    set((state) => ({
      edges: applyEdgeChanges(effectiveChanges, state.edges),
      isDirty: hasNonSelectChange ? true : state.isDirty,
    }))
    if (hasNonSelectChange) get().scheduleAutosave()
  },

  onConnect: (connection) => {
    if (!get().isEditMode) return
    get().pushHistory()
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          type: 'straight-center',
          style: { stroke: '#94a3b8', strokeWidth: 2 },
          animated: false,
        },
        state.edges
      ),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  // ── Node CRUD ─────────────────────────────────────────────────

  addNode: ({ position, level = 1, title = 'New Node' }) => {
    if (!get().isEditMode) return null
    get().pushHistory()
    const id = uuidv4()
    const newNode = {
      id,
      type: 'mindmap',
      position,
      data: {
        title,
        key: id,
        level,
        nodeType: 'folder',
        content: '',
      },
    }
    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }))
    get().scheduleAutosave()
    return newNode
  },

  updateNodeData: (nodeId, updates) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      ),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  setDescendantsCollapsed: (nodeId, collapse) => {
    if (!get().isEditMode) return
    const { edges } = get()
    const childrenMap = {}
    edges.forEach(e => {
      if (!childrenMap[e.source]) childrenMap[e.source] = []
      childrenMap[e.source].push(e.target)
    })
    // Collect the node itself and all descendants that have children
    const toUpdate = new Set()
    if (childrenMap[nodeId]?.length) toUpdate.add(nodeId)
    const collect = (id) => {
      ;(childrenMap[id] || []).forEach(kid => {
        if (childrenMap[kid]?.length) toUpdate.add(kid)
        collect(kid)
      })
    }
    collect(nodeId)
    if (toUpdate.size === 0) return
    get().pushHistory()
    set((state) => ({
      nodes: state.nodes.map(node =>
        toUpdate.has(node.id)
          ? { ...node, data: { ...node.data, collapsed: collapse } }
          : node
      ),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  setEdgeType: (targetNodeId, edgeType) => {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.target === targetNodeId ? { ...e, type: edgeType } : e
      ),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  deleteNode: (nodeId) => {
    if (!get().isEditMode) return
    get().pushHistory()
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      ),
      selectedNodeId:
        state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      isDirty: true,
    }))
    // Remove content row immediately so it doesn't linger in the nodes table
    const { currentMapId } = get()
    if (currentMapId) {
      supabase.from('nodes').delete().eq('id', nodeId).then(({ error }) => {
        if (error) console.error('Failed to delete node row:', error)
      })
    }
    get().scheduleAutosave()
  },

  // ── Selection ─────────────────────────────────────────────────

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId })
  },

  deselectNode: () => {
    set({ selectedNodeId: null, pendingNewNodeId: null })
  },

  // ── History ───────────────────────────────────────────────────

  pushHistory: () => {
    const { nodes, edges, past } = get()
    const snapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    set({ past: [...past, snapshot].slice(-HISTORY_LIMIT), future: [] })
  },

  undo: () => {
    if (!get().isEditMode) return
    const { nodes, edges, past, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const currentSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: past.slice(0, -1),
      future: [currentSnapshot, ...future].slice(0, HISTORY_LIMIT),
      isDirty: true,
    })
  },

  redo: () => {
    if (!get().isEditMode) return
    const { nodes, edges, past, future } = get()
    if (future.length === 0) return
    const next = future[0]
    const currentSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    set({
      nodes: next.nodes,
      edges: next.edges,
      past: [...past, currentSnapshot].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      isDirty: true,
    })
  },

  // ── Autosave ──────────────────────────────────────────────────

  scheduleAutosave: () => {
    const state = get()
    if (state.autosaveTimer) clearTimeout(state.autosaveTimer)
    if (!state.currentMapId) return // Only autosave maps that have been explicitly saved once

    const timer = setTimeout(() => {
      get().saveMap()
    }, 2000)

    set({ autosaveTimer: timer })
  },

  // ── Save / Load ───────────────────────────────────────────────

  saveMap: async (nameOverride) => {
    const { nodes, edges, currentMapId, currentMapName } = get()
    const name = nameOverride || currentMapName

    // Strip content from diagram JSON — content lives in the nodes table
    const mapData = {
      nodes: nodes.map(({ data: { content: _c, ...rest }, ...node }) => ({
        ...node,
        data: rest,
      })),
      edges,
    }

    set({ saveStatus: 'saving' })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      let mapId = currentMapId

      if (mapId) {
        const { error } = await supabase
          .from('maps')
          .update({ name, data: mapData })
          .eq('id', mapId)
        if (error) throw error
      } else {
        const { data: saved, error } = await supabase
          .from('maps')
          .insert({ name, data: mapData, user_id: user?.id })
          .select()
          .single()
        if (error) throw error
        mapId = saved.id
        set({ currentMapId: mapId })
      }

      // Upsert node content — skip submap pointer nodes (their content lives in the child map)
      const contentNodes = nodes.filter((n) => !n.data.isSubmap)
      if (contentNodes.length > 0) {
        const nodeRows = contentNodes.map((n) => ({
          id: n.id,
          map_id: mapId,
          user_id: user?.id,
          title: n.data.title || '',
          content: n.data.content || '',
        }))
        const { error } = await supabase
          .from('nodes')
          .upsert(nodeRows, { onConflict: 'id' })
        if (error) throw error
      }

      set({ isDirty: false, currentMapName: name, saveStatus: 'saved' })
      setTimeout(() => set({ saveStatus: 'idle' }), 2000)

      return { success: true }
    } catch (err) {
      console.error('Save failed:', err)
      set({ saveStatus: 'error' })
      setTimeout(() => set({ saveStatus: 'idle' }), 3000)
      return { success: false, error: err }
    }
  },

  loadMap: async (mapId, breadcrumbs = []) => {
    try {
      // Phase 1: load map structure only so the canvas renders immediately
      const mapResult = await supabase.from('maps').select('*').eq('id', mapId).single()
      if (mapResult.error) throw mapResult.error

      const nodes = (mapResult.data.data.nodes || []).map((n) => ({
        ...n,
        data: {
          ...n.data,
          nodeType: n.data.nodeType ?? (n.data.isSubmap ? 'submap' : 'folder'),
          content: '',
        },
      }))

      set((state) => ({
        nodes,
        edges: mapResult.data.data.edges || [],
        currentMapId: mapResult.data.id,
        currentMapName: mapResult.data.name,
        isDirty: false,
        past: [],
        future: [],
        selectedNodeId: null,
        saveStatus: 'idle',
        fitViewTrigger: state.fitViewTrigger + 1,
        breadcrumbs,
      }))

      // Only persist the last-opened map when at the root level
      if (breadcrumbs.length === 0) {
        localStorage.setItem('km_lastMapId', mapId)
      }

      // Phase 2: load node content in the background — updates hasNotes indicators
      get()._loadContentForMap(mapId)

      return { success: true }
    } catch (err) {
      console.error('Load failed:', err)
      return { success: false, error: err }
    }
  },

  _loadContentForMap: async (mapId) => {
    const { data } = await supabase.from('nodes').select('id, content').eq('map_id', mapId)
    if (!data) return
    const contentById = {}
    data.forEach((n) => { contentById[n.id] = n.content || '' })
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const content = contentById[n.id]
        if (content === undefined) return n
        return { ...n, data: { ...n.data, content } }
      }),
    }))
  },

  // ── Submap ────────────────────────────────────────────────────

  convertToSubmap: async (nodeId) => {
    if (!get().isEditMode) return { success: false }
    const { nodes, edges, currentMapId, currentMapName, isDirty, autosaveTimer } = get()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return { success: false }

    // Flush any pending autosave for the parent map first
    if (isDirty && currentMapId) {
      if (autosaveTimer) clearTimeout(autosaveTimer)
      await get().saveMap()
    }

    const nodeLevel = node.data.level

    // Build children map from edges
    const childrenMap = {}
    edges.forEach((e) => {
      if (!childrenMap[e.source]) childrenMap[e.source] = []
      childrenMap[e.source].push(e.target)
    })

    // Collect the node + all its descendants
    const subtreeIds = new Set([nodeId])
    const collectIds = (id) => {
      ;(childrenMap[id] || []).forEach((kid) => { subtreeIds.add(kid); collectIds(kid) })
    }
    collectIds(nodeId)

    const subtreeNodes = nodes.filter((n) => subtreeIds.has(n.id))
    const subtreeEdges = edges.filter((e) => subtreeIds.has(e.source) && subtreeIds.has(e.target))

    // Offset positions so the converted node lands at a nice centre
    const offsetX = 350 - node.position.x
    const offsetY = 250 - node.position.y

    const submapNodes = subtreeNodes.map((n) => ({
      ...n,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
      data: {
        ...n.data,
        level: n.id === nodeId ? 0 : Math.min(Math.max(n.data.level - nodeLevel, 1), 3),
        // Clear submap pointer fields — nodes are "real" inside the submap
        isSubmap: undefined,
        submapId: undefined,
        collapsed: n.id === nodeId ? false : n.data.collapsed,
      },
    }))

    // Strip content from map JSON (content lives in nodes table)
    const submapMapData = {
      nodes: submapNodes.map(({ data: { content: _c, ...rest }, ...n }) => ({ ...n, data: rest })),
      edges: subtreeEdges,
      parentMapId: currentMapId,
      parentNodeId: nodeId,
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Create the new submap record
      const { data: newMap, error: mapErr } = await supabase
        .from('maps')
        .insert({ name: node.data.title || 'Submap', data: submapMapData, user_id: user?.id })
        .select()
        .single()
      if (mapErr) throw mapErr

      // Write node content rows for the submap (this moves map_id ownership to the submap)
      const contentRows = subtreeNodes.map((n) => ({
        id: n.id,
        map_id: newMap.id,
        user_id: user?.id,
        title: n.data.title || '',
        content: n.data.content || '',
      }))
      const { error: contentErr } = await supabase
        .from('nodes')
        .upsert(contentRows, { onConflict: 'id' })
      if (contentErr) throw contentErr

      // Update parent map in memory: remove descendants, mark node as submap pointer
      const descendantIds = new Set([...subtreeIds].filter((id) => id !== nodeId))
      set((state) => ({
        nodes: state.nodes
          .filter((n) => !descendantIds.has(n.id))
          .map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, isSubmap: true, submapId: newMap.id, nodeType: 'submap', collapsed: false } }
              : n
          ),
        edges: state.edges.filter(
          (e) => !descendantIds.has(e.source) && !descendantIds.has(e.target)
        ),
        isDirty: true,
      }))

      // Save the updated parent map immediately
      await get().saveMap()

      return { success: true, submapId: newMap.id }
    } catch (err) {
      console.error('convertToSubmap failed:', err)
      return { success: false, error: err }
    }
  },

  navigateToSubmap: async (submapId) => {
    const { currentMapId, currentMapName, breadcrumbs, isDirty, autosaveTimer } = get()
    if (isDirty && currentMapId) {
      if (autosaveTimer) clearTimeout(autosaveTimer)
      await get().saveMap()
    }
    const newCrumbs = [...breadcrumbs, { mapId: currentMapId, mapName: currentMapName }]
    return get().loadMap(submapId, newCrumbs)
  },

  navigateBack: async (targetIndex = null) => {
    const { breadcrumbs } = get()
    if (breadcrumbs.length === 0) return
    let crumb, newCrumbs
    if (targetIndex !== null) {
      crumb = breadcrumbs[targetIndex]
      newCrumbs = breadcrumbs.slice(0, targetIndex)
    } else {
      crumb = breadcrumbs[breadcrumbs.length - 1]
      newCrumbs = breadcrumbs.slice(0, -1)
    }
    return get().loadMap(crumb.mapId, newCrumbs)
  },

  newMap: () => {
    const rootId = 'root-' + uuidv4().slice(0, 8)
    set({
      nodes: [
        {
          id: rootId,
          type: 'mindmap',
          position: { x: 350, y: 250 },
          data: { title: 'Central Topic', key: rootId, level: 0, content: '' },
        },
      ],
      edges: [],
      currentMapId: null,
      currentMapName: 'Untitled Map',
      isDirty: false,
      past: [],
      future: [],
      selectedNodeId: null,
      saveStatus: 'idle',
    })
  },

  setMapName: (name) => {
    set({ currentMapName: name, isDirty: true })
  },

  // ── Add child node ────────────────────────────────────────────

  addChildNode: (parentId, nodeType = 'folder') => {
    if (!get().isEditMode) return
    const { nodes, edges } = get()
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) return

    get().pushHistory()

    const parentLevel = parent.data.level ?? 0
    const isGroupParent = parent.data.nodeType === 'group'
    const childLevel = Math.min(parentLevel + 1, 3)
    const NODE_WIDTHS = [190, 160, 135, 115]
    const parentWidth = NODE_WIDTHS[Math.min(parentLevel, 3)]

    // Find existing children of this parent to stack below them
    const childIds = new Set(
      edges.filter((e) => e.source === parentId).map((e) => e.target)
    )
    const childNodes = nodes.filter((n) => childIds.has(n.id))

    const hGap = 70
    const vSpacing = 70
    const groupPaddingX = 24
    const groupPaddingTop = parent.data.title?.trim() ? 58 : 16

    let x = parent.position.x + parentWidth + hGap
    let y = parent.position.y

    if (isGroupParent) {
      x = parent.position.x + groupPaddingX
      y = parent.position.y + groupPaddingTop
      if (childNodes.length > 0) {
        const sorted = [...childNodes].sort((a, b) => a.position.y - b.position.y)
        y = sorted[sorted.length - 1].position.y + vSpacing
      }
    } else if (childNodes.length > 0) {
      const sorted = [...childNodes].sort((a, b) => a.position.y - b.position.y)
      y = sorted[sorted.length - 1].position.y + vSpacing
    }

    const id = uuidv4()
    const newNode = {
      id,
      type: 'mindmap',
      position: { x, y },
      data: { title: 'New Node', key: id, level: childLevel, nodeType, content: '' },
    }

    const newEdge = {
      id: `e-${parentId}-${id}`,
      source: parentId,
      target: id,
      type: 'straight-center',
      style: { stroke: '#94a3b8', strokeWidth: 2 },
      animated: false,
    }

    set((state) => ({
      nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), newNode],
      edges: [...state.edges, newEdge],
      pendingNewNodeId: id,
      isDirty: true,
    }))

    get().scheduleAutosave()
    return id
  },

  // ── Reparent node (drag-drop into group) ──────────────────────

  reparentNode: (nodeId, newParentId) => {
    if (!get().isEditMode) return
    const { nodes, edges } = get()

    // Guard: can't reparent to self
    if (nodeId === newParentId) return

    // Guard: already a direct child of this parent
    const currentParentEdge = edges.find(e => e.target === nodeId)
    if (currentParentEdge?.source === newParentId) return

    // Guard: newParentId must not be a descendant of nodeId (would create cycle)
    const isDescendant = (fromId, targetId) => {
      for (const e of edges) {
        if (e.source !== fromId) continue
        if (e.target === targetId || isDescendant(e.target, targetId)) return true
      }
      return false
    }
    if (isDescendant(nodeId, newParentId)) return

    const newParentNode = nodes.find(n => n.id === newParentId)
    const newParentLevel = newParentNode?.data?.level ?? 0
    const isGroupParent = newParentNode?.data?.nodeType === 'group'

    // Build new edge list: remove old parent edge, add new one
    const newEdges = [
      ...edges.filter(e => e.target !== nodeId),
      {
        id: `e-${newParentId}-${nodeId}`,
        source: newParentId,
        target: nodeId,
        type: 'straight-center',
        style: { stroke: '#94a3b8', strokeWidth: 2 },
        animated: false,
      },
    ]

    // Recursively assign new levels for the moved subtree
    const levelMap = {}
    const assignLevels = (id, level) => {
      levelMap[id] = Math.min(level, 3)
      newEdges.filter(e => e.source === id).forEach(e => assignLevels(e.target, level + 1))
    }
    assignLevels(nodeId, newParentLevel + 1)

    set(state => {
      const groupPaddingX = 24
      const groupPaddingTop = newParentNode?.data?.title?.trim() ? 58 : 16
      const vSpacing = 70

      let reparentedNodeY = null
      if (isGroupParent) {
        const siblingIds = newEdges
          .filter(e => e.source === newParentId && e.target !== nodeId)
          .map(e => e.target)
        const siblingNodes = state.nodes.filter(n => siblingIds.includes(n.id))
        reparentedNodeY = siblingNodes.length
          ? Math.max(...siblingNodes.map(n => n.position.y)) + vSpacing
          : (newParentNode?.position?.y ?? 0) + groupPaddingTop
      }

      return {
        nodes: state.nodes.map(n => {
          const nextLevel = levelMap[n.id]
          if (n.id === nodeId && isGroupParent) {
            return {
              ...n,
              position: {
                x: (newParentNode?.position?.x ?? 0) + groupPaddingX,
                y: reparentedNodeY ?? n.position.y,
              },
              data: {
                ...n.data,
                ...(nextLevel !== undefined ? { level: nextLevel } : {}),
              },
            }
          }
          if (nextLevel !== undefined) {
            return { ...n, data: { ...n.data, level: nextLevel } }
          }
          return n
        }),
        edges: newEdges,
        isDirty: true,
      }
    })

    get().scheduleAutosave()
  },

  // ── Move subtree ──────────────────────────────────────────────

  moveSubtreeBy: (rootId, dx, dy, shouldScheduleAutosave = true) => {
    if (!get().isEditMode) return
    if (!dx && !dy) return
    const { edges } = get()
    const descendants = new Set()
    const stack = [rootId]
    while (stack.length) {
      const current = stack.pop()
      edges.forEach((e) => {
        if (e.source === current && !descendants.has(e.target)) {
          descendants.add(e.target)
          stack.push(e.target)
        }
      })
    }
    if (descendants.size === 0) return

    set((state) => ({
      nodes: state.nodes.map((n) =>
        descendants.has(n.id)
          ? {
              ...n,
              position: { x: n.position.x + dx, y: n.position.y + dy },
            }
          : n
      ),
      isDirty: true,
    }))
    if (shouldScheduleAutosave) get().scheduleAutosave()
  },

  // ── Modal ─────────────────────────────────────────────────────

  openMapList: () => set({ isMapListOpen: true }),
  closeMapList: () => set({ isMapListOpen: false }),
}))
