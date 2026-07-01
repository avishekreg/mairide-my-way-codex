import { supabase } from '../supabase';

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

function getOAuthRedirectBase() {
  if (typeof window === 'undefined') return 'https://rides.mairide.in';
  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').toLowerCase();
  const isLocalHost =
    protocol === 'file:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0';

  if (isLocalHost) {
    return window.location.origin || 'http://localhost:5173';
  }

  if (hostname === 'mairide.in' || hostname === 'www.mairide.in' || hostname === 'rides.mairide.in') {
    return 'https://rides.mairide.in';
  }

  return window.location.origin || 'https://rides.mairide.in';
}

function buildOAuthPopupFeatures() {
  if (typeof window === 'undefined') return 'width=520,height=720';
  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  return [
    'popup=yes',
    'toolbar=no',
    'menubar=no',
    'width=' + width,
    'height=' + height,
    'left=' + left,
    'top=' + top,
  ].join(',');
}

async function waitForOAuthPopupSession(authInstance: SupabaseAuthCompat, popup: Window | null) {
  return await new Promise<UserCredential>((resolve, reject) => {
    let settled = false;
    let closePoll: ReturnType<typeof window.setInterval> | null = null;
    let timeoutId: ReturnType<typeof window.setTimeout> | null = null;

    const cleanup = () => {
      unsubscribe?.();
      if (closePoll) window.clearInterval(closePoll);
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'mairide-oauth-complete') return;
      if (authInstance.currentUser) {
        finish(() => resolve({ user: authInstance.currentUser as User }));
      }
    };

    const unsubscribe = onAuthStateChanged(authInstance, (nextUser) => {
      if (!nextUser || nextUser.isAnonymous) return;
      finish(() => resolve({ user: nextUser }));
    });

    window.addEventListener('message', onMessage);

    closePoll = window.setInterval(() => {
      if (popup && popup.closed) {
        finish(() => {
          reject(Object.assign(new Error('Google sign-in was closed before it completed.'), { code: 'auth/popup-closed-by-user' }));
        });
      }
    }, 400);

    timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error('Google sign-in timed out. Please try again.')));
    }, 120000);
  });
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
  sessionStorage.setItem('mairide_oauth_started', 'google');
  const oauthMode = sessionStorage.getItem('mairide_oauth_mode') || '';
  const oauthRole = sessionStorage.getItem('mairide_oauth_role') || '';
  const redirectUrl = new URL('/', getOAuthRedirectBase());
  if (oauthMode === 'login' || oauthMode === 'signup') {
    redirectUrl.searchParams.set('oauthMode', oauthMode);
  }
  if (oauthRole === 'driver' || oauthRole === 'consumer') {
    redirectUrl.searchParams.set('oauthRole', oauthRole);
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl.toString(),
      skipBrowserRedirect: true,
    },
  });

  if (error) throw mapAuthError(error);
  if (data?.url) {
    const popup = window.open(data.url, 'mairide-google-oauth', buildOAuthPopupFeatures());
    if (!popup) {
      window.location.assign(data.url);
      return { user: auth.currentUser as User };
    }
    popup.focus?.();
    return await waitForOAuthPopupSession(authInstance, popup);
  }

  return { user: auth.currentUser as User };
}

export async function signInWithPhoneNumber() {
  throw new Error('Phone auth is handled by the OTP API in this app.');
}
