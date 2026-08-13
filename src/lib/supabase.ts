import { createClient } from '@supabase/supabase-js';
import { supabaseAuthStorage } from './capacitorAuthStorage';

const PROD_SUPABASE_URL = 'https://jcgoccsdlrjnratpaeje.supabase.co';
const PROD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTkwMTQsImV4cCI6MjA5MDUzNTAxNH0.iPIawKCThu7lYMoGrWAyRDVvQPf5YICP7Ap_XOwAOrw';
const RETIRED_SUPABASE_PROJECT_REFS = ['qnmetkbiuxwzmlwpxpuz'];

const normalizeSupabaseUrl = (value: unknown) => {
  const candidate = String(value || '').trim();
  if (!candidate) return PROD_SUPABASE_URL;
  const lowered = candidate.toLowerCase();
  if (RETIRED_SUPABASE_PROJECT_REFS.some((ref) => lowered.includes(ref))) {
    console.warn('VITE_SUPABASE_URL points to a retired Supabase project — using production fallback.');
    return PROD_SUPABASE_URL;
  }
  return candidate;
};

// Prefer Vite envs when present; always fall back so Vercel client builds never ship an empty URL/key.
const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim() || PROD_SUPABASE_ANON_KEY;

if (!String(import.meta.env.VITE_SUPABASE_URL || '').trim()) {
  console.warn('VITE_SUPABASE_URL missing — using production Supabase URL fallback.');
}
if (!String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()) {
  console.warn('VITE_SUPABASE_ANON_KEY missing — using production anon key fallback.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: supabaseAuthStorage,
  },
});

export const SUPABASE_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'mairide-assets';
