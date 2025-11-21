import { defineConfig } from 'vite';

// Use VITE_BASE (preferred) or package.json homepage (npm_package_homepage) or default '/'
export default defineConfig({
  base: process.env.VITE_BASE || process.env.npm_package_homepage || '/',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'https://geo.jaxartes.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});