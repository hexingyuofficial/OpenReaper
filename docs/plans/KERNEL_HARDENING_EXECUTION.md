# Streetlight 内核硬化 — 执行手册

> 这是 `docs/KERNEL_HARDENING_PLAN.md` 的**执行级配套**。Plan 定义「做什么 + 契约 +
> 不变量(I1–I10)」；本文定义**每一步怎么做、要细化什么、坑在哪、怎么验**。
>
> 执行 agent 须知：本文每个步骤都给 **前置 / 步骤 / 细化点 / 坑点 / 验证 / 完成定义(DoD)**。
> 严禁违反 Plan §1 的任一不变量。任何 Lua 改动后必须执行「§0 重载协议」，否则你会
> 在一个**已被旧 chunk 占用**的 bridge 上测试,得到假结果。

---

## 0. 全局前置（每一步开工前都读）

### 0.1 构建与测试命令
```bash
npm install          # 一次
npm run build        # tsc -b，必须静默通过
npm test             # vitest，基线 22 files / 207 tests 必须全绿
```
任何步骤合并前：`npm run build` 0 报错 + `npm test` 全绿（新增测试计入）。

### 0.2 Lua 重载协议（最大的坑，先记住）
bridge 用 generation guard（`streetlight_bridge.lua` 顶部 `_G.STREETLIGHT_BRIDGE_GENERATION`）。
含义：
- **改了任何 Lua**（`streetlight_bridge.lua`、`packs/core/*.lua`、`manifest.lua`）后，
  必须在 REAPER 里**重新 Run** `start_bridge.lua`，否则跑的是旧代码。
- **改动涉及 guard 逻辑、`LAST_RESULT` 桶结构、`ENTITY_BUCKET`** 时，仅重 Run **不够**——
  旧 chunk 的 `reaper.defer` 链还在跑、还持有旧 `LAST_RESULT`。必须**完全重启 REAPER**，
  让新 chunk 成为唯一 owner。症状：`region_create` 返回 ok，但紧接着
  `render_region last_result:region:0` 报「no mutating call has produced changed regions」
  ——两条命令被不同 chunk 认领了。
- 验证 bridge 是新的：console 里 `bridge ready (generation N)` 的 N 应为 1（刚重启）。
- Slice 05 改了 bridge boot 路径（`dofile(error_codes.lua)` + `ctx.errs` 注入）。验收它时必须完全重启 REAPER，并确认 ready 行含 `loaded error_codes (22 codes)`。

### 0.3 不可违反的既有契约（实施时极易踩）
- **TS 校验类型，Lua 不重复校验类型**（`docs/TEMPLATE_SPEC.md`）。handler 只查运行期
  条件（item 是否存在、take 是否存在、路径是否可写）。不要在 Lua 加 Zod 式类型检查。
- **「错误→零改动」契约**：handler 必须在**任何 mutation 之前**解析 ref 和校验运行期
  条件。范例：`item_trim` 在写 `D_LENGTH` 前先取 take（若 `start_offset` 提供），否则
  空 take 的 item 会在长度已改后才报 `TAKE_NOT_FOUND`，破坏契约。
- **handler 形状固定**：`function(params, ctx) -> { changed_ids = {...} }`；失败用
  `error({ code, message })` 抛（**禁止** `error("string")`，码是协议的一部分）；
  `ctx = { refs, last_result, json }`。
- **锁定信封**（I3）：dispatcher 的 `finalize_template` 只读 handler 的 `changed_ids`，
  其余字段一律丢弃。不要试图让成功信封多带字段。
- **错误码全集**见 `packages/core/src/errors.ts`；Lua 侧必须用同名字符串。

