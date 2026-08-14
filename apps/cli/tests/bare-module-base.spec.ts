import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBareModuleBase } from '../src/profile-boot.ts'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A temp install root with the given `node_modules` subdirectories created. */
function layout(...segments: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bare-base-'))
  dirs.push(root)
  for (const segment of segments) mkdirSync(join(root, segment), { recursive: true })
  return root
}

describe('resolveBareModuleBase', () => {
  it('anchors at the shared .pnpm hoist of a pnpm-deployed install', () => {
    const root = layout('node_modules/.pnpm/node_modules')
    expect(resolveBareModuleBase(root)).toBe(`${pathToFileURL(join(root, 'node_modules/.pnpm/node_modules')).href}/`)
  })

  it('falls back to the flat top-level node_modules of an npm install', () => {
    const root = layout('node_modules')
    expect(resolveBareModuleBase(root)).toBe(`${pathToFileURL(join(root, 'node_modules')).href}/`)
  })

  it('prefers the hoist when both layouts exist', () => {
    const root = layout('node_modules', 'node_modules/.pnpm/node_modules')
    expect(resolveBareModuleBase(root)).toBe(`${pathToFileURL(join(root, 'node_modules/.pnpm/node_modules')).href}/`)
  })

  it('keeps the default resolution for a checkout without an install tree', () => {
    expect(resolveBareModuleBase(layout())).toBeUndefined()
  })
})
