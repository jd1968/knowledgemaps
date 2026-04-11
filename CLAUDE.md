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

**Knowledge Maps** is a React SPA for creating visual mind maps with hierarchical nodes, rich markdown notes, nested submaps, and a structured map editor.

### Stack
- **Frontend:** React 18 + Vite, state via Zustand, visual canvas via `@xyflow/react`
- **Backend:** Express (optional; not called by the UI — only serves `dist/` in production)
- **Database/Auth:** Supabase (PostgreSQL + Google OAuth). Frontend queries Supabase directly with RLS enforcing `user_id` isolation.
- **Routing:** React Router v6 (`BrowserRouter`). Routes: `/` (home), `/map/:mapId` (editor), `/legacymap/:mapId` (canvas), `/image-library` (standalone image manager)

### State Management (`src/store/useMindMapStore.js`)
Single Zustand store (~800 lines) holding all app state:
- **Graph state:** `nodes[]`, `edges[]`, `selectedNodeId`, `pendingNewNodeId`
- **Map metadata:** `currentMapId`, `currentMapName`, `currentMapIconUrl`, `currentMapContent`, `currentMapRegions[]`, `isDirty`, `saveStatus`
- **History:** `past[]`, `future[]` — snapshot-based undo/redo (max 50), deep JSON copy per change
- **UI state:** `isEditMode`, `viewMode`, `focusNodeId`, `breadcrumbs[]`

**Edit mode gate:** Nearly all mutations check `if (!get().isEditMode) return` before proceeding.

**Autosave:** Every meaningful mutation calls `scheduleAutosave()` — a 2-second debounce before `saveMap()` upserts to Supabase.

### Routes & Views

`/map/:mapId` → `MapEditorPage` (primary editing surface — regions, cards, markdown)
`/legacymap/:mapId` → `MapPage` (React Flow canvas with toolbar, four view modes):
- `'map'` — `MindMapCanvas.jsx`: React Flow canvas
- `'feed'` — `FeedView.jsx`: randomized card-based review
- `'contents'` — `ContentsView.jsx`: depth-first tree list
- `'text'` — `TextView.jsx`: read-only text dump

### Map Editor (`MapEditorPage`)
The main editing surface. Maps are structured as ordered **regions**, each of type `card`, `image`, or `diagram`. Regions contain:
- `id`, `type`, `title`, `iconUrl`, `content`, `cardSize` (XS/S/M/L/XL for card regions)
- `cards[]` — for card-type regions: `{ id, title, content, iconUrl }`

Region and card data is stored in `maps.data.regions[]` (jsonb). Map-level metadata (`iconUrl`, `content`) lives in `maps.data.meta`.

### Node Types (Legacy Canvas)
Five types in `CustomNode.jsx`: `folder`, `group`, `note`, `pointer`, `submap`.
Submap nodes link to a separate map record (`isSubmap: true`, `submapId`). Navigation via `breadcrumbs[]` in the store.

### Image Library (`src/image-library/`)
Self-contained module for managing a shared image asset library backed by Supabase Storage.

**Initialisation** (already done in `main.jsx`):
```js
import { initImageLibrary } from './image-library'
initImageLibrary({ supabaseUrl, supabaseAnonKey })
```

**Usage in components:**
```jsx
import { ImageLibraryTrigger } from '../image-library'
<ImageLibraryTrigger onSelect={(url) => setIconUrl(url)} />
```
`onSelect` always receives a plain HTTPS public URL string.

**Supabase buckets:**
- `assets` — private; original images (authenticated download required)
- `thumbnails` — public; thumbnails shown in the grid

**Displaying images** from the library: use `NodeIconDisplay` from `src/components/NodeIcon.jsx`. It handles both `storage:` protocol URLs (legacy uploads) and plain HTTPS URLs (image library), downloading private assets via the authenticated Supabase client.

**Do not modify files inside `src/image-library/`** without good reason — it is designed as a reusable module.

### Supabase Schema
- **`maps`** — `id`, `user_id`, `name`, `data` (jsonb: `{ meta: { iconUrl, content }, regions[], nodes[], edges[], parentMapId?, parentNodeId? }`)
- **`nodes`** — `id`, `map_id`, `user_id`, `title`, `content`, `long_title`
- **`assets`** — image library: `id`, `name`, `description`, `public_url`, `thumbnail_url`, `storage_path`, `thumbnail_path`, `format`, `width`, `height`, `file_size`
- **`tags`** / **`asset_tags`** — tagging for image library assets

### Key Files
| File | Purpose |
|------|---------|
| `src/store/useMindMapStore.js` | All app state, actions, Supabase I/O |
| `src/App.jsx` | Root: auth gate, React Router routes, global keyboard shortcuts |
| `src/components/HomePage.jsx` | Map list, new map, link to image library |
| `src/components/MapEditorPage.jsx` | Structured map editor: regions, cards, markdown |
| `src/components/MapPropertiesModal.jsx` | Map name, icon (via image library), content |
| `src/components/MindMapCanvas.jsx` | React Flow canvas, zoom/pan, node selection |
| `src/components/CustomNode.jsx` | Node renderer, context menu, child creation |
| `src/components/NodeModal.jsx` | Node create/edit/view dialog |
| `src/components/NodeIcon.jsx` | `NodeIconDisplay` — renders storage: and HTTPS icon URLs |
| `src/components/ImageLibraryPage.jsx` | Standalone image manager (browse, search, edit, delete, upload) |
| `src/components/FeedView.jsx` | Card-based content review |
| `src/components/ContentsView.jsx` | Hierarchical tree navigation |
| `src/components/Toolbar.jsx` | Top bar: save, undo/redo, mode switching, map picker |
| `src/context/AuthContext.jsx` | Supabase Google OAuth session |
| `src/image-library/` | Self-contained image library module |