### 0.4 关键文件地图
| 关注点 | 文件 |
|--------|------|
| 结果/错误/队列/注册/risk 契约 | `packages/core/src/{result,errors,queue,registry,risk}.ts` |
| MCP 工具层 | `packages/mcp-server/src/tools/{get-state,call-template,list-templates}.ts` |
| 模板定义(TS) | `packages/mcp-server/src/templates/*.ts`、`_shared.ts`、`index.ts` |
| 传输 | `packages/mcp-server/src/transport/file-queue.ts` |
| bridge 主体 | `reaper/streetlight_bridge.lua` |
| 派发/桶/refs/undo/handler | `reaper/packs/core/{manifest,refs,undo}.lua`、`templates/*.lua` |
| 回归 smoke | `docs/CROSS_MAC_SMOKE.md` |

---

## H1 — `entity_kind` 数据驱动

### 前置
读 `streetlight_bridge.lua` 中：`ENTITY_BUCKET`（~L116）、`finalize_template`（~L421）、
`DISPATCH.template`（~L542）；读 `refs.lua` 全部（三个 `M.resolve_*`）；读 `manifest.lua`。

### 步骤
1. **桶集合动态化**：把 `LAST_RESULT` 的初始化与跨桶清空从写死的
   `{ items, regions, tracks, renders }` 改为「遍历已注册 manifest 的 entity_kind 集合
   动态建桶」。`ENTITY_BUCKET`（kind→bucket 名）由 manifest 数据生成，而非硬编码常量。
2. **resolver 注册表**：在 `refs.lua` 暴露 `M.RESOLVERS = { item = resolve_item,
   track = resolve_track, region = resolve_region }`，并提供
   `M.resolve(entity_kind, ref, last_result)` 统一入口。新增实体只往表里加一项。
3. **严格 manifest 校验**：bridge 启动时遍历 `MANIFEST.templates`，校验每个 `entity_kind`
   都在已知桶集合内；未知则在**注册期**报错（不是运行期）。由环境变量
   `STREETLIGHT_STRICT_MANIFEST`（默认开）控制；关闭时退化为 loud-log + fallback。

### 细化点
- **区分两个概念，别合并**：
  - **bucket 存在**（`LAST_RESULT` 路由用）——每个 entity_kind 都需要。
  - **resolver 存在**（仅当有人写 `last_result:<kind>:N` 或 `<kind>:Name` 引用时才需要）。
  - 反例：`render` 这个 entity_kind **有桶无 resolver**（v0.1 故意如此，`renders` 桶存
    绝对路径，无 `last_result:render:N` 解析）。所以严格校验只校验「bucket 合法」，
    **不得**要求每个 kind 都有 resolver。
- `ENTITY_BUCKET` 的单复数映射（`item`→`items`）要保持一致；resolver 表用**单数
  entity_kind** 作键。

### 坑点
- `finalize_template` 里 `for k in pairs(LAST_RESULT) do LAST_RESULT[k] = {} end` 依赖
  `LAST_RESULT` 的键集合 = 全部桶。动态建桶后必须保证**新 kind 的桶在启动时就初始化为
  `{}`**，否则 `resolve_last_result_*` 里 `type(last_result.<bucket>) ~= "table"` 判定
  会误报 `REF_INVALID`。
- 改了 `ENTITY_BUCKET` / 桶结构 → **必须完全重启 REAPER**（§0.2），否则旧 chunk 的桶
  结构与新代码不一致。
- 严格校验若实现在「每次 dispatch」会拖慢；放在**启动期一次性**校验。

### 验证
- 新增**仅测试用**的假 manifest 条目 `entity_kind = "note"` + 注册一个假 resolver，
  不改 dispatcher 即可让 `last_result:note:0` 解析路径走通（单测）。
- manifest 笔误（`entity_kind = "iten"`）在严格模式下**启动即报错**。
- 现有 207 测试全绿；重启 REAPER 后 `docs/CROSS_MAC_SMOKE.md` 的 8 变体 demo 仍逐项通过。

### DoD
新增一个实体家族无需修改 `DISPATCH.template` / `finalize_template` 主体；只动 manifest 数据
+ 注册一个 resolver。

---

## H2 — 验证闭环 `expected_delta` / `actual_delta`（护城河，优先级最高）

