import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'development|production'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: {
      index: fileURLToPath(new URL('./index.html', import.meta.url)),
      capture: fileURLToPath(new URL('./collect.html', import.meta.url)),
    } },
  },
  server: { host: '127.0.0.1', port: 5173 },
});
