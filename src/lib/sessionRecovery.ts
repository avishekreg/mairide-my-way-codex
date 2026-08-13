/**
 * Session boot / login coordination.
 * Keeps guest boot non-blocking and prevents recovery timers from racing login submit.
 */

const SUPABASE_AUTH_STORAGE_KEY = 'sb-jcgoccsdlrjnratpaeje-auth-token';
const RETIRED_SUPABASE_PROJECT_REFS = ['qnmetkbiuxwzmlwpxpuz', 'qnmetkbiuxwzmlwpzpuz'];

const SESSION_HINT_KEYS = [
  SUPABASE_AUTH_STORAGE_KEY,
  'mairide_oauth_mode',
  'mairide_oauth_role',
  'mairide_phone_login_profile',
  'mairide_phone_login_number',
];

/** Guest boot must resolve to Login within this window — no "Starting your session…" flicker. */
export const SESSION_BOOT_FAIL_FAST_MS = 300;
export const SESSION_RESTORE_TIMEOUT_MS = 5000;

let interactiveLoginDepth = 0;
let bootGeneration = 0;

export const beginInteractiveLogin = () => {
  interactiveLoginDepth += 1;
  bootGeneration += 1; // invalidate any in-flight boot session probe
};

export const endInteractiveLogin = () => {
  interactiveLoginDepth = Math.max(0, interactiveLoginDepth - 1);
};

export const isInteractiveLoginActive = () => interactiveLoginDepth > 0;

export const getAuthBootGeneration = () => bootGeneration;

export const cancelBackgroundSessionBoot = () => {
  bootGeneration += 1;
};

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

export const purgeRetiredSupabaseState = () => {
  if (typeof window === 'undefined') return false;

  let purged = false;
  const shouldPurgeKeyOrValue = (key: string | null, value: string | null) => {
    const haystack = `${key || ''} ${value || ''}`.toLowerCase();
    return RETIRED_SUPABASE_PROJECT_REFS.some((ref) => haystack.includes(ref));
  };

  const purgeFromStorage = (storage: Storage | null | undefined) => {
    if (!storage) return;
    const keys: string[] = [];
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key) continue;
        let value = '';
        try {
          value = storage.getItem(key) || '';
        } catch {
          value = '';
        }
        if (shouldPurgeKeyOrValue(key, value)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => {
        storage.removeItem(key);
        purged = true;
      });
    } catch {
      // Storage access can fail in restricted webviews; ignore and keep booting.
    }
  };

  purgeFromStorage(window.localStorage);
  purgeFromStorage(window.sessionStorage);

  return purged;
};

export const hardResetToLogin = () => {
  if (isInteractiveLoginActive()) return; // never wipe tokens mid-login
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

/**
 * Non-blocking session probe for app boot.
 * Resolves null within failFastMs when no usable token is available yet.
 */
export const probeSessionFast = async <T,>(
  getSession: () => Promise<T | null>,
  failFastMs: number = SESSION_BOOT_FAIL_FAST_MS
): Promise<T | null> => {
  const generation = bootGeneration;
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(() => getSession())
        .then((session) => (generation === bootGeneration ? session : null)),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), failFastMs);
      }),
    ]);
    if (generation !== bootGeneration || isInteractiveLoginActive()) return null;
    return result;
  } catch {
    return null;
  }
};
