# 08 · 版本差分：2.1.311（stable）→ 2.1.319（latest）

> 两个版本都取 win32-x64 平台包，用同一套流程解包（00 文档），再用 [`scripts/facts.mjs`](../scripts/facts.mjs) 抽出可比较的“事实集合”，用 [`scripts/diff-facts.mjs`](../scripts/diff-facts.mjs) 做集合差。原始数据：[`facts-311.json`](../evidence/facts-311.json)、[`facts-319.json`](../evidence/facts-319.json)、[`diff-311-319.json`](../evidence/diff-311-319.json)。

| 项 | 2.1.311 | 2.1.319 |
|----|---------|---------|
| npm 发布时间 | 2026-10-26 | 2026-11-06 |
| dist-tag（11-08） | `stable` | `latest` / `next` |
| 中间版本 | — | 312、314–318（没有 313） |
| `claude.exe` SHA-256 | `966f4b2c…259c0680` | `2e055732…1345cbd` |

**为什么不按字符串 diff**：chunk 名是内容哈希，局部变量每次构建都重新压缩命名。逐文件 diff 几乎全是噪声（试算时连工具对象里的 `maxResultSizeChars` 都从 `XN` 变成了 `mT`，只是换了个变量名）。所以只比较**跨构建稳定的名字**：工具的 searchHint、hook 事件、遥测事件、环境变量、beta 头、`_meta` 键、资源名、Skill 名。

## 1. 运行时外壳：Bun 本身也换了

| PE 节 | 2.1.311 | 2.1.319 |
|------|--------:|--------:|
| 文件大小 | 298.9 MB | 344.8 MB（+46 MB） |
| `.text` | 93.5 MB | 122.7 MB（+29 MB） |
| `.rdata` | 23.6 MB | 27.5 MB |
| `.bunaot` / `.bunfeat` / `.bunid` | **无** | 3.7 KB / 536 B / 32 B |
| `.bunblt` | 2.72 MB | 2.76 MB |
| `.bun`（JS 载荷） | 177.1 MB | 189.5 MB（+12 MB） |

文件增大的 46 MB 里，大部分（约 33 MB）来自原生代码节，并且多了三个新的 Bun 节。**推断**：2.1.319 换了更新的 Bun 运行时，新增的 `.bunaot` 暗示有某种 AOT 产物。模块表布局没变（两版都是 `bun-1.3.9`，即 52 字节记录），REA 两版都能解。

两处编译元数据也变了（**观测**）：

- 编译参数：2.1.311 为空，2.1.319 是 `--zero-fill-buffers`（Bun 分配的 Buffer 默认清零，属于安全加固）。
- 每个模块头部的声明注释：2.1.311 写的是“Beta 产品、按商业条款，代码接受/拒绝决定视为 Feedback”一类文字；2.1.319 换成了简短的版权声明（“All rights reserved”加法律条款链接）。

## 2. 模块与代码量

| 项 | 2.1.311 | 2.1.319 | 变化 |
|----|--------:|--------:|-----:|
| 模块总数 | 2,845 | 3,128 | +283 |
| JS 模块 | 2,601 | 2,886 | +285 |
| JS 源码字节 | 50.9 MB | 54.4 MB | +3.5 MB（+6.8%） |

11 天里 JS 源码增加了 6.8%。

## 3. 能力面变化

### 3.1 新工具（4 个，观测）

| 工具名 | searchHint | 推断 |
|--------|-----------|------|
| **`REPL`**（别名 `Eval`） | execute JavaScript with programmatic tool access | 实验性的 “Code Mode”，见 §3.2 |
| `WrapUp` | offer the user a next step when a turn ends | 回合结束时给用户一个“下一步”（对应 `CLAUDE_CODE_ENABLE_WRAP_UP`） |
| `ReadWidgetContext` | read the state an MCP App view shared | 读取 MCP App 界面回传的状态 |
| `SendToProjectContext` | read what /send-to-project gathered about this folder | 配合 `/send-to-project` 命令 |

### 3.2 重点：REPL / Code Mode

这是本次差分里最有意思的变化。

