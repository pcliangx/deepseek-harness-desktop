# Agent Note: The desktop app is an Electron shell over the spawned web host

Status: implemented

English | [中文](2026-08-14-electron-desktop-shell.zh.md)

## Problem

The harness had no desktop distribution. `dsh web` boots a Node host (profile `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`) that serves the SPA from an OS-assigned loopback port, but reaching it requires a terminal, a checkout, and a matching Node install. The web GUI and host already speak HTTP plus two server-to-browser WebSockets over loopback, so the open questions for a one-click macOS app were which carrier to build, how the bundled app provides a Node runtime for the host and for the Node grandchildren the harness spawns through the subprocess seam (LSP servers, ACP subagents), and how a pnpm workspace closure becomes a self-contained `.app`.

## Decision

The desktop app is `apps/desktop`, an Electron shell that reuses the web stack unmodified: the Electron main process spawns the built `apps/cli` as a child (`bin.js web --port 0`) running on the Electron binary itself via `ELECTRON_RUN_AS_NODE=1`, parses the readiness line for the bound port, and points a `BrowserWindow` at `http://127.0.0.1:<port>`. No carrier protocol changes; the SPA, host API, and WebSockets are untouched. Host supervision is a `startHost()` handle whose `ready` promise resolves the port and whose `dispose()` terminates the child on quit.

The Node-runtime question is solved once, in the subprocess seam, rather than per caller: under Electron, `subprocess-local` maps a `node`/`node.exe` command to `process.execPath` in `resolveExecutable`, and `spawnSubprocess` rewrites an argv[0] of `node`, `node.exe`, or `process.execPath` to the Electron binary while pinning `ELECTRON_RUN_AS_NODE=1`. Every Node grandchild therefore runs on the bundled binary with no system Node, including `subagent-acp`, whose fixture passes `process.execPath` as the command.

Packaging stages the CLI runtime with `pnpm --filter @deepseek-ai/dsh deploy --prod --legacy` into `resources/apps/cli` (a bare `lib/` copy cannot boot: the cordis loader resolves plugin packages by name and the web bundle reaches `dsh-web-frontend/dist` through `require.resolve`). The deploy tree is not self-contained as pnpm emits it — the workspace `link:` overrides (`@deepseek-ai/cosmokit`, `@deepseek-ai/schemastery`) and the deploy root's self-reference leave symlinks pointing back into the checkout — so `stage-resources.mjs` materializes each escaping package once under the deploy's shared `.pnpm` hoist, repoints the links in-tree, and fails the build if any escaping link survives. electron-builder puts only `lib/main` in the asar and copies the staged tree verbatim into `Contents/Resources`, matching `cliBinPath`'s `<resources>/apps/cli/lib/bin.js`.

Three manifest and runtime gaps surfaced and were fixed at their roots: `apps/cli`'s manifest lacked the nineteen workspace peers the profile composition imports at runtime (masked by dev-install hoisting, exposed when the deploy pruned peers) and now declares them explicitly, mirroring `python/sdk-runtime`'s deploy closure; Electron is pinned to 41.3.0 because Electron 34 embeds Node 20.18, which lacks the `node:zlib` zstd exports `session-persistence-jsonl` imports at module load — the repo engines range (`^22.19 || >=24`) already excluded that Node; and the host supervisor passes `--expose-internals` because the web profile's cordis HMR plugin loader needs Node internals exposed or the host prints its readiness line and then crashes during plugin init.

## Alternatives considered

- **A dedicated IPC carrier** (file:// renderer plus an Electron IPC bridge replacing HTTP/WebSockets): rejected for v1 — it rewrites the client connection stack and the host's transport assumptions for no user-visible gain while loopback HTTP already works; the webserver's documented file:// seat remains available if a carrier is ever needed.
- **Cordis in the Electron main process**: rejected — it couples app lifecycle to harness lifecycle and re-enters the "everything is a plugin" runtime in a process with different constraints, while the subprocess approach keeps the host exactly the shipped `dsh web`.
- **A tsdown bundle of the CLI tree instead of `pnpm deploy`**: rejected by spike — the loader's by-name package resolution and the frontend-dist `require.resolve` both need a real `node_modules` tree.

## Consequences

- A mac with no Node install runs the full harness: the host, LSP servers, and ACP subagents all execute on the Electron binary. The trade is size: the arm64 `.app` is 618 MB (dmg 168 MB), dominated by the CLI dependency closure.
- Only arm64 ships so far. Making a universal binary is a fast-follow with two known blockers: `@electron/universal` 2.0.3 falsely reports a mach-O count mismatch on the standard `v8_context_snapshot` pair, and the CLI tree's native prebuilds (node-pty, koffi, sharp) are arm64-only and need per-arch selection or duplication.
- The build is unsigned (`identity: null`); signing, hardened-runtime entitlements, and notarization are the planned next phase, with electron-updater against an internal static source after that.
- Electron's postinstall unzip can silently produce only `LICENSE` in this sandbox (the download itself is complete); fresh clones hitting the same quirk complete the cache by hand until a self-heal lands in `stage-resources`.
- The desktop suite covers the pure pieces (port handshake, supervisor argv, path resolution); the assembled proof is the keyless smoke that launches the packaged app through playwright's `_electron` and asserts the window reaches `127.0.0.1`. The dev-mode `cliBinPath` branch is outside both (the smoke exercises the packaged branch) and is pinned by review: four path hops from `lib/main`, not three — the miscount that shipped first and joined to `apps/apps/cli/...`.
