import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  void mode;
  return {
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: false,
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
