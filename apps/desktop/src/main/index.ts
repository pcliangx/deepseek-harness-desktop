/**
 * Electron main entry: spawn the dsh web host, wait for its readiness line, and
 * load the SPA in a window. Full integration is exercised by the keyless
 * smoke; the pure pieces (URL/path) are unit-tested in main-helpers.spec.ts.
 * @module @deepseek-ai/dsh-desktop/main
 */
import { resolve } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { startHost } from './host-supervisor.ts'
import { cliBinPath, hostUrl } from './paths.ts'

// BrowserWindows must stay referenced or they can be garbage-collected and
// closed; this wrapper owns at most one live window (content or error).
const windows = new Set<BrowserWindow>()

void app.whenReady().then(async () => {
  // Development resolves the CLI from the checkout this bundle lives in
  // (lib/main → lib → desktop → apps → repo root); packaged builds use resources.
  const devRoot = resolve(import.meta.dirname, '../../../..')
  const host = startHost({
    execPath: process.execPath,
    cliBin: cliBinPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, devRoot }),
    env: {},
  })
  app.on('before-quit', () => { void host.dispose() })
  // Closing the window quits the app (and so disposes the host) instead of
  // leaving an invisible host running on macOS.
  app.on('window-all-closed', () => { app.quit() })
  try {
    const port = await host.ready
    const window = new BrowserWindow({ width: 1280, height: 800, show: false })
    windows.add(window)
    window.on('closed', () => { windows.delete(window) })
    await window.loadURL(hostUrl(port))
    window.show()
  } catch (error) {
    const failure = new BrowserWindow({ width: 640, height: 320 })
    windows.add(failure)
    failure.on('closed', () => { windows.delete(failure) })
    await failure.loadURL('data:text/plain,' + encodeURIComponent(`dsh failed to start:\n${String(error)}`))
  }
})
