# Streetlight 内核硬化规格 — Agent-DAW 的地基

> 本文是**可执行规格**，写给将要实施它的 agent。目标读者不是人类读者，而是
> 一个会照着改代码的 agent。每一节都给出：**目标 / 触及文件 / 契约 / 验收**。
> 不要把本文当愿景文档读——它是合同。
>
> 战略前提见 `docs/ARCHITECTURE.md`，路线全景见 `docs/ROADMAP.md`。本文只管
> **一件事**：把内核硬化到「新能力是机械化、可验证的单元」的程度，使广度从
> 人力活变成编译活。

---

## 0. 战略定位（不可动摇）

Streetlight 不争「功能最全的 REAPER MCP」。市面已有 58–80 工具的对手
（mthines、bonfire-audio、TwelveTake、total-reaper），它们的共性是：
**手写工具、无操作契约、手动 smoke、默认放行全部权限**。

Streetlight 争的是**唯一一个可信、可验证、可无限生长的 REAPER 内核**：

1. **可信** — risk 默认拒绝破坏性操作；每个 mutation 进 undo block；agent 不能
   越过 schema 乱来。
2. **可验证** — 每个 mutation 声明*预期变更*，bridge 报告*实际变更*，不符即
   `VERIFY_FAILED`。这是对手都没有的护城河，关掉了「agent 说它改了、但我不知道
   它到底干了啥」的信任缺口。
3. **可生长** — 工具面**永远 5 个**，能力作为数据增长；模板由描述符**生成**而非
   手写，广度成为商品。

> 一句话：**别人在上面搭 frontend，我们做底座。赌注是深度的正确性，不是广度的
> 功能。**

---

## 1. 内核不变量（NEVER BREAK）

以下契约是内核的脊椎。任何 PR 若违反其一，默认拒绝合并。它们已在当前代码中成立，
硬化工作**只能加固、不能削弱**它们。

| # | 不变量 | 当前落点 | 强制方式 |
|---|--------|----------|----------|
| I1 | MCP 工具面固定为 5：`ping` / `get_state` / `call_template` / `list_templates` / `list_recipes`。能力增长**不得**新增工具。 | `packages/mcp-server/src/index.ts` | 代码评审 + 测试断言工具数 |
| I2 | `Result<T>` 严格两态（`Ok<T>` \| `Err`），**永不抛异常**给 agent。 | `packages/core/src/result.ts` | 类型 + 现有测试 |
| I3 | `call_template` 成功信封锁定为 `{ template, changed_count, changed_ids[≤50], truncated }`。handler 多返回的字段在 bridge 边界**被丢弃**。 | `streetlight_bridge.lua` `build_template_envelope` | bridge 强制 + 单测 |
| I4 | 错误码是 TS↔Lua **同一套字符串**。Lua 写 result JSON 必须引用由 `errors.ts` 生成的 `error_codes.lua` 常量。 | `packages/core/src/errors.ts` ↔ `reaper/packs/core/error_codes.lua` ↔ `streetlight_bridge.lua`/handlers | 共享常量来源 + literal audit（见 H5 / Slice 05） |
| I5 | ref 生命周期：`selected:N`（快照）/ `guid:{...}`（跨命令稳定）/ `last_result:<kind>:N`（会话内）/ `track:Name`。多步配方**禁止**跨命令依赖 `selected:N`。 | `reaper/packs/core/refs.lua`、`ARCHITECTURE.md` | resolver + 测试 |
| I6 | risk 默认策略**拒绝** `destructive` 与 `unsafe_eval`。`unsafe_eval` 永远默认关。 | `packages/core/src/risk.ts` | `defaultPolicy()` + 测试 |
| I7 | 每个 mutating 模板进 undo block；read-only 路径（`ping`/`get_state`）**不得**触碰 `LAST_RESULT`。 | `manifest.lua` `undoable`/`undo_flags`、bridge `finalize_template` | manifest 数据 + 测试 |
| I8 | bridge **不执行任意字符串**：无 `dofile`/`load`/`loadstring` 处理命令。每个 handler 是静态可审查代码。 | `manifest.lua` 静态派发表 | 代码评审 |
| I9 | capability manifest 是**唯一真相源**：模板的 entity_kind / undo / risk 等元数据只在一处声明。 | 见 H1/H5 | 本文新增不变量 |
| I10 | 每个 mutating 模板声明 `expected_delta`；bridge 报告 `actual_delta`；不符即 `VERIFY_FAILED`。 | 见 H2 | 本文新增不变量 |

