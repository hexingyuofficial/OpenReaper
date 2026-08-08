# OpenReaper 开发者指南

状态：OpenReaper 0.1.0 候选版本开发者指南。

本指南面向维护者、worker agent、reviewer、Macro/pack 作者和未来贡献者，说明
OpenReaper 的架构边界，以及如何在不制造双重真相、隐藏执行路径或无证据支持
声明的前提下扩展产品。

## 修改前必读

修改文件前先读：

- `AGENTS.md`
- `docs/FOUNDATION_FREEZE_PLAN.md`
- `docs/REPOSITORY_LAYOUT.md`
- `docs/LAYER_PROGRESS.md`
- `docs/RATCHET_MODEL.md`
- 当前层级对应的 ABI 或 taxonomy 文档

开始工作时先运行 `git status --short`。只按精确路径 stage，不要还原用户或其他
窗口的改动。

## 产品术语

- `workflow`：用户面对的可复用流程，内部可以是 Recipe contract 或文件。
- `pack`：面向用户的 plugin、领域、workflow、媒体库、搜索或本地能力扩展包。
- `core capability pack`：冻结的内部能力域，例如 `reaper/packs/<pack>`。
- `extension pack`：用户可见 pack 的开发者术语。
- `macro`：有边界高频操作的 Template 产品类别，不是新工具层。

## 七层模型

OpenReaper 使用七个开发者层级：

```text
1. Truth Sources
2. Tool Surface
3. Capability Layer
4. Discovery / Search
5. State Layer
6. Orchestration Layer
7. Product UX Layer
```

原则是合并概念，不合并真相源。

## 1. 真相源

工程真相是 REAPER project state；能力真相是 repo descriptor 与 validated
runtime catalog。SQLite、artifact、搜索缓存、Recipe 或 pack 不能成为独立的
执行真相。

## 2. 工具表面

公开 agent-facing MCP 表面恰好有六个工具：

```text
ping
get_state
list_templates
list_recipes
call_template
call_recipe
```

不要添加第七个工具、第二套 Recipe executor、raw Lua runner、raw REAPER
Action、shell 或 UI automation 产品路径。

## 3. 能力层

- `template`：建立在 handler 上、经过审查的原子能力。
- `macro`：由 `list_templates` 发现、由 `call_template` 执行的 Template 产品类别。
- `recipe`：带 checkpoint、risk gate、recovery 和复用行为的长 workflow。

Macro 不是新工具层。若 Macro 缺少能力，应在有边界窗口内先修 handler/Template。
Recipe 只能组合已知能力，不得定义 raw Lua、raw Action、shell、未审查 Template
或 bypass。

### 平级 Macro 组合

默认 Agent context 有十五个平级、可执行 Macro：

```text
project.inspect / query / delete_targets / apply_layout / file
routing.apply
media.place_assets
items.analyze / apply
midi.apply
fx.apply_chain / set_controls
controls.set
automation.apply
render.targets
```

Discovery 为当前意图排序一到三个候选，只对精确 id 展开完整 manual。没有
Primary/Secondary 产品等级。改名 id 只作为隐藏兼容映射；direct Template 是带
typed reason 的长尾 fallback。

每个公开 Macro 必须执行固定、代码拥有的程序，并暴露 inputs、preflight、
mutation/read stages、live readback、blocker、recovery 和有界结果。Plan-only
行为不能作为已完成 Macro。

## 4. 发现与搜索

Discovery 使用 `list_templates`、`list_recipes` 和 `CapabilitySearchIndex`。
搜索索引只是 cache/ranking abstraction，不是能力真相。执行规则是：

```text
capability search may suggest
runtime catalog must authorize
```

## 5. 状态层

Artifact Store 保存 evidence original、report、snapshot、analysis payload、readback
proof 和 hydration source。Project SQLite Index 保存 query/navigation cache、
freshness、coverage、selected context、changed-since 和轻量搜索字段。