- 2.1.311 里已经有 `"REPL"` 这个名字常量，但没有对应的工具定义，相关遥测只有 3 个。2.1.319 有了完整的工具定义，`tengu_repl_*` 事件增加到 23 个。
- 用户可见名是 `"Code Mode"` / `"Code Mode (experimental)"`，由 `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE` 开启。还有 `_RESTART` / `_RESTARTED_FROM` 两个变量，以及 `tengu_repl_mode_opt_in_dialog_*` 系列事件（需要用户同意才能开启）。
- 工具属性（观测）：`enablesCodeExecution: true`，`isConcurrencySafe → false`，`isReadOnly → false`，`backgrounding: "never"`。它的 `prompt()` 会拿到**当前工具列表和权限上下文**来动态生成描述；`toAutoClassifierInput` 交给分类器的是 `code` 原文。
- 权限说明文案大意是：执行的是 Claude 写的代码，代码运行中每次需要审批的工具调用，仍会**单独**经过 auto mode、用户或 hook 检查。
- 运行时 API 来自打包的类型声明 `core.{bash,powershell}.{sync,async}.d.ts` 和 `team.{sync,async}.d.ts`，配合 `shell` / `file` / `running` / `team` 四个 prelude。这 12 个资源全是 2.1.319 新增的，并且只被 REPL 所在的 chunk 引用（直接引用或经由两个只给它用的加载器 chunk）。（**更正**：05 文档初稿把它们算在了 Workflow 工具名下，已改正。）
- 新增的错误类型名透露了它的执行模型：`VMContextPoisonedError`、`ReplGlobalOverwrite`、`ReplParseError`、`McpCallRefusedError`、`UnwritableArgumentsError`。新增的拒绝类事件有 `tengu_repl_script_escape_refused`、`_rewrite_refused`、`_spawn_refused`、`tengu_repl_mcp_undeclared_args_refused`。

**推断**：Code Mode 就是“让模型写一段 JS，在受控的 VM 上下文里批量调用工具”（programmatic tool calling），能省掉多轮往返。它的安全模型是：脚本本身不算被授权的动作，脚本里每一次工具调用都照常过权限链；同时拦截逃逸 VM、改写全局、私自起进程、给 MCP 传未声明参数这些行为。`team.*.d.ts` 里的 `spawnContext` / `listContexts` 说明脚本还能开子上下文（子代理）。

### 3.3 下线：7 个 Artifact 内置 Skill（观测）

2.1.311 里打包的这些 Skill，在 2.1.319 里连同名字引用一起消失：

```text
artifact-components  artifact-data-table  artifact-explainer  artifact-report
doc  prototype  workshop
```

同时移除的资源有 `artifact-workshop.html`、`workshop-page.html`、`template.html`、`skeleton.html`、`tokens.css`、`component.css`、`decisions-script.html`、`theme-script.html`；旁路查询 `artifact_patch_edit` 和遥测 `tengu_artifact_patch_turn` 也一起去掉了。**推断**：Artifact 的生成模板从“内置 Skill”改成了别的分发方式（服务端或插件），或者整体重做；保留下来的只有 `artifact-design` / `artifact-diagramming` 两个指南类 Skill。

新增资源：`api-sign-in.md`、`latency-optimization.md` + `latency_probe.py`、`levers.md`、`measuring.md`、`message-threads.md`、`search.md`，以及一些 Agent 模板改名（如 `explainer-video-maker` → `video-explainer-maker`、`watchlist-scanner` → `stock-watchlist-scanner`）。

### 3.4 其他新增（观测）

