import { defineConfig } from 'vite';
import { pwa } from './build/pwa.ts';

export default defineConfig({
  base: './',
  plugins: [pwa()],
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
