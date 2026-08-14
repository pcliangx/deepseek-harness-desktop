import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '../src/index.ts'
import { spawnSubprocess } from '../src/spawn.ts'
import type { SpawnInternals } from '../src/spawn.ts'

/** Records what Node would be asked to launch, without starting any process. */
interface CapturedLaunch {
  program?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
}

/**
 * Build internals whose spawn override captures the launch and returns an
 * inert child, so the Electron node probe is observable keylessly.
 * @param electron - the injected Electron-runtime probe value.
 */
function captureSpawn(electron: boolean): { captured: CapturedLaunch; internals: SpawnInternals } {
  const captured: CapturedLaunch = {}
  const spawnImpl = ((_program: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
    captured.program = _program
    captured.args = [..._args]
    captured.env = options.env
    return new EventEmitter() as unknown as ChildProcess
  }) as unknown as typeof spawn
  return { captured, internals: { electron, spawnImpl } }
}

/** One spawn spec against the captured launcher. */
function probeSpec(argv: readonly string[]): Parameters<typeof spawnSubprocess>[0] {
  return {
    argv,
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 1_000,
    env: {},
  }
}

describe('electron node probe (spawnSubprocess)', () => {
  it('remaps bare node to execPath under electron and sets ELECTRON_RUN_AS_NODE', () => {
    const { captured, internals } = captureSpawn(true)
    spawnSubprocess(probeSpec(['node', 'server.js']), internals)
    expect(captured.program).toBe(process.execPath)
    expect(captured.args).toEqual(['server.js'])
    expect(captured.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('remaps bare node.exe the same way', () => {
    const { captured, internals } = captureSpawn(true)
    spawnSubprocess(probeSpec(['node.exe', 'server.js']), internals)
    expect(captured.program).toBe(process.execPath)
    expect(captured.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('runs an explicit execPath argv[0] on the electron binary in Node mode', () => {
    const { captured, internals } = captureSpawn(true)
    spawnSubprocess(probeSpec([process.execPath, 'server.js']), internals)
    expect(captured.program).toBe(process.execPath)
    expect(captured.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('leaves bash argv untouched', () => {
    const { captured, internals } = captureSpawn(true)
    spawnSubprocess(probeSpec(['/bin/bash', '-c', 'echo hi']), internals)
    expect(captured.program).toBe('/bin/bash')
    expect(captured.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('leaves bare node untouched outside electron', () => {
    const { captured, internals } = captureSpawn(false)
    spawnSubprocess(probeSpec(['node', 'server.js']), internals)
    expect(captured.program).toBe('node')
    expect(captured.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('leaves an execPath argv[0] untouched outside electron', () => {
    const { captured, internals } = captureSpawn(false)
    spawnSubprocess(probeSpec([process.execPath, 'server.js']), internals)
    expect(captured.program).toBe(process.execPath)
    expect(captured.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
})

describe('electron node probe (resolveExecutable)', () => {
  /** Boot the real service with an injected electron probe, then dispose it. */
  async function withElectronService(run: (service: LocalSubprocessRuntime) => Promise<void>): Promise<void> {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const service = ctx.subprocess as LocalSubprocessRuntime
    service.internals.electron = true
    try {
      await run(service)
    } finally {
      await fiber.dispose()
    }
  }

  it('maps bare node names to the running executable under electron', async () => {
    await withElectronService(async (service) => {
      await expect(service.resolveExecutable('node')).resolves.toBe(process.execPath)
      await expect(service.resolveExecutable('node.exe')).resolves.toBe(process.execPath)
    })
  })

  it('resolves non-node executables normally under electron', async () => {
    await withElectronService(async (service) => {
      await expect(service.resolveExecutable(process.execPath)).resolves.toBe(process.execPath)
    })
  })
})
