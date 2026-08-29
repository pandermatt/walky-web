import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    // Git worktrees live under .claude/worktrees and contain a full copy of this
    // project, so their tests would be collected alongside ours and every count
    // would silently double.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  worker: { format: 'es' },
});
