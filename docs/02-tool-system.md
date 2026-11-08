# 02 · 工具系统

## 1. 两层结构：静态描述符 + `create(ctx)` 运行时

以 Glob 工具为例（**观测**，`chunk-27h4st9h.js`），定义对象大致是这个形状（标识符已压缩，这里只列字段）：

```text
{
  name, searchHint: "find files by name pattern or wildcard",
  backgrounding: "never", maxResultSizeChars: 1e5,
  description(), prompt({model, leanPrompt}),
  userFacingName() → "Search",
  getToolUseSummary, getActivityDescription → "Finding …",
  get inputSchema(), get outputSchema(),
  isConcurrencySafe() → true, isReadOnly() → true,
  toAutoClassifierInput(input), isSearchOrReadCommand() → {isSearch:true},
  ruleContentField: "path", getPath(input), preparePermissionMatcher({pattern}),
  renderToolUseMessage, extractSearchText,
  create(ctx) {                       ← 会话级运行时
    return { validateInput(input), checkPermissions(input, meta), call(input, meta), … }
  }
}
```

要点：

- **静态层**负责“列出 / 描述 / 渲染 / 判定属性”。不需要会话上下文就能拿来生成 API 的 `tools[]`、决定是否延迟加载、在 UI 上渲染。
- **运行时层**由 `create(ctx)` 生成，闭包里拿着 `ctx.session`、`ctx.permissions()` 等会话状态。`validateInput → checkPermissions → call` 三步都在这一层。Glob 的 `checkPermissions` 会先把这次读路径记进 `writePermissionStash`，再交给通用的路径权限检查。
- 和 Agent SDK 公开的 `tool()` / MCP 工具相比，内置工具多了大量**给 harness 自己用的元数据**。这些字段不发给模型，用来驱动权限、并发、UI、遥测和自动模式分类器。

## 2. Tool 对象字段频度（观测，启发式统计）

用 [`scripts/tool-keys.mjs`](../scripts/tool-keys.mjs) 在全部 chunk 里找到 99 个“像工具定义”的对象（有 `name` 且有 `inputSchema` 或 `maxResultSizeChars`），统计顶层字段出现次数（完整表见 [`evidence/tool-keys.txt`](../evidence/tool-keys.txt)）：

| 出现次数 | 字段 | 作用（**推断**，依据字段名和用法） |
|---:|---|---|
| 97 / 93 / 90 | `inputSchema` / `description` / `prompt` | 发给模型的契约。`prompt()` 拿到 `model` 参数，可以按模型裁剪描述 |
| 90 | `maxResultSizeChars` | 单次结果截断上限。多数是 `1e5`，Grep 是 `20000`，Monitor / EndConversation 是 `1e4`，ReportFindings 是 `256` |
| 88 | `backgrounding` | `never` / `self` / `detach`：能不能转后台。Bash、PowerShell、Agent 是 `self`，WebSearch、WebFetch 是 `detach` |
| 87 | `mapToolResultToToolResultBlockParam` | 把内部结果转成 API 的 `tool_result` 块 |
| 87 | `create` | 见 §1 |
| 86 | `searchHint` | 一句话能力描述，供 ToolSearch 检索延迟加载的工具 |
| 66 / 63 | `isReadOnly` / `isConcurrencySafe` | 只读和可并发的工具可以并行执行 |
| 60 | `toAutoClassifierInput` | 给 **auto mode 分类器**看的输入摘要（不是完整入参） |
| 51 | `shouldDefer` | 是否延迟加载，见 §4 |
| 12 / 12 / 9 | `getPath` / `ruleContentField` / `preparePermissionMatcher` | 权限规则 `Tool(内容)` 的匹配对象：Bash 匹配 `command`，Edit 匹配 `file_path`，Glob 匹配 `path` |
| 11 | `enablesCodeExecution` | Bash / PowerShell / Monitor 等能执行任意代码的工具 |
| 8 | `remoteExecution` | 能否在远程 ToolHost 上执行，以及 `decidingInputFields`（哪些入参影响远程判定） |
| 8 | `skipAggregateToolResultBudget` | 不计入“同一轮工具结果总预算”（如 WebFetch） |
| 7 / 6 | `suppressesAllPermissionUpdates` / `suppressesAlwaysAllowRule` | 不允许为它生成“总是允许”规则 |
| 6 | `requiresUserInteraction` | 必须有人在场（如 AskUserQuestion） |
| 5 | `preserveToolUseResultInSubagents` | 子代理里保留完整结果（如 Skill） |
| 4 | `isDestructive` | 破坏性操作标记 |

## 3. 内置工具一览（观测）

由 [`scripts/tool-table.mjs`](../scripts/tool-table.mjs) 从定义对象抽取（原始数据见 [`evidence/tool-table.json`](../evidence/tool-table.json)）；“—”表示脚本没能可靠抽到该字段。

