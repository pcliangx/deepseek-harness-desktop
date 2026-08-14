/**
 * Stage the dsh CLI runtime tree for electron-builder.
 *
 * The host the Electron main process spawns is the built `apps/cli` plus its
 * full production dependency closure (the cordis loader resolves plugin
 * packages by name and the web bundle requires `dsh-web-frontend/dist`, so a
 * bare `lib/` copy cannot boot). `pnpm deploy --prod --legacy` materializes
 * that closure under `resources/apps/cli`, which electron-builder then copies
 * verbatim into `Contents/Resources` (`cliBinPath` resolves
 * `<resources>/apps/cli/lib/bin.js`).
 *
 * The deploy tree is not self-contained as pnpm emits it: the workspace's
 * `link:` overrides (`@deepseek-ai/cosmokit`, `@deepseek-ai/schemastery`) and
 * the deploy root's self-reference leave symlinks pointing back into this
 * checkout. Each escaping package is materialized once under the deploy's
 * shared `.pnpm` hoist and every escaping link is re-pointed at that copy;
 * the final scan fails loudly if any escaping link survives.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const stageCli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'apps', 'cli')

/** Resolve a symlink to its absolute physical target. */
function resolveLink(link) {
  const target = readlinkSync(link)
  return isAbsolute(target) ? resolve(target) : resolve(dirname(link), target)
}

/** Every symlink under `node_modules` whose target escapes the deploy root. */
function escapingLinks(root) {
  const out = []
  /** @param {string} dir @param {number} depth */
  function walk(dir, depth) {
    if (depth > 8) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue
      const path = resolve(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const target = resolveLink(path)
        if (target !== root && !target.startsWith(root + '/')) out.push({ link: path, target })
      } else if (entry.isDirectory()) {
        walk(path, depth + 1)
      }
    }
  }
  walk(resolve(root, 'node_modules'), 0)
  return out
}

/**
 * Materialize one shared copy of an escaping package: copy it from this
 * checkout into the deploy's shared `.pnpm` hoist, dropping the workspace
 * symlink farm that came along (dependencies resolve by walking up into the
 * deploy's own hoist).
 */
function materializeShared(root, name, source) {
  const sharedDir = resolve(root, 'node_modules/.pnpm/node_modules/@deepseek-ai')
  const dest = resolve(sharedDir, name)
  rmSync(dest, { force: true, recursive: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(source, dest, { recursive: true })
  rmSync(resolve(dest, 'node_modules'), { force: true, recursive: true })
  return dest
}

/** The deploy root references itself by package name; satisfy it from the staged tree. */
function materializeDeployRoot(root) {
  const dest = resolve(root, 'node_modules/.pnpm/node_modules/@deepseek-ai/dsh')
  rmSync(dest, { force: true, recursive: true })
  mkdirSync(dest, { recursive: true })
  for (const item of ['lib', 'config', 'package.json']) {
    cpSync(resolve(root, item), resolve(dest, item), { recursive: true })
  }
  return dest
}

rmSync(resolve(stageCli, '..'), { recursive: true, force: true })
mkdirSync(resolve(stageCli, '..'), { recursive: true })

// `--legacy`: pnpm v10+ refuses deploy from non-injected workspaces otherwise;
// inject-workspace-packages would change install behavior for the whole repo.
// `verify-deps-before-run=false`: the deploy marks the workspace node_modules
// state for a purge; the auto-fix it triggers has no TTY here and would run a
// destructive production install. The resync below is the actual fix.
const deployed = spawnSync('pnpm', ['--config.verify-deps-before-run=false', '--filter', '@deepseek-ai/dsh', 'deploy', '--prod', '--legacy', stageCli], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (deployed.status !== 0) {
  console.error(`stage-resources: pnpm deploy failed with exit ${deployed.status}`)
  process.exit(deployed.status ?? 1)
}

const initial = escapingLinks(stageCli)
console.log(`stage-resources: ${initial.length} symlinks escape the staged tree`)

// Group by physical target so each distinct package is materialized once.
const byTarget = new Map()
for (const { link, target } of initial) {
  if (!byTarget.has(target)) byTarget.set(target, [])
  byTarget.get(target).push(link)
}
for (const [target, links] of byTarget) {
  const name = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8')).name
  const shared = name === '@deepseek-ai/dsh'
    ? materializeDeployRoot(stageCli)
    : materializeShared(stageCli, name.split('/')[1], target)
  for (const link of links) {
    if (resolve(link) === resolve(shared)) continue // the shared copy's own slot
    rmSync(link, { force: true, recursive: true })
    symlinkSync(relative(dirname(link), shared), link)
  }
}

// Misconfiguration fails loud: a staged tree that still reaches outside itself
// would break on any machine without this checkout.
const remaining = escapingLinks(stageCli)
if (remaining.length > 0) {
  for (const { link, target } of remaining) console.error(`stage-resources: escaping symlink remains: ${link} -> ${target}`)
  process.exit(1)
}

// The deploy's internal install leaves the workspace node_modules state
// flagged for purge; a plain install from the warm store restores it so the
// next pnpm command in this checkout does not fail.
const resynced = spawnSync('pnpm', ['--config.verify-deps-before-run=false', 'install'], { cwd: repoRoot, stdio: 'inherit' })
if (resynced.status !== 0) {
  console.error(`stage-resources: workspace resync failed with exit ${resynced.status}`)
  process.exit(resynced.status ?? 1)
}

console.log(`stage-resources: staged self-contained CLI tree at ${relative(repoRoot, stageCli)}`)
