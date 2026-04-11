import { createClient } from '@supabase/supabase-js'

let client = null

export function getSupabaseClient() {
  if (!client) {
    throw new Error(
      '[ImageLibrary] Supabase client not initialised. Call initImageLibrary({ supabaseUrl, supabaseAnonKey }) before using the library.'
    )
  }
  return client
}

export function initSupabase(url, anonKey) {
  client = createClient(url, anonKey)
  return client
}