---

## 2. 硬化工作（按依赖顺序，每项可独立交付）

记号：`H1..H7`。依赖关系见 §6。每项是一个 PR 量级的工作流。

---

### H1 — `entity_kind` 数据驱动（解耦 dispatcher）

**目标**：消除 bridge 里对实体种类的硬编码假设，让新实体（fx / param /
envelope / note）无需改 dispatcher 即可加入。

**现状问题**（已读源码确认）：
- `streetlight_bridge.lua` 里 `ENTITY_BUCKET = { item, track, region, render }`
  是硬编码表。
- `finalize_template` 对未知 entity_kind **静默 fallback 到 `items` 桶**并打
  warning——这在开发期会掩盖 manifest 笔误。
- `refs.lua` 的 resolver 是 `resolve_item` / `resolve_track` / `resolve_region`
  三个独立函数，新增实体要再写一个并在多处接线。

**契约**：
1. `LAST_RESULT` 的桶集合由已注册 manifest 的 `entity_kind` 集合**动态生成**，
   不再写死。
2. 引入统一 resolver 注册表 `REF_RESOLVERS[entity_kind] = fn(ref, last_result)`，
   `resolve_item/track/region` 注册进去；新增实体只注册一个 resolver。
3. **开发期**未知 entity_kind 必须**硬失败**（`INTERNAL_ERROR`），不再静默 fallback。
   生产期可保留 fallback + loud log，由环境变量 `STREETLIGHT_STRICT_MANIFEST`
   切换（默认严格）。

**触及文件**：
- `reaper/streetlight_bridge.lua`（`ENTITY_BUCKET`、`finalize_template`）
- `reaper/packs/core/refs.lua`（resolver 注册表）
- `reaper/packs/core/manifest.lua`（entity_kind 仍在此声明，但成为唯一来源）

**验收**：
- 新增一个**假实体** `entity_kind = "note"`（仅测试用 manifest），不改
  dispatcher 即可让 `last_result:note:0` 解析路径跑通。
- manifest 笔误（未知 entity_kind）在严格模式下让该模板**注册时**报错，而非运行时。
- 现有 207 测试全绿。

---

### H2 — 验证闭环 `expected_delta` vs `actual_delta`（护城河）

**目标**：每个 mutating 模板声明它**预期改变什么**；bridge 在 undo block 内
捕获 before/after，计算**实际改变**；不符即 `VERIFY_FAILED`。这是对手都没有的能力，
是 agent-DAW「敢放手」的基础。

**契约**：
1. `CapabilityDefinition` 新增可选字段 `expectedDelta`（声明式）：

   ```ts
   // packages/core/src/registry.ts
   interface ExpectedDelta {
     entity: "item" | "track" | "region" | string; // 复用 entity_kind
     count: number | "any";        // 预期改动的实体数量（item_pitch=1）
     fields?: string[];            // 预期被写的字段（如 ["D_PITCH"]）
     creates?: boolean;            // 是否新建实体（track_create=true）
     deletes?: boolean;            // 是否删除实体
   }
   ```

2. bridge 在 handler 执行前后对**受影响实体**做字段快照（仅 `expectedDelta.fields`
   列出的字段，避免全量序列化），算出 `actual_delta`，与声明比对。
3. 新错误码 `VERIFY_FAILED`（加入 `errors.ts`，`recoverable: false`——它意味着
   「操作执行了但效果与契约不符」，agent 不应盲目重试，应 `get_state` 对账）。
