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
  _authInstance: SupabaseAuthCompat,
  _provider: GoogleAuthProvider
) {
  sessionStorage.setItem('mairide_oauth_started', 'google');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });

  if (error) throw mapAuthError(error);
  if (data?.url) {
    window.location.assign(data.url);
  }

  return { user: auth.currentUser as User };
}

export async function signInWithPhoneNumber() {
  throw new Error('Phone auth is handled by the OTP API in this app.');
}
