# claude-rea

**基于 [REA](https://github.com/morluto/rea) 的 Claude Code 2.1.319 二进制解包与 agent harness 分析。**

本仓库整理了对 Claude Code 内嵌 JavaScript 模块的静态分析，涵盖工具系统、主循环、上下文管理、权限与 Hook、MCP 和遥测，并记录了 2.1.311 → 2.1.319 的版本差异。文档以中文编写，附有结构化证据和复现脚本。

| | |
|---|---|
| **分析对象** | Anthropic 官方 `claude` **2.1.319**（win32-x64 原生构建，2026-11-08 取得，当时为 npm `latest`） |
| **工具** | [morluto/rea](https://github.com/morluto/rea)（Reverse Engineer Anything），main 分支 `72d5e72` + 一行本地补丁 |
| **参考项目** | [lvy010/claude-re](https://github.com/lvy010/claude-re)：对 2.1.301 darwin-arm64 构建的二进制结构与字符串分析 |
| **对比版本** | 2.1.311 → 2.1.319（取得时分别为 npm `stable` 和 `latest`） |

## 分析方法与范围

Claude Code 以 Bun 编译的单文件可执行程序分发，业务逻辑以 JavaScript 的形式嵌入其中。[claude-re](https://github.com/lvy010/claude-re) 从原生二进制结构与字符串入手，梳理了工具调用相关的标识符和机制线索。

本仓库使用 REA 的 Bun standalone 读取器，提取 win32-x64 构建中 `.bun` 节的模块内容与资源（3,128 个模块，约 61 MB），再对其中的 JavaScript 做定向检索与静态分析。JSC 字节码未解码，分析过程与局限见 [00 方法](docs/00-method.md)。

文档区分可直接观测的结构、标识符与行为推断；推断均单独标注，尚未经运行时验证。

## 分析概览

| 项目 | 数量 | 项目 | 数量 |
|---|---:|---|---:|
| 模块（其中 JS chunk） | 3,128（2,878） | Hook 事件 | 33 |
| 内置工具 | 40+ | 权限模式 | 6 |
| 旁路查询来源（`querySource`） | 34 | `tengu_*` 遥测事件 | 3,601 |
| 环境变量名 | 1,243 | 日期型 API beta 标识 | 54 |
| MCP `_meta["anthropic/*"]` 键 | 42 | 共享 JSC 字节码区 | ≈108 MB |

## 阅读导航

可按关注的主题阅读：

- **了解编码 agent 的运行机制** → [02 工具系统](docs/02-tool-system.md) → [03 主循环与上下文](docs/03-agent-loop-and-context.md) → [04 权限与 Hook](docs/04-permissions-hooks-settings.md)
- **复现分析过程** → [00 方法](docs/00-method.md) → [01 产物解剖](docs/01-artifact-anatomy.md) → [`scripts/`](scripts/)
- **查看版本变化** → [08 版本差分](docs/08-version-diff-2.1.311-to-2.1.319.md)
- **快速了解主要发现** → [关键结论](#关键结论)

### 全部文档

| # | 文档 | 内容 |
|:-:|---|---|
| 00 | [方法：环境、REA 用法与复现](docs/00-method.md) | 工具链与复现步骤；Bun 读取器版本要求、共享字节码导致的扩展预算误判及处理方法 |
| 01 | [产物解剖：PE + Bun 模块图](docs/01-artifact-anatomy.md) | PE 节表、`.bun` 段的二进制格式、3,128 个模块的构成、内嵌资源 |
| 02 | [工具系统](docs/02-tool-system.md) | Tool 对象的两层结构与字段、40+ 内置工具属性表、延迟加载与 ToolSearch、并发 |
| 03 | [主循环、流式工具执行与上下文管理](docs/03-agent-loop-and-context.md) | 主循环状态机、流式工具执行器、`tool_use` / `tool_result` 配对修复、压缩体系、旁路查询 |
| 04 | [权限、Hook 与设置层级](docs/04-permissions-hooks-settings.md) | 6 种权限模式、33 个 Hook 事件、5 种 Hook 类型、设置来源的优先级 |
| 05 | [MCP、子代理、Skill、插件与 Workflow](docs/05-mcp-agents-skills-plugins.md) | MCP 传输与命名、内置子代理、内置 Skill、插件、Workflow 与 REPL 工具 |
| 06 | [环境变量、遥测、API Beta 与 CLI](docs/06-config-telemetry-betas.md) | 环境变量、`tengu_*` 遥测事件、API beta 头、CLI 子命令 |
| 07 | [与 claude-re 的对比、边界与未做事项](docs/07-vs-claude-re.md) | 方法对比、交叉验证、REA 能力评估与分析边界 |
| 08 | [版本差分：2.1.311 → 2.1.319](docs/08-version-diff-2.1.311-to-2.1.319.md) | Bun 运行时升级、REPL / Code Mode、7 个 Artifact Skill 下线、特性开关轮换 |

## 关键结论

### 二进制结构

1. **分析对象为约 345 MB 的 Bun 可执行文件。** `.bun` 节占约 189 MB，采用 Bun 1.3.9 起的 52 字节模块记录布局，包含 2,878 个 JS chunk、入口 `cli`、7 个独立 JS/MJS、138 个 zstd 压缩文档、73 个 Markdown、字体和一个原生插件 `audio-capture.node`。→ [01](docs/01-artifact-anatomy.md)
2. **JavaScript 源码与 JSC 字节码同时存在。** JS 模块包含经过压缩混淆的源码及 JSC 字节码。模块的字节码引用指向同一块约 108 MB 的共享区，起点不同、终点相同。REA 重复计算这些区间，将声明的展开体积计为约 94.7 GB；本次解包通过一行本地补丁跳过字节码区域。→ [00](docs/00-method.md)

### Agent 运行机制

3. **工具对象同时承载调用接口与调度配置。** 除 `name` / `inputSchema` / `call` 外，工具定义还包含二十多个供 harness 使用的字段，如 `searchHint`、`maxResultSizeChars`、`isConcurrencySafe`、`shouldDefer`、`backgrounding`、`toAutoClassifierInput` 和 `preparePermissionMatcher`，用于权限判断、并发控制、延迟加载、远程执行与自动模式分类。→ [02](docs/02-tool-system.md)
4. **工具执行与响应流式处理相结合。** 执行器在接收到 `tool_use` 块后启动工具，无需等待整条消息结束；默认并发上限为 10，可通过 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 配置。一次尝试失败时，已产出的消息会被标记为 `tombstone` 并撤回。→ [03](docs/03-agent-loop-and-context.md)
5. **工具调用与结果之间有配对校验。** `ensureToolResultPairing` 在严格模式下遇到配对异常会抛错；非严格模式下则补齐缺失的 `tool_result`，并上报遥测。→ [03](docs/03-agent-loop-and-context.md)
6. **上下文管理采用多层压缩策略。** 包括主动压缩（auto-compact）、按时间清理旧工具结果（microcompact）、收到 API 的 prompt-too-long 错误后触发的压缩（reactive）、空闲压缩和局部压缩，以及 API 侧的三种上下文编辑策略：`clear_tool_uses_20250919`、`clear_thinking_20251015`、`compact_20260112`。→ [03](docs/03-agent-loop-and-context.md)
7. **可识别 33 个 Hook 事件与 5 种 Hook 类型。** 事件包括 `UserPromptExpansion`、`PreModelSwitch` / `PostModelSwitch`、`DirectoryAdded`、`MessageDisplay` 等；类型为 `command` / `prompt` / `agent` / `http` / `mcp_tool`。→ [04](docs/04-permissions-hooks-settings.md)
8. **主对话之外可识别 34 种旁路查询来源。** 用途涉及会话标题生成、记忆提取、auto mode 分类与自我批评、工具调用摘要、提示建议等。根据调用上下文推断，这些来源对应独立的模型调用；实际触发条件与调用次数未经运行时验证。→ [03](docs/03-agent-loop-and-context.md)

### 版本差异（2.1.311 → 2.1.319，间隔 11 天）

9. **已比较的接口清单保持一致，内部实现与资源有所调整。** 两个版本的 CLI、Hook 事件和权限模式清单一致。主要变化包括：
   - Bun 运行时升级，可执行文件增大约 46 MB，其中约 33 MB 来自原生代码；
   - 新增实验性的 `REPL` 工具（Code Mode），支持模型通过 JavaScript 程序化调用工具，每次工具调用仍需单独经过权限校验；
   - 移除 7 个 Artifact 内置 Skill；
   - 遥测事件新增 341 个、移除 55 个，新增项中约四分之三为特性开关代号。

   → [08](docs/08-version-diff-2.1.311-to-2.1.319.md)

## 证据与脚本

[`evidence/`](evidence/) 收录模块索引、标识符清单、结构化元数据及 CLI 输出；[`scripts/`](scripts/) 提供解包与数据提取脚本。结合 [00 方法](docs/00-method.md)，可在同版本二进制上复核文档中的观测结果。仓库不收录解包后的完整源码。

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
| [`cli-runtime.txt`](evidence/cli-runtime.txt) | `--version` / `--help` 等命令的实际输出 |
| [`rea-local-patch.diff`](evidence/rea-local-patch.diff) | 对 REA 的一行本地补丁 |
| [`js-graph-partial.txt`](evidence/js-graph-partial.txt) | REA JS 应用分析（超时，部分结果） |
| [`claude-re-classnames-in-2.1.319.txt`](evidence/claude-re-classnames-in-2.1.319.txt) | claude-re 列出的类名在 2.1.319 中的核对 |
| [`facts-311.json`](evidence/facts-311.json) / [`facts-319.json`](evidence/facts-319.json) / [`diff-311-319.json`](evidence/diff-311-319.json) | 两个版本的可比事实集合及其差集 |
| [`module-index-311.tsv`](evidence/module-index-311.tsv) / [`cli-runtime-311.txt`](evidence/cli-runtime-311.txt) | 2.1.311 的模块索引与 CLI 输出 |

| 脚本 | 用途 |
|---|---|
| [`reproduce.sh`](scripts/reproduce.sh) | 下载目标包、应用本地补丁并构建 REA、解包 |
| [`bun-peek.mjs`](scripts/bun-peek.mjs) | 读取 `.bun` 节的模块记录，将索引映射为原始模块名 |
| [`tool-table.mjs`](scripts/tool-table.mjs) / [`tool-keys.mjs`](scripts/tool-keys.mjs) | 提取内置工具属性；统计工具对象字段 |
| [`facts.mjs`](scripts/facts.mjs) / [`diff-facts.mjs`](scripts/diff-facts.mjs) | 提取用于跨版本比较的名称集合；生成差异 |

</details>

### 快速复现

需要 Node.js ≥ 24.22.1、Git、npm，以及 Bash 环境。对目标程序的执行仅限于 `--version` / `--help`；工具链版本要求、脚本适用范围及 Windows 下的额外步骤见 [00 方法](docs/00-method.md)。

```bash
bash scripts/reproduce.sh 2.1.319 win32-x64
```

## 版权与使用边界

- Claude Code 的版权声明为 “© Anthropic PBC. All rights reserved”。本仓库不分发解包后的完整源码、提示词或内置文档原文；收录内容以标识符、事件名、环境变量名等事实性名称及 REA 生成的结构化元数据为主。机制说明中仅引用必要的简短标识符级代码片段。
- 文档明确标注推断；对代码结构与标识符的观测，可按 [00 方法](docs/00-method.md) 在同版本二进制上复核。
- 本项目用于学习 agent harness 的工程设计，不用于绕过鉴权、计费或安全机制。
