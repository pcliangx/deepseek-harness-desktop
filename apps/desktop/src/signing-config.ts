/**
 * Pure resolver turning credential env into electron-builder mac-signing inputs;
 * the dist entry feeds the result to electron-builder as `-c.` CLI overrides.
 * Lives at `src/` top level so the Electron main bundle never pulls it in.
 * @module @deepseek-ai/dsh-desktop/signing-config
 */

/** electron-builder mac-signing inputs resolved from credential env. */
export interface MacSigningConfig {
  /** `null` keeps the build unsigned (Plan-1 behavior). */
  identity: string | null
  /** Whether electron-builder notarizes the artifacts via `@electron/notarize`. */
  notarize: boolean
  /** Whether the hardened runtime is enabled; only meaningful when signing. */
  hardenedRuntime: boolean
  /** Absolute or config-relative entitlements plist; only set when signing. */
  entitlements: string | null
}

/** The notarytool identity env, all of which notarization requires. */
const NOTARY_ENV: readonly string[] = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

/**
 * Signing is all-or-nothing: it activates only when the certificate bundle is
 * present (`CSC_LINK` + `CSC_KEY_PASSWORD`), and notarization additionally
 * requires the notarytool identity (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`
 * + `APPLE_TEAM_ID`). Partial credential sets fail loud at dist time, not
 * silently mid-build. An env set to the empty string counts as unset (GitHub
 * Actions materializes absent secrets as empty strings).
 * @param env - the process env holding the credential variables.
 * @returns the resolved signing inputs; identity `null` means unsigned.
 * @throws when a credential group is present but incomplete, naming what is missing.
 */
export function resolveMacSigning(env: NodeJS.ProcessEnv): MacSigningConfig {
  if (!env.CSC_LINK) {
    return { identity: null, notarize: false, hardenedRuntime: false, entitlements: null }
  }
  if (!env.CSC_KEY_PASSWORD) {
    throw new Error('dist: CSC_LINK set without CSC_KEY_PASSWORD')
  }
  const missingNotary = NOTARY_ENV.filter(name => !env[name])
  if (missingNotary.length !== 0 && missingNotary.length !== NOTARY_ENV.length) {
    throw new Error(`dist: partial notarization identity, missing ${missingNotary.join(', ')}`)
  }
  return {
    identity: 'Developer ID Application',
    notarize: missingNotary.length === 0,
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
  }
}
