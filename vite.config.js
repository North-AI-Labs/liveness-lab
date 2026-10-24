import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
const input = { lab: 'index.html' };
// An optional local adapter may exist, but is not part of the public source.
if (existsSync(new URL('./capture.html', import.meta.url))) input.capture = 'capture.html';
export default defineConfig({
  base: process.env.LIVENESS_LAB_BASE || '/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision', 'onnxruntime-web'] },
  server: { headers: { 'Permissions-Policy': 'camera=(self), microphone=()' } },
  preview: { headers: { 'Permissions-Policy': 'camera=(self), microphone=()' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200, rollupOptions: { input } },
});
