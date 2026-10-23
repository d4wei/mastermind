import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isThemeAsset, resolveThemeAsset, scanThemes } from './themes/discovery'

const root = import.meta.dirname
const themesDir = path.join(root, 'themes')
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

/**
 * The webview loads `/themes/**` and `/themes.json` beside `desktop.html`. The dev server answers
 * them from the themes tree, and the build writes the same set into its output directory.
 */
function themeAssets(): Plugin {
  return {
    name: 'mastermind-theme-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        // Reloading a reviewer route serves the desktop entry, as the window first loaded it.
        if (pathname === '/' || pathname.startsWith('/d/')) {
          request.url = '/desktop.html'
          return next()
        }
        if (pathname !== '/themes.json' && !pathname.startsWith('/themes/')) return next()
        void (async () => {
          let body: string | Buffer | null = null
          let type = CONTENT_TYPES['.json']!
          if (pathname === '/themes.json') body = JSON.stringify(await scanThemes(themesDir))
          else {
            let name: string | null = null
            try { name = decodeURIComponent(pathname.slice('/themes/'.length)) } catch { /* Malformed escapes name nothing. */ }
            const file = name === null ? null : await resolveThemeAsset(themesDir, name)
            if (file) {
              body = await fs.readFile(file)
              type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
            }
          }
          if (body === null) response.statusCode = 404
          else response.setHeader('content-type', type)
          response.setHeader('cache-control', 'no-cache')
          response.end(body ?? '')
        })().catch(next)
      })
    },
    async writeBundle({ dir }) {
      if (!dir) throw new Error('theme assets need an output directory')
      await fs.cp(themesDir, path.join(dir, 'themes'), { recursive: true, filter: isThemeAsset })
      await fs.writeFile(path.join(dir, 'themes.json'), JSON.stringify(await scanThemes(themesDir)))
    },
  }
}

export default defineConfig({
  root: path.join(root, 'ui'),
  plugins: [react(), themeAssets()],
  publicDir: false,
  // `desktop/tauri.conf.json` names this port as its development URL.
  server: { port: 5173, strictPort: true },
  build: {
    target: 'esnext',
    outDir: path.join(root, 'desktop/reviewer-ui'),
    emptyOutDir: true,
    rolldownOptions: { input: path.join(root, 'ui/desktop.html') },
  },
})
