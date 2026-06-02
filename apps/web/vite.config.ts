import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Load env from the repo root so one .env serves api + web. Only VITE_* vars are
  // ever exposed to the client, so backend secrets in the same file stay private.
  envDir: '../..',
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
})
