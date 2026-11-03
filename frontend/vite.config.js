import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5176,
    strictPort: true,
    https: {
      key: readFileSync('../certs/attendx-key.pem'),
      cert: readFileSync('../certs/attendx.pem')
    },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/camera-': { target: 'http://127.0.0.1:8889', changeOrigin: true },
    }
  }
})
