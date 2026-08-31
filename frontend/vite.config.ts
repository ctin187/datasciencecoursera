import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served as a GitHub Pages project site at /<repo>/, not the domain root.
  base: process.env.GITHUB_PAGES ? '/datasciencecoursera/' : '/',
  test: {
    // The backend client reads this at module load to decide whether a backend
    // is configured at all. Tests need a value so they exercise the request
    // path rather than the "not configured" short-circuit; it is never fetched,
    // since those tests stub fetch.
    env: { VITE_API_BASE_URL: 'https://backend.test' },
  },
})
