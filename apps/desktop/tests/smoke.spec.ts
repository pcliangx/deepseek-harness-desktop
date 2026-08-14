import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from 'vitest'

// Keyless end-to-end smoke: launch the packaged app and assert its window
// reaches the spawned dsh host's loopback URL. The assertion runs in a clean
// node subprocess (scripts/smoke-launch.mjs) because Playwright's Electron
// driver deadlocks inside vitest's forked runner. Run locally after packaging:
//   DSH_DESKTOP_APP="apps/desktop/dist-build/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
//     pnpm exec vitest run apps/desktop/tests/smoke.spec.ts
// Without the variable it skips, so keyless CI stays green before packaging.
test.skipIf(!process.env.DSH_DESKTOP_APP)('the app boots and loads the SPA', { timeout: 120_000 }, () => {
  const launch = resolve(import.meta.dirname, '..', 'scripts', 'smoke-launch.mjs')
  const result = spawnSync(process.execPath, [launch, process.env.DSH_DESKTOP_APP!], {
    stdio: 'inherit',
    timeout: 110_000,
    // A sanitized env: the vitest fork's own variables leak into the Electron
    // app through the child and stall Playwright's driver.
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  })
  if (result.status !== 0) throw new Error(`smoke-launch exited with status ${result.status ?? 'null'}`)
})
