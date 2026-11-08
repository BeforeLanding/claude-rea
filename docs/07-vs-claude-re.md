# 07 · 与 claude-re 的对比、边界与未做事项

## 1. 方法对比

| 维度 | [lvy010/claude-re](https://github.com/lvy010/claude-re) | 本仓库 |
|------|------|------|
| 靶标 | 2.1.301，darwin-arm64，Mach-O（VS Code 扩展内） | 2.1.319，win32-x64，PE（npm 平台包） |
| 工具 | Craft Anything（原生分析视角） | REA main + 一行补丁（Bun 解包）+ REA 6.8.0（JS 分析） |
| 到达深度 | Mach-O 结构、`__bun` 段字符串命中 | **解包 `.bun` 模块图**，得到 3,128 个模块的源码 / 资源 |
| `tool_use` 追踪 | “121 处字符串命中，0 个函数” | 能直接读到工具定义对象、循环状态对象、配对守卫的完整逻辑 |
| 工具清单 | 正则扫 `*Tool` 类名（29 个） | 从定义对象抽属性（searchHint / 上限 / 并发 / 只读 / 延迟 / 后台） |
| 未覆盖 | `__bun` JS AST 解包 | 字节码；函数级调用图（被混淆）；运行时行为 |

结论一致：两者都确认 **Claude Code = Bun 运行时 + 嵌入的 TypeScript harness**，工具调用走公开的 Messages API `tool_use` / `tool_result` 契约，产品差异在 harness 层（权限、hook、MCP、ToolHost、上下文管理）。

## 2. 交叉验证

- claude-re 的 `tool-classes-clean.txt` 里的 29 个类名（`BashTool`、`FileReadTool`、`ToolSearchTool` …）**全部**能在 2.1.319 的解包内容中找到（[`evidence/claude-re-classnames-in-2.1.319.txt`](../evidence/claude-re-classnames-in-2.1.319.txt)，第二列是命中的模块数）。
- claude-re 提到的 `getAllBaseTools`、`runToolUse`、`streamingToolExecutor`、`ensureToolResultPairing`、`canUseTool`、`betaAgentToolset…` 在 2.1.319 中仍然存在（分别出现在 10 / 2 / 1 / 1 / 47 / 2 个模块里）。
- claude-re 的 `cli-runtime.txt` 只截了部分 `--help`，所以本仓库**不做**两个版本的逐参数对比，免得把“没截到”误当成“新增”。

## 3. REA 的表现（工具评估）

| 能力 | 结果 |
|------|------|
| `inspect-artifact`（6.8.0） | 只认出 PE，没识别 Bun 图（读取器尚未发版） |
| `inspect-artifact`（main） | 识别出 `bun-1.3.9` / `pe-section` / 3,128 模块，但被扩展预算拦下（共享字节码区） |
| 本地补丁后 | `inspect-artifact` 5.5 秒，`extract-artifact` 约 2 分 15 秒，完整解包 |
| `analyze-javascript-application`（main） | Windows 原生模块与 main 不匹配，`source-transfer` 阶段失败 |
| `analyze-javascript-application`（6.8.0） | 单文件超过 300 秒的上限后中止，此时处理了 273/2,887 个文件；部分图有 583 个模块、15,996 条 import 边、少量网络端点（[`evidence/js-graph-partial.txt`](../evidence/js-graph-partial.txt)） |
| `inspect-binary-layout` | pwntools 剖面只支持 Linux x64 |

部分 import 图里被引用最多的 chunk 依次是 `chunk-1ks9vs37.js`（配置 / 鉴权，89 次）、`chunk-2pp12te6.js`、`chunk-27h4st9h.js`（主循环，84 次），和 01 文档按体积、按事件判断的职责一致。

**体会**：REA 的价值在**格式层**，能可靠找到并解出 Bun 图，每一步都带 evidence_id 和局限说明。它的应用级 JS 分析是为 Electron 应用（几十到几百个有意义的模块）设计的，面对 2,900 个已混淆的 chunk 收益有限。对这类目标，用 REA 解包、再用 grep / 小脚本定向检索，效率最高。

## 4. 边界

- **混淆**：局部名字全被压缩，本仓库不尝试恢复函数级调用图。所有结论都落在“字段名、字符串、事件名、结构”这一层。
- **推断**：“作用 / 推断”列和明确写了**推断**的句子，都是根据名字和上下文的解释，没有运行时验证。
- **不含源码**：只发布名字和元数据。想深入请用 00 文档的步骤在本地复现。

## 5. 可以接着做的

1. ~~**版本差分**~~：已完成 2.1.311 → 2.1.319，见 [08 文档](08-version-diff-2.1.311-to-2.1.319.md)。还可以往前做到 2.1.301（claude-re 的版本），看更长时间跨度上的变化。
2. **上游反馈**：给 REA 提 issue，说明 Bun 图里共享物理区间导致扩展预算误判，建议按物理区间去重计费。
3. **跨平台一致性**：解包 darwin-arm64 / linux-x64 平台包，验证 `.bun` 模块表是否逐字节相同（是不是“一份 JS，多个运行时外壳”）。
4. **运行时观测**：在隔离环境里用 `-p --output-format stream-json` 加 `--include-hook-events` 观察真实的事件序列，验证 03 / 04 文档里标了**推断**的部分。
