import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico}'] },
      manifest: {
        name: 'Farm Rx',
        short_name: 'Farm Rx',
        theme_color: '#17513A',
        background_color: '#F5F5F5',
        display: 'standalone',
        icons: [
          {
            src: '/farm-rx-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
