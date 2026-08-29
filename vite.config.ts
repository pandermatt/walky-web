import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { pwa } from './build/pwa.ts';

// The version the settings sheet shows. Read from package.json rather than
// written anywhere in src, so the number on screen cannot drift from the one
// the project is released under.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  plugins: [pwa()],
  define: { __WALKY_APP_VERSION__: JSON.stringify(version) },
  test: {
    // Git worktrees live under .claude/worktrees and contain a full copy of this
    // project, so their tests would be collected alongside ours and every count
    // would silently double.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: {
        // The service worker has to keep a stable, root-level name: its URL is
        // its identity to the browser, and a hashed one would register a second
        // worker on every deploy instead of updating the first.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  worker: { format: 'es' },
});
