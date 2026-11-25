import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Inside Docker the API is reachable as http://api:4000; on a bare machine, localhost.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: process.env.VITE_HOST ?? 'localhost',
    // File events from macOS bind mounts don't always reach containers; polling is the reliable fallback.
    watch: process.env.VITE_POLL === '1' ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': apiTarget,
      '/healthz': apiTarget,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': apiTarget,
    },
  },
});
