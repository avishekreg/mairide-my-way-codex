/**
 * Isolated session recovery helpers for stuck "Starting your session…" states.
 * Keeps auth storage purge out of core Supabase client factories.
 */

const SUPABASE_AUTH_STORAGE_KEY = 'sb-jcgoccsdlrjnratpaeje-auth-token';

const SESSION_HINT_KEYS = [
  SUPABASE_AUTH_STORAGE_KEY,
  'mairide_oauth_mode',
  'mairide_oauth_role',
  'mairide_phone_login_profile',
  'mairide_phone_login_number',
];

export const SESSION_RESTORE_TIMEOUT_MS = 5000;

export const purgeLocalAuthSession = () => {
  if (typeof window === 'undefined') return;

  try {
    SESSION_HINT_KEYS.forEach((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore per-key failures.
      }
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore per-key failures.
      }
    });
  } catch {
    // Continue with broader clear.
  }

  try {
    // Remove any leftover Supabase auth keys for this project.
    const localKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('sb-jcgoccsdlrjnratpaeje') || key.includes('supabase.auth'))) {
        localKeys.push(key);
      }
    }
    localKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    try {
      window.localStorage.clear();
    } catch {
      // Ignore total clear failures.
    }
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Ignore sessionStorage failures.
  }
};

export const hardResetToLogin = () => {
  purgeLocalAuthSession();
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.delete('code');
    url.searchParams.delete('access_token');
    url.searchParams.delete('refresh_token');
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    window.location.replace(`${url.pathname}${url.search ? url.search : ''}`);
  } catch {
    window.location.href = '/';
  }
};

export const retrySessionRestore = () => {
  if (typeof window === 'undefined') return;
  window.location.reload();
};
