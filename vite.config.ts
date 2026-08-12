import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/** Drop heavy marketing/tutorial media from production dist so Capacitor APK stays lean. */
function stripHeavyPublicAssets(): Plugin {
  const heavyGlobs = [
    'tutorials/videos',
    'tutorials/screenshots/live',
  ];

  return {
    name: 'mairide-strip-heavy-public-assets',
    apply: 'build',
    closeBundle() {
      const distRoot = path.resolve(__dirname, 'dist');
      for (const relative of heavyGlobs) {
        const target = path.join(distRoot, relative);
        if (fs.existsSync(target)) {
          fs.rmSync(target, {recursive: true, force: true});
        }
      }
      // Keep one hero image; drop duplicate JPEG copy in assets if present.
      const duplicateHero = path.join(distRoot, 'assets', 'hero-car.jpg');
      if (fs.existsSync(duplicateHero) && fs.existsSync(path.join(distRoot, 'hero', 'mairide-hero-car.png'))) {
        fs.rmSync(duplicateHero, {force: true});
      }
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), stripHeavyPublicAssets()],
    build: {
      sourcemap: false,
      minify: 'esbuild',
      cssMinify: true,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2500,
      reportCompressedSize: true,
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'firebase/auth': path.resolve(__dirname, 'src/lib/supabaseCompat/auth.ts'),
        'firebase/firestore': path.resolve(__dirname, 'src/lib/supabaseCompat/firestore.ts'),
        'firebase/storage': path.resolve(__dirname, 'src/lib/supabaseCompat/storage.ts'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