### 前置
读 `undo.lua`（`with_undo` 保证 `Undo_EndBlock2` 必跑）；读 `DISPATCH.template` 的
undo 包裹路径（~L578）；读 `item.lua` 的 handler 写法（`item_pitch` 写 `D_PITCH` 后
`UpdateArrange`）；读 `render.lua` 的 deferred 模式。

### 步骤
1. TS 侧 `CapabilityDefinition` 增可选 `expectedDelta`（见 Plan H2 结构）。
2. bridge 在 `DISPATCH.template` 的成功路径、`finalize_template` 之前，做**两类校验**：
   - **结构校验**：`changed_count` 是否符合 `expectedDelta.count`；`creates/deletes` 是否
     与项目实体计数变化一致（在 handler 前后各取一次 `CountMediaItems/CountTracks/...`）。
   - **字段后置校验**：对 `changed_ids` 里的实体，重读 `expectedDelta.fields` 列出的字段，
     断言写入生效（值等于由 params 推导的期望值）。
3. 校验不过 → 返回 `VERIFY_FAILED`（新错误码，`recoverable: false`）。`actual_delta` 放进
   `error.details`。

2026-06-30 note: Slice 06 implements the field-postcheck subset for
`item_pitch`, `item_move`, `item_rate`, and `track_rename`. Because it
changes `verify.lua` and the bridge success path, live smoke must full
quit/reopen REAPER before loading `start_bridge.lua`.

2026-06-30 note: Slice 07 implements `item_trim` field postchecks and
the `optional:true` skip rule in `verify.lua`. It also changes the
`check_fields` path, so live smoke again requires full quit/reopen
REAPER before loading `start_bridge.lua`.

2026-06-30 note: Slice 08 implements `item_fade` field postchecks and
the `nullable:true` null-coerce rule in `verify.lua`. `check_fields`
now receives the bridge handler `ctx` so it can compare against the
same `ctx.json.null` sentinel as the handler; live smoke again requires
full quit/reopen REAPER before loading `start_bridge.lua`.

2026-06-30 note: Slice 09 implements `item_duplicate` field
postchecks without changing `verify.lua`. It is still a REAPER-restart
slice because the wire shape now sends `creates:true` and `fields[]`
together for the first time; full quit/reopen before loading
`start_bridge.lua` prevents stale bridge chunks from claiming queue
files with older manifest metadata.

2026-06-30 note: Slice 10 implements `track_create` field postchecks
without changing `verify.lua`. It is still a REAPER-restart slice
because the wire shape now sends `maybeCreates:true` and `fields[]`
together for the first time; full quit/reopen before loading
`start_bridge.lua` prevents stale bridge chunks from claiming queue
files with older manifest metadata.

2026-06-30 note: Slice 11 implements `media_import` field postchecks
without changing `verify.lua`. It is still a REAPER-restart slice
because the wire shape now sends `creates:true`, `count:"any"`, and
`fields[]` together for the first time; full quit/reopen before loading
`start_bridge.lua` prevents stale bridge chunks from claiming queue
files with older manifest metadata. The runtime intentionally verifies
only `changed_ids[1]` for `count:"any"` descriptors.

2026-06-30 note: Slice 12 implements `region_create` field postchecks
and changes `verify.lua` by adding `parse_region_ref` plus a
`FIELD_READERS["region"]` synthetic reader. It is a mandatory
REAPER-restart slice because the wire shape now sends
`fields[scope="region"]` for the first time. Before live smoke, fully
quit/reopen REAPER, load the current `start_bridge.lua`, and verify the
console shows `bridge ready (generation 1)` plus `loaded error_codes
(22 codes)`.

2026-06-30 note: Slice 13 does not change Lua runtime files, but it
changes the `region_create` manifest metadata sent over the wire from
one region field to three (`name`, optional `pos`, optional `rgnend`).
For live smoke, still fully quit/reopen REAPER and load the current
`start_bridge.lua`; the old Slice 12 chunk would otherwise advertise
and verify only the name field. Console preflight remains
`bridge ready (generation 1)` plus `loaded error_codes (22 codes)`.

