import { initSupabase } from './lib/supabase'
export { ImageLibrary } from './components/ImageLibrary'
export { ImageLibraryTrigger } from './components/ImageLibraryTrigger'
export { injectStyles as injectImageLibraryStyles } from './components/ImageLibrary'

/**
 * Initialise the image library with your Supabase credentials.
 * Call this once at the top level of your app (e.g. main.jsx).
 *
 * @param {object} config
 * @param {string} config.supabaseUrl   - Your Supabase project URL
 * @param {string} config.supabaseAnonKey - Your Supabase anon key
 */
export function initImageLibrary({ supabaseUrl, supabaseAnonKey }) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('[ImageLibrary] supabaseUrl and supabaseAnonKey are required.')
  }
  initSupabase(supabaseUrl, supabaseAnonKey)
}
