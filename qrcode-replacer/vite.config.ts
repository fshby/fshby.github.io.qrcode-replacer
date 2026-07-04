import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Vite 会把 `import.meta.env.BASE_URL` 注入进所有 ES 模块。
// 为了让同一个产物既能部署到站点根（腾讯云 COS），
// 也能部署到子路径（GitHub Pages 下的 /fshby.github.io.qrcode-replacer/），
// 我们在构建时把 base 改为 `./`（相对 index.html 的路径）。
// 开发环境仍保持 `/`，方便本地调试。
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  base: command === 'build'
    ? (process.env.VITE_BASE || './')
    : '/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096
  }
}))