### 细化点（这步设计难点都在这里）
- **不要做任意字段的全量 before/after diff**——太贵且 before 不可知（handler 内部才解析
  出受影响实体）。校验只覆盖两类**可知后置条件**：
  - 结构 delta：实体计数变化（before/after 计数,廉价）。
  - 声明字段：重读 changed 实体的 `fields`，与 params 推导值比对（不需要 before）。
- **count 语义钉死**：`expectedDelta.count` = 预期 `changed_ids` 长度（`item_pitch` = 1）。
  这本就等于 `changed_count`，结构校验近乎免费；真正有价值的是**字段后置校验**（确认写真的
  落了）。
- **mutate-in-place vs create**：`item_pitch` 不新建实体（count 变化 0，但 changed_ids=1）；
  `track_create`/`item_duplicate` 新建（count +1）。用 `creates: true/false` 区分,不要用
  实体计数变化去推断 changed_ids 长度。

### 坑点
- **render_region 必须可跳过**：它 `undoable=false`、无项目态 delta、走 deferred 槽、
  `entity_kind="render"`（产物是文件路径）。给它 `expectedDelta` 设为产物型（文件存在 +
  非空，复用现有 `RENDER_FILE_EMPTY` 逻辑）或显式标记跳过结构/字段校验。**不要**对它套
  实体计数校验。
- **校验失败不自动回滚**：此刻 undo block 已 `EndBlock2`（`with_undo` 保证），mutation 已
  提交。v0.2 决策 = **报告不回滚**，由 agent 收到 `VERIFY_FAILED` 后 `get_state` 对账决定。
  把这条写进错误 message,避免 agent 以为已回滚。
- **字段读取的 take/item 作用域**：pitch/rate 是 **take** 属性，position/length/fade 是
  **item** 属性（见 `item.lua` 注释）。字段校验重读时要走对作用域，否则恒为 default 误判
  `VERIFY_FAILED`。
- 校验代码若放在 `with_undo` 的 `fn` 之外，注意它**不在** undo block 内——这没问题（只读），
  但**before 计数**要在进入 `with_undo` 之前取，after 在其后取。

### 验证
- 造一个「撒谎 handler」：声明 `count:1` 实际 `changed_ids` 返回 `{}` → 必 `VERIFY_FAILED`。
- `item_pitch` 声明 `fields:["D_PITCH"]`、`creates:false`、`count:1`，正常调用 verify 通过；
  把 handler 里 `SetMediaItemTakeInfo_Value` 注释掉 → 字段校验抓出 `VERIFY_FAILED`。
- 全量 smoke 回归：8 变体 demo 仍逐项通过，且每步隐含 verify 通过。

### DoD
每个 mutating 模板都带 `expectedDelta`；故意制造的 delta 不符必被 `VERIFY_FAILED` 拦下；
render 类正确跳过；成功信封形状不变（I3）。

---

## H3 — 读模型框架（get_state scope + include + 分页）

### 前置
读 `get-state.ts`（scope enum、limit 夹取）；读 bridge `DISPATCH.get_state`（~L287）、
`read_selection`（~L235，**字节边界截断的样板**）、`KNOWN_SCOPES`。

### 步骤
1. 在 bridge 实现 scope：`project`（`GetSetProjectInfo` 取 BPM/采样率、
   `GetProjectTimeSignature` 等）、`tracks`（遍历 `CountTracks`，每轨名/guid/父子/vol/pan/
   recarm）、`regions`（`EnumProjectMarkers3` 取 isrgn 项）。
2. `get-state.ts` 增 `include`（如 `["fx"]`）、`fields`（字段投影）、`cursor`（分页）schema；
   bridge 对应实现。`include:["fx"]` 才遍历 `TrackFX_GetCount/GetFXName` 返回 FX 链。
3. 每个 list 型 scope **复用 `read_selection` 的字节边界截断模式**（逐条 encode、累加、
   超 `MAX_RESPONSE_BYTES` 停在上一条、首条就超则 `RESPONSE_TOO_LARGE`）。

