# OpenReaper 开发者指南

状态：Alpha3 首个产品版本草案。

本指南面向 OpenReaper 维护者、worker agent、reviewer、macro 作者、extension pack 作者和未来贡献者。它说明改动应该放在哪里、哪个层级拥有某类决策，以及如何扩展 OpenReaper，同时避免制造双重真相、隐藏执行路径或没有证据的产品支持声明。

面向用户的说明书见 `docs/USER_GUIDE.md`。operator/live 证据流程见 `docs/RUNBOOK.md`。

## 修改前必读

修改文件前先读仓库规则和当前层级文档：

- `AGENTS.md`
- `docs/FOUNDATION_FREEZE_PLAN.md`
- `docs/REPOSITORY_LAYOUT.md`
- `docs/LAYER_PROGRESS.md`
- `docs/RATCHET_MODEL.md`
- 你正在修改的层级对应 ABI 或 taxonomy 文档

开始新工作时先看状态：

```bash
git status --short
```

尊重文件所有权。architecture/process 文件和冻结的 ABI/taxonomy 文档属于 control tower，除非 prompt 明确打开这些文件，否则不要编辑。layer 或 docs worker 窗口不要 commit，除非 prompt 明确允许。

## 仓库地图

重要路径：

```text
docs/                       architecture, ABI, taxonomy, guides, support docs
docs/abi/                   frozen layer contracts
docs/taxonomy/              core capability pack taxonomy
packages/core/              shared contracts, catalog, registry, helpers
packages/mcp-server/        MCP server and runtime binding
reaper/bridge/              REAPER-side bridge runtime
reaper/packs/<pack>/        internal core capability packs
recipes/official/           official recipe/workflow contracts
recipes/user/               local user-authored recipes
scripts/                    checks and local entrypoints
tests/                      layer, runtime, Alpha3, and integration tests
```

不要把旧仓库里 workflow-shaped 的 pack，例如 `loop`、`cleanup`、`delivery`、`layer`、`music_sketch`，迁移成 OpenReaper 顶层 pack。在这个仓库里，它们是 workflow family、recipe tag 或未来产品流程，不是 core capability domain。

## 产品术语

保持术语一致：

- `workflow`：用户面对的可复用流程。内部可表示为 recipe file 或 recipe packet。
- `recipe`：开发者层面的工作流契约，包含 checkpoint，组合已知能力。
- `template`：经过审查的原子能力，连接 runtime/bridge 行为。
- `macro`：面向常见有边界操作的 template 产品类别。通过 `list_templates` 发现，通过 `call_template` 执行。
- `pack`：用户面对的扩展包。
- `extension pack`：可安装/可分享的插件、工作流、媒体库、搜索或领域能力包。
- `core capability pack`：内部冻结的 taxonomy owner，例如 `reaper/packs/fx`；普通用户不应需要理解这个概念。

Macro 不是第六个工具。Pack 不是原始代码加载后门。Workflow 不是隐藏执行器。

## Phase 3 七层模型

Phase 3 使用七个开发者面对的层级：

```text
1. Truth Sources
2. Tool Surface
3. Capability Layer
4. Discovery / Search
5. State Layer
6. Orchestration Layer
7. Product UX Layer
```

核心原则是：合并概念，不合并真相源。只有职责清楚的冗余视图才应该保留。

### 1. Truth Sources

项目真相是 REAPER project state。

能力真相是已审查的 repo descriptors 加 validated runtime catalog。

证据真相是保留的 artifacts 和已审查 evidence records。证据可以支撑声明，但它本身不授权执行。

不要让 Project SQLite Index、CapabilitySearchIndex、workflow packets、extension packs 或 artifact summaries 变成独立执行真相。

### 2. Tool Surface

公开的 agent-facing MCP 表面保持严格五个工具：

```text
ping
get_state
list_templates
list_recipes
call_template
```

不要添加第六个 MCP 工具、公开 `call_recipe`、隐藏 recipe executor、raw Lua runner、raw REAPER action 路径、shell 路径，或把 UI automation 作为产品能力。

