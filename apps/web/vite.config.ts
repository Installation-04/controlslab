import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative base: the build works under any path (static hosting, sub-folders).
  base: './',
  resolve: {
    alias: { '@content': fileURLToPath(new URL('../../content', import.meta.url)) },
  },
  server: { port: 5173, fs: { allow: ['../..'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: { name: 'web', include: ['test/**/*.test.ts'], environment: 'node' },
});
