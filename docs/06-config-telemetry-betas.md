# 06 · 环境变量、遥测、API Beta 与 CLI 面

## 1. 环境变量（观测）

在 JS 模块里匹配 `CLAUDE_CODE_*`、`CLAUDE_*`、`ANTHROPIC_*`、`MCP_*`、`BASH_*`、`DISABLE_*`、`ENABLE_*`，去重后共 1,243 个名字（有少量来自打包进来的依赖）。完整列表和出现次数见 [`evidence/env-vars.txt`](../evidence/env-vars.txt)。

| 前缀 | 个数 |
|------|---:|
| `CLAUDE_CODE_*` | 873 |
| `CLAUDE_*`（其他） | 190 |
| `ANTHROPIC_*` | 69 |
| `MCP_*` | 44 |
| `DISABLE_*` | 27 |
| `BASH_*` | 26 |
| `ENABLE_*` | 13 |

出现最多的几个：

| 变量 | 次数 | 说明（推断） |
|------|---:|------|
| `CLAUDE_CODE_REMOTE` | 281 | 是否运行在远程 / 云端会话里，到处都在分支判断 |
| `CLAUDE_CODE_OAUTH_TOKEN` | 138 | OAuth 凭据 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | 135 / 124 | API 鉴权与网关 |
| `CLAUDE_CODE_ENTRYPOINT` | 112 | 入口来源（cli / sdk / IDE / desktop …） |
| `CLAUDE_CODE_REMOTE_SESSION_ID` | 86 | 远程会话 ID |
| `CLAUDE_CONFIG_DIR` | 81 | 配置目录 |
| `ANTHROPIC_UNIX_SOCKET` | 67 | 通过 Unix socket 访问 API（托管环境） |
| `CLAUDE_CODE_ENVIRONMENT_KIND` / `_SESSION_KIND` | 62 / 59 | 运行环境和会话类型 |
| `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | 46 / 39 / 38 | 模型别名映射 |

**学到的设计**：`CLAUDE_CODE_REMOTE` 出现最多，说明同一份代码要同时跑在本地终端、IDE、桌面端和云端沙箱，大量行为按运行环境分叉。

## 2. 遥测事件（观测）

3,601 个 `tengu_*` 事件名（**推断**：“tengu” 是 Claude Code 的内部代号）。按第二段分组，前几位：

```text
mcp 134 · bg 118 · remote 91 · bridge 87 · auto 73 · oauth 65 · plugin 63
violin 50 · ccr 49 · device 46 · tool 43 · cobalt 34 · teleport 29 · amber 29
agent 27 · team 26 · artifact 26 · file 25 · refusal 24 · org 24 · api 24
```

- `bg`（后台会话）、`remote` / `bridge` / `ccr` / `teleport`（远程控制、云端会话、会话迁移）的事件量和 `mcp`、`auto` 相当，可见“本地 CLI”只是产品的一部分。
- `violin`、`cobalt`、`amber` 这类词，以及 `tengu_zippy_cocoa`、`tengu_teal_corbel_newel` 这样的随机词组，看起来是**特性开关 / 实验的代号**（**推断**）。真实功能名不出现在事件名里，事件名本身也就不泄露未发布功能。

完整列表：[`evidence/tengu-events.txt`](../evidence/tengu-events.txt)。

## 3. API Beta / 版本标识（观测）

代码里出现的日期型标识共 54 个（[`evidence/beta-headers.txt`](../evidence/beta-headers.txt)）。其中 `bedrock-2023-05-31`、`vertex-2023-10-16` 是云厂商的 `anthropic_version`，其余大多是 `anthropic-beta` 值。按主题分组：

| 主题 | 标识 |
|------|------|
| 工具 | `advanced-tool-use-2025-11-20`、`tool-search-tool-2025-10-19`、`inline-tools-2026-09-15`、`mid-conversation-tool-changes-2026-07-01`、`dangerous-tool-use-2026-09-03`、`tool-provenance-2026-10-26`、`advisor-tool-2026-03-01`、`web-search-2025-03-05`、`mcp-servers-2025-12-04` |
| 上下文与缓存 | `context-management-2025-06-27`、`context-hint-2026-04-09`、`extended-cache-ttl-2025-04-11`、`prompt-caching-scope-2026-01-05`、`prompt-caching-evict-2026-05-12`、`cache-keepalive-2026-09-03`、`cache-diagnosis-2026-04-07`、`mid-conversation-system-2026-04-07`、`mid-conversation-system-clear-at-2026-08-21` |
| 思考 | `interleaved-thinking-2025-05-14`、`redact-thinking-2026-02-12`、`thinking-token-count-2026-05-13`、`thinking-resumption-2026-07-17`、`thinking-binding-controls-2026-08-01`、`thinking-display-updates-2026-08-18`、`effort-2025-11-24` |
| 推理控制 / 容错 | `fast-mode-2026-02-01`、`per-turn-control-2026-07-01`、`server-side-fallback-2026-06-01/-07-01`、`fallback-credit-2026-06-01`、`task-budgets-2026-03-13`、`timing-2026-09-09` |
| 输出 | `structured-outputs-2025-12-15`、`token-counting-2024-11-01` |
| 平台 / 托管 | `managed-agents-2026-04-01`、`environments-2025-11-01`、`agent-memory-2026-07-22`、`dreaming-2026-04-21`、`user-profiles-2026-08-18`、`message-threads-2026-08-12`、`files-api-2025-04-14`、`message-batches-2024-09-24` |
| Claude Code 专用 | `claude-code-side-query-2026-09-29`（旁路查询）、`auto-mode-classifier-2026-07-16`、`afk-mode-2026-01-31`、`ccr-byoc-2025-07-29`、`ccr-triggers-2026-01-30`、`mcp-tunnels-2026-06-22`、`request-tags-2026-08-21`、`program-use-case-ids-2026-09-17` |
| 鉴权 | `oauth-2025-04-20`、`oidc-federation-2026-04-01` |

**学到什么**：harness 的很多能力（服务端压缩、工具延迟加载、auto mode 分类器、旁路查询）都要 API 侧配合，用 beta 头逐项开启。看一个客户端带了哪些 beta，就能大致看出它依赖服务端的哪些能力。

## 4. CLI 面（实跑 `--help`，观测）

顶层子命令：

```text
agents  attach  auth  auto-mode  doctor  gateway  import  install  logs  mcp
plugin|plugins  purge  respawn  rm  setup-token  stop|kill  ultrareview  update|upgrade
```

- `agents` / `attach` / `logs` / `respawn` / `rm` / `stop`：**后台会话**管理（对应遥测里的 `bg` 事件）。
- `gateway`：企业鉴权 / 遥测网关。
- `import`：从其他 AI 编码工具导入配置。
- `ultrareview`：云端多代理代码审查。
- `auto-mode`：查看或重置 auto mode 配置。

部分顶层参数：`--agent(s)`、`--bg`、`--cloud`、`--desktop`、`--remote-control`、`--teleport`、`--worktree`、`--tmux`、`--fork-session`、`--from-pr`、`--effort`、`--fallback-model`、`--max-budget-usd`、`--json-schema`、`--setting-sources`、`--safe-mode`、`--restricted`、`--exclude-dynamic-system-prompt-sections`、`--system-prompt-snapshot`、`--forward-subagent-text`。

完整输出见 [`evidence/cli-runtime.txt`](../evidence/cli-runtime.txt)。
