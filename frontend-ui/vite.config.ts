import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Default to localhost for secure context (crypto.subtle support)
    // Set VITE_HOST=0.0.0.0 to enable network access (mobile/tablet testing)
    host: process.env.VITE_HOST || 'localhost',
    port: 5173
  }
})
