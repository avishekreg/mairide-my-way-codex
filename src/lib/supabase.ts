import { createClient } from '@supabase/supabase-js';
import { supabaseAuthStorage } from './capacitorAuthStorage';

const PROD_SUPABASE_URL = 'https://jcgoccsdlrjnratpaeje.supabase.co';
const PROD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTkwMTQsImV4cCI6MjA5MDUzNTAxNH0.iPIawKCThu7lYMoGrWAyRDVvQPf5YICP7Ap_XOwAOrw';
const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '');
const configuredSupabaseUrl = normalizeUrl(
  String(import.meta.env.VITE_SUPABASE_AUTH_URL || import.meta.env.VITE_SUPABASE_URL || '')
);
export const supabaseUrl = configuredSupabaseUrl || PROD_SUPABASE_URL;
export const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim() || PROD_SUPABASE_ANON_KEY;
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
