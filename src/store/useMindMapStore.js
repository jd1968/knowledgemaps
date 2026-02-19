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

      // Upsert all node content to the nodes table
      if (nodes.length > 0) {
        const nodeRows = nodes.map((n) => ({
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

  loadMap: async (mapId) => {
    try {
      // Load diagram layout and node content in parallel
      const [mapResult, nodesResult] = await Promise.all([
        supabase.from('maps').select('*').eq('id', mapId).single(),
        supabase.from('nodes').select('id, content').eq('map_id', mapId),
      ])
      if (mapResult.error) throw mapResult.error

      // Build a lookup so we can merge content back into each node
      const contentById = {}
      nodesResult.data?.forEach((n) => { contentById[n.id] = n.content })

      const nodes = (mapResult.data.data.nodes || []).map((n) => ({
        ...n,
        data: { ...n.data, content: contentById[n.id] ?? '' },
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
      }))

      localStorage.setItem('km_lastMapId', mapId)
      return { success: true }
    } catch (err) {
      console.error('Load failed:', err)
      return { success: false, error: err }
    }
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
      data: { title: 'New Node', key: id, level: childLevel, content: '' },
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
      nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), { ...newNode, selected: true }],
      edges: [...state.edges, newEdge],
      selectedNodeId: id,
      isDirty: true,
    }))

    get().scheduleAutosave()
  },

  // ── Modal ─────────────────────────────────────────────────────

  openMapList: () => set({ isMapListOpen: true }),
  closeMapList: () => set({ isMapListOpen: false }),
}))
