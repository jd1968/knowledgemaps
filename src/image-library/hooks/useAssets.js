import { useState, useEffect, useCallback, useRef } from 'react'
import { getSupabaseClient } from '../lib/supabase'

export function useAssets({ search = '', tagIds = [] } = {}) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAssets = useCallback(async (q, tags) => {
    const supabase = getSupabaseClient()
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('assets')
        .select(`
          id, name, description, public_url, thumbnail_url,
          storage_path, thumbnail_path,
          format, width, height, file_size, created_at,
          asset_tags ( tag_id, tags ( id, name ) )
        `)
        .order('created_at', { ascending: false })

      if (q?.trim()) {
        query = query.or(
          `name.ilike.%${q}%,description.ilike.%${q}%,ai_description.ilike.%${q}%`
        )
      }

      if (tags?.length > 0) {
        // Assets that have ALL selected tags (using subquery via rpc or filter)
        // Simplified: filter to assets that have at least one of the selected tags
        const { data: matchingAssetIds } = await supabase
          .from('asset_tags')
          .select('asset_id')
          .in('tag_id', tags)

        const ids = [...new Set((matchingAssetIds || []).map((r) => r.asset_id))]
        if (ids.length === 0) {
          setAssets([])
          setLoading(false)
          return
        }
        query = query.in('id', ids)
      }

      const { data, error: fetchErr } = await query.limit(200)
      if (fetchErr) throw fetchErr

      // Flatten tags for easier consumption
      const normalised = (data || []).map((a) => ({
        ...a,
        tags: (a.asset_tags || []).map((at) => at.tags).filter(Boolean),
      }))

      setAssets(normalised)
    } catch (err) {
      console.error('[ImageLibrary] Fetch failed:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchAssets(search, tagIds)
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [search, tagIds, fetchAssets])

  const refresh = useCallback(() => fetchAssets(search, tagIds), [search, tagIds, fetchAssets])

  return { assets, loading, error, refresh }
}

export function useTags() {
  const [tags, setTags] = useState([])

  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase
      .from('tags')
      .select('id, name')
      .order('name')
      .then(({ data }) => setTags(data || []))
  }, [])

  return tags
}
