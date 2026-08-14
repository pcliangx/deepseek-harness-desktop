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
 * the final scan fails loudly if any escaping link survives. The deploy also
 * sprays a mirror of the deploy-root path into the vendored `link:` packages
 * (regenerated on every run); it is removed from the checkout before
 * materialization so its relative links are not copied into the staged tree
 * as absolute links.
 *
 * After materialization the staged tree is pruned of non-runtime files
 * (declarations, source maps, foreign-platform binaries, test trees, project
 * meta docs), keeping whitelisted runtime/legal assets (`SKILL.md`,
 * `LICENSE*`); a suspiciously small deletion count fails loud as an upstream
 * layout mutation rather than shipping an unpruned-looking tree.
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

/**
 * Every symlink under `node_modules` whose target escapes the deploy root.
 * Walked without a depth cap: entries come from readdir withFileTypes, so a
 * symlink's isDirectory() is false and links are never followed — no cycle
 * risk. A depth cap here once let absolute links buried deep in
 * `.pnpm/.../schemastery/apps/` slip past both this scan and the fail-loud
 * final scan and reach the signed bundle.
 */
function escapingLinks(root) {
  const out = []
  /** @param {string} dir */
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue
      const path = resolve(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const target = resolveLink(path)
        if (target !== root && !target.startsWith(root + '/')) out.push({ link: path, target })
      } else if (entry.isDirectory()) {
        walk(path)
      }
    }
  }
  walk(resolve(root, 'node_modules'))
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

// `pnpm deploy --legacy` writes the repo-relative deploy-root path itself
// into the vendored `link:` packages it hoists from (observed:
// vendor/schemastery/apps/desktop/resources/apps/cli/node_modules/@deepseek-ai/cosmokit
// -> ../../../../../../../../cosmokit): pnpm lays the deploy target's
// node_modules out relative to the vendored package instead of the deploy
// root, and regenerates the mirror on every deploy. The materialization below
// copies vendored packages wholesale and fs.cpSync's default
// verbatimSymlinks=false rewrites such relative links absolute, so without
// this cleanup each deploy recreates an escaping link inside the staged
// shared copy. Only the exact mirror path is removed, plus mirror-chain
// ancestors it left empty; any other content under a vendored package stays.
function rmDeployMirror(pkgDir) {
  const mirror = resolve(pkgDir, relative(repoRoot, stageCli))
  rmSync(mirror, { recursive: true, force: true })
  for (let dir = dirname(mirror); dir !== pkgDir; dir = dirname(dir)) {
    let entries
    try { entries = readdirSync(dir) } catch { continue } // a missing ancestor has nothing to prune
    if (entries.length > 0) break
    rmSync(dir, { recursive: true, force: true })
  }
}
for (const entry of readdirSync(resolve(repoRoot, 'vendor'), { withFileTypes: true })) {
  if (entry.isDirectory()) rmDeployMirror(resolve(repoRoot, 'vendor', entry.name))
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

// Non-runtime files dominate the staged tree (declarations, source maps,
// foreign-platform binaries, test trees, project meta docs) and push signing
// time and .app size past usable limits. Prune them from the staged tree only;
// this checkout is never touched.
const PRUNE_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts', '.ts', '.mts', '.map', '.pdb', '.exe', '.dll', '.so']
const PRUNE_DIRS = new Set(['tests', 'test', '__tests__'])
const PRUNE_PREFIXES = ['readme', 'changelog', 'history', 'contributing', 'authors', 'security']
/** Below this many deletions the upstream dependency layout has likely mutated. */
const MIN_PRUNED_FILES = 15_000

/** Runtime/legal assets no delete rule may ever hit. */
function isWhitelisted(name) {
  return name === 'SKILL.md' || /^license/i.test(name)
}

/** The delete rule matching `name` (also the prune-count category), or null. */
function deleteRule(name) {
  if (PRUNE_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'extension'
  const lower = name.toLowerCase()
  if (PRUNE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return 'name prefix'
  if (/\.spec\./.test(name) || /\.test\./.test(name)) return 'spec/test'
  return null
}

/**
 * Prune the staged CLI tree in place. Symlinks are matched by name only and
 * never followed: every physical file lives under a real directory (the pnpm
 * virtual store), so following links would only double-walk the same files.
 */
function pruneStagedTree(root) {
  if (resolve(root) !== resolve(stageCli)) {
    throw new Error(`stage-resources: prune refuses to walk anything but the staged tree (${root})`)
  }
  // Fail loud on rule drift: the canonical whitelist shapes must stay both
  // recognized and unmatched by every delete rule.
  for (const asset of ['SKILL.md', 'LICENSE', 'LICENSE-MIT', 'license.txt']) {
    if (!isWhitelisted(asset) || deleteRule(asset) !== null) {
      throw new Error(`stage-resources: prune rules endanger whitelisted asset ${asset}`)
    }
  }
  const counts = { extension: 0, 'name prefix': 0, 'spec/test': 0, directory: 0 }
  /** @param {string} dir */
  function countFiles(dir) {
    let n = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue
      const path = resolve(dir, entry.name)
      n += entry.isDirectory() ? countFiles(path) : 1
    }
    return n
  }
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue
      const path = resolve(dir, entry.name)
      if (!entry.isDirectory()) {
        // Files and symlinks alike: a stray link named like a prunable file is
        // removed with its name; its physical target is handled at its real path.
        if (isWhitelisted(entry.name)) {
          const rule = deleteRule(entry.name)
          if (rule !== null) throw new Error(`stage-resources: prune rule "${rule}" hit whitelisted ${path}`)
          continue
        }
        const rule = deleteRule(entry.name)
        if (rule !== null) {
          counts[rule]++
          rmSync(path, { force: true })
        }
        continue
      }
      if (PRUNE_DIRS.has(entry.name)) {
        counts.directory += countFiles(path)
        rmSync(path, { recursive: true, force: true })
        continue
      }
      walk(path)
    }
  }
  walk(root)
  const total = counts.extension + counts['name prefix'] + counts['spec/test'] + counts.directory
  console.log(`stage-resources: pruned ${total} files (extensions ${counts.extension}, name prefixes ${counts['name prefix']}, spec/test ${counts['spec/test']}, whole test directories ${counts.directory})`)
  if (total < MIN_PRUNED_FILES) {
    console.error(`stage-resources: only ${total} files pruned, below the ${MIN_PRUNED_FILES} floor — the upstream dependency layout likely changed; refusing to pass silently`)
    process.exit(1)
  }
}

pruneStagedTree(stageCli)

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
