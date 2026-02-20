# Knowledge Maps

Visual mind-mapping app for building topic trees with rich notes, map autosave, and nested submaps.

## What it does

- Google sign-in with Supabase Auth
- Interactive map canvas built with React Flow
- Node types: `folder`, `group`, `note`, `submap`
- Rich text notes via Tiptap (headings/lists/code/quotes)
- Undo/redo history (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Y`, `Ctrl/Cmd+Shift+Z`)
- Autosave (2s debounce) and manual save
- Convert any node subtree into a separate submap and navigate with breadcrumbs
- Saved map picker and delete flow

## Tech stack

- Frontend: React + Vite + Zustand + `@xyflow/react`
- Auth/DB: Supabase (Auth + Postgres)
- Backend: Express (optional API + production static hosting)

## Architecture

- Frontend reads/writes maps directly to Supabase from `src/store/useMindMapStore.js`.
- Express server in `server/index.js` exposes `/api/*` routes and can serve `dist/` in production.
- In local dev, Vite proxies `/api` to `http://localhost:3001` (configured in `vite.config.js`).
- Current UI does not call `/api/*`; it uses Supabase client directly.

## Prerequisites

- Node.js `>=20`
- A Supabase project

## Environment variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Required for frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Required for Express server API:

- `SUPABASE_URL` (or reuse `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `PORT` (default `3001`)
- `CLIENT_ORIGIN` (production CORS override)

## Supabase setup

### 1) Enable Google OAuth

- In Supabase Auth Providers, enable Google.
- Add your app URL(s) to redirect URLs (for local: `http://localhost:5173`).

### 2) Create tables

Run this SQL in Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled Map',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nodes (
  id text primary key,
  map_id uuid not null references public.maps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  overview text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_maps_updated_at on public.maps;
create trigger trg_maps_updated_at
before update on public.maps
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_nodes_updated_at on public.nodes;
create trigger trg_nodes_updated_at
before update on public.nodes
for each row execute procedure public.set_updated_at();
```

### 3) Enable RLS policies

```sql
alter table public.maps enable row level security;
alter table public.nodes enable row level security;

drop policy if exists "maps_select_own" on public.maps;
create policy "maps_select_own" on public.maps
for select using (auth.uid() = user_id);

drop policy if exists "maps_insert_own" on public.maps;
create policy "maps_insert_own" on public.maps
for insert with check (auth.uid() = user_id);

drop policy if exists "maps_update_own" on public.maps;
create policy "maps_update_own" on public.maps
for update using (auth.uid() = user_id);

drop policy if exists "maps_delete_own" on public.maps;
create policy "maps_delete_own" on public.maps
for delete using (auth.uid() = user_id);

drop policy if exists "nodes_select_own" on public.nodes;
create policy "nodes_select_own" on public.nodes
for select using (auth.uid() = user_id);

drop policy if exists "nodes_insert_own" on public.nodes;
create policy "nodes_insert_own" on public.nodes
for insert with check (auth.uid() = user_id);

drop policy if exists "nodes_update_own" on public.nodes;
create policy "nodes_update_own" on public.nodes
for update using (auth.uid() = user_id);

drop policy if exists "nodes_delete_own" on public.nodes;
create policy "nodes_delete_own" on public.nodes
for delete using (auth.uid() = user_id);
```

## Install and run

```bash
npm install
```

Client + server:

```bash
npm run dev
```

Client only (recommended if you are using direct Supabase mode):

```bash
npm run dev:client
```

Server only:

```bash
npm run dev:server
```

Build:

```bash
npm run build
```

Start production server:

```bash
npm start
```

## API (Express)

Defined in `server/index.js`:

- `GET /api/health`
- `GET /api/maps`
- `GET /api/maps/:id`
- `POST /api/maps`
- `PUT /api/maps/:id`
- `DELETE /api/maps/:id`

## Deployment notes

- `Procfile` uses `web: node server/index.js`.
- For platforms like Heroku, set all `VITE_*` variables before build, and runtime secrets (`SUPABASE_SERVICE_ROLE_KEY`, etc.) before boot.
- In production, Express serves `dist/` when `NODE_ENV=production`.
