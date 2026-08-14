import { test } from 'vitest'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { startHost } from '../src/main/host-supervisor.ts'

type SpawnFn = typeof import('node:child_process')['spawn']

/** A minimal spawn stand-in that emits one stdout line then stays alive. */
function fakeSpawn(emit: string): SpawnFn {
  return (() => {
    const child = new EventEmitter() as unknown as ChildProcess
    child.stdout = new EventEmitter() as unknown as Readable
    child.kill = () => true
    queueMicrotask(() => child.stdout?.emit('data', Buffer.from(emit)))
    return child
  }) as unknown as SpawnFn
}

test('resolves the bound port from the readiness line', async () => {
  const host = startHost({
    execPath: '/usr/local/bin/node',
    cliBin: '/repo/apps/cli/lib/bin.js',
    spawnFn: fakeSpawn('dsh web: http://127.0.0.1:4123'),
  })
  assert.equal(await host.ready, 4123)
  await host.dispose()
})

test('rejects on handshake timeout', async () => {
  const host = startHost({
    execPath: '/usr/local/bin/node',
    cliBin: '/repo/apps/cli/lib/bin.js',
    startupMs: 10,
    spawnFn: fakeSpawn('not ready yet'),
  })
  await assert.rejects(host.ready, /handshake timed out/)
  await host.dispose()
})

test('rejects when the host exits before handshake', async () => {
  const childHolder: { child?: ChildProcess } = {}
  const spawnFn = (() => {
    const child = new EventEmitter() as unknown as ChildProcess
    child.stdout = new EventEmitter() as unknown as Readable
    child.kill = () => true
    childHolder.child = child
    return child
  }) as unknown as SpawnFn
  const host = startHost({ execPath: 'n', cliBin: 'b', spawnFn })
  childHolder.child?.emit('exit', 1)
  await assert.rejects(host.ready, /exited before handshake/)
  await host.dispose()
})

test('dispose terminates the child', async () => {
  let killed = false
  const spawnFn = (() => {
    const child = new EventEmitter() as unknown as ChildProcess
    child.stdout = new EventEmitter() as unknown as Readable
    child.kill = () => { killed = true; return true }
    return child
  }) as unknown as SpawnFn
  const host = startHost({ execPath: 'n', cliBin: 'b', spawnFn })
  await host.dispose()
  assert.equal(killed, true)
})
