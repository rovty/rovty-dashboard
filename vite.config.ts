import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    // `npm run dev` serves the SPA only; proxy /api/* to a locally running
    // Worker (`npm run dev:worker`) so the SSO flow can be exercised without
    // a full build. Override the target with VITE_WORKER_ORIGIN if needed.
    proxy: {
      '/api': {
        target: process.env.VITE_WORKER_ORIGIN ?? 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
