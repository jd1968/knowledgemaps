# Image Library

A self-contained, embeddable image library component for React + Vite projects, backed by Supabase.

## Setup

### 1. Run the database migration

Paste `migration.sql` into your Supabase SQL editor and run it.

### 2. Create storage buckets

In the Supabase dashboard → Storage, create two buckets:

| Bucket name  | Public |
|---|---|
| `assets`     | false  |
| `thumbnails` | true   |

Add RLS policies for each (see comments in `migration.sql`).

### 3. Install the dependency

```bash
npm install @supabase/supabase-js
```

### 4. Copy this folder into your project

```
src/
  image-library/   ← copy here
```

### 5. Initialise once at app startup

```jsx
// src/main.jsx
import { initImageLibrary } from './image-library'

initImageLibrary({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})
```

Add to your `.env`:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Usage

### Drop-in trigger button

```jsx
import { ImageLibraryTrigger } from './image-library'

function MyForm() {
  const [logoUrl, setLogoUrl] = useState('')

  return (
    <div>
      <ImageLibraryTrigger onSelect={(url) => setLogoUrl(url)} />
      {logoUrl && <img src={logoUrl} alt="Selected" />}
    </div>
  )
}
```

### Custom trigger element

```jsx
<ImageLibraryTrigger onSelect={(url) => setLogoUrl(url)}>
  <button className="your-own-button">Pick an image</button>
</ImageLibraryTrigger>
```

### Headless (control open state yourself)

```jsx
import { ImageLibrary } from './image-library'

function MyComponent() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  return (
    <>
      <button onClick={() => setOpen(true)}>Open Library</button>
      <ImageLibrary
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(url) => { setUrl(url); setOpen(false) }}
      />
    </>
  )
}
```

---

## How thumbnails work

When you upload an image, the library:
1. Generates a WebP thumbnail client-side using the Canvas API (no server needed, no Supabase transformation charges)
2. Uploads the original to the `assets` bucket
3. Uploads the thumbnail to the `thumbnails` bucket
4. Stores both paths and public URLs in the `assets` table

SVGs are stored as-is for both original and thumbnail (they're resolution-independent).

---

## File structure

```
image-library/
  index.js                      ← exports + initImageLibrary()
  migration.sql                 ← run once in Supabase SQL editor
  components/
    ImageLibrary.jsx            ← modal shell
    ImageLibraryTrigger.jsx     ← convenience trigger wrapper
    AssetGrid.jsx               ← image grid
    AssetCard.jsx               ← individual card
    ImageUploader.jsx           ← drag-drop upload
    TagFilter.jsx               ← tag pill filters
  hooks/
    useAssets.js                ← fetch / search / filter
    useUpload.js                ← upload + thumbnail pipeline
  lib/
    supabase.js                 ← supabase client singleton
    thumbnail.js                ← canvas thumbnail generator
```
