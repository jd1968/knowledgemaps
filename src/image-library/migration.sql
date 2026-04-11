-- ============================================================
-- Image Library - Supabase Migration
-- Run this in your Supabase SQL editor
-- ============================================================

-- 1. Enable required extensions
create extension if not exists vector;
create extension if not exists pg_trgm;

-- 2. Assets table
create table if not exists assets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,

  -- Storage paths
  storage_path    text not null,
  thumbnail_path  text not null,

  -- Public URLs (denormalised for fast grid loads)
  public_url      text,
  thumbnail_url   text not null,

  -- Original file metadata
  format          text not null,
  file_size       bigint,
  width           int,
  height          int,

  -- Thumbnail metadata
  thumb_width     int,
  thumb_height    int,
  thumb_size      bigint,

  -- AI enrichment (populated async after upload)
  ai_description  text,
  embedding       vector(1536),

  -- Colour palette (hex strings)
  color_palette   text[],

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 3. Tags
create table if not exists tags (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table if not exists asset_tags (
  asset_id  uuid references assets(id) on delete cascade,
  tag_id    uuid references tags(id) on delete cascade,
  primary key (asset_id, tag_id)
);

-- 4. Collections (optional, for future grouping)
create table if not exists collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz default now()
);

create table if not exists asset_collections (
  asset_id       uuid references assets(id) on delete cascade,
  collection_id  uuid references collections(id) on delete cascade,
  primary key (asset_id, collection_id)
);

-- 5. Indexes
-- Full-text search
create index if not exists assets_fts on assets
  using gin(to_tsvector('english',
    coalesce(name, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(ai_description, '')
  ));

-- Trigram index for ilike search on name
create index if not exists assets_name_trgm on assets using gin(name gin_trgm_ops);

-- Vector similarity (create after you have data; uses ivfflat)
-- Requires at least a few hundred rows for good results.
-- create index assets_embedding_idx on assets
--   using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Tag name trigram
create index if not exists tags_name_trgm on tags using gin(name gin_trgm_ops);

-- 6. Updated_at trigger
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists assets_updated_at on assets;
create trigger assets_updated_at
  before update on assets
  for each row execute function update_updated_at();


-- ============================================================
-- Storage buckets
-- Run these separately in the Supabase dashboard Storage tab,
-- OR via the Supabase JS client in a one-time setup script.
-- ============================================================

-- Create via SQL (requires pg_net or supabase admin API)
-- Easier to create in the Supabase dashboard:
--
-- Bucket name: assets       | Public: false (or true for public libraries)
-- Bucket name: thumbnails   | Public: true
--
-- Then add the following RLS policies in the dashboard:
--
-- [thumbnails bucket] - Allow public read:
--   Policy: SELECT for role anon
--   Expression: true
--
-- [assets bucket] - Allow authenticated read:
--   Policy: SELECT for role authenticated
--   Expression: true
--
-- Both buckets - Allow authenticated insert:
--   Policy: INSERT for role authenticated
--   Expression: true
