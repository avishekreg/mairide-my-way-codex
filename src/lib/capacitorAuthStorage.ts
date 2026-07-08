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

const buildBrowserStorage = (): StorageLike => ({
  getItem: (key: string) => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore restricted browser storage failures.
    }
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore restricted browser storage failures.
    }
  },
});

const buildNativePreferencesStorage = (): StorageLike => ({
  async getItem(key: string) {
    try {
      const result = await Preferences.get({ key });
      return result.value ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string) {
    try {
      await Preferences.set({ key, value });
    } catch {
      // Ignore native persistence failures and let auth continue in-memory.
    }
  },
  async removeItem(key: string) {
    try {
      await Preferences.remove({ key });
    } catch {
      // Ignore native persistence failures and let auth continue in-memory.
    }
  },
});

export const supabaseAuthStorage: StorageLike = isNativeShellRuntime()
  ? buildNativePreferencesStorage()
  : buildBrowserStorage();
