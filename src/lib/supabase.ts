import { createClient } from '@supabase/supabase-js';

const PROD_SUPABASE_URL = 'https://jcgoccsdlrjnratpaeje.supabase.co';
const PROD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTkwMTQsImV4cCI6MjA5MDUzNTAxNH0.iPIawKCThu7lYMoGrWAyRDVvQPf5YICP7Ap_XOwAOrw';

const resolveSupabaseRuntimeTarget = () => {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const isDevBuild = Boolean(import.meta.env.DEV);

  // Fail-safe: every production build (web + installed app) must use the same
  // production Supabase project for consistent auth/data behavior.
  if (!isDevBuild) {
    return { url: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY };
  }

  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').toLowerCase();
    const protocol = String(window.location.protocol || '').toLowerCase();
    const ua = String(window.navigator?.userAgent || '').toLowerCase();
    const capacitorNative =
      typeof (window as any).Capacitor?.isNativePlatform === 'function' &&
      Boolean((window as any).Capacitor.isNativePlatform());
    const isNativeLikeRuntime =
      capacitorNative ||
      protocol.startsWith('capacitor:') ||
      protocol === 'file:' ||
      ua.includes(' wv') ||
      ua.includes('android webview');

    const isLocalLikeHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === 'capacitor.localhost' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.16.') ||
      host.startsWith('172.17.') ||
      host.startsWith('172.18.') ||
      host.startsWith('172.19.') ||
      host.startsWith('172.20.') ||
      host.startsWith('172.21.') ||
      host.startsWith('172.22.') ||
      host.startsWith('172.23.') ||
      host.startsWith('172.24.') ||
      host.startsWith('172.25.') ||
      host.startsWith('172.26.') ||
      host.startsWith('172.27.') ||
      host.startsWith('172.28.') ||
      host.startsWith('172.29.') ||
      host.startsWith('172.30.') ||
      host.startsWith('172.31.');

    // Installed app / webview runtimes must always target production DB.
    if (isNativeLikeRuntime) {
      return { url: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY };
    }

    // Dev behavior:
    // - Local/dev hostnames -> use env target (staging/local testing)
    // - Non-local hosts -> use production target
    if (!isLocalLikeHost) return { url: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY };
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
