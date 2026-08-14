/**
 * Dist entry: resolve signing inputs from the credential env and drive
 * electron-builder with them as `-c.mac.*` CLI overrides, so the YAML stays
 * static and unsigned while keyed env produces a signed, notarized build.
 * Runs under tsx (see the `dist` package script); `builderArgs` is the pure,
 * tested core.
 * @module @deepseek-ai/dsh-desktop/scripts/dist
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { isMachO } from '../src/macho.ts'
import { resolveMacSigning, type MacSigningConfig } from '../src/signing-config.ts'

/**
 * Run a security/codesign tool to completion, failing the dist on a non-zero
 * exit.
 * @param tool - the executable name.
 * @param args - its argv (may contain passphrases, as in electron-builder's
 * own import; this path runs on ephemeral CI runners).
 */
function run(tool: string, args: string[]): void {
  const result = spawnSync(tool, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`dist: ${tool} ${args.join(' ')} failed with exit ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

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
 * Make the resolved identity usable before electron-builder runs: the builder
 * imports CSC_LINK into its own keychain only inside its signing step, which
 * starts after the staged tree must already be pre-signed. A matching
 * identity already in the keychain (a developer machine) skips the import;
 * otherwise a throwaway keychain receives the p12 (a path or base64 payload)
 * with codesign access granted and is registered at the front of the user
 * search list.
 * @param env - the credential env (CSC_LINK, CSC_KEY_PASSWORD).
 * @returns the keychain cleanup, or undefined when no keychain was created.
 */
function importIdentity(env: NodeJS.ProcessEnv): (() => void) | undefined {
  const link = env.CSC_LINK ?? ''
  const password = env.CSC_KEY_PASSWORD ?? ''
  if (link === '' || password === '') throw new Error('dist: pre-signing requires CSC_LINK and CSC_KEY_PASSWORD')
  const known = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'])
  if (known.status === 0 && known.stdout.toString().includes('Developer ID Application')) {
    console.log('dist: a Developer ID Application identity is already in the keychain; skipping the import')
    return undefined
  }
  const keychainPassword = randomBytes(24).toString('hex')
  const keychain = `dsh-csc-${randomBytes(6).toString('hex')}.keychain-db`
  const dir = mkdtempSync(resolve(tmpdir(), 'dsh-csc-'))
  let p12 = link
  if (!existsSync(link)) {
    p12 = resolve(dir, 'cert.p12')
    writeFileSync(p12, Buffer.from(link, 'base64'))
  }
  run('security', ['create-keychain', '-p', keychainPassword, keychain])
  run('security', ['unlock-keychain', '-p', keychainPassword, keychain])
  run('security', ['set-keychain-settings', keychain])
  run('security', ['import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign'])
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-k', keychainPassword, '-T', '/usr/bin/codesign', keychain])
  const listed = spawnSync('security', ['list-keychains', '-d', 'user'])
  const previous = listed.status === 0
    ? listed.stdout.toString().split('\n').map(line => line.trim().replace(/^"|"$/g, '')).filter(line => line !== '')
    : []
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...previous])
  return () => {
    run('security', ['delete-keychain', keychain])
    rmSync(dir, { recursive: true, force: true })
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
  const disposeKeychain = config.identity !== null ? importIdentity(process.env) : undefined
  let status: number | null = 0
  try {
    if (config.identity !== null) preSignCliTree(config.identity)
    const args = builderArgs(config)
    console.log('dist: electron-builder', args.join(' '), '--publish never')
    const result = spawnSync('pnpm', ['exec', 'electron-builder', ...args, '--publish', 'never'], { stdio: 'inherit' })
    status = result.status
  } finally {
    disposeKeychain?.()
  }
  process.exit(status ?? 1)
}

// Entry guard: tests import `builderArgs` from this module and must not spawn.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}
