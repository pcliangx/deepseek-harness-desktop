import { join } from 'node:path'

/** The loopback URL the BrowserWindow loads once the host has bound. */
export function hostUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

/** Inputs for resolving the built CLI bin (injected so tests need no Electron). */
export interface CliBinResolution {
  isPackaged: boolean
  resourcesPath: string
  devRoot: string
}

/**
 * Resolve the built `apps/cli/lib/bin.js`. Packaged builds stage it under the
 * app resources root (`<resources>/apps/cli/lib/bin.js`, matching the
 * packaging stage layout); development runs it from the checkout root.
 */
export function cliBinPath(r: CliBinResolution): string {
  const base = r.isPackaged ? r.resourcesPath : r.devRoot
  return join(base, 'apps/cli/lib/bin.js')
}
