import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      // Proxy API requests to our Express backend during development
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false
      }
    },
    // Disable HMR overlay
    hmr: {
      overlay: false
    }
  },
  // Configure static assets correctly
  publicDir: 'public',
  // Configure SPA history fallback
  build: {
    outDir: 'dist',
    // Make sure Vite correctly handles base path when deployed
    emptyOutDir: true,
    // Ensure assets are properly referenced
    assetsDir: 'assets',
    // Improve load time by generating fewer chunks
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
})
