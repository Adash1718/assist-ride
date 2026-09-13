import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// See SPEC.md §6 for why Supabase (Postgres fits the relational
// rider/driver/ride-request model, plus built-in auth + realtime + storage
// in one free-tier service).
//
// Set these in a local .env (gitignored) as:
//   EXPO_PUBLIC_SUPABASE_URL=...
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
// See README-SUPABASE.md for how to create a project and run the schema.
const envUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const envKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!envUrl && !!envKey;

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase env vars are not set — auth/data calls will fail until EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are added to .env (see README-SUPABASE.md). Using a placeholder URL so the rest of the app can still run.'
  );
}

// createClient throws on an empty/invalid URL, which would crash the whole
// app before a real project even exists — fall back to a syntactically
// valid placeholder so unrelated screens keep working; actual network calls
// against it will simply fail (caught by each call site).
export const supabase = createClient(envUrl || 'https://placeholder.supabase.co', envKey || 'placeholder-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