### 细化点
- `include` 默认**不含** fx/automation——枚举 FX 参数（`TrackFX_GetNumParams` 循环）很贵，
  必须 opt-in。
- `fields` 投影让 agent 只取需要的字段，进一步压响应体。
- `cursor` 用**不透明游标**（如编码的 `{scope, offset, snapshot_hint}`），并容忍漂移。

### 坑点
- **绝不先序列化整工程再截断**——必须逐条累加（`read_selection` 已示范）。tracks/fx 在大
  工程里会爆 context。
- **分页期实体重编号**：与 `refs.lua` 里 region index 的警告同类——用户在翻页间编辑工程，
  index 会变。游标语义要么快照、要么文档化「分页期间工程被改则可能漏/重」。
- **读路径禁碰 `LAST_RESULT`（I7）**：新 scope 全部留在 `DISPATCH.get_state` 内，不要混进
  template 路径。
- `get_state` 的 scope 校验：未知 scope 返 `PARAMS_INVALID`，已知但未实现返
  `SCOPE_NOT_IMPLEMENTED`——保持这个区分（现有代码已如此）。

### 验证
- `get_state(project)` 返回真实 BPM/拍号/采样率，不再 `SCOPE_NOT_IMPLEMENTED`。
- `get_state(tracks, include:["fx"])` 返回每轨 FX 链。
- 构造大工程，分页可翻完且单页不超 `MAX_RESPONSE_BYTES`。
- 任一读调用后 `last_result:item:0` 行为不变（证明 `LAST_RESULT` 未被读路径污染）。

### DoD
project/tracks/regions 三 scope 可用，include/fields/cursor 生效，响应体始终有界。

---

## H4 — 幂等 token（安全重试）

### 前置
读 `queue.ts`（`QueueCommand`、`makeCommandId`）；读 `call-template.ts` 的超时语义 jsdoc；
读 bridge `process_one`（认领 pending→running）与 `DISPATCH.template`。

### 步骤
1. `QueueCommand` 增可选 `idempotency_key`。`file-queue.ts` 为每个**逻辑操作**生成稳定 key
   （重试时复用同一 key；注意与每次唯一的 `id` 区分）。
2. bridge 维护 `DEDUP[key] = 已完成的 inner 信封`。在 `DISPATCH.template` **执行 handler 前**
   查表：命中则直接回放上次 inner（成功或 typed error），不重复执行 mutation。
3. 写 done 信封时,把该命令的终态按 key 存入 `DEDUP`。

### 细化点
- 存**终态**（成功 + typed error 都存；INTERNAL_ERROR 可不存,容许重试）。
- 回放命中时仍要 `shape_outer_envelope` 带上**本次** `id` 与 `completed_at`,只复用 inner。

### 坑点
- **`DEDUP` 随 chunk 重载重置**（与 `LAST_RESULT` 同命运,见 §0.2）。v0.2 可接受（非持久化），
  但要在文档与代码注释里写明:跨 REAPER 重启不去重。
- **`id` ≠ `idempotency_key`**:`id` 是每次尝试唯一(决定 done 文件落点)；key 是逻辑操作
  稳定标识。绝不能拿 id 当 key。
- 去重检查点必须在**已认领(moved to running)之后、执行 handler 之前**。命中后仍要把
  running 文件按正常流程写 done 并清理,否则 running 留垃圾。
- deferred 模板(render)命中去重要小心:回放存的是**终态**,不要再进 deferred 槽。

### 验证
- 同 key 发两次 `item_pitch` → 项目态只改一次(用 H2 的字段读确认值未被二次写),第二次回放
  首次结果。
- 不同 key 的相同操作 → 各执行一次(符合 `media_import` 非幂等)。

### DoD
带 key 的重复命令安全回放,不 double-apply；无 key 时行为与现状一致。

---

## H5 — 描述符富化（单一真相源 + 对齐校验）

### 前置
读 `registry.ts`（`CapabilityDefinition`/`CapabilityMetadata`/`toMetadata`）、
`_shared.ts`、`list-templates.ts`、`manifest.lua`、`errors.ts`。

