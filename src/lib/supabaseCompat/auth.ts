import { Capacitor } from '@capacitor/core';
import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import { supabase } from '../supabase';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: GoogleIdentityConfig) => void;
          renderButton: (parent: HTMLElement, options: GoogleButtonConfig) => void;
          prompt: (listener?: (notification: GooglePromptNotification) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

type GoogleIdentityConfig = {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  context?: 'signin' | 'signup' | 'use';
  itp_support?: boolean;
  use_fedcm_for_prompt?: boolean;
  ux_mode?: 'popup' | 'redirect';
};

type GoogleButtonConfig = {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: string | number;
};

type GooglePromptNotification = {
  isDisplayed?: () => boolean;
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
  getDismissedReason?: () => string;
};

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

export interface ProviderData {
  providerId: string;
  uid: string;
  displayName: string | null;
  email: string | null;
  phoneNumber: string | null;
  photoURL: string | null;
}

export interface User {
  uid: string;
  email: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: ProviderData[];
  getIdToken: () => Promise<string>;
}

export interface UserCredential {
  user: User;
}

type AuthListener = (user: User | null) => void;

const GIS_SCRIPT_ID = 'mairide-google-gsi-client';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
let nativeGoogleInitialized = false;

function normalizeUser(user: any, accessToken?: string | null): User {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return {
    uid: user.id,
    email: user.email ?? null,
    phoneNumber: user.phone ?? user.user_metadata?.phone ?? null,
    displayName:
      user.user_metadata?.display_name ??
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      null,
    photoURL: user.user_metadata?.avatar_url ?? null,
    emailVerified: !!user.email_confirmed_at,
    isAnonymous: !!user.is_anonymous,
    tenantId: null,
    providerData: identities.map((identity: any) => ({
      providerId: identity.provider,
      uid: identity.id ?? user.id,
      displayName:
        user.user_metadata?.display_name ??
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        null,
      email: user.email ?? null,
      phoneNumber: user.phone ?? null,
      photoURL: user.user_metadata?.avatar_url ?? null,
    })),
    getIdToken: async () => {
      const currentSession = (await supabase.auth.getSession()).data.session;
      return accessToken || currentSession?.access_token || '';
    },
  };
}

class SupabaseAuthCompat {
  currentUser: User | null = null;

  async hydrate() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    this.currentUser = session?.user ? normalizeUser(session.user, session.access_token) : null;
    return this.currentUser;
  }
}

export const auth = new SupabaseAuthCompat();
void auth.hydrate();

export class GoogleAuthProvider {}

function ensureGoogleClientId() {
  if (GOOGLE_CLIENT_ID) return GOOGLE_CLIENT_ID;
  throw Object.assign(
    new Error('Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID for rides.mairide.in.'),
    { code: 'auth/operation-not-allowed' }
  );
}

function isNativeGoogleRuntime() {
  return Capacitor.isNativePlatform() && (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios');
}

async function ensureNativeGoogleSignInInitialized() {
  const clientId = ensureGoogleClientId();
  if (!isNativeGoogleRuntime() || nativeGoogleInitialized) return clientId;

  await GoogleSignIn.initialize({
    clientId,
    scopes: ['profile', 'email'],
  });

  nativeGoogleInitialized = true;
  return clientId;
}

function loadGoogleIdentityScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google sign-in is only available in the browser.'));
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }

  return new Promise<typeof window.google>((resolve, reject) => {
    const existing = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in.')));
      return;
    }

    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Failed to load Google sign-in.'));
    document.head.appendChild(script);
  });
}

function buildOverlay(text: { title: string; body: string; secondary: string }) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm';

  const shell = document.createElement('div');
  shell.className = 'w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-8 shadow-2xl';

  const badge = document.createElement('p');
  badge.className = 'mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-mairide-accent';
  badge.textContent = 'Secure Google Sign-In';

  const heading = document.createElement('h2');
  heading.className = 'mb-3 text-3xl font-black tracking-tight text-mairide-primary';
  heading.textContent = text.title;

  const body = document.createElement('p');
  body.className = 'mb-6 text-base leading-relaxed text-slate-500';
  body.textContent = text.body;

  const buttonHost = document.createElement('div');
  buttonHost.className = 'mb-4 flex justify-center';

  const secondary = document.createElement('button');
  secondary.type = 'button';
  secondary.className =
    'w-full rounded-2xl border border-mairide-secondary px-5 py-4 text-base font-bold text-mairide-primary transition-colors hover:bg-mairide-bg';
  secondary.textContent = text.secondary;

  shell.appendChild(badge);
  shell.appendChild(heading);
  shell.appendChild(body);
  shell.appendChild(buttonHost);
  shell.appendChild(secondary);
  overlay.appendChild(shell);

  return { overlay, buttonHost, secondary };
}

