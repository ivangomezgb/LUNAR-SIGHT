import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Synthetic fixtures in public/dev-data/ must never ship in a production build.
function stripDevData(): Plugin {
  let outDir = 'dist'
  return {
    name: 'strip-dev-data',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir
    },
    async closeBundle() {
      if (process.env.VITE_DATA_DIR === 'dev-data') return
      const fsName = 'node:fs'
      const fs = await import(/* @vite-ignore */ fsName)
      fs.rmSync(`${outDir}/dev-data`, { recursive: true, force: true })
    },
  }
}

declare const process: { env: Record<string, string | undefined> }

// base './' so the static build works from any sub-path (GitHub Pages). Routing uses HashRouter.
export default defineConfig({
  base: './',
  // Avoid the existing .vite cache, which can be locked on Windows.
  cacheDir: 'node_modules/.vite-luna',
  plugins: [react(), stripDevData()],
})
