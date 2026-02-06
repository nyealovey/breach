# Tailwind Content 扫描范围约束

版本：v1.0  
日期：2026-02-06

## 背景

在 Next.js 16 + Turbopack 构建中，Tailwind 会根据 `content` 配置扫描候选 class token。  
如果把 `src/lib/**` 这类“非模板代码目录”也纳入扫描，正则字面量（例如 `/[-:.]/g`、`/[-:\\s]/g`）可能被误识别为 arbitrary utility，生成非法 CSS：

- `.[\\[-\\:\\.\\]] { -: .; }`
- `.[\\[-\\:\\\\s\\]] { -: \\s; }`

最终触发构建失败：`Parsing CSS source code failed`。

## 设计决策

- Tailwind `content` 仅扫描模板目录：
  - `src/app/**/*.{ts,tsx}`
  - `src/components/**/*.{ts,tsx}`
- 不扫描 `src/lib/**/*`。
- 对少量由 `src/lib` 运行时返回的 class token，使用 `safelist` 显式保留（当前为覆盖态边框色相关类）。

## 结果

- 避免正则字面量被误识别为 class 候选，消除非法 CSS 生成。
- 保持现有页面样式能力不变（项目中的 Tailwind class 主要位于 `app` 与 `components`）。
