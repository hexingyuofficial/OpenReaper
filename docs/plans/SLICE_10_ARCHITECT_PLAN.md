---
  Slice 10 Architect Plan Packet — track_create maybeCreates
  field verification

  ▎ 工作流约束（先确认）：本 packet 仅做计划——不写代码、不
  ▎ commit、不 push、不 reset、不 branch。所有路径用绝对路径。本
  ▎ slice 改 packages/core/src/registry.ts 的静态校验、不动
  ▎ reaper/packs/core/verify.lua 的 check_fields 主路径（与
  ▎ Slice 09 同口径，新增一条 descriptor 的合法形态）。wire
  ▎ 上首次出现 maybeCreates:true + fields[] 同时出现的
  ▎ payload，所以 live smoke 仍必须 full quit/reopen
  ▎ REAPER，重新 Run start_bridge.lua（generation 必须 = 1）。

  ---
  候选排序（高 → 低）

  A. track_create（maybeCreates:true，count:1，track
  scope，GUID-shaped changed_ids） ⭐ 推荐

  - H2 覆盖 7/11 → 8/11；剩 4 个未纳入：track_create /
  media_import / region_create / render_region(carve-out)。
  - 在剩下三个 creates 类候选里 track_create 新轴最少：
    - 同 GUID-shaped changed_ids（item 与 track 都是
  guid:{...}，与 Slice 06 的 parse_guid_ref(changed_ids[1])
  完全同形）。
    - FIELD_READERS["track"] 已在 Slice 06 落定（track_rename 的
  P_NAME ← params.name），read_track_field 已专门处理 P_NAME 走
  GetSetMediaTrackInfo_String——verify.lua 主路径零改动。
    - 单 field（P_NAME），单 scope（track），string equality（无
  tolerance）。
    - count 是数值 1（不引入 count:"any" 的多新建实体语义）。
  - 唯一新轴：结构 delta=0 的 reuse 路径下，field verify
  是否仍跑、能不能跑、契约怎么写。这是 Slice 10
  必须独立验证的核心问题。
  - 收益：H2 覆盖 7/11 → 8/11；同时把"D5 放宽到
  maybeCreates"用最小风险面验完，为后续 media_import /
  region_create 铺路。

  B. media_import（creates:true，count:"any"，多 item）

  - 同时引入两个新轴：(1) D5 放宽到 count:"any"；(2)
  多新建实体下 fields verify 的覆盖语义（首项 / 全项 /
  跳过）。后者需独立产品决策。留 Slice 11+。

  C. region_create（creates:true，count:1，但 region
  scope，region:NAME 形 changed_ids）

  - 引入三个新轴：(1) region scope 新增；(2)
  parse_region_ref(changed_ids[1]) 新增；(3)
  FIELD_READERS["region"] 新增。verify.lua 主路径要改三处。留
  Slice 12+，单独作为"region scope 扩展"独立 packet。

  D. H4 / H6 / H7

  - H4 idempotency 三处产品决策（key 由谁出 / 生命周期 /
  回放语义）独立 packet。
  - H6 scaffold 至少要 H2 覆盖 ≥9/11；Slice 10 推到 8/11
  仍不够。
  - H7 socket 纯性能，不解锁护城河。

  结论：Slice 10 = track_create 字段 verify + D5 放宽到
  "maybeCreates:true only, 数值 count only"。 这是最小风险面把
  D5 拆开的第二刀（第一刀是 Slice 09 的 creates:true）。把"结构
  delta=0 的 reuse 路径下 verify 行为"作为本 slice
  的核心验证目标。

  ---
  1. GOAL

  把 H2 字段 verify 从 7 个模板扩到 8 个，新纳入
  track_create，首次允许 expectedDelta.fields[] 与
  maybeCreates:true 共存，仍用最小放宽面：

  - Slice 09 D5 已放：fields[] 可与 creates:true 共存当且仅当
  count 是数值 >= 1。
  - Slice 10 D5：fields[] 可与 maybeCreates:true 共存当且仅当
  count 是数值 >= 1。
    - 仍禁止 fields[] 与 deletes:true 共存（v0.1 无 deletes
  模板，规则保留）。
    - 仍禁止 fields[] 与 creates:true + count:"any"
  共存（media_import 留 Slice 11+）。
    - 仍禁止 field scope: "region"（FIELD_CHECK_SCOPES
  不增；region_create 留 Slice 12+）。
    - maybeCreates 已经从 Slice 04 起强制要求数值
  count（maybeCreates + count:"any" 静态拒），因此 Slice 10
  不需要新加 maybeCreates+any 的拒绝规则——它结构上不可达。

  track_create 落地一条字段 check：

  ┌─────────┬─────┬─────┬─────────┬───────┬───────┬───────┐
  │  模板   │ sco │ fie │ param   │ optio │ nulla │ toler │
  │         │ pe  │ ld  │  推导   │  nal  │  ble  │ ance  │
  ├─────────┼─────┼─────┼─────────┼───────┼───────┼───────┤
  │ track_c │ tra │ P_N │ params. │ (none │ (none │ (none │
  │ reate   │ ck  │ AME │ name    │ )     │ )     │ , str │
  │         │     │     │         │       │       │ ing)  │
  └─────────┴─────┴─────┴─────────┴───────┴───────┴───────┘

  bridge 端零代码改动。verify.check_fields 主路径与
  track_rename（Slice 06）字节同形：
  1. parse_guid_ref(changed_ids[1]) → GUID 字符串。
  2. FIELD_READERS["track"].resolve = find_track_by_guid(guid) →
  线性扫描 CountTracks(0) 找 GUID 一致的 track handle（create
  路径找新 track、reuse 路径找已存 track，皆可命中）。
  3. read_track_field(handle, "P_NAME") →
  GetSetMediaTrackInfo_String(handle, "P_NAME", "", false)
  返回当前 P_NAME。
  4. 与 params["name"] 字符串相等比较。

  H2 覆盖率：7/11 → 8/11。

  ---
  2. NON-GOALS

  - 不动 5 工具面（I1）。
  - 不动 call_template 成功信封（I3）：失败信封仅在
  error.details.fields[] 上扩张（保留 Slice 06/07/08/09 形状）。
  - 不引入新错误码、不重命名、不动 errs.* 接线（Slice 05
  不变）。
  - 不放开 fields[] + creates:true + count:"any"（media_import
  留 Slice 11+）。
  - 不放开 region scope 的 field check（region_create 留 Slice
  12+；不动 FIELD_CHECK_SCOPES、不动 FIELD_READERS、不动
  verify.lua 的 parse_guid_ref(changed_ids[1])）。
  - 不动 verify.lua 的 check_fields 主路径函数体。
  - 不动 streetlight_bridge.lua 的调用顺序：check_counts →
  check_fields → finalize_template。
  - 不动 render_region（继续 Slice 04 起的 carve-out：无
  expectedDelta、跳过任何 verify）。
  - 不动 LAST_RESULT 桶结构、entity_buckets、refs.lua。
  - 不动 get_state schema / include / fields / cursor。
  - 不动 track.lua 的 track_create handler
  本体（已落定：find_track_by_name(params.name) reuse
  命中即返已存 GUID；create 走 InsertTrackAtIndex +
  GetSetMediaTrackInfo_String(track, "P_NAME", params.name,
  true)，返回新 GUID）。
  - 不动 8 个 Slice 06/07/08/09 已覆盖模板的
  expectedDelta（item_pitch / item_move / item_rate /
  track_rename / item_trim / item_fade /
  item_duplicate）（注：track_rename 是 Slice 06
  已落定的；track_create 是本 slice 新收）。
  - 不为 reuse 路径"短路"字段 verify。reuse 路径下 field verify
  照跑，与 create 路径同形（关键守护：bridge 端是
  delta-agnostic，本 packet 不引入"reuse 跳过 verify"分叉）。
  - 不做 H4 idempotency token、H6 scaffold、H7 socket。
  - 不动 recipes/、scripts/setup.mjs、install.*、setup-out/。
  - 不动 docs/CROSS_MAC_SMOKE.md、docs/ARCHITECTURE.md
  等非内核硬化文档。

  ---
  3. USER-FACING BEHAVIOR

  - Slice 06 的 4 happy envelope + Slice 07 的 item_trim 2 +
  Slice 08 的 item_fade 4 + Slice 09 的 item_duplicate 2 happy
  envelope 逐字节不变。
  - track_create happy envelope 逐字节不变（仍是锁定 { template,
  changed_count, changed_ids, truncated }，changed_ids 仍是
  ["guid:{TRACK-GUID}"]，changed_count 仍是 1，create 与 reuse
  两条路径外形一致）。
  - 新增 wire / 语义只在四类路径上可见：
    - a. list_templates
  metadata：track_create.expectedDelta.fields[] 含 1 条
  {scope:"track", field:"P_NAME", paramPath:"name"}；不含
  optional、不含 nullable、不含 tolerance（缺省即省略，遵守
  Slice 03 omit-when-absent 策略；string 字段不应该有
  tolerance）。其他 10 个模板字节稳定。
    - b. "创建或复用即验证"语义：track_create 在 handler
  成功后由 bridge 重读 track 的 P_NAME，与 params.name
  比对（string equality）。差异 → VERIFY_FAILED +
  recoverable:false + details.fields[] + LAST_RESULT.tracks
  不更新。注意：reuse 路径下 verify
  是结构性永真——find_track_by_name(params.name) 命中意味着已存
  track 的 P_NAME 必等于 params.name，所以 verify
  必通过。这条路径是"verify pipeline 还活着"的
  proof-of-life，不是强断言。Create 路径同样必通过（handler 显式
  GetSetMediaTrackInfo_String(track, "P_NAME", params.name,
  true)）。日常用户看不到 mismatch 路径——它仅在 raw queue
  故意搞坏 wire 时才暴露。
    - c. 静态校验更严：尝试给 track_create 之外的 maybeCreates
  模板加 fields[]（v0.1 暂无第二个 maybeCreates
  模板，规则前置）仍走 D5 放宽路径；尝试给 media_import 这种
  count:"any" + creates:true 模板加 fields[] 仍会在
  registry/manifest CLI 上注册时报错。
    - d. wire 首次同时出现 maybeCreates:true 与
  fields[]：call_template track_create 的 wire payload 现在含
  expected_delta:{count:1, maybeCreates:true,
  fields:[{scope:"track", field:"P_NAME",
  param_path:"name"}]}。这是 Slice 10 唯一的 wire
  diff，针对单个模板，预期出现。
  - read-only 路径（ping / get_state / list_templates /
  list_recipes）继续不触碰 LAST_RESULT（I7）。

  ---
  4. FILES LIKELY TO CHANGE

  TypeScript（写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/core
  /src/registry.ts
    - validateExpectedDeltaFields 修订：把 if
  (expectedDelta.maybeCreates) { throw ... cannot coexist with
  maybeCreates yet } 一杆子拒，改为分流：
        - expectedDelta.deletes === true → 仍拒（保留）。
      - expectedDelta.maybeCreates === true → 接受，但 count
  必须为数值 >= 1（实际上 maybeCreates 在 Slice 04 已强制数值
  count，所以这条只是显式断言；count:"any" + maybeCreates 在
  §200–215 的现有 maybeCreates requires a numeric count
  那条拒绝规则前置拦住）。
      - expectedDelta.creates === true → 沿用 Slice 09
  规则（数值 count >= 1）。
    - 其他规则（duplicate (scope,field)、负 tolerance、dotted
  paramPath、boolean optional、boolean nullable、all-optional
  iff all-nullable、FIELD_CHECK_SCOPES =
  {"take","item","track"}）一律不动。
    - toMetadata / ExpectedDelta type 形态不变。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-
  server/src/templates/track-create.ts
    - descriptor 加 expectedDelta = { count: 1, maybeCreates:
  true, fields: [{ scope: "track", field: "P_NAME", paramPath:
  "name" }] }。
    - 现有 expectedDelta = { count: 1, maybeCreates: true }
  直接扩展为带 fields 形态。
    - 不加 tolerance——P_NAME 是 string，与 track_rename 的 Slice
  06 descriptor 一致。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-
  server/src/tools/call-template.ts
    - 不改。toWireExpectedDelta 已在 Slice 06/07/08 把 fields[]
  透传含 optional/nullable/tolerance/param_path；本 slice
  不引入新字段。

  Lua（不写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/packs/
  core/verify.lua — 不改。
    - FIELD_READERS["track"] 已经有 entity_kind="track"、resolve
  = find_track_by_guid、read = read_track_field（专门处理
  P_NAME 走 GetSetMediaTrackInfo_String(handle, field, "",
  false)）。
    - parse_guid_ref 已经按 ^guid:(%b{})$ 匹配 track GUID（与
  item GUID 同形）。
    - track_rename 在 Slice 06 已经走这条路径成功 verify P_NAME
  ← params.name；Slice 10 只是让 track_create 复用。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/street
  light_bridge.lua — 不改。调用顺序、字段 verify 入参（含
  ctx）、details 形状都不变。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/packs/
  core/templates/track.lua — 不改。track_create handler 在
  create / reuse 两路径都返回 { changed_ids = {
  "guid:{TRACK-GUID}" } }，与 verify pipeline 已对齐。
  - manifest.lua / refs.lua / undo.lua / error_codes.lua /
  lib/*.lua — 不改。

  Scripts（写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/manif
  est-alignment.mjs
    - 静态规则与 registry.ts 同口径修订：把 "fields cannot
  coexist with maybeCreates yet" 放宽为 "fields 可与
  maybeCreates:true 共存，但必须 count 为数值 >= 1（事实上由
  maybeCreates 自身规则隐含）"。
    - "fields cannot coexist with deletes" 仍保留。
    - Slice 09 的 "fields + creates:true + count:'any'" 仍拒。

  Tests（写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/core
  /src/__tests__/registry.test.ts
    - +6 测试：
        - 合法：maybeCreates:true + count:1 +
  fields:[...]（接受）。
      - 合法：maybeCreates:true + count:1 + fields:[{scope:"trac
  k",field:"P_NAME",paramPath:"name"}]（接受，with no
  tolerance/optional/nullable）。
      - 非法：maybeCreates:true + count:"any" +
  fields:[...]（拒；由 maybeCreates 自身的 numeric-count
  规则承担——本测试守护拒绝消息不变）。
      - 非法：deletes:true + fields:[...]（仍拒，规则保留）。
      - 非法：maybeCreates:true + count:0 +
  fields:[...]（拒——count 必须 >= 1；与 Slice 09 creates
  同口径）。
      - 合法回归：creates:true + count:1 + fields:[...]（Slice
  09 行为不退化）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-
  server/src/tools/__tests__/call-template.test.ts
    - +2 测试：
        - track_create name:"Slice10 X" reuse_existing:false →
  wire expected_delta 含 count:1, maybeCreates:true,
  fields:[{scope:"track", field:"P_NAME", param_path:"name"}]。
      - track_create 不会在 fields 上夹带 optional / nullable /
  tolerance（descriptor 没声明 → wire 必然没有）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-
  server/src/tools/__tests__/list-templates.test.ts
    - +3 测试：
        - track_create metadata expectedDelta.fields[] 含 1 条
  {scope:"track", field:"P_NAME", paramPath:"name"}；不含
  optional/nullable/tolerance。
      - 其他 10 个模板 metadata 字节稳定（含 7 个已纳入
  fields：4 个 Slice 06
  in-place、item_trim、item_fade、item_duplicate；其余 3 个
  expectedDelta 无
  fields：media_import、region_create、render_region；其中
  render_region 无 expectedDelta）。
      - 断言：media_import.expectedDelta = {count:"any",
  creates:true} 仍无 fields（Slice 11+
  才放）；region_create.expectedDelta = {count:1, creates:true}
  仍无 fields（Slice 12+ 才放）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/__tes
  ts__/manifest-alignment.test.mjs
    - +4 测试：与 registry tests 同口径覆盖（合法
  maybeCreates+count:1+fields；合法
  maybeCreates+count:1+fields+无 tolerance；非法
  maybeCreates+"any"+fields 走原 numeric-count 规则；非法
  deletes+fields 保留）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/__tes
  ts__/lua-structure.test.mjs
    - +1 测试：grep 守护 verify.lua 仍未引入 parse_region_ref /
  scope = "region" / region FIELD_READER（防止本 slice 顺带漂出
  scope 扩展；region 留 Slice 12+）。Slice 09 已有同形 grep；本
  slice 把这个 grep 强化或新增一条声明这是 Slice 10 的守护点。

  Docs（写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/SL
  ICE_10_ARCHITECT_PLAN.md — 本 packet 落盘（建议格式与 Slice 09
  packet 一致）。
  -
  /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/HANDOFF.md
  — live edge 切到 Slice 10；Slice 09 decisions 保留；append
  Slice 10 decisions（D1–D6 见 §6）；明确 "D5 放宽到
  maybeCreates"、count:"any" 与 region scope 仍未放开。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/PROGRESS
  .md — Slice 10 段（scope / what changed / verification
  baseline 占位 / live smoke evidence 占位）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/TEMPLATE
  _SPEC.md — "Fields on creates templates (Slice 09)" 子节后追加
  "Fields on maybeCreates templates (Slice 10)"，明示：fields[]
  可与 maybeCreates:true 共存当且仅当 count 是数值正整数；解释
  "reuse 路径下 verify 是结构性永真，仅做 pipeline
  proof-of-life" 的约定；明示 count:"any" / region scope
  仍未放开。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/RESPONSE
  _BUDGET.md — VERIFY_FAILED details 段追加：track_create
  单字段失败时 details.fields[] ≤ 256 字节增量（与 Slice
  06/07/08/09 同口径）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/KE
  RNEL_HARDENING_PLAN.md § H2 — 注："Slice 10 把字段 verify 扩到
  track_create，第二次放宽 D5 让 maybeCreates:true 与 fields[]
  共存（仍仅限数值 count）；media_import (count:"any") 留 Slice
  11+，region_create (region scope) 留 Slice 12+。"
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/KE
  RNEL_HARDENING_EXECUTION.md § H2 + §0.2 重载协议 —
  追加："Slice 10 不改 verify.lua 主路径，但 wire 首次出现
  maybeCreates:true + fields[] 同时出现的 payload。建议 full
  quit/reopen REAPER 以确保旧 chunk 的 manifest 上 track_create
  没有 fields 不会与新 chunk 抢命令。"

  Files NOT touched（明确禁碰）

  - packages/core/src/errors.ts / result.ts / risk.ts / types.ts
  / refs.ts / queue.ts
  - packages/mcp-server/src/transport/file-queue.ts
  - packages/mcp-server/src/index.ts /
  tools/{get-state,list-recipes,ping}.ts
  - packages/mcp-server/src/templates/*.ts（除 track-create.ts
  外的 10 个 TS 模板）
  - reaper/streetlight_bridge.lua
  - reaper/packs/core/{manifest,refs,undo,error_codes,verify}.lu
  a、templates/*.lua（含 templates/track.lua）、lib/*.lua
  - scripts/error-codes.mjs / setup.mjs / install.* / setup-out/
  / recipes/*.yaml
  - render_region、media_import、region_create 模板（继续
  carve-out / deferred）

  ---
  5. CONTRACT / SCHEMA / ERROR-CODE CHANGES

  TS — validateExpectedDeltaFields 修订（向后兼容扩展）

  // 当前（Slice 09）：
  if (expectedDelta.deletes) {
    throw new Error(`Capability ${name} expectedDelta.fields
  cannot coexist with deletes`);
  }
  if (expectedDelta.maybeCreates) {
    throw new Error(
      `Capability ${name} expectedDelta.fields cannot coexist
  with maybeCreates yet`,
    );
  }
  if (expectedDelta.creates) {
    if (
      typeof expectedDelta.count !== "number" ||
      !Number.isFinite(expectedDelta.count) ||
      Math.floor(expectedDelta.count) !== expectedDelta.count ||
      expectedDelta.count < 1
    ) {
      throw new Error(
        `Capability ${name} expectedDelta.fields with
  creates:true requires numeric count >= 1`,
      );
    }
  }

  // Slice 10：
  if (expectedDelta.deletes) {
    throw new Error(`Capability ${name} expectedDelta.fields
  cannot coexist with deletes`);
  }
  if (expectedDelta.maybeCreates || expectedDelta.creates) {
    // maybeCreates 已经从 Slice 04 起强制 numeric count（拒
  "any"），这里再断言一次保险。
    if (
      typeof expectedDelta.count !== "number" ||
      !Number.isFinite(expectedDelta.count) ||
      Math.floor(expectedDelta.count) !== expectedDelta.count ||
      expectedDelta.count < 1
    ) {
      const mode = expectedDelta.creates ? "creates:true" :
  "maybeCreates:true";
      throw new Error(
        `Capability ${name} expectedDelta.fields with ${mode}
  requires numeric count >= 1`,
      );
    }
  }
  // 其余规则（FIELD_CHECK_SCOPES / duplicate / tolerance /
  optional / nullable /
  // all-optional iff all-nullable）原样保留。

  Descriptor — track-create.ts 改动

  // 之前（Slice 04）：
  expectedDelta: { count: 1, maybeCreates: true },
  // Slice 10：
  expectedDelta: {
    count: 1,
    maybeCreates: true,
    fields: [
      { scope: "track", field: "P_NAME", paramPath: "name" },
    ],
  },

  Wire 协议（snake_case，字面同名）

  jsonc
  "expected_delta": {
    "count": 1,
    "maybeCreates": true,
    "fields": [
      { "field": "P_NAME", "scope": "track", "param_path":
  "name" }
    ]
  }

  Slice 06–09 的 param_path / tolerance / optional / nullable
  字段语义不变。本 slice 不引入新字段。

  Lua check_fields 行为差异：零。 Slice 10 的 track_create
  走的就是 Slice 06 已落定的 track_rename 的字段 verify
  路径——parse_guid_ref(changed_ids[1]) →
  find_track_by_guid(guid) → read_track_field(handle, "P_NAME")
  → 与 params.name string-equal。

  VERIFY_FAILED 错误码：不动。 details.fields[] 形状不动；单
  field 增量 ≤ 256 字节。

  list_templates 元数据：track_create.expectedDelta.fields[0] 含
  {scope, field, paramPath}；不含 optional、不含 nullable、不含
  tolerance（string 字段不应该有 numeric
  tolerance；缺省省略）。

  ---
  6. DECISIONS FOR USER

  #: D1
  决策项: Slice 10 收哪个 maybeCreates/creates 模板？
  选项: (a) track_create（maybeCreates+count:1+track
    scope+GUID-shaped changed_ids，verify.lua
  主路径零修改）；(b)
     media_import（叠加 count:"any" 的多新建实体语义轴）；(c)
    region_create（叠加 region scope + region:NAME 形
  changed_ids
     两个新轴）
  推荐: (a) — 唯一一个不引入"第二个新轴"的剩余创造类模板；把"放
    D5 到 maybeCreates"独立验证
  ────────────────────────────────────────
  #: D2
  决策项: D5 放宽到 maybeCreates:true 同时是否也放宽
    count:"any"（+ creates）？
  选项: (a) 仅 maybeCreates+数值 count；(b) maybeCreates+数值 +
    creates+"any" 同放（一刀清到 media_import）；(c)
  不放，留更晚
  推荐: (a) — 单轴更安全；media_import 留 Slice
  11+，多新建实体下
     verify 分配语义（首项 / 全项 / 跳过）独立 packet 决策
  ────────────────────────────────────────
  #: D3
  决策项: track_create 在 Slice 10 验哪些字段？
  选项: (a) 仅 P_NAME ← params.name（track scope，1
    条，verify.lua 主路径零修改）；(b) 加 I_FOLDERDEPTH ← (无
    param 推导)（无 paramPath 来源，需新轴）；(c) 加 verify 新
    track 出现在 params.index 指定位置（需用
    GetMediaTrackInfo_Value(handle, "IP_TRACKNUMBER") reader，新

    field 类型）
  推荐: (a) — P_NAME 是 params 直接驱动、单 scope、与
    track_rename Slice 06
    主路径字节一致；其他字段都引入新轴，应作为"H2 跨字段
    verify"或"index-based verify"独立 packet
  ────────────────────────────────────────
  #: D4
  决策项: reuse_existing:true 路径下，field verify 是否仍跑？
  选项: (a) 仍跑（推荐）：reuse 命中已存 track（structural
    delta=0），bridge check_fields 不查 delta，照走 GUID 解析  →

    读 P_NAME → 与 params.name 比较；命中必为 true（reuse
    命中条件就是 name 等）。这是"verify pipeline 还活着"的
    proof-of-life。(b) reuse 路径短路跳过 verify：在 verify.lua
    加 if delta=0 then skip 分支；引入新代码、新轴、新文档负担
  推荐: (a) — 不引入"reuse 短路"分叉。verify pipeline
    delta-agnostic 是 Slice 06 起的契约；本 slice 不偏离。reuse
    路径下 verify 永真是事实，不是 bug。把这条契约 ("reuse-path
    verify is tautological proof-of-life, not strong assertion")

    写进 TEMPLATE_SPEC.md
  ────────────────────────────────────────
  #: D5
  决策项: P_NAME 字段比较是否需要 tolerance？
  选项: (a) 无 tolerance（推荐）：string 字段不应有 numeric
    tolerance；verify.lua 的 values_match 在 tolerance == nil
    时退化为 expected == actual，已经覆盖；(b) 加 tolerance:0
    的空 placeholder
  推荐: (a) — descriptor 不声明 tolerance；metadata
    自动省略；values_match(expected_string, actual_string,  nil)

    走 == 路径，与 track_rename Slice 06 同口径
  ────────────────────────────────────────
  #: D6
  决策项: "creates + VERIFY_FAILED 留下孤儿实体" 这条 Slice 09
    已知 trap，在 maybeCreates 的 reuse 路径下表现如何？
  选项: (a) 明确记录两种语义（推荐）：create 路径下
  VERIFY_FAILED
     留下一个孤儿 track（新 track 已创建，handler 返回
    changed_ids，verify 在 finalize 之前失败，LAST_RESULT
    不更新——这是 Slice 09 已验证的 creates 类共有副作用）；reuse

    路径下 VERIFY_FAILED 不留孤儿（handler 没创建新
    track，只返回已存 track 的 GUID），但 LAST_RESULT
    仍不更新。在 PROGRESS / TEMPLATE_SPEC
    显式记录这两种语义差异，并让 live smoke 各验一次。(b)
    不区分记录，仅当 creates 类共有副作用处理
  推荐: (a) — 这是 maybeCreates 类相对 creates
    类的语义差异，下一个 maybeCreates 模板（暂无 v0.1 候选，但
    v0.2 可能加）依赖这条契约。Slice 10 的 live smoke
    必须各覆盖一次

  ---
  7. RISKS & REGRESSION NOTES

  D5 放宽的滑坡风险（Slice 10 最大策略点）

  - 放宽 fields[] + maybeCreates:true
  之后，剩余两条仍互斥的边界（deletes / creates+count:"any" /
  region scope）必须仍由静态校验守住，否则后续 PR 把 fields 塞到
  media_import 上 → verify 路径会爆"changed_ids[1] 是首项 item
  GUID 但只验 1 项 / 漏掉 N-1 项"的隐藏 bug。
  - 缓解：D2 把 count:"any"+fields
  静态拦住；scripts/__tests__/manifest-alignment.test.mjs 与
  packages/core/src/__tests__/registry.test.ts 双重覆盖；HANDOFF
  + KERNEL_HARDENING_PLAN
  注明哪些组合仍未开放（更新组合矩阵：creates+数值 ✅ /
  maybeCreates+数值 ✅ / creates+"any" ✗ / deletes ✗ / region
  scope ✗）。

  reuse 路径下 verify "结构性永真" 的契约风险

  - find_track_by_name(params.name) 命中意味着已存 track 的
  P_NAME == params.name（按 name 找的）。reuse 路径下 verify
  P_NAME == params.name 必为 true——这是结构性永真，不是强断言。
  - 风险：未来读者可能把"track_create 在 reuse 下 verify
  通过"误读为"verify 在 maybeCreates
  路径下确实验证了字段写入"。它没有——它只验证了 GUID
  解析与字段读取 pipeline 仍在工作。
  - 缓解：D4 决策 (a) 选择"reuse 路径不短路
  verify"，把这条契约写进 docs/TEMPLATE_SPEC.md 的 "Fields on
  maybeCreates templates" 子节，明确语义。live smoke 在 S6/S8
  显式触发 raw-queue 故意 mismatch 来证明 mismatch
  路径仍工作（用 field:"P_NAMEX" 让 GetSetMediaTrackInfo_String
  返回 ok=false / 空字符串）。

  changed_ids[1] = track GUID 的契约（与 Slice 09 同形 +
  跨实体类型扩展）

  - track_create handler 在 create 和 reuse 路径都返回 {
  changed_ids = { "guid:{TRACK-GUID}" } }——只有一条。Slice 06 的
  parse_guid_ref(changed_ids[1]) + find_track_by_guid(guid)
  直接打通；后者已是 Slice 06 在 track_rename 上落地的
  FIELD_READERS["track"] 主路径。
  - 风险：未来 media_import 会出现 N 条 changed_ids；仅验证
  changed_ids[1] 是部分覆盖。Slice 11+ 需明确"首项
  verify"还是"全项 verify"。本 slice 不背这个决策——D2
  静态把它拦住。
  - 缓解：HANDOFF + KERNEL_HARDENING_PLAN 把"changed_ids[1] =
  新（或复用）实体的 GUID"作为 Slice 06–10 共识，遗留
  count:"any" 的语义讨论到 Slice 11+。

  create 与 reuse 副作用差异

  - D6 决策 (a) 推荐：create 路径下 VERIFY_FAILED 留下孤儿
  track（与 Slice 09 item_duplicate 同形）；reuse
  路径下不留孤儿但 LAST_RESULT 仍不更新。
  - 风险：live smoke 必须在两条路径上各验 mismatch
  一次，避免遗漏 reuse 路径的契约。
  - 缓解：S6 (create + mismatch) 与 S8 (reuse + mismatch)
  各执一次；S7 / S9 分别验证 LAST_RESULT 不被污染。

  track_create handler 内部 reuse 实现的隐含耦合

  - track.lua find_track_by_name(name) 与 refs.lua 的
  resolve_track_by_name 是两份独立扫描；本 slice 不动 handler
  也不动 refs，但要在 PROGRESS 注明这条耦合：reuse 路径下 verify
  读 GetSetMediaTrackInfo_String(handle, "P_NAME") 必等于
  params.name 的前提是 handler 用 name 查的。任何未来 handler 改
  reuse 查找策略（例如改用 GUID 或 P_TAGS）都会让 verify
  永真假设失效——届时需要重新评估 D4。
  - 缓解：在 track-create.ts descriptor 的 expectedDelta.fields
  注释里写一行 // Slice 10: reuse path is tautological — verify
  is proof-of-life, not assertion，让源码层就能看到这条契约。

  wire 字节稳定

  - Slice 06 的 4 模板 wire 字节不变。
  - Slice 07 的 item_trim wire 字节不变。
  - Slice 08 的 item_fade wire 字节不变。
  - Slice 09 的 item_duplicate wire 字节不变。
  - 4 个未纳入字段 verify 的模板（media_import / region_create /
  render_region / Slice 10 之前形态的 track_create）中：
    - track_create wire 在 Slice 10 之后含
  fields:[{P_NAME...}]——这是本 slice 唯一的 wire
  diff，针对单个模板，预期出现。
    - 其余 3 个（media_import / region_create /
  render_region）wire 字节稳定。

  static redlines（防 D5 滥用）

  - registry + manifest-alignment 双层守护：见 §5 修订。
  - 新增/保留 lua-structure.test.mjs grep：守护 verify.lua
  未引入 region scope reader 或 parse_region_ref（这是 Slice 12+
  的工作；防止本 slice 漂出 scope 扩展）。
  - 新增 list-templates 断言：media_import / region_create /
  render_region 仍无 fields（防 PR 顺手扩散）。
  - HANDOFF / PROGRESS 把"已放开 /
  仍互斥"的组合矩阵列清楚，给后续 architect 明确边界。

  error-code constants 不退化

  - 失败路径仍走 errs.VERIFY_FAILED。
  - Slice 05 audit 已 grep reaper/packs/core/**/*.lua；本 slice
  不改 Lua，audit 影响为 0。
  - npm run check:error-codes-fresh 必须保持 22 codes。

  REAPER bridge boot 必须 full quit/reopen

  - 本 slice 不改 verify.lua，但 wire 首次出现 maybeCreates:true
  + fields[] 同时出现的 payload。如果旧 chunk 的 manifest 上
  track_create 没有 fields，新 chunk 的 manifest 上有，bridge
  启动时是 dofile 一次，所以靠 Re-Run start_bridge.lua 即可（无
  verify.lua 主路径变更）。
  - 但为消除 Slice 04+05+06+07+08+09 累计的 chunk-stack
  不确定性，仍建议 full quit/reopen REAPER，确保 generation =
  1。
  - 验证 console 含 loaded error_codes (22 codes)。

  回归覆盖必查项

  - Slice 06 的 4 happy envelope 字节稳定（item_pitch /
  item_move / item_rate / track_rename）——track_rename 与 Slice
  10 共享 FIELD_READERS["track"] + P_NAME 路径，必须不退化。
  - Slice 07 item_trim 的两个 happy envelope
  字节稳定（length-only + length+start_offset）。
  - Slice 07 item_trim 的 optional 跳过路径仍工作。
  - Slice 08 item_fade 的 4 happy envelope 字节稳定（数值单字段
  / 数值双字段 / null 单清 / null 双清）。
  - Slice 09 item_duplicate 的 happy envelope 字节稳定（同 track
  + 跨 track）。
  - Slice 04 的结构 verify 失败仍优先于字段 verify。
  - Slice 05 errs.* 接线不退化（track_create selected:0 name:"x"
  不可能——但 cross-type ref 测试仍工作）。
  - Slice 02 get_state include 仍工作。
  - Slice 01 readonly scope 不污染 LAST_RESULT。
  - render_region 仍跳过任何 verify；changed_ids 仍是绝对路径。
  - Slice 06 的"raw 结构 mismatch 优先于字段 mismatch"仍工作（在
  track_create 上重新验一次）。
  - media_import / region_create 仍无 fields[]（Slice 10
  不收它们）。
  - Slice 09 item_duplicate 的 D5 boundary（creates:true +
  numeric count + fields）仍工作。

  ---
  8. IMPLEMENTATION SEQUENCE

  按依赖顺序（每步独立绿测后再走下一步）：

  1. TS schema 修订 — /Users/Zhuanz/Documents/streetlight-reaper
  -mcp/packages/core/src/registry.ts
    - 修订 validateExpectedDeltaFields：把"fields cannot coexist
  with maybeCreates yet"分流为"maybeCreates + numeric count >=
  1 接受"（见 §5 伪代码）。
    - TDD：先在 /Users/Zhuanz/Documents/streetlight-reaper-mcp/p
  ackages/core/src/__tests__/registry.test.ts 加 6
  个新测试，再写实现。
  2. track_create descriptor —
  /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-se
  rver/src/templates/track-create.ts
    - 把 expectedDelta = { count:1, maybeCreates:true } 扩展为
  expectedDelta = { count:1, maybeCreates:true,
  fields:[{scope:"track", field:"P_NAME", paramPath:"name"}] }。
    - 在 expectedDelta 上方加一行注释：// Slice 10: reuse path
  is tautological — verify is proof-of-life, not assertion。
  3. wire 透传验证 —
  /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-se
  rver/src/tools/__tests__/call-template.test.ts
    - toWireExpectedDelta 不需改（Slice 06 已实现 fields
  透传）；只加 2 个测试断言 wire 形态正确。
  4. list_templates 富化 —
  /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-se
  rver/src/tools/__tests__/list-templates.test.ts
    - 加 3 个测试：track_create metadata 含 1 条 fields；其他 10
  个模板 metadata 字节稳定；media_import / region_create /
  render_region 仍无 fields。
  5. 静态守护扩展 — /Users/Zhuanz/Documents/streetlight-reaper-m
  cp/scripts/manifest-alignment.mjs +
  /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/__tests
  __/manifest-alignment.test.mjs
    - 与 registry.ts 同口径修订；加 4 个新测试。
  6. lua-structure 防漂 — /Users/Zhuanz/Documents/streetlight-re
  aper-mcp/scripts/__tests__/lua-structure.test.mjs
    - +1 grep 守护：verify.lua 不含 parse_region_ref / scope =
  "region" / region FIELD_READER（强化 Slice 09 已有的同形
  grep，明确归属 Slice 10 守护点）。
  7. 不改 Lua — verify.lua / streetlight_bridge.lua / track.lua
  / manifest.lua 全部不动。
  8. 静态闸 — 见 §9。
  9. REAPER full quit/reopen → ReaScript: Load → Run — 验证
  generation = 1 + loaded error_codes (22 codes) 行。
  10. Live smoke — 见 §10。
  11. Docs 同步 — HANDOFF / PROGRESS / TEMPLATE_SPEC /
  RESPONSE_BUDGET / KERNEL_HARDENING_{PLAN,EXECUTION} / 本
  packet。

  ---
  9. STATIC VERIFICATION

  绝对路径命令：

  cd /Users/Zhuanz/Documents/streetlight-reaper-mcp
  npm test
  npm run build
  npm run check:manifest
  npm run check:error-codes-fresh
  git -C /Users/Zhuanz/Documents/streetlight-reaper-mcp diff
  --check

  通过判据：

  - npm test → 基线 272 + 新增 16 ≈ 288 全绿；若 < 272
  视为回归。
  - npm run build → 0 报错（pre-existing TS6310 噪声可忽略）。
  - npm run check:manifest → Streetlight manifest alignment ok
  (11 templates).
  - npm run check:error-codes-fresh → Streetlight error codes
  fresh (22 codes). + zero forbidden literal usage。
  - git diff --check → 无空白错误。

  ---
  10. LIVE SMOKE PLAN

  前置（必须）：用户完全退出 REAPER 进程（不只是关项目），重开 →
  Actions → Show action list → ReaScript: Load… → 选
  start_bridge.lua → Run。console 必须有：

  [streetlight] loaded error_codes (22 codes)
  bridge ready (generation 1) — loaded error_codes (22 codes) —
  templates: …

  generation ≠ 1 或 22 codes 行缺失 → 不通过，回到前置。

  Smoke 步骤（保持 Slice 04–09 的"成功路径 + 故意 mismatch + 多
  slice 回归"三轨）

  S0 reachability：ping → bridge:connected,
  reaper_version=7.71/macOS-arm64。

  S1 list_templates：11 模板返回；断言：
  - track_create.expectedDelta 含 {count:1, maybeCreates:true,
  fields:[{scope:"track", field:"P_NAME",
  paramPath:"name"}]}；不含 optional/nullable/tolerance。
  - Slice 06/07/08/09 已纳入的 7 个模板 metadata 字节稳定。
  - media_import.expectedDelta = {count:"any",
  creates:true}（仍无 fields——Slice 11+ 才放）。
  - region_create.expectedDelta = {count:1, creates:true}（仍无
  fields——Slice 12+ 才放）。
  - render_region 仍无 expectedDelta。

  S2 track_create happy create 路径：track_create name:"Slice10
  Live Smoke <ts>" reuse_existing:true → 首次调用 = create
  路径。
  - 断言：changed_count=1，changed_ids 是新 track 的
  guid:{...}；记下该 GUID。
  - 验证：bridge 端结构 verify 算出 delta_tracks=+1（与
  maybeCreates+count:1 的 d ~= 0 and d ~= 1 兼容路径符合：d==1
  通过）；字段 verify 端 P_NAME readback == "Slice10 Live Smoke
  <ts>" 通过。
  - 这是 Slice 10 的核心新行为之一：maybeCreates + create +
  fields 路径全程绿。

  S3 track_create happy reuse 路径：再次 track_create
  name:"Slice10 Live Smoke <ts>" reuse_existing:true → reuse
  路径。
  - 断言：changed_count=1，changed_ids[1] GUID 与 S2
  完全相同（reuse 命中已存 track，REAPER 主时间线上仍只有一条
  Slice10 Live Smoke 轨）。
  - 验证：bridge 端结构 verify 算出 delta_tracks=0（maybeCreates
  路径下 d == 0 通过）；字段 verify 端 P_NAME readback 仍 ==
  "Slice10 Live Smoke <ts>" 通过——这是 D4 决策 (a)
  的核心断言：reuse 路径下 verify 走完整 pipeline
  并通过（结构性永真，但 pipeline 确实在跑）。

  S4 LAST_RESULT 桶正确：发 track_rename last_result:track:0
  name:"Slice10 Renamed <ts>" → 应当作用于 S2/S3 的同一
  track；这是 Slice 06 in-place + 字段
  verify，必须通过。changed_ids[1] GUID 与 S2 / S3 一致。
  - 验证：bridge 端 P_NAME readback == "Slice10 Renamed <ts>"
  通过。

  S5 track_create reuse-on-renamed：再次 track_create
  name:"Slice10 Renamed <ts>" reuse_existing:true → reuse 命中
  S4 改过名的 track。
  - 断言：changed_count=1，changed_ids[1] 仍与 S2 同 GUID（同一
  track，新 name 被 reuse 匹配命中）；delta_tracks=0；字段
  verify P_NAME == "Slice10 Renamed <ts>" 通过。
  - 这条验证了 maybeCreates+fields 在 reuse 路径下 verify
  仍正确（不依赖 S2/S3 的特定名字）。

  S6 字段 mismatch 强制路径（create + raw
  queue）：先准备一个唯一名字 force-c-<ts>，确保该名字 track
  不存在。直接往 queue 投 track_create name:"force-c-<ts>"
  reuse_existing:false，但 wire expected_delta.fields[0].field =
  "P_NAMEX"（不存在的 attr）。
  - handler 仍正常 InsertTrackAtIndex +
  GetSetMediaTrackInfo_String(track, "P_NAME", "force-c-<ts>",
  true) 创建新 track；bridge 端字段 verify 读
  GetSetMediaTrackInfo_String(handle, "P_NAMEX", "",
  false)——REAPER 对未知 string attr 返回 ok=false / 空字符串 →
  与 expected="force-c-<ts>" 不等 → fields verify 失败。
  - 断言：VERIFY_FAILED，recoverable:false，details.fields[0].ok
  =false，details.fields[0].expected="force-c-<ts>"，details.fie
  lds[0].actual 是空字符串或 false，message 含 Slice 04
  恢复短语字面量。
  - 副作用（D6 决策 (a) 显式记录）：S6 让 handler 真创建了一个新
  track（在 REAPER 项目里可见，名为 "force-c-<ts>"），但
  LAST_RESULT.tracks 不更新——orphan track，与 Slice 09
  item_duplicate S7 同形。

  S7 LAST_RESULT 不污染（create 路径）：发 track_rename
  last_result:track:0 name:"Slice10 Renamed Post-S6 <ts>" →
  应当作用于 S5 末尾的 track（与 S2/S3/S4/S5 同 GUID），不作用于
  S6 创建的 orphan。
  - 断言：changed_ids[1] GUID 与 S2 同；S6 的 orphan track
  名字仍是 "force-c-<ts>"（人工到 REAPER 看，或用
  get_state(tracks) 列出）。
  - 这是 Slice 10 的关键守护：create + VERIFY_FAILED 不污染
  LAST_RESULT，即使 handler 真的创建了新实体。

  S8 字段 mismatch 强制路径（reuse + raw queue）：直接往 queue
  投 track_create name:"Slice10 Renamed Post-S6 <ts>"
  reuse_existing:true（S7 留下的名字，必定 reuse 命中），但 wire
  expected_delta.fields[0].field = "P_NAMEX"。
  - handler 走 reuse 路径，不创建任何 track，直接返回 reuse 命中
  track 的 GUID；bridge 端字段 verify 读未知 attr 失败。
  - 断言：VERIFY_FAILED，recoverable:false，details.fields[0].ok
  =false；REAPER 项目里 没有新 track 被创建（人工查 /
  get_state(tracks) 比对前后）。
  - 副作用（D6 决策 (a) 显式记录）：reuse 路径下 VERIFY_FAILED
  不留 orphan——这是 maybeCreates 类相对 creates 类的语义差异。

  S9 LAST_RESULT 不污染（reuse 路径）：发 track_rename
  last_result:track:0 name:"Slice10 Renamed Post-S8 <ts>" →
  仍作用于 S7 后的同一 track（S8 没动 LAST_RESULT）。
  - 断言：changed_ids[1] GUID 与 S2/S3/S4/S5/S7 同。
  - 这条与 S7 一起锁定：无论 create 还是 reuse 路径的
  VERIFY_FAILED，都不污染 LAST_RESULT。

  S10 forced paramPath 错位（raw queue）：raw 发 track_create
  name:"Slice10 PP <ts>" reuse_existing:false，wire params.name
  正常，但 expected_delta.fields[0].paramPath="nameX"（不存在的
  key）。
  - verify 端 params["nameX"] == nil 且 optional 不为 true →
  mismatch {expected:"present param", actual:nil} →
  VERIFY_FAILED。
  - 这一步守护"paramPath 错位"在 Slice 10 仍按 Slice 06 的
  mismatch 路径走（不是新代码路径）。
  - 副作用：handler 又创建了一个 orphan track 名为 "Slice10 PP
  <ts>"——记入 evidence。

  S11 结构 mismatch 仍优先（Slice 04 回归 + 在 maybeCreates
  模板上重测）：raw 发 track_create name:"Slice10 SM <ts>"
  reuse_existing:false，expected_delta = {count:2,
  maybeCreates:true, fields:[{...}]} → handler 创建 1 个
  track，结构 verify count expected 2 got 1
  失败优先返回，top-level details 不含 fields（与 Slice 06–09
  一致）。
  - 副作用：又一个 orphan track "Slice10 SM <ts>"——记入
  evidence。

  S12 maybeCreates 结构 verify 的 delta=0 / delta=+1
  双兼容：这一步无需新命令，由 S2 (delta=+1) 与 S3 (delta=0)
  共同覆盖。在 evidence 段显式断言两次结构 verify 都通过。

  S13 Slice 09 / 08 / 07 / 06 回归（在 S2 创建的 track 上）：
  - 先 media_import path:"/System/Library/Sounds/Ping.aiff"
  track_id:"last_result:track:0" position:0（拿到 item）；
  - item_duplicate last_result:item:0
  track_id:"last_result:track:0" position:2.5 → success + Slice
  09 D_POSITION verify 通过；
  - item_fade last_result:item:0 fade_in:null → success + Slice
  08 nullable verify 通过；
  - item_trim last_result:item:0 length:1.0 → success + Slice 07
  D_LENGTH verify 通过，D_STARTOFFS skip；
  - item_pitch last_result:item:0 semitones:-3 + item_move
  last_result:item:0 position:5.0 → success + Slice 06 verify
  通过。

  S14 error-code constants 回归：
  - track_create name:"" → PARAMS_INVALID（Zod min(1) 拦住，MCP
  层）。
  - track_rename last_result:track:99 name:"x" → REF_INVALID /
  TRACK_NOT_FOUND（依 refs.lua 实际消息）。
  - region_create name:"bad/name" start:0 end:1 →
  REGION_NAME_INVALID。

  S15 get_state include 回归：
  - get_state(tracks, include:["fx"]) → OK；
  - get_state(render, include:["fx"]) → PARAMS_INVALID；
  - get_state(render) → SCOPE_NOT_IMPLEMENTED。

  S16 render_region carve-out：region_create
  name:"slice10-r-<ts>" start:0 end:1 → success；render_region
  region:"slice10-r-<ts>" output_dir:"<临时 dir>"
  render_pattern:"slice10-r-<ts>" → success；临时 dir 含且仅含
  .wav，无 .RPP / .RPP-bak。changed_ids 是绝对 WAV
  路径。render_region 仍跳过任何 verify。临时 render dir
  用后必须删干净。

  S17 media_import / region_create 仍无 fields
  回归：list_templates 重读一次（或 S1 已经覆盖），断言
  media_import.expectedDelta 仍无
  fields；region_create.expectedDelta 仍无 fields。

  清理

  smoke 中创建的 track / item / region 留在 REAPER
  项目里由用户手动 Cmd+Z / 删除（沿用 Slice 04–09
  惯例）；任何临时 render dir 必须删干净。

  S6 / S10 / S11 的 orphan track（"force-c-<ts>" / "Slice10 PP
  <ts>" / "Slice10 SM <ts>"）在 PROGRESS / 本 packet 的 live
  smoke evidence 段必须明确点名"这些是预期的 'create + verify
  failure' 语义副作用"，让用户知道不需要 panic。S8 不留
  orphan（reuse 路径），也明确记录。

  通过判据

  S0–S17 全绿，且：

  - S2 / S3 的 happy 路径确实进入 fields verify 且 P_NAME
  通过——这是 Slice 10 核心断言（create + reuse 两条路径都跑
  verify pipeline）。
  - S3 的 reuse 路径下 delta_tracks=0 仍通过结构 verify——这是 D4
  决策 (a) 的核心断言。
  - S6 details 含 fields[0]，结构与本 packet §5 一致；create
  路径 handler 已经把新 track 创建了，但 envelope 是
  VERIFY_FAILED。
  - S7 的 LAST_RESULT 隔离——VERIFY_FAILED 不更新
  LAST_RESULT，即使 handler 真的创建了实体。
  - S8 details 含 fields[0]；reuse 路径 handler 没创建新
  track，但 envelope 仍是 VERIFY_FAILED。
  - S9 的 LAST_RESULT 隔离——VERIFY_FAILED 不更新
  LAST_RESULT，即使 handler 没创建实体（reuse 路径的语义守护）。
  - S10 的 paramPath 错位仍走 Slice 06 的 mismatch
  路径（不是新代码路径）。
  - S11 details 不含 fields（结构 mismatch 优先）。
  - S13 / S14 / S15 / S16 wire code 与 Slice 09 之前完全一致。
  - 任何 path 退化为 INTERNAL_ERROR / 错误码字面量泄漏 →
  不通过，回滚迁移并复盘。
  - list_templates 11 模板字节稳定，仅 track_create 新出现
  fields[]——其他 3 个 creates/maybeCreates 类（media_import /
  region_create / render_region）必须仍无 fields。

  ---
  针对用户 6 个问题的直接答案

  1. maybeCreates create path 和 reuse_existing path 是否都跑
  field verify？

  都跑。bridge 端 verify.check_fields 是 delta-agnostic
  的——它只看 expected.fields，不查 actual delta。两条路径都返回
  changed_ids = { "guid:{TRACK-GUID}" }，verify pipeline 走
  parse_guid_ref(changed_ids[1]) → find_track_by_guid(guid) →
  read_track_field(handle, "P_NAME") → 与 params.name
  string-equal 比较——形态完全一致。create 路径下 P_NAME ==
  params.name 通过（handler 显式 set）；reuse 路径下 P_NAME ==
  params.name 也通过（handler 用 name
  查的，结构性永真）。不引入"reuse 短路 verify"分叉（D4 决策
  (a)）；reuse 路径下 verify 是"pipeline 还活着"的
  proof-of-life，不是强断言，这条契约写进 TEMPLATE_SPEC.md。

  2. verify 字段是否只验 track P_NAME <- params.name？

  是。Slice 10 单字段 P_NAME ← params.name，track scope，string
  equality，无 tolerance（D3=a,
  D5=a）。其他候选字段（I_FOLDERDEPTH 无 paramPath 推导、track
  index 需要新 reader 类型）都引入新轴，应作为独立 packet。

  3. 当结构 delta=0 但 changed_ids 返回已存在 track GUID
  时，check_fields 如何读取该 track？

  复用 Slice 06 已落定的 FIELD_READERS["track"]
  主路径，零代码改动：

  1. parse_guid_ref(changed_ids[1]) → 提取 GUID 字符串（regex
  ^guid:(%b{})$，与 item GUID 同形）。
  2. find_track_by_guid(guid) → 线性扫描 CountTracks(0)，对每个
  track 调 GetSetMediaTrackInfo_String(track, "GUID", "", false)
  比对——reuse 命中的已存 track 必能找到（它就在工程里）。
  3. read_track_field(handle, "P_NAME") →
  GetSetMediaTrackInfo_String(handle, "P_NAME", "", false)
  返回该 track 当前的 P_NAME。
  4. values_match(expected=params.name, actual, tolerance=nil) →
  tolerance 为 nil 走 expected == actual 路径。
  5. reuse 命中的前提是 find_track_by_name(params.name) 已经按
  name 找到，所以 P_NAME readback == params.name 必为 true。

  结构 verify 端 expected.maybeCreates 分支 (if d ~= 0 and d ~=
  count_val then mismatch) 已经允许 d==0，所以 reuse 路径的
  delta=0 不被结构 verify 拦住，直接进 field verify。

  4. 是否需要 Lua verify 改动，还是现有 track reader 已够？

  现有 track reader 已够，零 Lua 改动。FIELD_READERS["track"] 自
  Slice 06 起就为 track_rename 服务，专门处理 P_NAME 走
  GetSetMediaTrackInfo_String；find_track_by_guid 也是 Slice 06
  落地。Slice 10 只是让 track_create 复用同一条路径。verify.lua
  / streetlight_bridge.lua / track.lua / manifest.lua 全部不改。

  5. 需要哪些 registry / manifest redlines，防止 maybeCreates
  放宽滑到 count:any / region scope？

  - registry.ts（见 §5 伪代码）：
    - fields[] + deletes:true → 仍拒。
    - fields[] + (maybeCreates OR creates) → 必须 numeric count
  >= 1（统一规则）。
    - maybeCreates + count:"any" 由 Slice 04 已有的 maybeCreates
  requires a numeric count 规则前置拦住——结构上不可达 fields +
  maybeCreates + "any" 这条组合。
    - creates + count:"any" + fields → 仍拒（Slice 09
  规则保留）。
  - manifest-alignment.mjs 同口径修订（CLI 与 vitest
  校验对齐）。
  - lua-structure.test.mjs grep 守护：verify.lua 未引入
  parse_region_ref / scope = "region" / region
  FIELD_READER（防本 slice 漂出 scope 扩展）。
  - list-templates 测试：断言 media_import / region_create /
  render_region 仍无 fields（防 PR 顺手扩散）。
  - HANDOFF + KERNEL_HARDENING_PLAN 把"已放开 /
  仍互斥"组合矩阵列清楚：
    - ✅ creates + numeric count + fields（Slice 09）
    - ✅ maybeCreates + numeric count + fields（Slice 10）
    - ❌ creates + count:"any" + fields（Slice 11+ for
  media_import，需独立产品决策"首项/全项 verify"）
    - ❌ deletes + fields（v0.1 无 deletes 模板，规则保留）
    - ❌ field scope = "region"（Slice 12+ for
  region_create，需新 parse_region_ref + 新 reader）
    - ❌ render_region 任何 verify（永久 carve-out，artifact
  path）

  6. live smoke 怎么覆盖 create + reuse 两条路径，以及
  VERIFY_FAILED 不污染 LAST_RESULT？

  详细见 §10。核心五件事：

  - S2 happy create：track_create name:"X" reuse_existing:true
  首次调用 → delta_tracks=+1 + P_NAME verify 通过。
  - S3 happy reuse：同命令第二次调用 → delta_tracks=0 + P_NAME
  verify 通过 + changed_ids[1] GUID 与 S2 完全相同。
  - S6 forced create + VERIFY_FAILED：raw queue 改 wire
  field:"P_NAMEX" + reuse_existing:false → handler 创建 orphan
  track + bridge VERIFY_FAILED + details.fields[]。
  - S7 create-path LAST_RESULT 隔离：track_rename
  last_result:track:0 仍作用于 S2/S3/S4/S5 的同一 track，S6 的
  orphan 名字不变。
  - S8 forced reuse + VERIFY_FAILED：raw queue 改 wire
  field:"P_NAMEX" + reuse_existing:true + 命中已存名字 → handler
  不创建任何 track + bridge VERIFY_FAILED + details.fields[] →
  reuse 路径下 VERIFY_FAILED 不留 orphan。
  - S9 reuse-path LAST_RESULT 隔离：track_rename
  last_result:track:0 仍作用于 S7 后的同一 track，S8
  没动任何东西。

  S7 + S9 一起锁定"无论 create 还是 reuse 路径的
  VERIFY_FAILED，都不污染 LAST_RESULT"——这是 maybeCreates 类相对
  creates 类的语义差异（D6 决策 (a) 显式记录）。

  ---
  拍板请求

  请就 D1–D6 拍板（推荐 (a)/(a)/(a)/(a)/(a)/(a)），其余按本
  packet 推进。Codex 执行；reviewer 只读复核；smoke
  通过后由你决定是否 commit——本 packet 不替你 commit、不
  push、不 reset、不 branch。

  最关键的两个决策点：

  - D2：D5 放宽到 maybeCreates 时是否同时放宽到
  count:"any"？推荐拒——count:"any" 多新建实体下的 verify
  分配语义需独立产品决策。
  - D4：reuse 路径下是否短路 field verify？推荐不短路——保留
  verify pipeline delta-agnostic 的 Slice 06 契约；reuse 路径下
  verify 永真是事实不是 bug，把这条契约写进 TEMPLATE_SPEC.md
  即可。

  若想换方向：

  - 直接 Slice 10 收 media_import：可以，但等于把"放 D5 到
  maybeCreates"和"count:'any' 多实体 verify
  分配语义"两件事一刀做。请准备好回答"changed_ids 有 N 条时只
  verify 首项是否合契约 / 是否扩展为 fields-per-item /
  是否全项扫描"——这是 1–3 个新的产品决策。
  - 直接 Slice 10 收 region_create：不推荐——region scope +
  region:NAME 形 ref + 新 FIELD_READER 三个新轴叠加 D5
  放宽，故障定位贵。建议先做 track_create 把"D5 放宽到
  maybeCreates"的 static redline 套件先在最简形态上验证。

✻ Baked for 11m 13s

────────────────────────────────────────────────────────────────
❯ 
────────────────────────────────────────────────────────────────
  ? for shortcuts · ← for agents             100% context used