### 3. Capability Layer

Capability Layer 包含：

- templates：已审查的原子能力；
- macros：产品级 templates，带 label、task intent、safety policy、compact readback、typed blockers、声明依赖和测试；
- recipes：更长的 workflow contracts，带 checkpoints、assertions、evidence、risk gates、recovery 和 portability metadata。

层级关系保持：

```text
REAPER handler -> template -> macro -> recipe -> agent/user
```

如果 macro 或 recipe 需要缺失能力，不要用 raw Lua、raw action、shell、UI automation 或私有 executor 隐藏它。应打开有边界的 handler/template 窗口，添加经过审查的能力，运行相关 gate，然后再连接更高层产品面。

### 4. Discovery / Search

Discovery 使用 `list_templates`、`list_recipes` 和 `CapabilitySearchIndex`。

`CapabilitySearchIndex` 是 Discovery/Search 的缓存和排序抽象。它可以索引 templates、macros、recipes、workflows 和未来 extension-pack capability cards。它首先应是 in-memory。只有 installed workflows/packs 或 UI search 规模证明必要时，才考虑 SQLite-backed 实现。

执行规则：

```text
CapabilitySearchIndex may suggest.
Runtime catalog must authorize.
```

搜索输出默认应 compact，通过 exact-id expansion 和 field selection 获取细节。搜索不得绕过 lifecycle、risk、support 或 catalog authorization。

### 5. State Layer

State Layer 有两个主要 store，职责不同。

Artifact Store：

- 保留 evidence originals；
- 存储 reports、snapshots、analysis payloads 和 readback proof；
- 用 artifact refs 持有大 payload；
- 是 `payload_ref` hydration 的来源。

Project SQLite Index：

- 为当前 project/session 存储 query/navigation/cache rows；
- 跟踪 freshness 和 coverage；
- 支持 selected context、changed-since、paging 和轻量 searchable fields；
- 只有完整匹配 project/session/bridge identity 时，持久化 rows 才可用。

常见 SQLite row 形状：

```text
ref
owner_ref
summary fields
freshness_status
coverage_status
observed_at
snapshot_id
payload_ref
```

`payload_ref` 指向 Artifact Store 证据。不要默认把深 payload 复制进 SQLite。SQLite 可以让决策更快，但写操作前仍必须由 REAPER 确认真相。

### 6. Orchestration Layer

Orchestration Layer 组织安全、快速的工作：

- query macros；
- selected-context 和 hydration planning；
- batch readback；
- safe parallel reads；
- serial authorized mutations；
- generic control macros；
- recovery 和 cleanup planning；
- risk gates 和 typed blockers。

写路径：

```text
SQLite candidate refs
-> refresh or re-resolve in REAPER
-> execute through accepted capability path
-> batch readback from REAPER
-> update Artifact Store and Project SQLite Index
```

Plan-only orchestration 可以返回可跟随的 request plan，但不能声称已经执行。Readback mismatch、stale refs、catalog drift 和 unsupported fields 必须返回 typed blockers，而不是成功形状的响应。

### 7. Product UX Layer

Product UX 包含：

- startup 和 reconnect；
- connection health 和 stale-session guard；
- scoped authorization；
- concise readback；
- workflow save/scrub/share/install/fork；
- extension-pack install/readiness/support status；
- stock plugin semantic controls；
- beginner-readable blockers 和 recovery。

用户主要用自然语言表达。不要要求用户理解 templates、macros、handlers、SQLite、artifacts、ABI layers、session ids 或 owner/generation values。

## 好冗余和坏冗余

好冗余：

- Artifact payload 加 SQLite indexed rows。
- Runtime catalog 加 CapabilitySearchIndex。
- Recipe checkpoints 加 readback artifacts。
- Plan output 加 post-action readback。

坏冗余：

- 双执行路径；
- project state 的双重真相；
- capability support 的双重真相；
- 默认把完整 artifact payload 复制进 SQLite；
- 默认倾倒 FX parameters、automation points、routing graphs、media analysis 或巨大 project overview。

