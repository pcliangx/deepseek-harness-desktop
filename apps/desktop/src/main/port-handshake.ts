/**
 * Pure parser for the host's readiness line, printed by
 * `packages/bundle/web-app/src/index.ts` as
 * `dsh web: http://127.0.0.1:<port>` (optionally followed by a LAN suffix).
 * The desktop supervisor scans stdout for this line to recover the OS-assigned
 * port (`--port 0`).
 * @param line - one stdout line from the host child.
 * @returns the bound port, or `undefined` when the line is not the readiness signal.
 */
const READY_LINE = /^dsh web: http:\/\/127\.0\.0\.1:(\d+)/

export function parsePortFromOutput(line: string): number | undefined {
  const match = READY_LINE.exec(line)
  return match && match[1] !== undefined ? Number(match[1]) : undefined
}