`macro.project.query` 是唯一 Project SQLite Index query/navigation 表面；它不是
raw SQL、write executor、render 或 save 表面。写入前必须按需 hydrate，并在
REAPER 中重新解析 live candidate。SQLite row 本身永远不能授权写入。

## 6. 编排层

该层组织 query、safe parallel reads、串行授权 mutation、批量 readback、固定
可执行 Macro、risk gate、recovery 和 cleanup。写路径是：

```text
SQLite candidate refs
-> 在 REAPER 中重新解析
-> 通过已接受能力路径执行
-> 从 REAPER 批量读回
-> 更新 Artifact Store 与 Project SQLite Index
```

不支持的 render format/target mode、control field、精确 project-file Macro 合同
之外的任意工程文件操作、任意 plugin 和 hardware/device routing 必须 fail
closed，不能变成 bypass。

## 7. 产品 UX 层

Product UX 包含 startup/reconnect、connection health、stale-session guard、范围化
授权、workflow save/share/install/fork、pack readiness、stock plugin fluency 和
初学者可读 blocker。不要要求用户理解 Template、Macro、handler、SQLite、
artifact、Bridge internals、ABI、session id 或 owner/generation。

## 好冗余与坏冗余

好的冗余包括 Artifact payload 与 SQLite index row、runtime catalog 与搜索索引、
Recipe checkpoint 与 readback artifact。坏的冗余包括双重真相、双执行路径、双份
完整 payload，以及默认倾倒 FX parameter、Automation point、routing graph 或媒体
分析。

## Macro 与 Pack 编写

Macro 和 extension pack 作者必须声明 namespace/owner、task intent、用户 label、
inputs/modes/ranges、依赖、plugin identity、risk policy、readback contract 和
evidence/support status。官方 Macro alias 只有通过有边界合同才能成为全局唯一
exact alias；partner/DLC/local pack alias 默认 package-scoped，冲突会阻止安装或
promotion。

Extension pack 的 manifest、permission、install/share/fork、scrub、validation、
evidence tier 和 plugin/media pack 规则见 `docs/EXTENSION_PACK_STANDARD.md`。

## 测试与证据

先运行最窄且有意义的测试；共享行为改变后再扩大。常见 gate 包括 descriptor/
static validation、fake smoke、runtime binding、discovery/menu、risk gate、readback
verification、用户流程 review，以及明确授权窗口内的 bounded live REAPER evidence。

Support wording 必须绑定匹配证据。Static docs、fake smoke、draft Recipe 或无关
portability note 不能提升 live support。

## 文档边界

- `docs/USER_GUIDE.md` 面向用户并保持 task-first。
- `docs/DEVELOPER_GUIDE.md` 承载 architecture 与 extension 规则。
- `docs/EXTENSION_PACK_STANDARD.md` 面向 pack 作者和验证。
- `docs/RUNBOOK.md` 面向 operator/live evidence 验收。

不得用 raw SQL、直接 SQLite 写入、raw Lua/Action、shell/UI bypass、hidden
executor 或第二套 Recipe 路径绕过缺失 Macro 或 held mode。

## 版本与打包

根 `package.json.version` 是唯一手工编辑的产品 SemVer。MCP server metadata、
package metadata、provenance、Doctor 输出、build id 和 ZIP 文件名都从它派生；
传入的打包版本必须完全一致，否则 build 失败。候选版本使用 `0.1.0-alpha.N`。
只有两平台 exact artifact 都完成 fresh installed acceptance，并通过最终
source-blind trust review，才能提升为 `0.1.0`。

平台包由 `scripts/package-openreaper-alpha.mjs` 构建。macOS 使用 POSIX/zsh
entrypoint；Windows 使用原生 PowerShell entrypoint。共享 kernel、Recipe、
transport、safety 和 evidence truth 必须一致。Windows runtime 不能依赖 Git
Bash、Git、WSL 或 SSH。
