/**
 * Dist entry: resolve signing inputs from the credential env and drive
 * electron-builder with them as `-c.mac.*` CLI overrides, so the YAML stays
 * static and unsigned while keyed env produces a signed, notarized build.
 * Runs under tsx (see the `dist` package script); `builderArgs` is the pure,
 * tested core.
 * @module @deepseek-ai/dsh-desktop/scripts/dist
 */
import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMachO } from '../src/macho.ts'
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

/**
 * Pre-sign every true Mach-O image in the staged CLI tree before
 * electron-builder runs: `mac.signIgnore` skips that tree during the builder's
 * own signing (its isBinaryFile probing signs tens of thousands of resource
 * files one by one), so the nested code images that Gatekeeper validates must
 * be signed here. Symlinks are skipped — every physical file sits under a real
 * directory, and signing through a link would re-sign the same inode per alias.
 * @param identity - the codesign identity (Developer ID Application).
 */
function preSignCliTree(identity: string): void {
  const root = resolve(import.meta.dirname, '..', 'resources', 'apps', 'cli')
  const machO: string[] = []
  /** @param dir */
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(resolve(dir, entry.name))
        continue
      }
      if (entry.isSymbolicLink()) continue
      const path = resolve(dir, entry.name)
      const header = Buffer.alloc(4)
      const fd = openSync(path, 'r')
      try {
        readSync(fd, header, 0, 4, 0)
      } finally {
        closeSync(fd)
      }
      if (isMachO(header)) machO.push(path)
    }
  }
  walk(root)
  console.log(`dist: pre-signing ${machO.length} Mach-O files in the staged CLI tree`)
  for (const file of machO) {
    const result = spawnSync('codesign', ['--force', '--sign', identity, '--timestamp', '--options', 'runtime', file], { stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`dist: pre-signing failed on ${file} with exit ${result.status}`)
      process.exit(result.status ?? 1)
    }
  }
}

/**
 * Run electron-builder with the resolved overrides; propagates its exit code.
 * `--publish never` is fixed: CI detection would otherwise trigger an implicit
 * GitHub-Release publish the read-only workflow token cannot perform; release
 * publishing stays a deliberate later step.
 */
function main(): void {
  const config = resolveMacSigning(process.env)
  if (config.identity !== null) preSignCliTree(config.identity)
  const args = builderArgs(config)
  console.log('dist: electron-builder', args.join(' '), '--publish never')
  const result = spawnSync('pnpm', ['exec', 'electron-builder', ...args, '--publish', 'never'], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

// Entry guard: tests import `builderArgs` from this module and must not spawn.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}
