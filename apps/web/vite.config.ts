import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    fs: { allow: ['..', '../..'] },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
