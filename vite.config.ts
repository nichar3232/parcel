import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// A second local Parcel checkout may already own the default backend port.
// Keeping the standard target preserves the documented two-process workflow;
// an explicit origin lets a specific frontend bind to its matching backend.
const apiOrigin = process.env.PARCEL_API_ORIGIN || 'http://localhost:3025';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [vinext(), sites()],
  server: {
    proxy: {
      /**
       * The API is a separate process in development, so the browser's
       * Origin (the Vite port) never matches the Host the backend is
       * reached on, and its mutation guard rejects every write —
       * deposits, trades and the settlement clock all 403 while GETs
       * sail through. Presenting the proxied request as same-origin is
       * what the two-port split already means. In production one
       * server answers both and the header is the browser's own.
       */
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        headers: { origin: apiOrigin },
      },
    },
  },
});
