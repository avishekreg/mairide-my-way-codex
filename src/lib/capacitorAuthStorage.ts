import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

type StorageLike = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

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
 * Native WebView storage: dual-write Preferences + localStorage.
 * Android Capacitor WebViews (especially remote-url shells) can lose Preferences
 * mid-session; localStorage on the https origin is the reliable fallback.
 */
const buildNativeHybridStorage = (): StorageLike => ({
  async getItem(key: string) {
    let preferenceValue: string | null = null;
    try {
      const result = await Preferences.get({ key });
      preferenceValue = result.value ?? null;
    } catch {
      preferenceValue = null;
    }

    const localValue = readLocal(key);
    if (preferenceValue != null && preferenceValue !== '') {
      if (localValue !== preferenceValue) {
        writeLocal(key, preferenceValue);
      }
      return preferenceValue;
    }

    if (localValue != null && localValue !== '') {
      try {
        await Preferences.set({ key, value: localValue });
      } catch {
        // Keep serving localStorage even if Preferences sync fails.
      }
      return localValue;
    }

    return null;
  },
  async setItem(key: string, value: string) {
    writeLocal(key, value);
    try {
      await Preferences.set({ key, value });
    } catch {
      // localStorage write already applied for WebView continuity.
    }
  },
  async removeItem(key: string) {
    removeLocal(key);
    try {
      await Preferences.remove({ key });
    } catch {
      // Ignore native persistence failures.
    }
  },
});

export const supabaseAuthStorage: StorageLike = isNativeShellRuntime()
  ? buildNativeHybridStorage()
  : buildBrowserStorage();
