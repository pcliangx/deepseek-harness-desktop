import { test } from 'vitest'
import assert from 'node:assert/strict'
import { parsePortFromOutput } from '../src/main/port-handshake.ts'

test('parses the loopback url line', () => {
  assert.equal(parsePortFromOutput('dsh web: http://127.0.0.1:3080'), 3080)
})

test('parses with the optional LAN suffix', () => {
  assert.equal(parsePortFromOutput('dsh web: http://127.0.0.1:54321 (LAN: http://192.168.1.5:54321)'), 54321)
})

test('returns undefined for an unrelated line', () => {
  assert.equal(parsePortFromOutput('some other stdout line'), undefined)
})

test('returns undefined for a non-loopback host', () => {
  assert.equal(parsePortFromOutput('dsh web: http://0.0.0.0:3080'), undefined)
})

test('returns undefined for a non-numeric port', () => {
  assert.equal(parsePortFromOutput('dsh web: http://127.0.0.1:notaport'), undefined)
})
