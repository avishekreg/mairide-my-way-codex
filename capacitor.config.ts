import { config as loadEnv } from 'dotenv';
import type { CapacitorConfig } from "@capacitor/cli";

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

const RIDES_APP_ORIGIN = "https://rides.mairide.in";
const GOOGLE_WEB_CLIENT_ID =
  process.env.VITE_GOOGLE_CLIENT_ID ||
  '506109288880-4ad9lteqdrc8bcf8pkgv4a7vrkfv6pu4.apps.googleusercontent.com';

const config: CapacitorConfig = {
  appId: "in.mairide.app",
  appName: "MaiRide",
  webDir: "dist",
  server: {
    url: RIDES_APP_ORIGIN,
    cleartext: false,
    allowNavigation: [
      "rides.mairide.in",
      "www.mairide.in",
      "mairide.in",
      "jcgoccsdlrjnratpaeje.supabase.co",
      "*.supabase.co",
    ],
  },
  plugins: {
    // Do NOT globally patch window.fetch — that combination with remote
    // server.url has caused Android WebView fatal crashes on cold start.
    // Login still uses explicit CapacitorHttp.post() where needed.
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
