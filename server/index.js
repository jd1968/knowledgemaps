import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

dotenv.config()

//test

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// In dev, restrict CORS to the Vite dev server.
// In production the frontend is served from the same origin, so CORS is irrelevant
// for browser requests — but we allow it explicitly via CLIENT_ORIGIN if set.
const corsOrigin = isProd
  ? (process.env.CLIENT_ORIGIN || true)
  : 'http://localhost:5173'

app.use(cors({ origin: corsOrigin }))
app.use(express.json({ limit: '10mb' }))

// ── Supabase client (server-side, uses service role key) ──────────────
// VITE_SUPABASE_URL is the same value as SUPABASE_URL — reuse it to avoid duplication.
// The service role key is separate: it bypasses RLS and must never reach the browser.
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// ── Health check ──────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})

// ── List maps ─────────────────────────────────────────────────────────
app.get('/api/maps', async (_req, res) => {
  const { data, error } = await supabase
    .from('maps')
    .select('id, name, updated_at, created_at')
    .order('updated_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── Get single map ────────────────────────────────────────────────────
app.get('/api/maps/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('maps')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) return res.status(404).json({ error: error.message })
  res.json(data)
})

// ── Create map ────────────────────────────────────────────────────────
app.post('/api/maps', async (req, res) => {
  const { name, data } = req.body
  if (!name || !data) return res.status(400).json({ error: 'name and data required' })

  const { data: map, error } = await supabase
    .from('maps')
    .insert({ name, data })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(map)
})

// ── Update map ────────────────────────────────────────────────────────
app.put('/api/maps/:id', async (req, res) => {
  const { name, data } = req.body

  const { data: map, error } = await supabase
    .from('maps')
    .update({ name, data })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(map)
})

// ── Delete map ────────────────────────────────────────────────────────
app.delete('/api/maps/:id', async (req, res) => {
  const { error } = await supabase
    .from('maps')
    .delete()
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

// ── Serve frontend in production ──────────────────────────────────────
// API routes are registered above; this catch-all comes last so it never
// swallows /api/* requests.
const distPath = join(__dirname, '..', 'dist')
if (isProd && existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Knowledge Maps server running on port ${PORT} (${isProd ? 'production' : 'development'})`)
})
