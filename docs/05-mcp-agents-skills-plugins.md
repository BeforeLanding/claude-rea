# 05 · MCP、子代理、Skill、插件与 Workflow

## 1. MCP

### 1.1 传输（观测）

代码里有三组传输枚举：

```text
["stdio", "http", "sse", "ws"]          ← 用户可配置
["sse-ide", "ws-ide", "sdk"]            ← IDE 扩展 / SDK 进程内
["http", "sse", "claudeai-proxy"]       ← claude.ai 托管的 connector 走代理
```

另有 beta `mcp-tunnels-2026-06-22`（出现 10 次）。**推断**：这是让云端会话通过隧道访问本地 MCP 服务器的能力。

### 1.2 工具命名与归类（观测）

工具名按前缀分三类：

```text
mcp__<server>__<tool>     → "mcp"
eval_registered__…        → "eval_registered"（插件评测时临时注册的工具）
其他含 "__" 的名字         → "dynamic_tool"
```

在遥测里，MCP 工具名如果不能映射到已知名称，就归一成 `mcp_tool`，不上报原名（**观测**：分类函数里 `startsWith("mcp__")` 的分支先查一张映射表，查不到返回 `"mcp_tool"`）。**学到的设计**：用户装的第三方工具名可能带隐私信息，统计时只留类别。

### 1.3 `_meta["anthropic/*"]` 扩展通道

见 02 文档 §4。42 个键里除了加载、检索、截断相关的，还有一些和权限、交互相关的：`anthropic/permissionAsks`、`anthropic/permissionDisplay`、`anthropic/requiresUserInteraction`、`anthropic/remoteToolExecution`、`anthropic/toolHostInterface`、`anthropic/toolHostPermissionDecision`，以及 Chrome 相关的一组 `anthropic/chrome*`（[完整列表](../evidence/mcp-meta-keys.txt)）。Claude in Chrome 和 Computer Use 在实现上就是挂了这些元数据的 MCP 工具，这和 claude-re 在 2.1.301 里看到的 `getClaudeInChromeMCPToolOverrides` 一致。

## 2. 内置子代理（观测）

| agentType | 工具 | 模型 | 其他 |
|-----------|------|------|------|
| `general-purpose` | `["*"]` | 继承 | 通用 |
| `Explore` | 禁用 Agent、Artifact 系列、ExitPlanMode、Edit、Write、NotebookEdit | `inherit` | `omitClaudeMd: true`（不加载 CLAUDE.md） |
| `Plan` | 同 Explore | `inherit` | `omitClaudeMd: true` |
| `statusline-setup` | `["Read","Edit"]` | `sonnet` | `color: "orange"` |
| `claude-code-guide` | — | — | 回答 Claude Code / Agent SDK / API 使用问题 |
| `claude` | `["*"]` | — | `appendSystemPrompt: true`；描述里称它是 FleetView 的默认代理 |

子代理定义的字段：`agentType`、`whenToUse`（还有一个省 token 的 `whenToUseLean`）、`tools` / `disallowedTools`、`model`、`omitClaudeMd`、`appendSystemPrompt`、`getSystemPrompt`、`source`（`built-in` / 用户 / 插件）、`baseDir`、`color`。

**学到的设计**：只读探索类代理不加载 CLAUDE.md（`omitClaudeMd`）。项目说明通常是写给“要改代码的人”看的，对只读搜索帮助不大，还占上下文。

## 3. 内置 Skill（观测）

`.bun` 里打包了一批 Skill 的 `SKILL.md`（部分用 zstd 压缩）。能从 frontmatter 读到名字的有：

| Skill | 用途（取自 description 大意） |
|-------|------|
| `run` | 启动并操作项目应用，确认改动生效 |
| `verify` | 端到端验证一次代码改动 |
| `run-skill-generator` | 为项目生成专属的 `run-<unit>` skill |
| `plugin-authoring` | 写“mod”：面板、状态栏、斜杠命令、工具调用 hook 等 |
| `artifact-design` / `artifact-diagramming` | Artifact 的设计和画图指南 |
| `design-sync` | 把 React 设计系统推到 claude.ai/design |
| `sign-in` | 为测试账号登录并保存会话 |
| （无名，Claude Test 内部） | 后台浏览器跑 spec、首轮起草 spec |

