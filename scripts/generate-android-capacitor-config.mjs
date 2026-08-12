#!/usr/bin/env node
/**
 * Generates capacitor.config.ts for Android CI builds.
 * HAS_ANDROID_FIREBASE=1 keeps PushNotifications; otherwise omit it.
 *
 * LOCKED to known-good APK 342 (093016b) shell config:
 * - CapHttp.enabled = false (explicit CapHttp.post still used for login)
 * - NO server.hostname spoof of rides.mairide.in (that caused white-screen)
 * - NO remote server.url
 * Maps key is supplied at Vite build time via VITE_GOOGLE_MAPS_API_KEY.
 */
import { writeFileSync } from 'node:fs';

const hasFirebase = process.env.HAS_ANDROID_FIREBASE === '1';
const pushBlock = hasFirebase
  ? `    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
`
  : '';

const contents = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.mairide.app',
  appName: 'MaiRide',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    GoogleSignIn: {
      scopes: ['profile', 'email'],
      serverClientId: '506109288880-4ad9lteqdrc8bcf8pkgv4a7vrkfv6pu4.apps.googleusercontent.com',
    },
${pushBlock}  },
  server: {
    androidScheme: 'https',
    cleartext: false,
    allowNavigation: [
      'rides.mairide.in',
      'www.mairide.in',
      'mairide.in',
      'jcgoccsdlrjnratpaeje.supabase.co',
      '*.supabase.co',
      'accounts.google.com',
      '*.googleapis.com',
      '*.gstatic.com',
    ],
  },
};

export default config;
`;

writeFileSync('capacitor.config.ts', contents);
console.log(contents);
console.log('firebase=', hasFirebase);
