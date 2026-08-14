import { defineConfig } from 'tsdown'

/**
 * Bundle the Electron main entry from source to `lib/main/index.js`. The desktop
 * package is private and ships no type declarations (its type-check program uses
 * `noEmit`); tsdown compiles `src/main/**` directly.
 *
 * `outDir` is anchored to this config's directory with an absolute path: when run
 * standalone (`tsdown` from a `pnpm --filter` script) tsdown otherwise resolves a
 * relative `outDir` against the detected workspace root and emits into the
 * repo-root `lib/`. `electron` stays external so the bundled main imports it from
 * the Electron runtime at launch.
 */
export default defineConfig({
  cwd: import.meta.dirname,
  entry: ['src/main/index.ts'],
  outDir: `${import.meta.dirname}/lib/main`,
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  // `.js` (ESM via package.json "type":"module"), not `.mjs`; no declarations —
  // this private package type-checks with `noEmit` and ships only the bundle.
  fixedExtension: false,
  dts: false,
  external: ['electron'],
})
