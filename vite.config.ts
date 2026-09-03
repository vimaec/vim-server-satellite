import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH lets the same build serve from a GitHub Pages sub-path
// (`/vim-server-satellite/`) or from a domain root during development.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
