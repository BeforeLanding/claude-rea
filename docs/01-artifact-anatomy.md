# 01 · 产物解剖：PE + Bun 模块图

## 1. PE 节表（观测）

```text
节名        vsize        rawsize      rawptr
.text       122,660,934  122,661,376  1,536          ← Bun/JSC 原生代码
.rdata       27,463,768   27,464,192  122,662,912
.data         2,323,328      130,560  150,127,104
.pdata        1,726,296    1,726,464  150,257,664
.bunaot           3,752        4,096  151,984,128
.bunblt       2,763,134    2,763,264  151,988,224
.bunfeat            536        1,024  154,751,488
.bunid               32          512  154,752,512
.fptable            256          512  154,753,024
.tls             23,510       23,552  154,753,536
_RDATA              500          512  154,777,088
__DATA,_         16,384       16,384  154,777,600   ← 两个同名节（名字被 8 字节截断）
__DATA,_         16,384       16,384  154,793,984
.rsrc           200,748      201,216  154,810,368
.reloc          301,532      301,568  155,011,584
.bun        189,483,232  189,483,520  155,313,152  ← 嵌入的模块图
```

和 claude-re 在 Mach-O 里看到的 `__BUN,__bun` / `__jsc_int` 对应，PE 版本多出 `.bunaot`、`.bunblt`、`.bunfeat`、`.bunid` 四个 Bun 自用节（**推断**：分别与 AOT、内建模块、特性开关、构建 ID 有关，本仓库没有深挖）。`.text` 有 117 MB，主要是 JavaScriptCore 和 Bun 运行时本身，业务逻辑全在 `.bun`。

## 2. `.bun` 节的二进制格式（观测 + REA）

```text
.bun 节
├─ u64  payload_length = 189,483,224
└─ payload
   ├─ [数据区] 模块名 / 源码 / 字节码 / 资源 …（各模块用 {offset,length} 指针引用）
   ├─ [模块表] 3,128 条 × 52 字节，起于 payload+189,294,756，长 162,656
   ├─ Offsets（32 字节）
   │    u64 byte_count          = 189,483,176
   │    u32 modules.offset/len  = 189,294,756 / 162,656
   │    u32 entry_point_id      = 7                → B:/~BUN/root/cli
   │    u32 exec_argv.offset/len→ "--zero-fill-buffers"
   │    u32 flags               = 15359
   └─ 尾标 "\n---- Bun! ----\n"（16 字节）
```

单条模块记录（52 字节，REA 称 `bun-1.3.9` 布局）：

| 偏移 | 字段 | 说明 |
|-----:|------|------|
| 0 | `name` 指针 | 如 `B:/~BUN/root/chunk-wt4dg253.js`（Windows 下虚拟根是 `B:/~BUN/`） |
| 8 | `contents` 指针 | 源码 / 资源本体 |
| 16 | `sourcemap` 指针 | **全部为空**，没有随包发 sourcemap |
| 24 | `bytecode` 指针 | 见 §3 |
| 32 | `module_info` 指针 | 全部为空 |
| 40 | `bytecode_origin` 指针 | 字节码对应的源路径（2,880 个模块有） |
| 48 | encoding / loader / module_format / side | 各 1 字节 |

REA 解出来的记录类型分布：

| encoding / loader / format / side | 数量 | 是什么 |
|---|---:|---|
| latin1 / js / esm / server | 2,881 | JS 模块：2,878 个 `chunk-*.js`、入口 `cli`、`audio-capture.js` 等 |
| latin1 或 utf8 / text / none / client | 103 | Markdown、提示模板、`.d.ts`、示例代码（文本） |
| binary / file / none / client | 143 | `*.zst` 压缩文档、字体 `.woff2.asset` |
| binary / napi / none / client | 1 | `audio-capture.node`（原生插件，推断用于语音输入） |

## 3. 共享字节码区

2,880 个 JS 模块都有 `bytecode` 指针，但指向的不是各自独立的一小块：

