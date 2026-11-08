# claude-rea：用 REA 逆向 Claude Code 2.1.319 的学习笔记

> 靶标：Anthropic 官方 `claude` **2.1.319**（npm `latest`，win32-x64 原生构建，2026-11-08 取得）
> 工具：[morluto/rea](https://github.com/morluto/rea)（Reverse Engineer Anything）main 分支 `72d5e72`，加一行本地补丁
> 参照：[lvy010/claude-re](https://github.com/lvy010/claude-re)（对 2.1.301 darwin-arm64 做的字符串级逆向）

claude-re 停在“字符串命中、函数 xref 为 0”这一层：Claude Code 是 Bun 编译的单文件可执行程序，业务逻辑以 JS 形式嵌在 `__bun` 段里，用原生反汇编的视角看不到它。

本仓库多走了一步：**用 REA 的 Bun standalone 读取器把 `.bun` 段里的模块图完整解包**（3,128 个模块，61 MB），再在解包后的 JS 上做静态分析。下面所有结论都来自解包出的模块内容，按“二进制里看到了什么”来写，不靠猜。

## 目录

| 文档 | 内容 |
|------|------|
| [docs/00-method.md](docs/00-method.md) | 环境、REA 的用法、踩到的两个坑（Bun 读取器尚未发版；共享字节码撞扩展预算）、可复现步骤 |
| [docs/01-artifact-anatomy.md](docs/01-artifact-anatomy.md) | PE 节表、Bun 模块图的二进制格式、3,128 个模块的构成、内嵌资源 |
| [docs/02-tool-system.md](docs/02-tool-system.md) | Tool 对象的接口字段、40+ 内置工具属性表、延迟加载 / ToolSearch、并发 |
| [docs/03-agent-loop-and-context.md](docs/03-agent-loop-and-context.md) | 主循环状态机、流式工具执行器、tool_use/tool_result 配对修复、压缩体系、旁路查询 |
| [docs/04-permissions-hooks-settings.md](docs/04-permissions-hooks-settings.md) | 6 种权限模式、33 个 Hook 事件、5 种 Hook 类型、设置来源层级 |
| [docs/05-mcp-agents-skills-plugins.md](docs/05-mcp-agents-skills-plugins.md) | MCP 传输与命名、内置子代理、内置 Skill、插件、Workflow 工具 |
| [docs/06-config-telemetry-betas.md](docs/06-config-telemetry-betas.md) | 环境变量、`tengu_*` 遥测事件、API beta 头、CLI 子命令 |
| [docs/07-vs-claude-re.md](docs/07-vs-claude-re.md) | 与 claude-re 的方法对比、本仓库的边界与未做事项 |

| 证据 | 内容 |
|------|------|
| `evidence/inspect-artifact-summary.json` | REA `inspect-artifact` 的摘要视图（Bun 图根元数据） |
| `evidence/module-index.tsv` | 3,128 个模块的索引 → 原始模块名（只有名字，不含代码） |
| `evidence/tool-table.json` | 从工具定义对象里抽出的内置工具属性 |
| `evidence/hook-events.txt` | 代码中的 Hook 事件全集（33 个） |
| `evidence/query-sources.txt` | 主循环以外的“旁路 LLM 调用”来源标签 |
| `evidence/env-vars.txt` | 代码中出现的环境变量名及出现次数 |
| `evidence/tengu-events.txt` | 3,601 个 `tengu_*` 遥测事件名 |
| `evidence/beta-headers.txt` | 代码中出现的日期型 API beta 标识 |
| `evidence/cli-runtime.txt` | `--version` / `--help` / `mcp --help` / `plugin --help` 实跑输出 |
| `evidence/rea-local-patch.diff` | 对 REA 的一行本地补丁 |
| `scripts/` | 读 `.bun` 段的小脚本、生成工具属性表的脚本、复现脚本 |

## 一页结论

1. **形态**：`claude.exe`（345 MB）是 Bun 编译的 PE。`.bun` 节 189 MB，用的是 Bun 1.3.9 起的 52 字节模块记录布局。里面有 3,128 个模块：2,878 个 JS chunk（`B:/~BUN/root/chunk-*.js`）、入口 `cli`、7 个独立 JS/MJS、138 个 zstd 压缩文档、73 个 Markdown、字体、一个原生插件 `audio-capture.node`。编译参数只有 `--zero-fill-buffers`。
2. **源码与字节码都在**：每个 JS 模块同时保存了 latin1 编码的源码（已压缩混淆）和 JSC 字节码。所有模块的字节码指针指向同一块约 108 MB 的共享区，起点各不相同、终点相同。这个布局会让 REA 的扩展预算误判为 94.7 GB，需要打补丁跳过（见 00）。
3. **工具是“胖对象”**：每个工具除 `name / inputSchema / call` 外，还带 `searchHint`、`maxResultSizeChars`、`isConcurrencySafe`、`isReadOnly`、`shouldDefer`、`backgrounding`、`remoteExecution`、`toAutoClassifierInput`、`preparePermissionMatcher` 等二十多个字段。权限、并发、延迟加载、远程执行、自动模式分类器都挂在工具对象上。
4. **主循环**：流式响应里每出现一个 `tool_use` 块，就交给 `streamingToolExecutor.addTool` 开始执行，不等整条消息结束。并发上限默认 10（`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`）。一次尝试失败时，已产出的消息会被标成 `tombstone` 撤回。
5. **配对修复是安全阀**：`ensureToolResultPairing` 在严格模式下拒绝修复、直接抛错（报错文案引用了内部事故编号）。非严格模式下才补齐缺失的 `tool_result`，并上报 `tengu_tool_result_pairing_repaired`。
6. **上下文管理是多层的**：主动 auto-compact（阈值可被 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 压低）、按时间清理旧工具结果的 microcompact、等 API 报 prompt-too-long 再压缩的 reactive 模式、空闲压缩（idle compact）、局部压缩（partial compact）。同时用到 API 侧的 `clear_tool_uses_20250919`、`clear_thinking_20251015`、`compact_20260112` 三种上下文编辑策略。
7. **Hook 事件有 33 个**：其中包括 `UserPromptExpansion`、`PreModelSwitch` / `PostModelSwitch`、`DirectoryAdded`、`MessageDisplay` 等。Hook 类型有 `command / prompt / agent / http / mcp_tool` 五种，另有 SDK 内部用的 `callback / function`。
8. **大量“旁路查询”**：除主对话外，还有 34 种 `querySource`，例如会话标题生成、记忆提取、auto mode 分类与自我批评、工具调用摘要、提示建议、Artifact 评论分诊等，（推断）每种都是一次独立的模型调用。

## 版权与使用边界

- Claude Code 的许可是 “© Anthropic PBC. All rights reserved”。**本仓库不包含任何解包出的源码、提示词或内置文档原文**。只收录标识符、事件名、环境变量名这类事实性名称，以及 REA 产出的结构化元数据。为说明机制而引用的代码片段，都只截取几十个字符的标识符级片段。
- 文档里的“推断”都会标明。凡是写“代码里有 X”的，都能用 `scripts/` 和 00 文档里的步骤在同版本二进制上复现。
- 目的仅为学习 agent harness 的工程设计，不用于绕过任何鉴权、计费或安全机制。
