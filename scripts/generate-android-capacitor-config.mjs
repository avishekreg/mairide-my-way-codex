#!/usr/bin/env node
/**
 * Generates capacitor.config.ts for Android CI builds.
 * HAS_ANDROID_FIREBASE=1 keeps PushNotifications; otherwise omit it.
 *
 * IMPORTANT: Do NOT set server.hostname to rides.mairide.in (or any live API host).
 * Spoofing the production host makes same-origin fetches hit Capacitor's local asset
 * server, and allowNavigation + location.reload() can escape the bundled shell into
 * a remote white-screen state after login.
 *
 * Keep default localhost + https scheme. Maps key is baked at build time; Google Cloud
 * HTTP referrers must allow https://localhost/* for the WebView Maps JS API.
 * API calls always target https://rides.mairide.in via resolveApiBaseUrl().
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
    // Default Capacitor host. Never spoof the live API domain here.
    cleartext: false,
    allowNavigation: [
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
