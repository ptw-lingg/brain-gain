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
        port: 5173,
        proxy: {
            // Backend runs HTTPS with a self-signed cert in dev → target https + secure:false.
            '/api': { target: 'https://localhost:3001', changeOrigin: true, secure: false },
        },
    },
});
