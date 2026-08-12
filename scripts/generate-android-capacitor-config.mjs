#!/usr/bin/env node
/**
 * Generates capacitor.config.ts for Android CI builds.
 * HAS_ANDROID_FIREBASE=1 keeps PushNotifications; otherwise omit it.
 *
 * Production native shell loads https://rides.mairide.in so API + map tiles
 * share the live HTTPS origin (fixes Network Error / blocked tiles in WebView).
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
  server: {
    url: 'https://rides.mairide.in',
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      'rides.mairide.in',
      'www.mairide.in',
      'mairide.in',
      'jcgoccsdlrjnratpaeje.supabase.co',
      '*.supabase.co',
      'accounts.google.com',
      '*.googleapis.com',
      '*.gstatic.com',
      '*.tile.openstreetmap.org',
      '*.openstreetmap.org',
      '*.mapbox.com',
      'api.mapbox.com',
    ],
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    GoogleSignIn: {
      scopes: ['profile', 'email'],
      serverClientId: '506109288880-4ad9lteqdrc8bcf8pkgv4a7vrkfv6pu4.apps.googleusercontent.com',
    },
${pushBlock}  },
};

export default config;
`;

writeFileSync('capacitor.config.ts', contents);
console.log(contents);
console.log('firebase=', hasFirebase);
