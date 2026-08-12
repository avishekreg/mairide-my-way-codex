import { config as loadEnv } from 'dotenv';
import type { CapacitorConfig } from "@capacitor/cli";

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

const GOOGLE_WEB_CLIENT_ID =
  process.env.VITE_GOOGLE_CLIENT_ID ||
  '506109288880-4ad9lteqdrc8bcf8pkgv4a7vrkfv6pu4.apps.googleusercontent.com';

/**
 * Native Android shell: load the live HTTPS app origin so API + map tiles
 * share the same secure host (fixes Network Error / blocked tiles in WebView).
 * Local production web deploy remains separate — this only affects the APK WebView.
 */
const config: CapacitorConfig = {
  appId: "in.mairide.app",
  appName: "MaiRide",
  webDir: "dist",
  server: {
    url: "https://rides.mairide.in",
    androidScheme: "https",
    cleartext: true,
    allowNavigation: [
      "rides.mairide.in",
      "www.mairide.in",
      "mairide.in",
      "jcgoccsdlrjnratpaeje.supabase.co",
      "*.supabase.co",
      "accounts.google.com",
      "*.googleapis.com",
      "*.gstatic.com",
      "*.tile.openstreetmap.org",
      "*.openstreetmap.org",
      "*.mapbox.com",
      "api.mapbox.com",
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
      serverClientId: GOOGLE_WEB_CLIENT_ID,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
