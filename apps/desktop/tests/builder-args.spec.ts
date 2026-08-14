import { test } from 'vitest'
import assert from 'node:assert/strict'
import { builderArgs } from '../scripts/dist.impl.ts'

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