### 步骤
1. `CapabilityDefinition` 扩展:`entity_kind`、`undo_flags`(符号化,如 `["ITEMS"]`)、
   `expectedDelta`(H2)、`examples`、`reads`、`writes`。TS 成为**元数据权威源**。
2. 新增 `scripts/check-manifest-alignment.mjs`:读 TS 描述符与 `manifest.lua`,断言每个模板的
   `entity_kind`、`undo_flags` 两侧一致;不一致 CI 报错。（**不做**全量生成 Lua——handler
   体是手写 Lua,无法生成;只做对齐校验。）
3. 从 `errors.ts` 生成 Lua 错误码常量文件(如 `packs/core/error_codes.lua`),bridge
   启动时 dofile 一次并传给 refs/handlers。检查分两层:handler 里出现的未知错误码必须
   报错;runtime Lua 出现已知错误码字面量也必须报错,要求改用 `ERRS.*` / `ctx.errs.*`。
4. `list-templates.ts`/`toMetadata` 返回富化字段(examples、risk、expectedDelta 摘要)。

### 细化点
- `undo_flags` 在 TS 用符号数组,提供 `["ITEMS","TRACKCFG",...]` → bit 的映射,与 `undo.lua`
  的常量一致。
- `reads`/`writes` 字段服务 H2 字段校验与 H6 生成。

### 坑点
- **不要试图从 TS 生成整个 manifest.lua**:handler 函数体是手写的,生成会覆盖逻辑。只生成/
  校验**元数据对齐**。
- 错误码迁移触及多个 handler;改为引用常量是机械活,但要一次到位 + audit
  检查兜底,否则漂移依旧。Slice 05 已完成 bridge/refs/handler 运行时迁移;后续模板不得
  重新引入字面量。

### 验证
- 故意把某模板 TS 的 `entity_kind` 改得与 Lua 不一致 → `check-manifest-alignment.mjs` 报错。
- handler 里写一个不存在的错误码 → audit 报错。
- handler 里写一个已知错误码字面量(如 `raise("ITEM_NOT_FOUND", ...)`) → audit 报错。
- `list_templates` 输出含每模板 example + expectedDelta 摘要。

### DoD
模板元数据 TS↔Lua 不一致时 CI 必红;错误码有单一来源 + runtime 常量引用 + literal audit;`list_templates` 富化。

---

## H6 — 模板工厂（广度乘数）

### 前置
完成 H1、H2、H5。读 `item.lua`(handler 样板:`raise`、ref 解析、`UpdateArrange`、
`changed_ids` 回执)、`_shared.ts`、`index.ts`、`manifest.lua`、一个现有
`templates/__tests__/*.test.ts`。

### 步骤
1. 新增 `scripts/scaffold-template.mjs`,输入描述符(name/pack/entity_kind/params 字段/
   ReaScript 调用占位/expectedDelta),输出:
   - `packages/mcp-server/src/templates/<name>.ts`(Zod + `CapabilityDefinition`,
     用 `callTemplateResultSchema(name)`)。
   - `reaper/packs/<pack>/templates/<name>.lua` handler 骨架:含 `raise` 帮助、ref 解析、
     运行期校验占位、`UpdateArrange`、`changed_ids` 回执、H2 字段快照钩子。
   - `packages/mcp-server/src/templates/__tests__/<name>.test.ts` 骨架(断言信封形状 +
     PARAMS_INVALID 边界)。
   - manifest 条目片段(见坑点)。
2. 生成物默认满足全部不变量(I1–I10):undo 由 manifest `undoable` 驱动、带 entity_kind、
   带 expectedDelta 占位。

### 细化点
- 工厂**只生成脚手架**:ref 解析、undo 接线(经 manifest)、信封回执、verify 钩子、schema、
  测试骨架——即「除了那 3–5 行真正的 `reaper.*` 调用之外的一切」。真正的 REAPER API 调用由
  人/agent 按描述符里给定的 API 填入,工厂**不臆造 API**。

