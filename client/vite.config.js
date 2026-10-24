import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // API_PROXY_TARGET lets the browser smoke tests point at their own API (see playwright.config.js).
  server: {
    port: 5173,
    // The landing page's gate demo imports the server's pure rule code (server/src/logic).
    fs: { allow: ['..'] },
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:4000',
      '/uploads': process.env.API_PROXY_TARGET || 'http://localhost:4000',
    },
  },
});
