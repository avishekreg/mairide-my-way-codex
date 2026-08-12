#!/usr/bin/env node
/**
 * Patches the generated Android project for MaiRide release builds.
 * - Ensures internet / network / camera / location permissions
 * - Enables cleartext + mixed-content friendly network security
 * - Enables largeHeap for WebView/Maps
 * - Writes MainActivity mixed-content guards
 * - Disables Firebase auto-init when google-services.json is absent
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifestPath)) {
  console.error('Android manifest not found at', manifestPath);
  process.exit(1);
}

const networkSecurityPath = 'android/app/src/main/res/xml/network_security_config.xml';
mkdirSync(dirname(networkSecurityPath), { recursive: true });
writeFileSync(
  networkSecurityPath,
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Allow HTTPS map/API hosts and cleartext fallbacks for WebView tile loads. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">mairide.in</domain>
        <domain includeSubdomains="true">supabase.co</domain>
        <domain includeSubdomains="true">googleapis.com</domain>
        <domain includeSubdomains="true">gstatic.com</domain>
        <domain includeSubdomains="true">openstreetmap.org</domain>
        <domain includeSubdomains="true">tile.openstreetmap.org</domain>
        <domain includeSubdomains="true">mapbox.com</domain>
    </domain-config>
</network-security-config>
`
);

let xml = readFileSync(manifestPath, 'utf8');

for (const permission of [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.CAMERA',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
]) {
  if (!xml.includes(permission)) {
    xml = xml.replace(
      /<application\b/,
      `    <uses-permission android:name="${permission}" />\n    <application`
    );
  }
}

if (!xml.includes('android:largeHeap')) {
  xml = xml.replace(/<application\b/, '<application android:largeHeap="true"');
}

if (!xml.includes('android:usesCleartextTraffic')) {
  xml = xml.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
}

if (!xml.includes('android:networkSecurityConfig')) {
  xml = xml.replace(
    /<application\b/,
    '<application android:networkSecurityConfig="@xml/network_security_config"'
  );
}

if (!xml.includes('in.mairide.app.WEBVIEW_CONNECT_SRC')) {
  xml = xml.replace(
    /(<application\b[^>]*>)/,
    `$1\n        <meta-data android:name="in.mairide.app.WEBVIEW_CONNECT_SRC" android:value="'self' https://*.mairide.in https://*.supabase.co https://*.tile.openstreetmap.org https://*.mapbox.com https://*.googleapis.com https://*.gstatic.com" />`
  );
}

if (process.env.HAS_ANDROID_FIREBASE !== '1') {
  for (const name of [
    'firebase_messaging_auto_init_enabled',
    'firebase_analytics_collection_enabled',
  ]) {
    if (!xml.includes(name)) {
      xml = xml.replace(
        /(<application\b[^>]*>)/,
        `$1\n        <meta-data android:name="${name}" android:value="false" />`
      );
    }
  }

  xml = xml.replace(
    /\s*<service[\s\S]*?com\.capacitorjs\.plugins\.pushnotifications\.MessagingService[\s\S]*?<\/service>/g,
    ''
  );
}

writeFileSync(manifestPath, xml);

const mainActivityCandidates = [
  'android/app/src/main/java/in/mairide/app/MainActivity.java',
  'android/app/src/main/java/com/getcapacitor/myapp/MainActivity.java',
];
const mainActivity = `package in.mairide.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applyMixedContentAllow();
  }

  @Override
  public void onStart() {
    super.onStart();
    applyMixedContentAllow();
  }

  private void applyMixedContentAllow() {
    try {
      if (getBridge() != null && getBridge().getWebView() != null) {
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
      }
    } catch (Exception ignored) {
      // capacitor.config android.allowMixedContent remains the primary switch.
    }
  }
}
`;

for (const candidate of mainActivityCandidates) {
  if (existsSync(candidate) || candidate.includes('in/mairide/app')) {
    mkdirSync(dirname(candidate), { recursive: true });
    // Only write the MaiRide package path; skip writing into missing template paths.
    if (candidate.includes('in/mairide/app')) {
      writeFileSync(candidate, mainActivity);
      console.log('Wrote', candidate);
    }
  }
}

console.log('Patched AndroidManifest.xml + network security config');
for (const needle of [
  'largeHeap',
  'usesCleartextTraffic',
  'networkSecurityConfig',
  'ACCESS_NETWORK_STATE',
  'INTERNET',
  'firebase_messaging_auto_init_enabled',
  'MessagingService',
]) {
  console.log(needle, xml.includes(needle));
}