## Template、Macro 和 Recipe 规则

Templates 是危险边界。它们会触及 REAPER state、files、routing、FX、automation、render、actions、bridge/runtime behavior 和 artifacts。Template 扩展是经过审查的 maintainer/developer-mode 工作。

Macros 被接受后是 customer entrypoints。一个 macro 需要：

- canonical id 和 namespace；
- user label 和 task intent；
- menu group；
- input/output schema；
- execution shape；
- risk policy 和 hard stops；
- required templates/handlers/plugins/services/indexes；
- compact readback；
- typed blockers；
- 与支持声明匹配的 tests 和 evidence。

Recipes 组合已知能力。它们可以声明 steps、checkpoints、assertions、recovery、idempotency、expected outputs 和 portability metadata，但不能创造新能力。

没有公开 `call_recipe`。Agents 通过正常 discovery、`call_template` 和 `get_state` 调用执行 workflows。

## CapabilitySearchIndex

这个 index 用于快速找到可能适合的产品能力。它可以按这些维度排序：

- task intent；
- user label；
- aliases；
- tags；
- lifecycle/support status；
- pack 或 namespace；
- risk class；
- required plugin/service；
- evidence level。

最低接口方向：

```text
buildFromCatalog(catalog)
search(query, filters, fields, limit, cursor)
getFingerprint()
invalidate()
```

Invalidation 应跟随 catalog fingerprints、installed workflow/pack changes 和 extension-pack registry changes。Index 不能决定某个能力可执行。它只返回 candidates；runtime catalog validation 和 risk policy 决定执行。

## Project SQLite Index

Project SQLite Index 的目标是让用户级 query 和 macro flows 更快、更安全。它不是通用 raw-SQL 表面。

已接受的 Alpha3 覆盖包括 resident/project index helpers、optional SQLite persistence、identity guards、freshness/coverage rows、selected context、tracks、items、takes、FX、routing、markers/regions、media、changed-since、hydrate-ref planning、catalog-drift blockers 和有序 next-action guidance。

Broad customer-usable `query_automation` 仍被缺失的 lower-layer read-only automation envelope inventory template 阻塞。不要在 query 代码里隐藏这个缺口。

规则：

- 不暴露 user raw SQL；
- stale 或 missing identity 应进入 degraded/blocked，而不是 trusted；
- write tasks 需要 fresh target refs 和相关 owner context；
- refresh plans 只能发出 accepted call-template requests；
- catalog drift 返回 typed blockers；
- writes 只能在 REAPER readback 后更新 SQLite。

## Artifact Store

Artifacts 是保留证据和大 payload。它们通过 refs 寻址，不是文件路径。Agents 通过 `get_state` 读取 bounded summaries 或 payloads。

适合用 artifacts 保存：

- large project snapshots；
- observation bundles；
- analysis reports；
- render 或 delivery reports；
- cleanup/fingerprint evidence；
- readback proof；
- 默认响应放不下的大 payload。

不要把本地文件路径、traversal、公开 `last_result` artifact aliases 或 raw payload dumps 作为正常用户态 state 暴露。

## Orchestration 和 Risk Gates

产品应该快，但不能鲁莽。

已接受的 Alpha3 orchestration 当前是 execution scheduling 的 plan-only 能力：它可以组织 safe parallel reads、serial authorized mutations、batch readback、hard stops、recovery 和 concise reporting。它本身不扩大 live support，也不创建新 executor。

Risk policy 应支持 scoped authorization，例如：

```text
Allow reversible track, item, send, and stock-plugin parameter changes for
this task; do not delete, export, overwrite, scan private folders, or change
hardware I/O.
```

破坏性删除、overwrite/export、hardware I/O、paid/licensed downloads、privacy-sensitive scans 和 ambiguous irreversible actions 仍然是 hard stops。

## Extension Pack Standard

Extension packs 详见 `docs/EXTENSION_PACK_STANDARD.md`。

一个 extension pack 必须声明：