4. 成功信封**不变**（I3），`actual_delta` 仅在 verify 失败时进 `error.details`，
   或在显式 debug 模式下回传。**默认不污染锁定信封。**

2026-06-30 note: Slice 04 landed structural count verification. Slice
06 lands the first field-level subset for `item_pitch`, `item_move`,
`item_rate`, and `track_rename`; the remaining templates stay Slice 07+
scope.

2026-06-30 note: Slice 07 extends field-level verification to
`item_trim` and introduces `optional:true` field descriptors for params
that are validly absent. `item_fade`, `item_duplicate`, `track_create`,
`media_import`, `region_create`, and `render_region` stay Slice 08+
scope.

2026-06-30 note: Slice 08 extends field-level verification to
`item_fade` and introduces `nullable:true` field descriptors. In
`verify.lua`, explicit `json.null` is coerced to expected value `0`,
matching the fade-clear handler contract. `item_duplicate`,
`track_create`, `media_import`, and `region_create` stay Slice 09+
because creates/maybeCreates templates still need the D5 relaxation.

2026-06-30 note: Slice 09 extends field-level verification to
`item_duplicate` and makes the first narrow D5 relaxation:
`expectedDelta.fields[]` may coexist with `creates:true` only when
`count` is a finite positive integer. `track_create` / `maybeCreates`
stays Slice 10, `media_import` / `count:"any"` stays Slice 11+, and
`region_create` / region-scope field readers stay Slice 12+.

2026-06-30 note: Slice 10 extends field-level verification to
`track_create` and makes the second narrow D5 relaxation:
`expectedDelta.fields[]` may coexist with `maybeCreates:true` only when
`count` is a finite positive integer. Create and reuse paths both run
field verification on track `P_NAME`. `media_import` / `count:"any"`
stays Slice 11+, and `region_create` / region-scope field readers stay
Slice 12+.

2026-06-30 note: Slice 11 extends field-level verification to
`media_import` and makes the third narrow D5 relaxation:
`expectedDelta.fields[]` may coexist with `creates:true` plus
`count:"any"`. Runtime verification stays bounded by checking only
`changed_ids[1]` (first-item verify), with item `D_POSITION` compared to
`params.position` at tolerance `1e-6`. `region_create` / region-scope
field readers stay Slice 12+.

2026-06-30 note: Slice 12 extends field-level verification to
`region_create` and adds the `region` field scope. `verify.lua` now
parses name-shaped `region:NAME` changed ids and reads a synthetic
region handle `{index,pos,rgnend,name}`. The Slice 12 descriptor declares
only `region.name <- params.name`; this is a pipeline proof-of-life like
Slice 10's `track_create` reuse path. Bounds verification (`pos` /
`rgnend`) stays Slice 13 because explicit and item-derived region modes
need their own paramPath decision. H2 v0.1 coverage is now 10/11; the
remaining `render_region` template is the permanent artifact-path
carve-out.

2026-06-30 note: Slice 13 expands `region_create.expectedDelta.fields[]`
from one region field to three: `name <- params.name`,
`pos <- params.start`, and `rgnend <- params.end`. The two bounds fields
are `optional:true` with tolerance `1e-6`, so explicit mode
`{name,start,end}` verifies all three fields while item-derived mode
`{name,item_id}` skips the bounds fields and remains name-only
proof-of-life. This intentionally avoids a new "computed expected" axis
that would have to resolve `item_id` and derive `position + length`.
`verify.lua`, `region.lua`, and `streetlight_bridge.lua` do not change
in Slice 13; the slice activates the region `pos` / `rgnend` readers
written in Slice 12 and the optional-absent rule from Slice 07.

**触及文件**：
- `packages/core/src/registry.ts`（`expectedDelta` 字段）
- `packages/core/src/errors.ts`（`VERIFY_FAILED`）
- `reaper/streetlight_bridge.lua`（before/after 快照 + 比对，在 undo block 内）
- 每个 `reaper/packs/core/templates/*.lua` handler 提供「我改了哪些实体」的回执
  （已有 `changed_ids`，只需补字段层快照钩子）

