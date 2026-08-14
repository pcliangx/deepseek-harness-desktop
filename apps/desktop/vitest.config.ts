import { defineConfig } from 'vitest/config'

/**
 * Local test program for the desktop package. Without it, a filter-scoped
 * `vitest run` from apps/desktop walks up to the repo-root vitest config, whose
 * include globs resolve against the repo root and whose tsconfig-paths plugin
 * mis-resolves from this directory. The root suite picks these files up
 * separately through its own apps test glob.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
