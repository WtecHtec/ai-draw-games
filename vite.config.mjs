import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  base: './',
  envPrefix: ['VITE_', 'JEV_', 'TYPESAFE_'],
  server: {
    port: 5173,
    open: false,
    cors: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
