import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.mairide.app',
  appName: 'MaiRide',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: {
      // Patch window.fetch through native HTTP on Android/iOS.
      // Required so Supabase JS (and other APIs) do not hang in the WebView
      // after CapHttp-based login. Firebase auto-init is stripped in CI.
      enabled: true,
    },
    GoogleSignIn: {
      scopes: ['profile', 'email'],
      serverClientId: '506109288880-4ad9lteqdrc8bcf8pkgv4a7vrkfv6pu4.apps.googleusercontent.com',
    },
  },
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
