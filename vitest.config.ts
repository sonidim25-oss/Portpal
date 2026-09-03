import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Resolve from this file, not the cwd, so the suite also runs from a git worktree
// (where node_modules is inherited from the main checkout).
const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    root: here,
    setupFiles: [here + 'src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src-tauri/**/*.{test,spec}.{ts,ts}'],
    exclude: ['node_modules', 'dist', 'src-tauri/target'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', '**/*.d.ts'],
    },
  },
});
