# 04 · 权限、Hook 与设置层级

## 1. 权限模式（观测）

代码里出现的完整模式数组：

```text
["dontAsk", "auto", "default", "acceptEdits", "plan", "bypassPermissions"]
```

| 模式 | 含义（结合公开文档） |
|------|------|
| `default` | 按规则执行，不确定就问用户 |
| `acceptEdits` | 自动接受文件编辑 |
| `plan` | 只读规划，退出要经 ExitPlanMode 审批 |
| `auto` | 交给**分类器**判断是否放行，判不了再问人 |
| `dontAsk` | 不弹询问，规则外的一律拒绝（**推断**：给无人值守场景用） |
| `bypassPermissions` | 跳过权限检查 |

## 2. 一次权限判定的四种结果（观测）

在代码里数 `behavior:"…"` 出现的次数：

| behavior | 次数 | 含义 |
|----------|---:|------|
| `deny` | 454 | 拒绝 |
| `ask` | 311 | 询问用户（或交给外部 `--permission-prompt-tool`） |
| `allow` | 233 | 放行 |
| `passthrough` | 123 | **本层不表态，交给下一层**（规则、hook、分类器、用户依次判定） |

`passthrough` 出现得这么多，说明权限判定是**责任链**：工具自己的 `checkPermissions` → 规则引擎 → PreToolUse / PermissionRequest hook → auto mode 分类器 → 用户。每一层都可以说“我不管”。

## 3. Auto mode：分类器当守门员

相关遥测事件有 54 个（`tengu_auto_mode_*` / `tengu_sandbox_*` / `tengu_permission_*`），从中能拼出 auto mode 的组成（**观测**事件名 → **推断**用途）：

| 事件 | 推断用途 |
|------|---------|
| `tengu_auto_mode_decision` | 分类器每次给出的裁决 |
| `tengu_auto_mode_bash_prescreen_retry` | Bash 命令先过一遍预筛 |
| `tengu_auto_mode_local_classifier_call` | 有本地分类器路径 |
| `tengu_auto_mode_fallback_to_ask` | 分类器没把握时回退到问人 |
| `tengu_auto_mode_denial_limit_exceeded` | 拒绝次数超限 |
| `tengu_auto_mode_context_withheld` / `_over_ceiling` / `_static_over_budget` | 给分类器的上下文超预算时的截断处理 |
| `tengu_auto_mode_classifier_overflow_compact` | 分类器上下文溢出时先压缩 |
| `tengu_auto_mode_destructive_mcp_rule_allow` | 破坏性 MCP 工具命中允许规则 |
| `tengu_auto_mode_hook_allow_funneled` | hook 放行的结果汇入分类器流程 |

分类器的输入就是各工具的 `toAutoClassifierInput()`（02 文档），另有 `auto_mode_critique`（自我批评）和 `auto_mode_setup_propose`（帮用户生成 auto mode 配置）两种旁路查询（03 文档）。

## 4. Hook

### 4.1 事件全集（观测，33 个）

```text
PreToolUse  PostToolUse  PostToolUseFailure  PostToolBatch
Notification  UserPromptSubmit  UserPromptExpansion
SessionStart  SessionEnd  Stop  StopFailure
SubagentStart  SubagentStop
PreCompact  PostCompact
PreModelSwitch  PostModelSwitch
PermissionRequest  PermissionDenied
Setup  TeammateIdle  TaskCreated  TaskCompleted
Elicitation  ElicitationResult
ConfigChange  WorktreeCreate  WorktreeRemove
InstructionsLoaded  CwdChanged  FileChanged  DirectoryAdded  MessageDisplay
```

按生命周期分组：

| 阶段 | 事件 |
|------|------|
| 会话 | `Setup` → `SessionStart` → … → `SessionEnd` |
| 输入 | `UserPromptSubmit`、`UserPromptExpansion`（斜杠命令 / skill 展开） |
| 工具 | `PreToolUse` → `PermissionRequest` / `PermissionDenied` → `PostToolUse` / `PostToolUseFailure` → `PostToolBatch`（一批并行工具都结束后） |
| 轮次结束 | `Stop` / `StopFailure` |
| 子代理与团队 | `SubagentStart`、`SubagentStop`、`TeammateIdle`、`TaskCreated`、`TaskCompleted` |
| 上下文 | `PreCompact`、`PostCompact`、`InstructionsLoaded`（CLAUDE.md 等加载） |
| 模型 | `PreModelSwitch`、`PostModelSwitch` |
| MCP 交互 | `Elicitation`、`ElicitationResult` |
| 环境 | `CwdChanged`、`FileChanged`、`DirectoryAdded`、`ConfigChange`、`WorktreeCreate`、`WorktreeRemove` |
| 显示 | `Notification`、`MessageDisplay` |

### 4.2 Hook 类型（观测）

两组枚举：

```text
["prompt", "agent", "http", "mcp_tool"]       ← 加上 "command"，共 5 种用户可配置类型
["prompt", "agent", "callback", "function"]   ← SDK / 内部使用
```

| 类型 | 做什么 |
|------|--------|
| `command` | 跑 shell 命令，stdin 收 JSON，用退出码或 stdout JSON 返回决定 |
| `prompt` | 让模型按提示判断（旁路查询 `hook_prompt`） |
| `agent` | 起一个子代理判断（旁路查询 `hook_agent`） |
| `http` | POST 到一个 URL |
| `mcp_tool` | 调某个 MCP 工具 |
| `callback` / `function` | SDK 进程内回调；`function` 跑在单独的 `hooks-worker.js` Worker 里（**推断**：依据模块路径 `src/plugins/functionHooks/hooks-worker/`） |

**学到的设计**：hook 本身也可以是一次 LLM 调用（`prompt` / `agent`），这样能写“用模型判断这次 Bash 是否安全”之类的策略，不必全靠正则。

## 5. 设置来源与优先级（观测）

代码里出现的来源数组：

```text
["userSettings", "projectSettings", "localSettings", "flagSettings", "policySettings"]
["userSettings", "projectSettings", "localSettings", "session", "cliArg"]
```

| 来源 | 文件 / 渠道 |
|------|------------|
| `userSettings` | `~/.claude/settings.json` |
| `projectSettings` | `.claude/settings.json`（提交进仓库） |
| `localSettings` | `.claude/settings.local.json`（不提交） |
| `flagSettings` | `--settings` 参数 |
| `policySettings` | 企业托管策略（最高优先级，不可覆盖） |
| `session` / `cliArg` | 会话内临时授权、`--allowedTools` 等命令行参数，仅用于权限规则 |

`--setting-sources` 可以选择加载哪些来源（见 06 文档 CLI 参数）。

## 6. 学到什么

1. **权限是责任链，不是一个大 if**：`passthrough` 让每层只管自己懂的部分。
2. **自动化审批要有退路**：分类器拿不准就 `fallback_to_ask`，拒绝太多次就触发 `denial_limit_exceeded`。
3. **Hook 的事件粒度很细**：`PostToolBatch` 和 `PostToolUse` 分开，可以在“一批并行工具都结束后”统一做检查（比如跑一次 lint），不用每个工具跑一遍。
