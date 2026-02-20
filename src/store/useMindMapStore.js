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
      content: '',
      overview: '',
    },
  },
]

export const useMindMapStore = create((set, get) => ({
  // ── Map data ─────────────────────────────────────────────────
  nodes: initialNodes,
  edges: [],
  selectedNodeId: null,

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

  // ── Submap navigation ─────────────────────────────────────────
  // Each entry: { mapId, mapName }  — the trail of maps above the current one
  breadcrumbs: [],

  // ── React Flow handlers ───────────────────────────────────────

  onNodesChange: (changes) => {
    // Don't push position changes to history during drag (too noisy)
    // History is pushed in onNodeDragStart instead
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      isDirty: true,
    }))
    // Debounce autosave (skip for selection-only changes)
    const hasNonSelectChange = changes.some((c) => c.type !== 'select')
    if (hasNonSelectChange) get().scheduleAutosave()
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      isDirty: true,
    }))
    get().scheduleAutosave()
  },

  onConnect: (connection) => {
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
        content: '',
        overview: '',
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

  deleteNode: (nodeId) => {
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
    set({ selectedNodeId: null })
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
          overview: n.data.overview || '',
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
      // Load diagram layout and node content in parallel
      const [mapResult, nodesResult] = await Promise.all([
        supabase.from('maps').select('*').eq('id', mapId).single(),
        supabase.from('nodes').select('id, content, overview').eq('map_id', mapId),
      ])
      if (mapResult.error) throw mapResult.error

      // Build a lookup so we can merge content back into each node
      const contentById = {}
      nodesResult.data?.forEach((n) => { contentById[n.id] = { content: n.content, overview: n.overview } })

      const nodes = (mapResult.data.data.nodes || []).map((n) => ({
        ...n,
        data: {
          ...n.data,
          content: contentById[n.id]?.content ?? '',
          overview: contentById[n.id]?.overview ?? '',
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
      return { success: true }
    } catch (err) {
      console.error('Load failed:', err)
      return { success: false, error: err }
    }
  },

  // ── Submap ────────────────────────────────────────────────────

  convertToSubmap: async (nodeId) => {
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
        overview: n.data.overview || '',
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
              ? { ...n, data: { ...n.data, isSubmap: true, submapId: newMap.id, collapsed: false } }
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
          data: { title: 'Central Topic', key: rootId, level: 0, content: '', overview: '' },
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

  addChildNode: (parentId) => {
    const { nodes, edges } = get()
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) return

    get().pushHistory()

    const parentLevel = parent.data.level ?? 0
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

    const x = parent.position.x + parentWidth + hGap
    let y = parent.position.y

    if (childNodes.length > 0) {
      const sorted = [...childNodes].sort((a, b) => a.position.y - b.position.y)
      y = sorted[sorted.length - 1].position.y + vSpacing
    }

    const id = uuidv4()
    const newNode = {
      id,
      type: 'mindmap',
      position: { x, y },
      data: { title: 'New Node', key: id, level: childLevel, content: '', overview: '' },
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
      isDirty: true,
    }))

    get().scheduleAutosave()
  },

  // ── Modal ─────────────────────────────────────────────────────

  openMapList: () => set({ isMapListOpen: true }),
  closeMapList: () => set({ isMapListOpen: false }),
}))
