#!/usr/bin/env node
/**
 * Patches the generated AndroidManifest.xml for MaiRide release builds.
 * - Ensures camera/location permissions
 * - Enables largeHeap for WebView/Maps
 * - Disables Firebase auto-init when google-services.json is absent
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const path = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(path)) {
  console.error('Android manifest not found at', path);
  process.exit(1);
}

let xml = readFileSync(path, 'utf8');

for (const permission of [
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

writeFileSync(path, xml);
console.log('Patched AndroidManifest.xml');
for (const needle of [
  'largeHeap',
  'firebase_messaging_auto_init_enabled',
  'CAMERA',
  'MessagingService',
  'FirebaseInitProvider',
]) {
  console.log(needle, xml.includes(needle));
}
