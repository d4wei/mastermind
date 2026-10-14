import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'translation-cli': 'tools/translation/translation-cli.ts' },
  outDir: 'dist/node',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  splitting: false,
  clean: true,
  skipNodeModulesBundle: true,
})
