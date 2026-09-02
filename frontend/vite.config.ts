import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // basicSsl serves the dev server over HTTPS with an auto-generated self-signed cert,
  // so the app is HTTPS-only in development too (browsers show a one-time warning).
  plugins: [vue(), basicSsl()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
    proxy: {
      // Backend runs HTTPS with a self-signed cert in dev → target https + secure:false.
      '/api': { target: 'https://localhost:3101', changeOrigin: true, secure: false },
      // Deliberately NOT proxied: the SCORM content origin (https://localhost:3102). The player
      // loads it directly — proxying it through Vite would collapse the two origins into one and
      // void the whole isolation design (untrusted package JS could then read the app's storage).
      // For SCORM in dev, start the backend with APP_ORIGIN=https://localhost:5273 so the content
      // origin's frame-ancestors allows the Vite-served app to frame it.
    },
  },
});