### 坑点
- **不能生成 handler 业务逻辑**(那是 ReaScript 真实调用);明确工厂边界,别让它瞎编 API。
- **改 `manifest.lua` / `index.ts` 是结构化插入**:直接程序化改 Lua 易碎。两条路选一:
  (a)工厂输出**精确片段**让执行者粘贴到标注插入点;(b)在 manifest/index 设一段「生成区」
  由工厂维护。推荐 (a) 起步,稳。
- 生成的 Lua 改动后同样受 §0.2 重载协议约束。

### 验证
- 用工厂生成一个真实新模板(如 `track_color`):仅填入 `reaper.GetSetMediaTrackInfo_Value`
  那几行,**脚手架零手写**,即通过 `npm run build` + 新测试 + H5 对齐校验。
- 生成的 handler 默认带 undo 与 verify 钩子。

### DoD
「填描述符 → 生成脚手架 → 补 3–5 行 API → 绿」成为加模板的标准路径,且每个生成模板都带 H2 校验。

---

## H7 — 传输升级（可选 socket，契约不变）

### 前置
读 `file-queue.ts`、bridge 的 `process_one`/defer 循环、`ARCHITECTURE.md` § Transport
(明确因装机复杂度把 socket 延后)。

### 步骤
1. 新增 socket transport,与 `file-queue.ts` **同接口**;默认仍 file queue,socket 由配置开启
   并能优雅回退。
2. bridge 增 socket 监听,与现有 defer 轮询并存。
3.(可选,可独立交付)`call_template_sequence`:一段配方一次往返 + 单一 undo 点;**不是新 MCP
   工具**,是 core/bridge 内批处理,对 agent 仍表现为 `call_template` 序列语义(不违反 I1)。

### 细化点 / 坑点
- **LuaSocket 是可选依赖,绝不设为硬依赖**:file queue 必须保持零依赖默认路径,否则破坏装机
  承诺(ARCHITECTURE 明示)。
- **跨传输字节一致**:同一操作在 socket 与 file queue 下产出的 Result 必须逐字节相同;传输只
  改投递,不改形状(I3)。
- **`call_template_sequence` 的回滚语义要钉死**:单 undo block 包 N 步,中途出错 +
  `Undo_EndBlock2` 仍会提交此前 mutation。须明确:序列是「全有或全无」(出错需主动 undo 整块)
  还是「停在首错、保留此前」。这关系到 H4 幂等与 H2 verify 的交互,**实施前先决策并写文档**。

### 验证
- socket 模式下 8 变体 demo 延迟显著下降,输出与 file queue 模式逐字节一致。
- 关闭/不可用 socket 时自动回退 file queue,agent 无感。
- 按已决策的回滚语义验证 sequence 的部分失败行为。

### DoD
socket 加速可用且可回退;契约/信封不变;sequence 语义明确且测试覆盖。

---

## 附. 执行顺序与门禁（重申）

```
H1 ──> H5 ──┬─> H2 (护城河,先做)
            ├─> H3 (写能力前提)
            ├─> H4
            └─> H6 (广度乘数,依赖 H1+H2+H5)
H7 任意时刻可并行(纯性能)
```

每个 H 合并门禁:
1. `npm run build` 0 报错;`npm test` 全绿(含新测试)。
2. 不违反 Plan §1 任一不变量(I1–I10)。
3. 涉 Lua 的步骤,按 §0.2 重启/重载后跑 `docs/CROSS_MAC_SMOKE.md` 全流程,8 变体 demo 逐项通过
   (含**无 sidecar** 契约)。
4. H2、H6 合并后**必做**一次全量 smoke 回归。

**建议第一刀**:H1 + H3 只读部分(`get_state(tracks, include:["fx"])`)——零项目态写入、
风险最低,直接解锁「插件发现 / automation 可调制性」,并为后续所有实体扩展铺好 dispatcher 解耦。

> 实施纪律:在 H1/H2/H5/H6 把内核磨硬之前,**不要**为追广度手写大量模板——那会绕过 H6 的
> 杠杆,正是要避免的「功能稀释架构」。
