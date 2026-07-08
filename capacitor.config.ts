import type { CapacitorConfig } from "@capacitor/cli";

const RIDES_APP_ORIGIN = "https://rides.mairide.in";

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
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
