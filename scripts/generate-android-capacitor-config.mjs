#!/usr/bin/env node
/**
 * Generates capacitor.config.ts for Android CI builds.
 * HAS_ANDROID_FIREBASE=1 keeps PushNotifications; otherwise omit it.
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