**验收**：
- 故意写一个 handler 声明 `count: 1` 但实际改 0 个 → 必返 `VERIFY_FAILED`。
- `item_pitch` 声明 `fields: ["D_PITCH"]`，正常调用 verify 通过。
- verify 开销可接受（字段级快照，非全工程）；render_region 等无项目态变更的模板
  可声明 `expectedDelta` 为产物型（文件存在性）或显式跳过。

> **战略备注**：H2 单独就值得对外讲。它是「可验证内核」定位的实锤，README 应
> 直接拿它和「自动放行 80 工具」的对手对比。

---

### H3 — 读模型框架（`get_state` scope + 投影 + 分页）

**目标**：把 `get_state` 从「只有 selection」扩成真正的读模型，支撑插件发现、
工程感知、写歌前置读取。这是所有「写」能力的前提——先能读到目标和校验依据。

**现状**（已读源码确认）：`KNOWN_SCOPES` 有 5 个名字，但 bridge 只实现
`selection`，其余返回 `SCOPE_NOT_IMPLEMENTED`。`get-state.ts` 已有 `limit` 上限
夹取（1–200）。

**契约**：
1. 实现 scope：`project`（BPM/拍号/采样率/render 设置）、`tracks`（轨道树）、
   `regions`（region 列表）。
2. 引入 `include` 投影：`get_state(tracks, include: ["fx"])` 才返回 FX 链；默认
   不含，保护 response budget。
3. 引入 `fields` 字段投影 + `cursor` 分页（接 `docs/RESPONSE_BUDGET.md` 的设计），
   把 v0.1 的「limit + 截断 + RESPONSE_TOO_LARGE」backstop 升级为真分页 API。
4. **所有读路径不得触碰 `LAST_RESULT`**（I7）。

**触及文件**：
- `packages/mcp-server/src/tools/get-state.ts`（scope/include/fields/cursor schema）
- `reaper/streetlight_bridge.lua`（`DISPATCH.get_state` 各 scope 实现）
- `docs/RESPONSE_BUDGET.md`（落实分页契约）

**验收**：
- `get_state(project)` 返回 BPM/拍号/采样率，不再 `SCOPE_NOT_IMPLEMENTED`。
- `get_state(tracks, include:["fx"])` 返回每轨 FX 链（名称/ident/启用/preset）。
- 大工程下分页可翻页，单页不超过 `MAX_RESPONSE_BYTES`。

---

### H4 — 幂等 token（安全重试）

**目标**：消除当前「mutating 命令超时 → `BRIDGE_NOT_RUNNING` 既可能是没发生、
也可能是发生了但没回执」的歧义。写歌是几百次 mutation，这个歧义对长链致命。

**现状**（已读 `call-template.ts` jsdoc + `errors.ts` 确认）：v0.1 契约是「超时后
agent 必须 `get_state` 对账，禁止盲目重试」。可用但脆。

**契约**：
1. `QueueCommand` 增加可选 `idempotency_key`（见 `packages/core/src/queue.ts`）。
2. bridge 维护一张**已完成命令去重表**（key → 上次结果），重复 key 直接回放上次
   结果，不重复执行 mutation。
3. 去重表随 bridge 生命周期存在（与 `LAST_RESULT` 同级，非持久化即可满足 v0.2）。
4. 保持 I2/I3：去重命中时回放的仍是锁定信封。

**触及文件**：
- `packages/core/src/queue.ts`（`idempotency_key` 字段）
- `packages/mcp-server/src/transport/file-queue.ts`（生成/附带 key）
- `reaper/streetlight_bridge.lua`（去重表 + 回放）

**验收**：
- 同一 key 发两次 `item_pitch` → 项目态只改一次，第二次回放首次结果。
- 不同 key 的相同操作 → 各自执行（符合 `media_import` 非幂等语义）。

