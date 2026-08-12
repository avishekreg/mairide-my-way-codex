import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

type StorageLike = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

const PREFERENCES_TIMEOUT_MS = 400;

const isNativeShellRuntime = () => {
  try {
    return typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const readLocal = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocal = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore restricted browser storage failures.
  }
};

const removeLocal = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore restricted browser storage failures.
  }
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const buildBrowserStorage = (): StorageLike => ({
  getItem: (key: string) => readLocal(key),
  setItem: (key: string, value: string) => {
    writeLocal(key, value);
  },
  removeItem: (key: string) => {
    removeLocal(key);
  },
});

/**
 * Native WebView storage:
 * - Read/write localStorage first (sync, reliable for https://rides.mairide.in shells)
 * - Mirror into Capacitor Preferences in the background with a short timeout
 *   so a hung Preferences bridge cannot block Supabase sign-in.
 */
const buildNativeHybridStorage = (): StorageLike => ({
  async getItem(key: string) {
    const localValue = readLocal(key);
    if (localValue != null && localValue !== '') {
      void withTimeout(Preferences.set({ key, value: localValue }), PREFERENCES_TIMEOUT_MS);
      return localValue;
    }

    try {
      const result = await withTimeout(Preferences.get({ key }), PREFERENCES_TIMEOUT_MS);
      const preferenceValue = result?.value ?? null;
      if (preferenceValue != null && preferenceValue !== '') {
        writeLocal(key, preferenceValue);
        return preferenceValue;
      }
    } catch {
      // Fall through to null.
    }

    return null;
  },
  async setItem(key: string, value: string) {
    writeLocal(key, value);
    void withTimeout(Preferences.set({ key, value }), PREFERENCES_TIMEOUT_MS);
  },
  async removeItem(key: string) {
    removeLocal(key);
    void withTimeout(Preferences.remove({ key }), PREFERENCES_TIMEOUT_MS);
  },
});

export const supabaseAuthStorage: StorageLike = isNativeShellRuntime()
  ? buildNativeHybridStorage()
  : buildBrowserStorage();
