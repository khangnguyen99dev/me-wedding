import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const server = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
        },
    },
    build: {
        outDir: 'dist',
        manifest: true,
        rollupOptions: {
            input: {
                // Admin SPA (served by the Node server at /admin/*)
                admin: fileURLToPath(new URL('./index.html', import.meta.url)),
                // Hydration bundle injected into every public invitation page
                ladipage: fileURLToPath(new URL('./src/public/ladipage.ts', import.meta.url)),
            },
        },
    },
    server: {
        port: 5173,
        // The admin runs on Vite in dev; template assets + preview rendering live on the Node server.
        proxy: {
            '/templates': server,
            '/api': server,
        },
    },
});
