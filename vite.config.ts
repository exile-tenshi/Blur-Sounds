import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            rollupOptions: {
              // These packages resolve their bundled binaries via their own __dirname,
              // so they must stay external and be required from node_modules at runtime.
              external: ['ffmpeg-static', 'ffprobe-static'],
            },
          },
        },
      },
      preload: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
      renderer: {},
    }),
  ],
})
