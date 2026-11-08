# claude-rea

**用 [REA](https://github.com/morluto/rea) 把 Claude Code 2.1.319 的二进制完整解包，读懂它的 agent harness 是怎么搭起来的。**

一份中文学习笔记：工具系统、主循环、上下文压缩、权限与 Hook、MCP、遥测，以及一次 11 天的版本差分。

| | |
|---|---|
| **靶标** | Anthropic 官方 `claude` **2.1.319**（npm `latest`，win32-x64 原生构建，2026-11-08 取得） |
| **工具** | [morluto/rea](https://github.com/morluto/rea)（Reverse Engineer Anything），main 分支 `72d5e72` + 一行本地补丁 |
| **参照** | [lvy010/claude-re](https://github.com/lvy010/claude-re)，对 2.1.301 darwin-arm64 做的字符串级逆向 |
| **对比版本** | stable 2.1.311 → latest 2.1.319 |

## 为什么还要再做一遍

Claude Code 是 Bun 编译的单文件可执行程序，业务逻辑以 JS 的形式嵌在 `.bun` 段里。用原生反汇编的视角去看，只能看到字符串，函数交叉引用为 0，claude-re 就停在这一层。

本仓库多走了一步：用 REA 的 Bun standalone 读取器**把模块图完整解包**（3,128 个模块，61 MB），再在解包出的 JS 上做静态分析。所以下面的结论写的都是“二进制里看到了什么”。少数推断会明确标出“推断”。

## 数字一览

| 项目 | 数量 | 项目 | 数量 |
|---|---:|---|---:|
| 模块（其中 JS chunk） | 3,128（2,878） | Hook 事件 | 33 |
| 内置工具 | 40+ | 权限模式 | 6 |
| 旁路查询来源（`querySource`） | 34 | `tengu_*` 遥测事件 | 3,601 |
| 环境变量名 | 1,243 | 日期型 API beta 标识 | 54 |
| MCP `_meta["anthropic/*"]` 键 | 42 | 共享 JSC 字节码区 | ≈108 MB |

## 怎么读

按你关心的问题挑起点：

- **想知道一个编码 agent 是怎么运转的** → [02 工具系统](docs/02-tool-system.md) → [03 主循环与上下文](docs/03-agent-loop-and-context.md) → [04 权限与 Hook](docs/04-permissions-hooks-settings.md)
- **想自己动手复现** → [00 方法](docs/00-method.md) → [01 产物解剖](docs/01-artifact-anatomy.md) → [`scripts/`](scripts/)
- **只关心最近改了什么** → [08 版本差分](docs/08-version-diff-2.1.311-to-2.1.319.md)
- **想先有个整体印象** → 直接看下面的[一页结论](#一页结论)

### 全部文档

| # | 文档 | 讲什么 |
|:-:|---|---|
| 00 | [方法：环境、REA 用法与复现](docs/00-method.md) | REA 怎么用；踩到的两个坑（Bun 读取器尚未发版、共享字节码撞扩展预算）；复现步骤 |
| 01 | [产物解剖：PE + Bun 模块图](docs/01-artifact-anatomy.md) | PE 节表、`.bun` 段的二进制格式、3,128 个模块的构成、内嵌资源 |
| 02 | [工具系统](docs/02-tool-system.md) | Tool 对象的两层结构与字段、40+ 内置工具属性表、延迟加载与 ToolSearch、并发 |
| 03 | [主循环、流式工具执行与上下文管理](docs/03-agent-loop-and-context.md) | 主循环状态机、流式工具执行器、`tool_use` / `tool_result` 配对修复、压缩体系、旁路查询 |
| 04 | [权限、Hook 与设置层级](docs/04-permissions-hooks-settings.md) | 6 种权限模式、33 个 Hook 事件、5 种 Hook 类型、设置来源的优先级 |
| 05 | [MCP、子代理、Skill、插件与 Workflow](docs/05-mcp-agents-skills-plugins.md) | MCP 传输与命名、内置子代理、内置 Skill、插件、Workflow 与 REPL 工具 |
| 06 | [环境变量、遥测、API Beta 与 CLI](docs/06-config-telemetry-betas.md) | 环境变量、`tengu_*` 遥测事件、API beta 头、CLI 子命令 |
| 07 | [与 claude-re 的对比、边界与未做事项](docs/07-vs-claude-re.md) | 两种方法的差别、交叉核对、对 REA 的评价、本仓库没做的事 |
| 08 | [版本差分：2.1.311 → 2.1.319](docs/08-version-diff-2.1.311-to-2.1.319.md) | Bun 运行时升级、REPL / Code Mode、7 个 Artifact Skill 下线、特性开关轮换 |

## 一页结论

### 二进制长什么样

1. **一个 345 MB 的 Bun 可执行文件。** `.bun` 节占 189 MB，采用 Bun 1.3.9 起的 52 字节模块记录布局，里面有 2,878 个 JS chunk、入口 `cli`、7 个独立 JS/MJS、138 个 zstd 压缩文档、73 个 Markdown、字体和一个原生插件 `audio-capture.node`。→ [01](docs/01-artifact-anatomy.md)
2. **源码和字节码都在。** 每个 JS 模块既有压缩混淆过的源码，也有 JSC 字节码。所有模块的字节码指针都指向同一块约 108 MB 的共享区，起点各不相同、终点相同。这让 REA 把扩展量误算成 94.7 GB，需要打一行补丁跳过。→ [00](docs/00-method.md)

### Agent 是怎么跑起来的

3. **工具是“胖对象”。** 除了 `name` / `inputSchema` / `call`，每个工具还带二十多个只给 harness 用的字段（`searchHint`、`maxResultSizeChars`、`isConcurrencySafe`、`shouldDefer`、`backgrounding`、`toAutoClassifierInput`、`preparePermissionMatcher`…）。权限、并发、延迟加载、远程执行、自动模式分类都挂在工具对象上。→ [02](docs/02-tool-system.md)
4. **边流式输出边执行工具。** 响应里每出现一个 `tool_use` 块就立刻开始执行，不等整条消息结束，默认最多 10 个并发（`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`）。一次尝试失败时，已产出的消息会被标成 `tombstone` 撤回。→ [03](docs/03-agent-loop-and-context.md)
5. **配对修复是一道安全阀。** `ensureToolResultPairing` 在严格模式下直接抛错，非严格模式下才补齐缺失的 `tool_result` 并上报遥测。→ [03](docs/03-agent-loop-and-context.md)
6. **上下文管理分好几层。** 主动 auto-compact、按时间清理旧工具结果的 microcompact、等 API 报 prompt-too-long 再压缩的 reactive 模式、空闲压缩、局部压缩，外加 API 侧的三种上下文编辑策略（`clear_tool_uses_20250919`、`clear_thinking_20251015`、`compact_20260112`）。→ [03](docs/03-agent-loop-and-context.md)
7. **33 个 Hook 事件。** 包括 `UserPromptExpansion`、`PreModelSwitch` / `PostModelSwitch`、`DirectoryAdded`、`MessageDisplay` 等；Hook 类型有 `command` / `prompt` / `agent` / `http` / `mcp_tool` 五种。→ [04](docs/04-permissions-hooks-settings.md)
8. **主对话之外还有 34 种“旁路查询”。** 会话标题生成、记忆提取、auto mode 分类与自我批评、工具调用摘要、提示建议等，（推断）每种都是一次独立的模型调用。→ [03](docs/03-agent-loop-and-context.md)

### 11 天里变了什么（2.1.311 → 2.1.319）

9. **外部接口不变，内部变化不小。** CLI、Hook 事件、权限模式完全一样。变化在里面：
   - Bun 运行时升级，文件大了 46 MB，其中约 33 MB 是原生代码；
   - 新增实验性的 `REPL` 工具（Code Mode），让模型用 JS 程序化调用工具，脚本里的每次工具调用仍单独过权限链；
   - 下线 7 个 Artifact 内置 Skill；
   - 遥测事件 +341 / −55，新增的约四分之三是特性开关代号。

   → [08](docs/08-version-diff-2.1.311-to-2.1.319.md)

## 证据与脚本

所有结论都能在 [`evidence/`](evidence/) 里找到对应的原始数据，用 [`scripts/`](scripts/) 在同版本二进制上重新生成。这些文件只含名字和元数据，不含代码。

<details>
<summary>展开文件清单</summary>

| 文件 | 内容 |
|---|---|
| [`inspect-artifact-summary.json`](evidence/inspect-artifact-summary.json) | REA `inspect-artifact` 的摘要视图（Bun 图根元数据） |
| [`module-index.tsv`](evidence/module-index.tsv) | 3,128 个模块的索引 → 原始模块名 |
| [`tool-table.json`](evidence/tool-table.json) / [`tool-keys.txt`](evidence/tool-keys.txt) | 内置工具属性；工具对象字段频度 |
| [`hook-events.txt`](evidence/hook-events.txt) | 33 个 Hook 事件 |
| [`query-sources.txt`](evidence/query-sources.txt) | 34 种旁路查询来源 |
| [`env-vars.txt`](evidence/env-vars.txt) | 环境变量名及出现次数 |
| [`tengu-events.txt`](evidence/tengu-events.txt) | `tengu_*` 遥测事件名 |
| [`beta-headers.txt`](evidence/beta-headers.txt) | 日期型 API beta 标识 |
| [`mcp-meta-keys.txt`](evidence/mcp-meta-keys.txt) | MCP `_meta["anthropic/*"]` 键 |
| [`cli-runtime.txt`](evidence/cli-runtime.txt) | `--version` / `--help` 等的实跑输出 |
| [`rea-local-patch.diff`](evidence/rea-local-patch.diff) | 对 REA 的一行本地补丁 |
| [`js-graph-partial.txt`](evidence/js-graph-partial.txt) | REA JS 应用分析（超时，部分结果） |
| [`claude-re-classnames-in-2.1.319.txt`](evidence/claude-re-classnames-in-2.1.319.txt) | claude-re 列出的类名在 2.1.319 中的核对 |
| [`facts-311.json`](evidence/facts-311.json) / [`facts-319.json`](evidence/facts-319.json) / [`diff-311-319.json`](evidence/diff-311-319.json) | 两个版本的可比事实集合及其差集 |
| [`module-index-311.tsv`](evidence/module-index-311.tsv) / [`cli-runtime-311.txt`](evidence/cli-runtime-311.txt) | 2.1.311 的模块索引与 CLI 输出 |

| 脚本 | 用途 |
|---|---|
| [`reproduce.sh`](scripts/reproduce.sh) | 下载靶标包、构建打过补丁的 REA、解包 |
| [`bun-peek.mjs`](scripts/bun-peek.mjs) | 读 `.bun` 段的模块记录，把索引映射回模块名 |
| [`tool-table.mjs`](scripts/tool-table.mjs) / [`tool-keys.mjs`](scripts/tool-keys.mjs) | 抽内置工具属性表；统计工具对象字段 |
| [`facts.mjs`](scripts/facts.mjs) / [`diff-facts.mjs`](scripts/diff-facts.mjs) | 抽跨版本稳定的名字集合；比较两个版本 |

</details>

### 快速复现

需要 Node.js ≥ 24.22.1、git、npm。脚本只会对靶标运行 `--version` / `--help`，细节和 Windows 下的额外步骤见 [00](docs/00-method.md)。

```bash
bash scripts/reproduce.sh 2.1.319 win32-x64
```

## 版权与使用边界

- Claude Code 的许可是 “© Anthropic PBC. All rights reserved”。**本仓库不包含任何解包出的源码、提示词或内置文档原文**，只收录标识符、事件名、环境变量名这类事实性名称和 REA 产出的结构化元数据。为说明机制而引用的代码，都只截取几十个字符的标识符级片段。
- 文档里的推断都会标明；凡是写“代码里有 X”的，都能按 00 的步骤在同版本二进制上复现。
- 目的仅为学习 agent harness 的工程设计，不用于绕过任何鉴权、计费或安全机制。
