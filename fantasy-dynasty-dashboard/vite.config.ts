import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served as a GitHub Pages project site at /<repo>/, not the domain root.
  base: process.env.GITHUB_PAGES ? '/datasciencecoursera/' : '/',
})