---

### H5 — 能力描述符富化（单一真相源 + 生成入口）

**目标**：把模板元数据收敛到**一处声明**，既消除 TS/Lua 双写漂移，又成为 H6
代码生成的输入。这是「广度商品化」的数据层。

**现状问题**：模板的真相目前分散在三处——`templates/*.ts`（Zod schema + risk +
mutates/undoable/idempotent）、`manifest.lua`（handler + undo_flags +
entity_kind）、`errors.ts`（码）。新增模板要在多处接线。

**契约**：
1. 定义**单一 capability descriptor**（建议 TS 为权威源，Lua manifest 由其生成或
   校验对齐）：包含 name / pack / risk / mutates / undoable / idempotent /
   entity_kind / params(Zod) / result / `expectedDelta`(H2) / `examples` /
   `reads`(读哪些字段) / `writes`(写哪些字段)。
2. 错误码集合从 `errors.ts` 导出为**生成产物**，供 Lua 侧引用（消除 I4 的手抄风险）。Slice 05 已让 bridge/refs/handlers 运行时引用 `ERRS.*` / `ctx.errs.*`，并用 audit 禁止 runtime Lua 重新写入错误码字面量。
3. `list_templates` 返回富化描述符（含 examples / risk / expectedDelta 摘要），
   让 agent 无需读源码即可正确调用。

**触及文件**：
- `packages/core/src/registry.ts`（descriptor 扩展）
- `packages/mcp-server/src/templates/*.ts`（补 examples/reads/writes）
- 新增 `scripts/gen-manifest-check.mjs`（校验 TS descriptor 与 Lua manifest 对齐）
- `packages/mcp-server/src/tools/list-templates.ts`（返回富化字段）

**验收**：
- 任一模板的 entity_kind/risk 在 TS 与 Lua 不一致时，CI 校验脚本**报错**。
- Lua runtime 文件出现 `code = "FOO"` / `raise("FOO")` / `raise(code or "FOO")` / `return nil, "FOO"` 等错误码字面量时，error-code audit **报错**。
- `list_templates` 输出含每模板的 example 调用与 expectedDelta 摘要。

---

### H6 — 模板工厂（广度乘数 / 弯道超车引擎）

**目标**：把「加一个模板」从手写降为「填一个描述符 → 生成 schema + handler 骨架
+ 测试骨架 + manifest 条目」。这是用工程化碾过对手手写广度的核心武器。

**契约**：
1. 新增 `scripts/scaffold-template.mjs`：输入一个 descriptor（name / pack /
   entity_kind / params 字段 / REAPER API 调用 / expectedDelta），输出：
   - `packages/mcp-server/src/templates/<name>.ts`（Zod + CapabilityDefinition）
   - `reaper/packs/<pack>/templates/<name>.lua` handler 骨架（含 ref 解析 +
     undo 包裹 + changed_ids 回执 + 字段快照钩子）
   - `packages/mcp-server/src/templates/__tests__/<name>.test.ts` 骨架
   - manifest 条目（或提示插入点）
2. 生成物**必须**满足全部内核不变量（I1–I10）——工厂是不变量的执行者。
3. 工厂不臆造 REAPER API：descriptor 显式给出 ReaScript 调用，生成器只做接线与
   契约包裹。

**触及文件**：
- 新增 `scripts/scaffold-template.mjs`
- 新增 `docs/TEMPLATE_AUTHORING.md`（描述符字段说明 + REAPER API 速查）

**验收**：
- 用工厂生成一个新模板（如 `track_color`），**零手写**即通过 `npm run build` +
  新测试 + manifest 校验（H5）。
- 生成的 handler 默认带 undo block 与 verify 钩子（I7/I10）。

> **这一项回答了你的问题「内核稳了能不能走捷径追上广度」**：能。H6 之后，REAPER
> 有限的 ReaScript API 表面可被**批量描述符 → 批量生成 → 批量验证**，每个模板都带
> H2 的校验契约。对手的 80 个手写工具没有 verify，你的 200 个生成工具每个都有。
> 这不是追平，是降维。

