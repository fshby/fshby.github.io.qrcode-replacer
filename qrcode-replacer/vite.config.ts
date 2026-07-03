import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  base: process.env.VITE_BASE || '/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096
  }
})