| 工具 | searchHint（原文） | 结果上限 | 并发安全 | 只读 | 延迟加载 | 后台 |
|------|------|---:|:--:|:--:|:--:|------|
| Bash | execute shell commands | — | — | — | — | self |
| PowerShell | execute Windows PowerShell commands | 动态 | — | — | — | self |
| Edit | modify file contents in place | 1e5 | — | — | — | never |
| Glob | find files by name pattern or wildcard | 1e5 | ✓ | ✓ | | never |
| Grep | search file contents with regex (ripgrep) | 20000 | ✓ | ✓ | | never |
| NotebookEdit | edit Jupyter notebook cells (.ipynb) | 1e5 | — | — | ✓ | never |
| WebFetch | fetch and extract content from a URL | — | — | — | ✓ | detach |
| WebSearch | search the web for current information | 1e5 | ✓ | ✓ | ✓ | detach |
| Agent | delegate work to a subagent | — | ✓ | ✓ | | self |
| Skill | invoke a slash-command skill | 1e5 | — | — | | never |
| ToolSearch | — | 1e5 | — | — | | never |
| TodoWrite | manage the session task checklist | 1e5 | ✓ | ✓ | ✓ | never |
| TaskCreate / TaskUpdate / TaskList / TaskGet | create / update / list / retrieve a task | 1e5 | ✓（Create 为否） | ✓ | ✓ | never |
| TaskStop | kill a running background task | 1e5 | ✓ | ✓ | ✓ | never |
| Monitor | — | 1e4 | — | — | ✓ | — |
| CronCreate / CronDelete / CronList | schedule / cancel / list … | 1e5 | List ✓ | List ✓ | ✓ | never |
| ScheduleWakeup | — | 1000 | — | — | ✗ | never |
| SendMessage / ListAgents | send messages to agent teammates / list agents … | 1e5 | — / ✓ | — / ✓ | ✓ / | never |
| ExitPlanMode | present plan for approval and start coding | 1e5 | ✓ | ✗ | ✓ | never |
| EnterWorktree / ExitWorktree | create / exit an isolated git worktree | 1e5 | — | — | ✓ | never |
| AskUserQuestion | prompt the user with a multiple-choice question | 1e5 | ✓ | ✓ | | never |
| LSP | code intelligence (definitions, references, symbols, hover) | 1e5 | ✓ | ✓ | ✓ | never |
| Artifact | render an HTML file to a claude.ai web page | — | — | — | ✗ | never |
| Workflow（别名 RunWorkflow） | orchestrate subagents with deterministic JavaScript workflow | 1e5 | — | — | | never |
| RemoteTrigger | manage scheduled cloud agent routines … | — | ✓ | 按 action | ✓ | never |
| ReportFindings | report code-review findings as a structured list | 256 | ✓ | ✓ | | never |
| SendUserFile | deliver files … to the user | 1e5 | ✓ | ✓ | | never |
| PushNotification | send a notification to the user … | 1000 | ✓ | ✓ | ✓ | never |
| StructuredOutput | return the final response as structured JSON | 1e5 | — | — | | never |
| EndConversation | end the conversation — only for sustained user abuse … | 1e4 | — | — | ✓ | never |

另外有 `Read`、`Write`、`EnterPlanMode`、`Brief` 的名字常量（**观测**），但它们的定义没有按上面的模式写，脚本没抽到属性。Agent 工具还有一个别名常量（**推断**：为兼容保留的旧名 `Task`）。

## 4. 延迟加载与 ToolSearch

- 标了 `shouldDefer: true` 的工具不会在首轮请求里带完整 schema，只把名字发给模型。生成 API 请求时，这类工具会被打上 `defer_loading: true`（**观测**：请求构造代码里有 `if(n.deferLoading) Io.defer_loading = !0`）。模型需要时，先调用 ToolSearch 把 schema “取回来”。
- 对应的 API beta 是 `tool-search-tool-2025-10-19`（**观测**，见 06 文档）。
- 发送给不支持该特性的后端前，会有一个函数统一剥掉 `eager_input_streaming`、`defer_loading`、`strict`、`citations`、`ownership_metadata` 这几个字段（**观测**）。
- MCP 工具可以用 `_meta["anthropic/alwaysLoad"]` 要求不延迟，用 `_meta["anthropic/searchHint"]` 提供检索提示，用 `_meta["anthropic/maxResultSizeChars"]` 自定截断上限（**观测**，共 42 个 `anthropic/*` 元数据键，见 [`evidence/mcp-meta-keys.txt`](../evidence/mcp-meta-keys.txt)）。也就是说，**MCP 服务器能拿到和内置工具同等的 harness 元数据通道**。

## 5. 并发执行

- 默认并发上限是 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY ?? 10`（**观测**）。
- 能不能并行由 `isConcurrencySafe(input)` 决定。它是**按入参**判断的函数，不是常量；比如 SendMessage 的判断条件会看 `message` 是不是字符串。
- 流式执行细节见 [03 文档](03-agent-loop-and-context.md)。

## 6. 学到什么

1. **工具描述要分层**：模型看到的（schema、描述）和 harness 用的（并发、权限、渲染、截断、后台）放在同一个对象里，但分属不同字段，后者永远不进上下文。
2. **权限匹配是工具自己声明的**：每个工具通过 `ruleContentField` 和 `preparePermissionMatcher` 说清“规则括号里的内容匹配我的哪个参数、怎么匹配”，通用权限引擎不需要认识每个工具。
3. **给分类器专门的输入视图**：`toAutoClassifierInput` 只交出做安全判定需要的那部分入参，既省 token，也减少无关内容干扰判定。
4. **结果截断按工具定制**：同样是搜索，Grep（2 万）比 Glob（10 万）收得更紧。