```text
module 0  bytecode = [23,877,112 , len 108,171,704]
module 1  bytecode = [23,877,748 , len 108,171,068]
module 2  bytecode = [23,878,712 , len 108,170,104]
...
所有区间的终点都是 132,048,816
```

也就是说，整个程序的 JSC 字节码是一块连续的约 108 MB 区域。每个模块只记录自己在这块区域里的起点，长度一律写成“到区尾”。**推断**：Bun 把整张模块图的字节码一次性生成并整体加载，单个模块的“长度”在运行时用不到，所以序列化时没有精确记录。

这正是 REA 预算误判的原因（00 文档坑 2）：按条目求和是 94.7 GB，按物理区间去重只有 108 MB。

每个 JS 模块的源码开头都是：

```js
// @bun @bytecode
// (c) Anthropic PBC. All rights reserved. ...
// Version: 2.1.319
```

`@bytecode` 标记表示“运行时优先用预编译字节码”。源码仍保留在包里（Bun 需要它做函数 `toString`、报错位置和字节码失效时的回退），所以静态分析能直接读源码。

## 4. 模块构成

| 类别 | 数量 | 例子 |
|------|-----:|------|
| JS chunk | 2,878 | `chunk-27h4st9h.js`（最大，5.4 MB，主循环 / 工具 / 权限的大部分逻辑） |
| 入口 | 1 | `cli`（26 KB，只做环境检查后 import 各 chunk） |
| 第三方前端库 | 若干 | `mermaid.min.js`、`chart.umd.min.js`、`hljsBundle.generated.min.js` |
| Worker | 1 | `src/plugins/functionHooks/hooks-worker/hooks-worker.js`（唯一一个保留了源路径的模块） |
| 内置 Skill / 文档 | 211（.md / .zst / .txt） | 见 05 文档 |
| 字体 | 2 | `anthropicSans400.woff2`、`anthropicSerif400.woff2`（Artifact 渲染用） |
| 原生插件 | 1 | `audio-capture.node`（推断：语音输入的音频采集） |

按体积排的前几个 chunk，以及其中出现最多的遥测事件（用来大致判断 chunk 的职责）：

| chunk | 大小 | 高频 `tengu_*` 事件 → 推断职责 |
|-------|-----:|------|
| `chunk-27h4st9h.js` | 5.39 MB | `auto_mode_fallback_to_ask`、`streaming_error`、`file_history_rewind…` → 主循环、工具、权限 |
| `chunk-cbbfqbjt.js` | 1.94 MB | `feedback_survey_event`、`plan_exit` → TUI 交互 |
| `chunk-49xa1zr6.js` | 1.57 MB | 无 → 第三方依赖 |
| `chunk-z7bs0q82.js` | 1.08 MB | `sandbox_scrub_…`、`darwin_thread_cwd` → 沙箱 / 进程 |
| `chunk-35hbws1h.js` | 0.96 MB | `session_resumed`、`sdk_result` → 会话 / SDK 输出 |
| `chunk-1ks9vs37.js` | 0.95 MB | `config_auth_loss_prevented`、`oauth_` → 配置与鉴权 |
| `chunk-kcs58ea0.js` | 0.63 MB | `artifact_verify` → Artifact |
| `chunk-cxcakgnv.js` | 0.60 MB | `git_operation`、`team_mem_…` → Git / 团队记忆 |

## 5. 名字保留情况

- **模块级**：chunk 名是内容哈希（`chunk-xxxxxxxx.js`），看不出原始文件结构。
- **标识符级**：局部变量和函数名都被压缩（`Qr`、`Me`、`dt`…），但**对象属性名、字符串、错误文案、遥测事件名全部保留**。所以函数级调用图难恢复，接口形状（字段名）和行为（文案、事件）却很清楚。少数函数名还留在错误文案里，比如 `ensureToolResultPairing: ...`。
- 这正好解释了 claude-re 的观测：“`tool_use` 有 121 处字符串命中、0 个函数命中”。名字都在 JS 字符串里，原生符号表里本来就没有它们。
