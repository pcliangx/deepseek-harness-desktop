import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resolveMacSigning } from '../src/signing-config.ts'

const CERT = { CSC_LINK: 'base64-p12', CSC_KEY_PASSWORD: 'p12-pass' }
const NOTARY = { APPLE_ID: 'dev@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh', APPLE_TEAM_ID: 'WXYZ012345' }

test('keyless env keeps the Plan-1 unsigned build', () => {
  assert.deepEqual(resolveMacSigning({}), { identity: null, notarize: false, hardenedRuntime: false, entitlements: null })
})

test('certificate pair signs without notarization', () => {
  assert.deepEqual(resolveMacSigning({ ...CERT }), { identity: 'Developer ID Application', notarize: false, hardenedRuntime: true, entitlements: 'build/entitlements.mac.plist' })
})

test('full credential set signs and notarizes', () => {
  assert.equal(resolveMacSigning({ ...CERT, ...NOTARY }).notarize, true)
})

test('certificate without its password fails loud', () => {
  assert.throws(() => resolveMacSigning({ CSC_LINK: 'base64-p12' }), /CSC_KEY_PASSWORD/)
})

test('partial notarization identity fails loud naming the missing vars', () => {
  const partial = { ...CERT, APPLE_ID: NOTARY.APPLE_ID, APPLE_TEAM_ID: NOTARY.APPLE_TEAM_ID }
  assert.throws(() => resolveMacSigning(partial), /APPLE_APP_SPECIFIC_PASSWORD/)
})
