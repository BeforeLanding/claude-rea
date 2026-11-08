# 00 · 方法：环境、REA 用法与可复现步骤

## 1. 靶标

| 项 | 值 |
|----|----|
| 包 | `@anthropic-ai/claude-code-win32-x64@2.1.319`（`npm pack` 取得） |
| 文件 | `package/claude.exe`，344,807,072 字节 |
| SHA-256 | `2e055732c9d03d22700d9046251a8370b673607bfcc9e4d16a1b0e8fb1345cbd` |
| `--version` | `2.1.319 (Claude Code)` |
| 取得时 dist-tags | `latest: 2.1.319` / `next: 2.1.319` / `stable: 2.1.311` |

从 npm 上的情况看，`@anthropic-ai/claude-code` 主包现在只是个壳，真正的程序在 8 个平台的 optionalDependencies 里（`darwin-arm64/x64`、`linux-x64/arm64(+musl)`、`win32-x64/arm64`）。claude-re 用的是 VS Code 扩展里的 darwin-arm64 二进制；这里用的是 win32-x64，两者是同一套 Bun 嵌入架构。

## 2. 工具链

| 组件 | 版本 | 备注 |
|------|------|------|
| Node.js | 24.22.2（便携版，SHA 已对官方 SHASUMS256 校验） | REA 要求 `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1`，本机原有的 24.16 不够 |
| REA（npm 发布版） | `rea-agents@6.8.0`（2026-10-25） | 用于 JS 应用分析 |
| REA（源码构建） | main `72d5e72`（2026-11-08） | 用于 Bun standalone 解包，6.8.0 里还没有这个读取器 |

### 坑 1：Bun 读取器还没发版

6.8.0 对 `claude.exe` 的 `inspect-artifact` 只认出 `pe` 格式，`extract-artifact` 报 `Artifact format has no extraction reader: pe`。Bun standalone 读取器（`src/artifacts/BunStandaloneArtifactReader.ts`）是 2026-10-29 合进 main 的（PR #6998），要从源码构建：

```bash
git clone --depth 1 https://github.com/morluto/rea.git rea-src
cd rea-src && npm ci --ignore-scripts
# Windows：从 6.8.0 tarball 里拷回 native/windows/build/{manifest.json,rea-windows-x64.node}，否则 build 会静默跳过
npm run build:cached
node scripts/rea.mjs --version
```

### 坑 2：共享字节码撞上扩展预算

main 版能认出 Bun 图（`layout_revision: bun-1.3.9`，`carrier: pe-section`），但随即报错：

```text
Bun standalone readable entries declare 94764858061 plaintext bytes,
exceeding this graph's 94741612000-byte expansion budget.
```

原因见 [01 文档 §3](01-artifact-anatomy.md#3-共享字节码区)：Claude Code 的 3,128 个模块共用同一块约 108 MB 的字节码区，每个模块的 `bytecode` 指针都“从自己的起点一直指到区尾”。REA 把每条区间都按独立明文计入预算（约 3,128 × 30 MB ≈ 94.7 GB），刚好超过“payload × 500”的上限。

本仓库的处理是在本地构建里跳过 `bytecode` 区域（它是不透明的 JSC 字节码，REA 本来也不解码），只保留 `contents` / `sourcemap` / `module-info`。补丁见 [`evidence/rea-local-patch.diff`](../evidence/rea-local-patch.diff)：

```diff
       for (const region of REGIONS) {
         const range = regionRange(module, region);
         if (range === null) continue;
+        if (region === "bytecode") continue; // local patch
```

> 这是给 REA 上游提 issue 的好素材：对“同一物理区间被多个条目引用”的 Bun 图，按物理区间去重计费，就不会误判。

## 3. 分析步骤

```bash
REA="node /path/to/rea-src/scripts/rea.mjs"
T=claude.exe

# 1) 结构识别：Bun 图根元数据 + 模块清单（摘要视图，完整证据另存 bundle）
$REA inspect-artifact "$T" --detail summary --evidence_output inspect-artifact.bundle --format json

# 2) 解包：把每个模块的 contents 写到安全输出树（文件名是索引 bun-modules/<i>）
$REA extract-artifact "$T" --format json        # 约 2 分 15 秒

# 3) 索引 → 原名：用 scripts/bun-peek.mjs 读模块表（只读，不执行目标）
node scripts/bun-peek.mjs "$T" <.bun 节 rawptr> <.bun 节 vsize> 52 > bun-module-table.txt

# 4) 为 JS 静态分析准备副本：把 B:/~BUN/root/ 绝对导入改写成 ./，入口 cli → cli.js
# 5) REA 6.8.0 做应用级 JS 分析（2,887 个文件）
rea analyze-javascript-application ./app --detail summary --evidence_output js-app.bundle --max-heap-mb 6144

# 6) 定向检索：ripgrep/grep + scripts/tool-table.mjs
node scripts/tool-table.mjs ./named Bash Read Edit Glob Grep ...
```

`.bun` 节的 `rawptr` / `vsize` 可以从 PE 节表读出来，本例是 `155313152` / `189483232`（见 01 文档）。

### 关于第 5 步

- 用 main 构建（拷了 6.8.0 的 Windows 原生模块）跑 `analyze-javascript-application`，在 `source-transfer` 阶段报 `Unknown native filesystem operation (Win32 87)`，应该是原生模块和 main 的 JS 版本不匹配；换回 6.8.0 发布版就正常了。
- 2,887 个文件逐个解析，大 chunk（5.4 MB）单个就要几十秒，整体按小时计。本仓库的主要结论**不依赖**第 5 步，都来自第 2 步解包内容的定向检索，第 5 步只作补充。

## 4. 证据等级约定

| 记号 | 含义 |
|------|------|
| **观测** | 解包内容中逐字存在的标识符、字符串、结构，可用 grep 复现 |
| **REA** | REA 产出的结构化证据（evidence_id 可查） |
| **推断** | 根据观测拼出的行为解释；文中会明确写“推断” |

## 5. 不做什么

- 不执行除 `--version` / `--help` 以外的任何命令，不登录，不发网络请求。
- 不发布解包内容（源码、提示词、内置文档）。
- 不解码 JSC 字节码，不做原生层（JavaScriptCore / Bun 运行时本身）的分析。
