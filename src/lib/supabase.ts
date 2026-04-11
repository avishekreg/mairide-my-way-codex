import { createClient } from '@supabase/supabase-js';

const PROD_SUPABASE_URL = 'https://jcgoccsdlrjnratpaeje.supabase.co';
const PROD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTkwMTQsImV4cCI6MjA5MDUzNTAxNH0.iPIawKCThu7lYMoGrWAyRDVvQPf5YICP7Ap_XOwAOrw';

const resolveSupabaseRuntimeTarget = () => {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').toLowerCase();
    const protocol = String(window.location.protocol || '').toLowerCase();
    const ua = String(window.navigator?.userAgent || '').toLowerCase();
    const isAndroidRuntime = ua.includes('android') || protocol.startsWith('capacitor:');
    const isProdHost = host === 'mairide.in' || host === 'www.mairide.in';
    const isEmbeddedAppHost =
      host === '' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === 'capacitor.localhost';

    // Force production DB target on live domains and embedded Android runtime hosts.
    if (isProdHost || (isAndroidRuntime && isEmbeddedAppHost)) {
      return { url: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY };
    }
  }

  return { url: envUrl, anonKey: envAnonKey };
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
