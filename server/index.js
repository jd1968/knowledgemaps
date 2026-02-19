import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json({ limit: '10mb' }))

// ── Supabase client (server-side, uses service role key) ──────────────
const supabase = createClient(
  process.env.SUPABASE_URL || '',
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

app.listen(PORT, () => {
  console.log(`Knowledge Maps API server running on http://localhost:${PORT}`)
})
