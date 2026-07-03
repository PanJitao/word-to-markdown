import { defineConfig } from 'vite'

// Tauri 期望前端 dev server 跑在 1420 端口
export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
