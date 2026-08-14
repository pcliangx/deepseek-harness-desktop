import { test } from 'vitest'
import assert from 'node:assert/strict'
import { builderArgs } from '../scripts/dist.impl.ts'
import { isMachO } from '../src/macho.ts'

test('keyless config passes an explicit null identity', () => {
  assert.deepEqual(builderArgs({ identity: null, notarize: false, hardenedRuntime: false, entitlements: null }),
    ['-c.mac.identity=null'])
})

test('signed config passes the four mac overrides', () => {
  const args = builderArgs({ identity: 'Developer ID Application', notarize: true, hardenedRuntime: true, entitlements: 'build/entitlements.mac.plist' })
  assert.ok(args.includes('-c.mac.identity=Developer ID Application'))
  assert.ok(args.includes('-c.mac.notarize=true'))
  assert.ok(args.includes('-c.mac.hardenedRuntime=true'))
  assert.ok(args.includes('-c.mac.entitlements=build/entitlements.mac.plist'))
})

test('detects each mach-o magic in both byte orders', () => {
  for (const magic of [0xfeedfacf, 0xfeedface, 0xcafebabe]) {
    const be = Buffer.alloc(4)
    be.writeUInt32BE(magic, 0)
    const le = Buffer.alloc(4)
    le.writeUInt32LE(magic, 0)
    assert.equal(isMachO(be), true, `0x${magic.toString(16)} big-endian`)
    assert.equal(isMachO(le), true, `0x${magic.toString(16)} little-endian`)
  }
})

test('rejects non-mach-o and short headers', () => {
  assert.equal(isMachO(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), false) // ELF
  assert.equal(isMachO(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), false) // PE
  assert.equal(isMachO(Buffer.from([0x1f, 0x8b, 0x08, 0x00])), false) // gzip
  assert.equal(isMachO(Buffer.alloc(3)), false)
})
