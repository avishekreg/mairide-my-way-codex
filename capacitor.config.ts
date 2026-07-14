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
    allowNavigation: ["rides.mairide.in"],
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: GOOGLE_WEB_CLIENT_ID,
      forceCodeForRefreshToken: false,
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
