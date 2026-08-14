/**
 * Dist entry: resolve signing inputs from the credential env and drive
 * electron-builder with them as `-c.mac.*` CLI overrides, so the YAML stays
 * static and unsigned while keyed env produces a signed, notarized build.
 * Runs under tsx (see the `dist` package script); `builderArgs` is the pure,
 * tested core.
 * @module @deepseek-ai/dsh-desktop/scripts/dist
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveMacSigning, type MacSigningConfig } from '../src/signing-config.ts'

/**
 * Translate resolved signing inputs into electron-builder `-c.mac.*` CLI
 * overrides. The identity is always passed (`null` spelled out keeps the
 * keyless build unsigned); the remaining overrides appear only when set.
 * @param config - the signing inputs resolved from credential env.
 * @returns argv elements appended after the `electron-builder` program name.
 */
export function builderArgs(config: MacSigningConfig): string[] {
  const args = [`-c.mac.identity=${config.identity ?? 'null'}`]
  if (config.notarize) args.push('-c.mac.notarize=true')
  if (config.hardenedRuntime) args.push('-c.mac.hardenedRuntime=true')
  if (config.entitlements !== null) args.push(`-c.mac.entitlements=${config.entitlements}`)
  return args
}

/** Run electron-builder with the resolved overrides; propagates its exit code. */
function main(): void {
  const args = builderArgs(resolveMacSigning(process.env))
  console.log('dist: electron-builder', args.join(' '))
  const result = spawnSync('pnpm', ['exec', 'electron-builder', ...args], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

// Entry guard: tests import `builderArgs` from this module and must not spawn.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}
