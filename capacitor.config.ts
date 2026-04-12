import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "in.mairide.app",
  appName: "MaiRide",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    url: "https://www.mairide.in",
    cleartext: false,
  },
};

export default config;

