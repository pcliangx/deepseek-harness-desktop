import { spawn, type ChildProcess } from 'node:child_process'
import { parsePortFromOutput } from './port-handshake.ts'

/** Options for spawning the host child. */
export interface HostSpawnOptions {
  /** Executable that runs Node semantics — `process.execPath` in production (Electron binary). */
  execPath: string
  /** Absolute path to the built CLI bin (`apps/cli/lib/bin.js`). */
  cliBin: string
  /**
   * Extra host environment (e.g. `DEEPSEEK_API_KEY`, `DSH_HOME`); merged over the
   * parent env. Same-process typed config: callers must source values only from
   * trusted code or validated settings — never model/tool output. Validation
   * belongs at the boundary that produces these values. Merged before
   * `ELECTRON_RUN_AS_NODE`, which this layer pins and callers cannot unset.
   */
  env?: Record<string, string>
  /** Deadline for the port handshake. Defaults to 15 s. */
  startupMs?: number
  /** Injectable spawn for tests. */
  spawnFn?: typeof spawn
}

/** Handle to the supervised host child. */
export interface HostSupervisor {
  /** Resolves the bound port, or rejects on handshake timeout / early exit / spawn error. */
  readonly ready: Promise<number>
  /** Best-effort terminate the host child. */
  dispose(): Promise<void>
}

/**
 * Spawn the dsh web host with `--port 0` and resolve its OS-assigned port from the
 * readiness line. Runs the Electron binary as Node (`ELECTRON_RUN_AS_NODE=1`) so no
 * system Node is required. `--expose-internals` is required because the web profile
 * loads the cordis HMR plugin, which reads Node internals the loader only exposes
 * under that flag.
 */
export function startHost(opts: HostSpawnOptions): HostSupervisor {
  const startupMs = opts.startupMs ?? 15_000
  const child: ChildProcess = (opts.spawnFn ?? spawn)(
    opts.execPath,
    ['--expose-internals', opts.cliBin, 'web', '--port', '0'],
    {
      env: { ...process.env, ...opts.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )

  let settle: ((port: number) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  const ready = new Promise<number>((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  const timer = setTimeout(
    () => fail?.(new Error('host supervisor: port handshake timed out')),
    startupMs,
  )

  child.stdout?.on('data', (chunk: Buffer) => {
    const port = parsePortFromOutput(chunk.toString('utf8').trim())
    if (port !== undefined) {
      clearTimeout(timer)
      settle?.(port)
    }
  })
  child.on('error', (error: Error) => {
    clearTimeout(timer)
    fail?.(error)
  })
  child.on('exit', (code) => {
    clearTimeout(timer)
    fail?.(new Error(`host supervisor: host exited before handshake with code ${code}`))
  })

  return {
    ready,
    dispose: () => {
      clearTimeout(timer)
      child.kill('SIGTERM')
      return Promise.resolve()
    },
  }
}