| 类别 | 新增 |
|------|------|
| API beta（+4） | `claude-code-side-query-2026-09-29`、`tool-provenance-2026-10-26`、`request-tags-2026-08-21`、`program-use-case-ids-2026-09-17` |
| MCP `_meta` 键（+6） | `anthropic/approvalTicket`、`anthropic/readBaselineOfCall`、`anthropic/shellDirectoryHeld`、`anthropic/movesAtTimeout`、`anthropic/notPublicWhen`、`anthropic/chromeOwnTabsUnasked` |
| 旁路查询 | `+resume_cache_warm`（恢复会话时先预热 prompt cache，配 `CLAUDE_CODE_RESUME_CACHE_WARM`）；`−teleport_generate_title`、`−artifact_patch_edit` |
| Auto mode | `tengu_auto_mode_local_classifier_call` / `_switched_off`（**本地分类器**）、`_bash_prescreen_retry`、`_simulation_mark_wrong`、`_end_offer` |
| MCP 文件处理 | 16 个 `tengu_mcp_drive_download_*` / `tengu_mcp_gmail_attachment_*`：连接器下载的文件是存盘、留在对话里还是不读 |
| Hook | 新名字常量 `RunProjectHttpHook`、`RunProjectMcpHook`、`RunProjectModelHook`、`RunPluginHttpHook`、`JudgeHookCondition` |
| 环境变量（+75 / −3） | 如 `CLAUDE_CODE_SUBAGENT_EFFORT`、`CLAUDE_CODE_DISABLE_ULTRATHINK`、`CLAUDE_CODE_UPFRONT_TOOLS`、`CLAUDE_CODE_DROP_UNAVAILABLE_DEFERRED_TOOL`、`CLAUDE_CODE_NORMALIZE_PREFIX_CACHE(_VERIFY)`、`CLAUDE_CODE_DISABLE_SUBAGENT_HANDBACK`、`CLAUDE_CODE_DISABLE_FEATURE_FLAGS`、`CLAUDE_CODE_PERSONAL_HOOKS_OFF`；移除 `CLAUDE_CODE_LAZY_ENV_GETTERS`、`CLAUDE_CODE_MCP_HANDED_LISTINGS`、`CLAUDE_WORKSHOP_PROGRESS` |

### 3.5 没变的

- **33 个 hook 事件**、**6 种权限模式**、**hook 类型**、**11 种 agentType**、**3 种 API 上下文编辑策略**、出现的模型 ID 集合，两版完全一致。
- **CLI 面**：`--help`、`mcp --help`、`plugin --help` 的参数和子命令完全相同，只有 `auto-mode` 的描述从“…auto mode classifier configuration”简化成“…auto mode configuration”（[`cli-runtime-311.txt`](../evidence/cli-runtime-311.txt)）。

也就是说，11 天里对外接口（CLI、hook、权限模式）保持稳定，变化集中在内部：新工具、Skill 分发、分类器、缓存、MCP 文件处理。

## 4. 遥测事件变化：特性开关在快速轮换

| | 新增 | 移除 |
|---|---:|---:|
| `tengu_*` 事件 | 341 | 55 |
| 其中“形容词_名词”式代号（如 `tengu_jolly_*`、`tengu_mossy_*`） | 约 253 | 约 37 |

按功能前缀看，新增最多的是 `repl`（20）、`mcp`（16）、`auto`（7）。其余大部分新增是代号式名字。

移除的事件里有一批特性的收尾痕迹：`tengu_promo_*`（推广横幅 4 个）、`tengu_file_read_dedup` / `tengu_read_dedup_killswitch`（读文件去重的开关和熔断）、`tengu_daemon_install_prompt_answer`、`tengu_fleetview_peers`、`tengu_oauth_token_refresh_completed`。

**推断**：大约四分之三的新增事件是代号式名字，说明大量变更以**特性开关 + 实验**的方式灰度上线。去掉 killswitch 事件，通常意味着该特性已经稳定（或被放弃），开关代码随之删除。

## 5. 学到什么

1. **差分要比较“稳定标识”**：混淆构建之间直接 diff 源码没有意义，要先抽出跨版本稳定的名字集合（searchHint、事件名、环境变量、资源名）再比。
2. **外壳和内容要分开看**：这次 46 MB 的增长主要来自 Bun 运行时，JS 只占 12 MB。只看文件大小会误判成业务大幅膨胀。
3. **对外接口稳定、内部快速迭代**：CLI 和 hook 事件 11 天零变化，内部却新增了 4 个工具、下线了 7 个 Skill、轮换了几百个开关。这是同时服务插件生态和 SDK 用户的产品该有的节奏。
4. **Code Mode 的安全设计值得借鉴**：执行模型写的代码时，不给脚本整体授权，而是把脚本里的每次工具调用都重新送进原来的权限链，同时在 VM 层面拦截逃逸。

## 6. 复现

```bash
# 1) 两版分别 npm pack → REA inspect/extract（00 文档）→ bun-peek 还原模块名
# 2) 抽事实集合
node scripts/facts.mjs extracted/named-2.1.311 > facts-311.json
node scripts/facts.mjs extracted/named-2.1.319 > facts-319.json
# 3) 集合差
node scripts/diff-facts.mjs facts-311.json facts-319.json > diff-311-319.json
```

`facts.mjs` 的工具定义识别依赖 `dn({name:X, … searchHint:"…"})` 这种构建模式，抽不到名字的工具用 searchHint 当键（两版一致，所以可比）。
