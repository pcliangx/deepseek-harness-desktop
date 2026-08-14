# Agent Note: 桌面应用是包裹 web 宿主子进程的 Electron 外壳

Status: implemented

[English](2026-08-14-electron-desktop-shell.md) | 中文

## Problem

harness 此前没有桌面发行形态。`dsh web` 启动一个 Node 宿主(profile 为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`),在 OS 分配的环回端口上服务 SPA,但要用上它需要终端、仓库检出和匹配的 Node 安装。web GUI 与宿主之间 already 通过环回上的 HTTP 加两条 server→browser WebSocket 通信,因此做一个一键安装 macOS 应用要回答的问题是:构建哪种载体、打包后的应用如何为宿主以及 harness 经 subprocess seam 派生的 Node 孙进程(LSP server、ACP subagent)提供 Node 运行时、以及如何把 pnpm workspace 闭包变成自包含的 `.app`。

## Decision

桌面应用是 `apps/desktop`,一个原样复用 web 栈的 Electron 外壳:Electron 主进程把构建出的 `apps/cli` 作为子进程拉起(`bin.js web --port 0`),通过 `ELECTRON_RUN_AS_NODE=1` 跑在 Electron 二进制自身上,从 readiness 行解析出绑定端口,再把 `BrowserWindow` 指向 `http://127.0.0.1:<port>`。不改载体协议;SPA、宿主 API、WebSocket 全部不动。宿主监督是一个 `startHost()` 句柄,其 `ready` promise 决议端口,`dispose()` 在退出时终止子进程。

Node 运行时的问题在 subprocess seam 一次性解决,而非按调用方各自处理:在 Electron 下,`subprocess-local` 在 `resolveExecutable` 里把 `node`/`node.exe` 命令映射到 `process.execPath`,`spawnSubprocess` 把为 `node`、`node.exe` 或 `process.execPath` 的 argv[0] 重写为 Electron 二进制并钉住 `ELECTRON_RUN_AS_NODE=1`。因此所有 Node 孙进程都跑在打包自带的二进制上,无需系统 Node——包括 `subagent-acp`,其 fixture 以 `process.execPath` 作为 command 传入。

打包用 `pnpm --filter @deepseek-ai/dsh deploy --prod --legacy` 把 CLI 运行时暂存到 `resources/apps/cli`(裸 `lib/` 拷贝无法启动:cordis loader 按包名解析插件,web bundle 经 `require.resolve` 触达 `dsh-web-frontend/dist`)。deploy 树按 pnpm 的产出并不自包含——workspace 的 `link:` override(`@deepseek-ai/cosmokit`、`@deepseek-ai/schemastery`)与 deploy 根的自引用留下指回检出目录的 symlink——因此 `stage-resources.mjs` 把每个逃逸包一次性物化到 deploy 的共享 `.pnpm` hoist 下,把链接重指树内,任何逃逸链接存活即构建失败。electron-builder 只把 `lib/main` 放进 asar,暂存树原样拷进 `Contents/Resources`,与 `cliBinPath` 的 `<resources>/apps/cli/lib/bin.js` 对齐。

三个 manifest 与运行时缺口浮现后都在根因处修复:`apps/cli` 的 manifest 缺 profile 组合在运行时 import 的十九个 workspace peer(被 dev 安装的 hoisting 掩盖,deploy 剪掉 peer 时暴露),现已显式声明,与 `python/sdk-runtime` 的 deploy 闭包同构;Electron 钉在 41.3.0,因为 Electron 34 内嵌 Node 20.18,缺 `session-persistence-jsonl` 模块加载即 import 的 `node:zlib` zstd 导出——repo 的 engines 区间(`^22.19 || >=24`)本就排除了那个 Node;宿主 supervisor 传 `--expose-internals`,因为 web profile 的 cordis HMR 插件 loader 需要暴露 Node internals,否则宿主打完 readiness 行即在插件初始化中崩溃。

## Alternatives considered

- **专用 IPC 载体**(file:// 渲染层加取代 HTTP/WebSocket 的 Electron IPC 桥):v1 拒绝——它重写客户端连接栈与宿主传输假设,而环回 HTTP 已可用且无用户可见收益;若将来需要载体,webserver 文档中的 file:// seat 仍在。
- **Cordis 跑进 Electron 主进程**:拒绝——它把应用生命周期与 harness 生命周期耦合,在约束不同的进程里重新进入 "everything is a plugin" 运行时;子进程方案让宿主恰好就是已发行的 `dsh web`。
- **用 tsdown 打包 CLI 树替代 `pnpm deploy`**:经 spike 拒绝——loader 的按名包解析与 frontend-dist 的 `require.resolve` 都需要真实的 `node_modules` 树。

## Consequences

- 没有 Node 安装的 mac 能跑完整 harness:宿主、LSP server、ACP subagent 全部执行在 Electron 二进制上。代价是体积:arm64 `.app` 为 618 MB(dmg 168 MB),主要是 CLI 依赖闭包。
- 目前只出 arm64。universal 化是 fast-follow,两个已知阻塞:`@electron/universal` 2.0.3 在标准的 `v8_context_snapshot` 成对文件上误报 mach-O 计数不匹配;CLI 树的原生 prebuild(node-pty、koffi、sharp)是 arm64-only,需要按 arch 选择或双份。
- 签名与公证已在 CI 运行(`desktop-release.yml`):Developer ID Application 加 hardened runtime 与两条 canonical Electron entitlement,五个 repo secrets 齐全时 notarize 并 staple;无 secrets 的运行仍产出 Plan-1 的无签名产物,对内部静态源的 electron-updater 仍在后续。
- Electron 的 postinstall 解压在本沙箱可能静默只产出 `LICENSE`(下载本身完整);遇到同样怪癖的 fresh clone 需手工补全缓存,直到 `stage-resources` 落地自愈。
- 桌面套件覆盖纯函数部分(端口握手、supervisor argv、路径解析);组装级证明是无 key smoke——用 playwright 的 `_electron` 拉起打包后的应用并断言窗口抵达 `127.0.0.1`。dev 模式的 `cliBinPath` 分支在两者覆盖之外(smoke 走 packaged 分支),由评审钉住:从 `lib/main` 起四跳而非三跳——首次提交的误计数拼出了 `apps/apps/cli/...`。
