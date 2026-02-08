# Next.js 构建默认使用 webpack（Turbopack 作为可选）

## 背景

在 Next.js 16 中，`next build` 默认使用 Turbopack。在部分受限环境下，Turbopack 可能在构建阶段失败（例如出现 `TurbopackInternalError: creating new process`，并伴随 `binding to a port` / `Operation not permitted`）。

为保证 `bun run build` 作为稳定入口可用，本仓库将 **生产构建默认切换为 webpack**，并保留 Turbopack 构建与 bundle 分析作为可选命令。

## 命令约定

- 默认构建（稳定）：`bun run build`
  - 等价于：`next build --webpack`
- Turbopack 构建（可选）：`bun run build:turbo`
  - 等价于：`next build --turbo`
- Bundle 分析（可选，输出模式）：`bun run build:analyze`
  - 等价于：`next experimental-analyze --output`
  - 说明：`experimental-analyze` 仅兼容 Turbopack；`--output` 只写入分析文件并退出（不会启动交互式服务端口）。

## 交互式分析（按需）

如需交互式 UI（会启动一个本地服务端口），可手工运行：

```bash
next experimental-analyze
```

若环境限制导致 Turbopack 无法运行，请优先使用输出模式（`bun run build:analyze`）或直接跳过分析。
