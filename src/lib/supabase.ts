import { createClient } from '@supabase/supabase-js';

const PROD_SUPABASE_URL = 'https://jcgoccsdlrjnratpaeje.supabase.co';
const PROD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTkwMTQsImV4cCI6MjA5MDUzNTAxNH0.iPIawKCThu7lYMoGrWAyRDVvQPf5YICP7Ap_XOwAOrw';

const resolveSupabaseRuntimeTarget = () => {
  // Hard lock every runtime (web + installed app + local dev) to main production Supabase.
  // Staging project has been retired.
  return { url: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY };
};

const { url: supabaseUrl, anonKey: supabaseAnonKey } = resolveSupabaseRuntimeTarget();

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl || 'https://invalid-project.supabase.co', supabaseAnonKey || 'invalid-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const SUPABASE_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'mairide-assets';
