/**
 * Launch the packaged desktop app and assert its window reaches the dsh host's
 * loopback URL. Runs as a standalone node process (spawned by the vitest smoke
 * suite) so Playwright's Electron driver runs outside vitest's forked runner,
 * which deadlocks on the driver's stdio protocol.
 *
 * Usage: node scripts/smoke-launch.mjs <path-to-electron-binary-or-.app>
 */
import { _electron as electron } from 'playwright'

const appPath = process.argv[2]
if (!appPath) {
  console.error('smoke-launch: missing app path argument')
  process.exit(2)
}

/**
 * Tear the app down without letting Playwright's graceful close wedge the
 * suite: that close path occasionally stalls (the quit request is delivered,
 * the app acknowledges it, yet the driver never observes process exit) while
 * the app itself is healthy — a direct SIGTERM exits it in about a second.
 * The assertion has already run by the time this is called, so the signal
 * fallback cannot mask a boot failure.
 * @param {import('playwright').ElectronApplication} app - the launched app.
 */
async function closeApp(app) {
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 15_000))]).catch(() => {})
  const proc = app.process()
  if (proc === undefined || proc.exitCode !== null) return
  proc.kill('SIGTERM')
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => { proc.kill('SIGKILL'); resolve() }, 10_000)
    proc.once('exit', () => { clearTimeout(killTimer); resolve() })
  })
}

const app = await electron.launch({ executablePath: appPath })
try {
  const win = await app.firstWindow()
  const deadline = Date.now() + 60_000
  let url = win.url()
  while (!url.includes('127.0.0.1') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    url = win.url()
  }
  if (!url.includes('127.0.0.1')) {
    console.error(`smoke-launch: window never reached the host; last url=${url}`)
    process.exitCode = 1
  } else {
    console.log(`smoke-launch: window loaded ${url}`)
  }
} finally {
  await closeApp(app)
}