---

### H7 — 传输升级（可选 socket，契约不变）

**目标**：file queue 每次 100–500ms 往返，写歌几百调用太慢。加可选 socket 传输
作为加速层，file queue 保留为零依赖回退。

**契约**：
1. socket 传输**不改** MCP 工具契约（I1）与信封（I3）。
2. 默认仍是 file queue；socket 由配置开启，且能优雅回退。
3. `call_template_sequence` 语义（一段配方一次往返 + 单一 undo 点）可在此阶段或
   独立交付——但它**不是新 MCP 工具**，是 core/bridge 内的批处理，对 agent 仍表现
   为 `call_template` 序列的语义。

**触及文件**：
- `packages/mcp-server/src/transport/`（新增 socket transport，与 file-queue 同接口）
- `reaper/streetlight_bridge.lua`（socket 监听，与现有 defer 轮询并存）

**验收**：
- socket 模式下 8 变体 demo 延迟显著下降，结果与 file queue 模式逐字节一致。
- socket 不可用时自动回退 file queue，agent 无感。

---

## 3. 执行顺序与验收门

```
H1 (entity_kind 数据驱动)
  └─> H5 (描述符富化 / 单一真相源)
        ├─> H2 (验证闭环)            ← 护城河，优先级最高的“可信”项
        ├─> H3 (读模型框架)          ← 所有“写”能力的前提
        ├─> H4 (幂等 token)
        └─> H6 (模板工厂)            ← 依赖 H1+H2+H5，广度乘数
H7 (传输升级)                         ← 任意时刻可并行，纯性能
```

**门禁**：
- 每个 H 项合并前，**全部 207 现有测试 + 新增测试必须绿**。
- 每个 H 项不得违反 §1 任一不变量。
- H2 与 H6 合并后，跑一次 `docs/CROSS_MAC_SMOKE.md` 全流程回归，确认 8 变体 demo
  仍逐项通过（含无 sidecar 契约）。

**建议第一刀**（最小、最高杠杆）：**H1 + H3 的只读部分**
（`get_state(tracks, include:["fx"])`）。零项目态写入、风险最低，却直接解锁
「我有哪些插件 / 哪些参数暴露给 automation」这条线；同时 H1 为后续所有实体扩展
铺好 dispatcher 解耦。

---

## 4. 硬化之后才解锁的能力包（不在本文范围，仅标依赖）

本文只硬化内核。以下能力包**依赖**上述硬化完成，按 `docs/ROADMAP.md` 推进：

- **感知包**（依赖 H3）：`fx_inventory`、FX 链读取、参数 `is_automatable` /
  `has_envelope` / `has_mod` 标志 → 回答「插件发现 + automation 可调制性」。
- **FX/自动化写包**（依赖 H1/H2/H5/H6）：`fx_add` / `fx_set_param` /
  `envelope_add_point` / `fx_set_mod`。
- **MIDI 包**（依赖 H1/H2/H5/H6）：`set_tempo` / `midi_item_create` /
  `midi_note_add` / `midi_cc_add` → **写歌**。
- **作曲 recipe `write_song`**（依赖以上全部）。
- **分析包**（让 agent「听到」）：渲染临时 WAV → 读响度/峰值/频谱元数据回灌。

---

## 5. 纪律：本阶段明确不做

- 不为追广度而在内核硬化前手写大量模板（违背 H6 的杠杆）。
- 不放开 `unsafe_eval` 默认（I6）。
- 不新增 MCP 工具（I1）。
- 不在锁定信封里塞 verify / descriptor 等额外字段（I3）。
- 不做实时音频流 / 监听（超出 MCP 文件队列模型，归后期 frontend）。

> 内核硬化的成功标准应当「无聊得恰到好处」：装上、连上、放手让 agent 在真实工程里
> 干活，每一步都可验证、可撤销、可复现——而对手做不到这一点。
