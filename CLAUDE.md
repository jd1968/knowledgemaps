# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run Vite (port 5173) + Express (port 3001) concurrently
npm run dev:client   # Vite only — use this when working on frontend (direct Supabase mode)
npm run build        # Production build → dist/
npm start            # Production server (Express serves dist/)
```

No test framework is configured.

## Architecture

**Knowledge Maps** is a React SPA for creating visual mind maps with hierarchical nodes, rich markdown notes, and nested submaps.

### Stack
- **Frontend:** React 18 + Vite, state via Zustand, visual canvas via `@xyflow/react`
- **Backend:** Express (optional; not called by the UI — only serves `dist/` in production)
- **Database/Auth:** Supabase (PostgreSQL + Google OAuth). Frontend queries Supabase directly with RLS enforcing `user_id` isolation.

### State Management (`src/store/useMindMapStore.js`)
Single Zustand store (~800 lines) holding all app state:
- **Graph state:** `nodes[]`, `edges[]`, `selectedNodeId`, `pendingNewNodeId`
- **Map metadata:** `currentMapId`, `currentMapName`, `isDirty`, `saveStatus`
- **History:** `past[]`, `future[]` — snapshot-based undo/redo (max 50), deep JSON copy per change
- **UI state:** `isEditMode`, `viewMode`, `focusNodeId`, `breadcrumbs[]`

**Edit mode gate:** Nearly all mutations check `if (!get().isEditMode) return` before proceeding.

**Autosave:** Every meaningful mutation calls `scheduleAutosave()` — a 2-second debounce before `saveMap()` upserts to Supabase.

### View Modes
No React Router. `App.jsx` renders one of four views based on `viewMode` in the store:
- `'map'` (default) — `MindMapCanvas.jsx`: React Flow canvas, the primary editing surface
- `'feed'` — `FeedView.jsx`: randomized card-based review/annotation view
- `'contents'` — `ContentsView.jsx`: depth-first tree list for navigation
- `'text'` — `TextView.jsx`: read-only text dump

### Node Types
Four types with different behaviour in `CustomNode.jsx`: `folder`, `group`, `note`, `pointer`, `submap`.
Submap nodes link to a separate map record (`isSubmap: true`, `submapId`). Navigation via `breadcrumbs[]` in the store.

### Supabase Schema
- **`maps`** — `id`, `user_id`, `name`, `data` (jsonb: `{nodes[], edges[], parentMapId?, parentNodeId?}`)
- **`nodes`** — `id` (node UUID), `map_id`, `user_id`, `title`, `content`, `long_title` — content stored separately from map structure so they can be saved independently

### Key Files
| File | Purpose |
|------|---------|
| `src/store/useMindMapStore.js` | All app state, actions, Supabase I/O |
| `src/components/MindMapCanvas.jsx` | React Flow canvas, zoom/pan, node selection |
| `src/components/CustomNode.jsx` | Node renderer, context menu, child creation |
| `src/components/NodeModal.jsx` | Node create/edit/view dialog |
| `src/components/FeedView.jsx` | Card-based content review |
| `src/components/ContentsView.jsx` | Hierarchical tree navigation |
| `src/components/Toolbar.jsx` | Top bar: save, undo/redo, mode switching, map picker |
| `src/context/AuthContext.jsx` | Supabase Google OAuth session |
| `src/App.jsx` | Root: auth gate, view-mode routing, global keyboard shortcuts |