- `pack_id`、namespace、owner、version、compatibility 和 support status；
- contributed capabilities 和 workflow entries；
- 对 plugins、services、indexes、templates 或 handlers 的依赖；
- permissions 和 risk classes；
- aliases；
- evidence；
- privacy、scrub、cache、changelog 和 deprecation policy。

Aliases 默认 package-scoped。Global alias execution 尚未广泛启用；promotion 需要明确的有边界契约和证据。Pack installation/portability gates 可以写 manifest 和 disabled registry rows，但 D2.4 不会改变 enabled execution state，也不会暴露 global aliases。

Plugin-control packs 需要 plugin identity、semantic parameter maps、safe ranges、owner-scoped FX checks、compact readback、tests 和有边界 live/customer smoke，才能使用 supported wording。

Media/search packs 需要 source permissions、privacy policy、provenance、candidate refs、preview/import contracts 和 typed blockers。搜索结果不授权写操作。

## Stock Plugin Fluency

Alpha3 stock plugin 工作覆盖 ReaEQ、ReaComp、ReaGate、ReaDelay、ReaSynth、RS5k、ReaTune、ReaPitch、ReaXcomp 和 ReaLimit 的 semantic controls。

当前边界：

- semantic maps、starter actions、hydration guidance、readback/evidence envelopes 和 agent execution flow 已接受；
- ReaComp 有有边界的 live write/readback 证据；
- 其他优先 stock plugins 在使用 broad live support wording 前，需要有边界 live 证据；
- 这项工作没有添加 alias expansion、hidden executor、公开 `call_recipe` 或 raw bypass。

## Tests 和 Evidence

先用最窄但有意义的 check；如果改动触及共享表面，再扩大检查范围。

常见 gates：

- descriptor/static validation；
- fake smoke；
- runtime binding tests；
- discovery/menu tests；
- risk gate tests；
- readback verification tests；
- workflow/pack portability tests；
- support-matrix wording review；
- customer-facing flows 的 trial-officer review；
- 只有明确打开窗口时才做 bounded live REAPER evidence。

常用命令：

```bash
npm run check:layout
npm run check:template-runtime
npm run check:alpha3-c3
npm run check:alpha3-c4
npm run check:alpha3-c5
npm run check:alpha3-d1
npm run check:alpha3-d2
npm run check:alpha3-e1
npm test
git diff --check
```

Support wording 必须绑定匹配证据。Static docs、fake smoke、draft recipes、portability packets 和 plan-only orchestration 本身都不能提升 live support。

## 当前限制

在代码注释、产品 metadata、docs 和 reviews 中，相关时应保持这些限制可见：

- 本地 macOS manual-bridge support 仍是 evidence-bound live baseline；
- true customer-ready one-click/app-wrapper startup 仍需要 bounded live startup evidence；
- extension-pack enable/disable/update/uninstall/global alias execution 仍是 readiness-gated；
- generic controls 和 orchestration 在没有 live execution evidence promoted 的地方仍是 plan-only；
- broad `query_automation` 被缺失的 lower-layer read inventory 阻塞；
- ReaComp 是当前唯一有 bounded live macro evidence 的 stock-plugin 行；
- recipe-level live/local portability 仅对 `recipe.project.cleanup_fingerprint_report` 接受；
- remote-clone/new-machine portability 尚未证明；
- 普通产品路径不允许用户创建 templates 或新的 automation powers。

## Review Checklist

返回工作前自查：

- 是否只改了分配范围？
- 是否保留冻结 lower-layer contracts？
- 是否保持 REAPER 和 runtime catalog 作为真相？
- 是否避免新工具、隐藏执行器、raw Lua/action/shell/UI bypass 和公开 `call_recipe`？
- 是否区分 plan/static/fake/live evidence？
- 是否添加或运行了与影响面匹配的 tests？
- 是否避免没有证据的 broad support wording？
- 是否报告未 commit 和剩余风险？

对 docs，还要检查 `docs/USER_GUIDE.md` 是否保持 task-first 和 beginner-readable，而本指南是否承载 architecture 和 extension 规则。
