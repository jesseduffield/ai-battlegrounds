import { defineConfig } from 'vite'
import checker from 'vite-plugin-checker'

export default defineConfig({
  base: '/ai-battlegrounds/',
  plugins: [
    checker({
      typescript: true,
    }),
  ],
  server: {
    port: 3000,
    open: true
  }
})
