import { config as loadEnv } from 'dotenv';
import type { CapacitorConfig } from "@capacitor/cli";

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

const GOOGLE_WEB_CLIENT_ID =
  process.env.VITE_GOOGLE_CLIENT_ID ||
  '506109288880-4ad9lteqdrc8bcf8pkgv4a7vrkfv6pu4.apps.googleusercontent.com';

/**
 * Android/iOS shells load bundled web assets (no remote server.url).
 * hostname matches production so Maps API key referrer restrictions work.
 * API calls still target https://rides.mairide.in via resolveApiBaseUrl().
 */
const config: CapacitorConfig = {
  appId: "in.mairide.app",
  appName: "MaiRide",
  webDir: "dist",
  server: {
    androidScheme: "https",
    hostname: "rides.mairide.in",
    cleartext: false,
    allowNavigation: [
      "rides.mairide.in",
      "www.mairide.in",
      "mairide.in",
      "jcgoccsdlrjnratpaeje.supabase.co",
      "*.supabase.co",
      "accounts.google.com",
      "*.googleapis.com",
      "*.gstatic.com",
    ],
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