同时打包的还有：

- **claude-api 参考文档**：`tool-use`、`streaming`、`files-api`、`batches`、`opentelemetry` 等每篇有 5–7 个语言版本，另有 `managed-agents-*` 共 18 篇。
- **dataviz 素材**：`palette`、`color-formula`、`marks-and-anatomy`、`choosing-a-form`，以及 `validate_palette.{js,py}`。
- **Agent 模板**：`deep-researcher`、`data-analyst`、`incident-commander`、`bug-hunter`、`support-agent`、`structured-extractor` 等。
- **计划模板**：`simple_plan`、`visual_plan`、`three_subagents_with_critique`。
- **`/loop` 自主模式前言**：`loopAutonomousPreamble`、`loopAutonomousPreamblePersistent`。
- **Mod 模板**：`band.tsx`、`pane.tsx`（含 `.d.ts` 和测试），对应 `plugin-authoring`。

**学到的设计**：Skill 内容是**随二进制发版**的，不是运行时下载。这样版本可复现、能离线用，代价是每次更新文档都要发新版。

## 4. 插件（观测）

插件清单 / 组件相关的键（按出现次数）：

```text
hooks 219 · skills 186 · agents 99 · commands 65 · workflows 64 · mcpServers 39
themes 36 · dependencies 28 · monitors 19 · outputStyles 13 · lspServers 10
userConfig 6 · statusLine 6 · mods 6 · channels 6
```

（这是全局字符串计数，有些键在别处也会用到，只能看出量级。）

`plugin --help` 里的子命令有 `init|new`（脚手架）、`eval`（跑 `case.yaml` 评测，对应旁路查询 `plugin_eval_judge` / `plugin_eval_mock`）、`configure`、`details`、`prune|autoremove`（清掉自动装的依赖）、`marketplace` 等，见 [`evidence/cli-runtime.txt`](../evidence/cli-runtime.txt)。

## 5. Workflow 工具：用确定性 JS 编排子代理

`Workflow`（别名 `RunWorkflow`）的 searchHint 是 “orchestrate subagents with deterministic JavaScript workflow”。从打包的类型声明能看出它的运行时 API（**观测**，只列名字）：

| 声明文件 | 暴露的名字 |
|---------|-----------|
| `team.sync.d.ts` / `team.async.d.ts` | `spawnContext`、`releaseContext`、`listContexts`；类型 `ContextStatus`、`ContextCost`、`ContextHandle` |
| `core.bash.sync.d.ts` 等 4 个 | `edit`、`write`、`file`、`sleep`、`preview`、`log`、`self`、定时器、`atob` / `btoa`、`searchTools`、`describeTool` |
| prelude | `team.prelude.js`、`file.prelude.js`、`running.prelude.js`、`shell.prelude.js` |

相关遥测：`tengu_workflow_launched`、`_phase_completed`、`_agent_cap_exceeded`、`_budget_cap_exceeded`、`_agent_stall_retries`、`_schema_lint_enforce`、`_journal_started_hit_respawn` 等。

**推断**：Workflow 让模型写一段 JS 脚本，用 `spawnContext` 并行开子代理、拿到句柄、读取成本，由脚本决定控制流。这样编排逻辑是确定性的、可重放的（有 journal），不靠模型每一步临场决定，同时有代理数量上限和预算上限。

## 6. 团队 / 多代理

`"team"` 出现 143 次，`"teammate"` 47 次，还有 `TeammateIdle` hook、`SendMessage` / `ListAgents` 工具、`teammateMode`、`teammateColors`，以及 `tengu_team_mem_*`（团队记忆）事件。可以看出产品里有一层“代理团队”抽象：多个会话能互发消息、共享记忆。本仓库没有展开这部分。