async function requestGoogleIdToken(context: 'signin' | 'signup') {
  ensureGoogleClientId();

  if (isNativeGoogleRuntime()) {
    try {
      await ensureNativeGoogleSignInInitialized();
      const result = await GoogleSignIn.signIn();
      const idToken = String(result?.idToken || '').trim();

      if (!idToken) {
        throw new Error('Google sign-in did not return an ID token.');
      }

      return idToken;
    } catch (error: any) {
      const message = String(error?.message || error || '').trim();
      if (/cancel/i.test(message)) {
        throw Object.assign(new Error('Google sign-in was closed before it completed.'), {
          code: 'auth/popup-closed-by-user',
        });
      }

      throw Object.assign(
        new Error(message || `Failed to load Google sign-in for ${context}.`),
        { code: error?.code || 'auth/native-google-sign-in-failed' }
      );
    }
  }

  await loadGoogleIdentityScript();

  return await new Promise<string>((resolve, reject) => {
    if (!window.google?.accounts?.id) {
      reject(new Error('Google sign-in is unavailable right now. Please try again.'));
      return;
    }

    const { overlay, buttonHost, secondary } = buildOverlay({
      title: context === 'signup' ? 'Finish with Google' : 'Continue with Google',
      body:
        context === 'signup'
          ? 'Use your Google account in a secure popup and we will complete your MaiRide profile right here.'
          : 'Use your Google account in a secure popup and we will bring you straight back into MaiRide.',
      secondary: 'Cancel',
    });

    let settled = false;
    let fallbackTimer: number | null = null;

    const cleanup = () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      try {
        window.google?.accounts?.id.cancel();
      } catch {
        // Ignore cancel errors from GIS.
      }
      overlay.remove();
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    secondary.addEventListener('click', () => {
      finish(() => {
        reject(
          Object.assign(new Error('Google sign-in was closed before it completed.'), {
            code: 'auth/popup-closed-by-user',
          })
        );
      });
    });

    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      finish(() => {
        reject(
          Object.assign(new Error('Google sign-in was closed before it completed.'), {
            code: 'auth/popup-closed-by-user',
          })
        );
      });
    });

    document.body.appendChild(overlay);

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        const idToken = response.credential;
        if (!idToken) {
          finish(() => reject(new Error('Google sign-in did not return an ID token.')));
          return;
        }
        finish(() => resolve(idToken));
      },
      auto_select: false,
      cancel_on_tap_outside: false,
      context,
      itp_support: true,
      use_fedcm_for_prompt: true,
      ux_mode: 'popup',
    });

    window.google.accounts.id.renderButton(buttonHost, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: context === 'signup' ? 'signup_with' : 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: 320,
    });

    fallbackTimer = window.setTimeout(() => {
      window.google?.accounts?.id.prompt((notification) => {
        if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
          // Keep the rendered button available; no need to reject here.
        }
      });
    }, 250);
  });
}

function toUserCredential(user: any, accessToken?: string | null): UserCredential {
  return { user: normalizeUser(user, accessToken) };
}

function mapAuthError(error: any) {
  if (!error) return new Error('Unknown authentication error');
  if (error.code) return error;
  const mapped = new Error(error.message || 'Authentication error') as Error & {
    code?: string;
  };
  mapped.code = error.name || 'auth/error';
  return mapped;
}

export class RecaptchaVerifier {
  constructor(
    public container: string | HTMLElement,
    public parameters?: Record<string, unknown>,
    public authInstance?: SupabaseAuthCompat
  ) {}

  clear() {}
}

export type ConfirmationResult = {
  confirm: (otp: string) => Promise<UserCredential>;
};

export function onAuthStateChanged(
  authInstance: SupabaseAuthCompat,
  callback: AuthListener
) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    authInstance.currentUser = session?.user
      ? normalizeUser(session.user, session.access_token)
      : null;
    callback(authInstance.currentUser);
  });

  void authInstance.hydrate().then(() => {
    callback(authInstance.currentUser);
  });

  return () => data.subscription.unsubscribe();
}

export async function signOut(authInstance: SupabaseAuthCompat) {
  if (isNativeGoogleRuntime()) {
    await GoogleSignIn.signOut().catch(() => undefined);
  }
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  authInstance.currentUser = null;
  if (error) throw mapAuthError(error);
}

export async function createUserWithEmailAndPassword(
  authInstance: SupabaseAuthCompat,
  email: string,
  password: string
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error || !data.user) throw mapAuthError(error);
  authInstance.currentUser = normalizeUser(data.user, data.session?.access_token);
  return toUserCredential(data.user, data.session?.access_token);
}

export async function signInWithEmailAndPassword(
  authInstance: SupabaseAuthCompat,
  email: string,
  password: string
) {
  const credentials = email.includes('@') ? { email, password } : { phone: email, password };
  const { data, error } = await supabase.auth.signInWithPassword(credentials as any);
  if (error || !data.user) throw mapAuthError(error);
  authInstance.currentUser = normalizeUser(data.user, data.session?.access_token);
  return toUserCredential(data.user, data.session?.access_token);
}

export async function signInAnonymously(authInstance: SupabaseAuthCompat) {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw mapAuthError(error);
  authInstance.currentUser = normalizeUser(data.user, data.session?.access_token);
  return toUserCredential(data.user, data.session?.access_token);
}

export async function signInWithPopup(
  authInstance: SupabaseAuthCompat,
  _provider: GoogleAuthProvider
) {
  if (typeof window === 'undefined') {
    throw new Error('Google sign-in is only available in the browser.');
  }

  sessionStorage.setItem('mairide_oauth_started', 'google');
  const oauthMode = sessionStorage.getItem('mairide_oauth_mode') || '';
  const context = oauthMode === 'signup' ? 'signup' : 'signin';
  const idToken = await requestGoogleIdToken(context);

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error || !data.user) throw mapAuthError(error);
  authInstance.currentUser = normalizeUser(data.user, data.session?.access_token);
  return toUserCredential(data.user, data.session?.access_token);
}

export async function signInWithPhoneNumber() {
  throw new Error('Phone auth is handled by the OTP API in this app.');
}
