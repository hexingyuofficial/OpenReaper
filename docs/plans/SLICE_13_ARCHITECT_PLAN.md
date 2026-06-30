 ---
  Slice 13 Architect Plan Packet — region_create 边界字段 verify（pos / 
  rgnend，optional-skip for item-mode）

  ▎ 工作流约束（重申）：本 packet 仅做计划。Architect 不写代码、不 commit、不 
  ▎ push、不 reset、不 branch。本 slice 改 TS 描述符 + 静态校验 redlines + 测试 
  ▎ + 文档；Lua 不改一行（Slice 12 已把 read_region_field 的 pos / rgnend 
  ▎ 路径打通）。wire 首次出现 region scope + 多个 fields 同时出现 + 含 
  ▎ optional:true 的 region-scope payload。

  ---
  候选排序（高 → 低）— 风险 / 收益 / 可测性

  A. region_create 加 pos ← start (optional) + rgnend ← end 
  (optional)，explicit-mode 完全 verify、item-mode optional 跳过 ⭐ 推荐

  - 本 slice 唯一新轴：首次在同一 descriptor 里把 Slice 07 的 optional:true 与 
  Slice 12 的 region scope 组合。verify.lua
  零改动（read_region_field("pos"/"rgnend") 已在 Slice 12
  一次性写好；check_fields 的 optional-absent 跳过逻辑早已在 Slice 07 落定）。
  - explicit-mode ({name,start,end}): 三个字段（name 必验 / pos 必验 / rgnend
  必验）。
  - item-mode ({name,item_id}): 一个字段（name 必验），两个字段（pos /
  rgnend）走 Slice 07 「optional + 缺 param → 跳过」路径。
  - 故意 mismatch 路径仍可测：raw queue 给 explicit-mode 改 start:5 但 handler
  创建后人为干预（或直接对 wire expected_delta.fields 做 paramPath 错位 / field
  错位 / 数值错位三类）。
  - 收益：H2 在 region scope 上从 "pipeline proof-of-life" 升级到 "explicit-mode
  强断言 + item-mode pipeline proof-of-life"。明确把"两 mode paramPath 不对称"
  这件事用最小放宽面解决——不引入「computed expected」轴。

  B. region_create 在 item-mode 也强 verify：引入 "computed expected" 描述符轴

  - 描述符新增 expectedSource: "param" | "derivedFromItem" 或 paramPath: 
  "item_id.D_POSITION+D_LENGTH"-类 DSL。
  - verify.lua 需要：解 params.item_id → refs.lua.resolve_item → 读 D_POSITION /
  D_LENGTH → 计算 expected。这是首次让 verify 跨 scope 读其它实体。
  - 故障面三件大事一刀：跨 scope reader / 新 descriptor 轴 /
  跨模板间数值漂移容忍。
  - 拒（建议作为 Slice 14+ 独立 packet，绑 "computed expected" 产品决策）。

  C. Handler-stashed bounds（让 region.lua 把 resolved rstart / rend 
  塞到额外信道）

  - 违反 I3 锁定信封（changed_ids 形态固定为 {"region:NAME"}），或要求新 wire
  字段（如 ctx.stash[...]）。
  - 拒。

  D. 不做 bounds，转 H4 / H6 / H7

  - H2 在 v0.1 上的最大未收口点就是 region bounds。Slice 12 packet 已显式说
  "bounds verify 留 Slice 13 独立 packet"。
  - 跳过会把 region scope 永远停在 "name-only pipeline proof-of-life"。建议先做
  Slice 13 = A 路径，再评估 H4 / H6。
  - D 路径仍是合法选项，但不是推荐。

  ▎ 结论：Slice 13 = A 路径。region_create.fields[] 从 1 项扩到 3 项（name 
  ▎ 不变，新增 pos optional + rgnend optional）。仅在 explicit-mode 下激活 
  ▎ bounds verify；item-mode 保持 Slice 12 的 name-only 
  ▎ proof-of-life。verify.lua / region.lua / streetlight_bridge.lua 零改动。

  ---
  1. Goal

  把 H2 在 region scope 上的覆盖从 "1 字段（name）" 扩到 "1+2 字段（name + 可选
  pos + 可选 rgnend）"，且：

  - 不引入新 descriptor 轴 —— 仅组合 Slice 07 的 optional:true 与 Slice 12 的
  region scope。
  - 不改 Lua —— Slice 12 的 FIELD_READERS["region"].read = read_region_field
  已支持 pos / rgnend / name 三个键；check_fields 的 optional-absent
  跳过路径已在 Slice 07 落定。
  - 不改 region.lua handler —— handler 仍走 explicit-mode (rstart=params.start,
  rend=params["end"]) / item-mode (rstart=item.pos, rend=item.pos+item.length)
  二路；TS 描述符的 paramPath 仍指向 start / end，item-mode 自动落入
  optional-skip。

  descriptor 形态：
  
  ┌─────┬────────┬────────┬───────────┬──────────┬──────────┬───────────┐
  │  #  │ scope  │ field  │ paramPath │ optional │ nullable │ tolerance │
  ├─────┼────────┼────────┼───────────┼──────────┼──────────┼───────────┤
  │ 0   │ region │ name   │ name      │ —        │ —        │ —         │
  ├─────┼────────┼────────┼───────────┼──────────┼──────────┼───────────┤
  │ 1   │ region │ pos    │ start     │ true     │ —        │ 1e-6      │
  ├─────┼────────┼────────┼───────────┼──────────┼──────────┼───────────┤
  │ 2   │ region │ rgnend │ end       │ true     │ —        │ 1e-6      │
  └─────┴────────┴────────┴───────────┴──────────┴──────────┴───────────┘
  
  执行路径（verify.check_fields 既有逻辑零改动）：
  - explicit-mode → params.start / params["end"] 都在 → 全部 3 字段 verify。
  - item-mode → params.start / params["end"] 不在 → pos / rgnend 跳过；只验
  name。
  - 任何 mode 下 params.name 都在 → name 必验。

  H2 v0.1 覆盖率：region_create 从 "1 字段 / pipeline proof-of-life" 升级到 "3
  字段 (1+2) / mixed-mode verify"；H2 覆盖的模板数仍是 10/11（render_region 永久
  carve-out）。

  ---
  2. Non-goals

  - 不动 5 工具面 (I1)、不动 call_template 成功信封 (I3)、不引入新错误码（继续走
  errs.VERIFY_FAILED）。
  - 不引入 "computed expected" 描述符轴（item-mode 不做 derived-from-item
  强验证；留 Slice 14+ 独立 packet）。
  - 不动 verify.lua（含 parse_region_ref / find_region_by_name /
  read_region_field / check_fields 主路径）—— Slice 12 已写好的 pos / rgnend
  读取分支在本 slice 首次被激活。
  - 不动 region.lua handler（含 explicit/item-mode
  XOR、AddProjectMarker2、changed_ids = {"region:" .. params.name}）。
  - 不动 streetlight_bridge.lua（含 check_counts → check_fields → 
  finalize_template 调用顺序、ctx.errs / ctx.json 注入）。
  - 不动 manifest.lua / refs.lua / error_codes.lua / lib/*.lua。
  - 不动 region GUID ref 支持（REAPER 7 无 region GUID API；refs.lua 仍返
  REF_INVALID + "regions don't support GUID refs in v0.1"）。
  - 不放开 fields[] + deletes:true（v0.1 无 deletes 模板，规则保留）。
  - 不放开 "all-items verify" / "per-item fields" 语义（留 Slice 14+）。
  - 不收 render_region（永久 carve-out）。
  - 不动 10 个已纳入 fields verify 的模板（item_pitch / item_move / item_rate /
  track_rename / item_trim / item_fade / item_duplicate / track_create /
  media_import / region_create 自身 Slice 12 已落的 name 字段）。
  - 不动 H1（LAST_RESULT 桶 / ENTITY_BUCKET / entity_buckets）。
  - 不动 recipes/ / scripts/setup.mjs / install.* / setup-out/ /
  docs/CROSS_MAC_SMOKE.md。
  - 不做 H4 idempotency token、H6 scaffold、H7 socket。

  ---
  3. User-facing behavior
  
  - region_create happy envelope 逐字节不变（仍是锁定 {template, changed_count, 
  changed_ids, truncated}；changed_ids = ["region:<name>"]；changed_count = 
  1）。其余 10 个模板 happy envelope 逐字节不变。
  - 新 wire / 语义只在五类路径上可见：

    - a. list_templates metadata：region_create.expectedDelta.fields[] 从 1
  条扩到 3 条。name 保持 Slice 12 形态；新增 pos/rgnend 两条带 optional:true 与
  tolerance:1e-6，不含 nullable。其他 10 个模板 metadata 字节稳定。
    - b. wire 首次同时出现 region scope + 多字段 + optional：call_template 
  region_create payload 中的 expected_delta.fields[] 含 3 项。其中 pos/rgnend 携
  param_path:"start" / param_path:"end" + tolerance:1e-6 + optional:true。这是
  Slice 13 唯一的 wire diff，针对单个模板，预期出现。
    - c. explicit-mode 强 verify 真实执行：region_create name:"foo" start:0 
  end:1.25 时 bridge 重读首个匹配 region 的 pos / rgnend，与 params.start /
  params["end"] 在 1e-6 容差下比对。N=1 完全 verify（pipeline proof-of-life on
  name + 强后置断言 on bounds）。
    - d. item-mode optional-skip：region_create name:"foo" item_id:"selected:0"
  时 params.start / params["end"] 均不在 → pos / rgnend 字段被 Slice 07 路径跳过
  → 只验 name（与 Slice 12 行为完全一致）。
    - e. mismatch 路径：
        - explicit-mode raw queue 把 pos field 改成 posX（reader 返 region field
  'posX' not supported）→ VERIFY_FAILED + details.fields[]。
      - explicit-mode raw queue 把 paramPath:"start" 改成
  paramPath:"startX"（params 无此 key, optional:false → mismatch
  {expected:"present param", actual:nil}） → VERIFY_FAILED。
      - explicit-mode raw queue 把 start:0 与
  expected_delta.fields[1].paramPath:"start" 都保留，但伪造 params.start = 99 与
  handler 实际写入的 0 不符（即直接造一个 raw-queue payload 使 wire-side
  params.start ≠ 真 handler 行为）—— 方便用 raw queue 制造一致结构、强制 
  verify_failure；
      - item-mode raw queue 把 params.item_id 与 wire
  expected_delta.fields[1].paramPath:"start" 保留：因为 item-mode 无
  params.start，pos 字段照 Slice 07 optional 路径跳过 —— 这是预期通过路径，非
  mismatch。要触发 item-mode 的 bounds mismatch，必须把 wire 的 optional:true
  移除（raw queue 控制），让 verify 走 "present param expected, nil actual" 路径
  → VERIFY_FAILED。
    - f. 结构 mismatch 仍优先（Slice 04 回归 + 在 region scope
  多字段场景首次验）：raw queue 给 region_create 发 expected_delta:{count:2, 
  creates:true, fields:[name, pos, rgnend]} → handler 只创建 1 个 region → 结构
  verify 先返 VERIFY_FAILED，top-level details 不含 fields[]（与 Slice 06–12
  一致）。
  - read-only 路径（ping / get_state / list_templates / list_recipes）继续不触碰
  LAST_RESULT (I7)。
  - VERIFY_FAILED 仍 recoverable:false；orphan region 副作用语义同 Slice 12（见
  §7 风险段 + §9 smoke 计数）。

  ---
  4. Files likely to change
  
  TypeScript（写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-server/src/templ
  ates/region-create.ts
    - 把现有 1 项 fields 扩到 3 项（顺序见 §5 伪代码）。
    - descriptor 上方注释更新：把 Slice 12 的 "bounds verification is deferred
  to Slice 13" 替换为 "Slice 13: pos/rgnend verified in explicit mode only;
  item-mode skips via optional:true. Future Slice 14+ may add computed expected
  for item-mode bounds. See TEMPLATE_SPEC.md."
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/core/src/registry.ts
    - 不改。FIELD_CHECK_SCOPES 自 Slice 12 已含
  "region"；validateExpectedDeltaFields 的 all-optional iff all-nullable
  规则适用于"全部字段都 optional"的情形——Slice 13 descriptor 是
  mixed-optional（name 不 optional / pos / rgnend
  optional），不触发该规则。fields + creates:true + numeric count >= 1 路径自
  Slice 09 已放开。
    - 断言不变量：mixed-optional + region scope + creates + numeric count
  仍走绿。registry tests 必须覆盖此组合。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-server/src/tools
  /call-template.ts
    - 不改。toWireExpectedDelta 自 Slice 06 已透传 param_path / tolerance /
  optional / nullable / scope / field，本 slice 不引入新 descriptor 字段。

  Lua（不写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/packs/core/verify.lua
  —— 不改。FIELD_READERS["region"].read = read_region_field 早已支持 "pos" /
  "rgnend" / "name"；check_fields 主循环对 mixed-optional 路径已在 Slice 07
  闭合（raw_value == nil and field.optional == true 跳过）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua
  —— 不改。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/packs/core/templates/r
  egion.lua —— 不改（handler 仍走 explicit / item-mode XOR）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/packs/core/{manifest,r
  efs,undo,error_codes}.lua / templates/*.lua / lib/*.lua —— 不改。

  Scripts（写）

  -
  /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/manifest-alignment.mjs
  —— 不改。Slice 13 不引入新静态规则；现有 validateExpectedDeltaFields
  已经接受多字段 + mixed-optional + region scope + creates + numeric count
  的组合（Slice 09 / Slice 12 累积）。但需要确认：
    - ["take", "item", "track", "region"].includes(field.scope) 已含
  region（Slice 12 落地）。
    - paramPath 字段 dotted 检查仍拒（field.paramPath.includes(".")），不影响
  "start" / "end"。
    - 重复 (scope,field) 检查仍拒；本 slice 三字段 key 是 region:name /
  region:pos / region:rgnend，无重复。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/error-codes.mjs ——
  不改。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/setup.mjs / install.*
  / setup-out/ —— 不改。

  Tests（写）
  
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/core/src/__tests__/r
  egistry.test.ts — +5：
    - 合法：region_create-shape descriptor {count:1, creates:true, 
  fields:[{scope:"region",field:"name",paramPath:"name"}, 
  {scope:"region",field:"pos",paramPath:"start",tolerance:1e-6,optional:true}, 
  {scope:"region",field:"rgnend",paramPath:"end",tolerance:1e-6,optional:true}]}
  。
    - 合法：mixed-optional + region scope + creates + numeric count（这是 Slice
  13 关键新组合）。
    - 非法回归：region scope + 全部 optional 且 NOT 全部 nullable（继续按 Slice
  08 规则拒，确保 Slice 13 不退化全-optional 守护）。
    - 非法回归：region scope + duplicate (scope, field) ——
  [{...,field:"pos",...}, {...,field:"pos",...}] 拒。
    - 合法回归：Slice 09–12 D5 矩阵 + region scope name-only Slice 12
  形态仍接受。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-server/src/tools
  /__tests__/call-template.test.ts — +3：
    - explicit-mode wire：region_create name:"foo" start:0 end:1.25 → wire
  expected_delta.fields[] 含 3 项；fields[1] = {scope:"region", field:"pos", 
  param_path:"start", tolerance:1e-6, optional:true}；fields[2] = 
  {scope:"region", field:"rgnend", param_path:"end", tolerance:1e-6, 
  optional:true}。
    - item-mode wire：region_create name:"foo" item_id:"selected:0" → wire
  形态与 explicit-mode 相同（wire-side 不知道 mode；optional 由 verify 端
  runtime 判定）。
    - 不含 nullable：descriptor 没声明 → wire 必然没有。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-server/src/tools
  /__tests__/list-templates.test.ts — +4：
    - region_create.expectedDelta.fields[] 长度 = 3，逐字段断言（含 paramPath /
  tolerance / optional 在 pos / rgnend 上正确；不含 nullable）。
    - 字段顺序断言（按 §6 D6 决策固定，便于回归比对）。
    - 其他 10 个模板 metadata 字节稳定。
    - render_region 仍无 expectedDelta（永久 carve-out）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/__tests__/manifest-al
  ignment.test.mjs — +3：
    - 合法：mixed-optional + region scope + creates + numeric
  count（双层守护）。
    - 合法回归：4 个 scope 仍接受。
    - 合法回归：Slice 09 / 10 / 11 / 12 D5 边界不退化。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/scripts/__tests__/lua-structu
  re.test.mjs — +3：
    - grep 守护 verify.lua 仍含 parse_region_ref + FIELD_READERS["region"] +
  read_region_field 内的 "pos" / "rgnend" / "name" 三个分支（防本 slice 误删
  Slice 12 reader）。
    - grep 守护 verify.lua 仍未引入 for _, id in ipairs(changed_ids) 之类
  multi-item 循环（Slice 14+）。
    - grep 守护 verify.lua 仍未引入 refs.resolve_item /
  dofile(refs.lua)-类调用（防本 slice 漂出 "computed expected" 跨 scope
  调用；解耦保留）。

  Docs（写）

  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/SLICE_13_ARCHITECT
  _PLAN.md — 本 packet 落盘（与 Slice 11 / 12 同格式）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/HANDOFF.md —
    - 修正 doc-vs-git drift：Slice 12 已 committed 在 6e4a02f（如果用户决定先
  commit Slice 12 push 状态再起 Slice 13，则更新；若 main 已是 Slice 12，则把
  "live-smoked / not committed" 改为 "committed and pushed"）。
    - live edge 切到 Slice 13；append Slice 13 decisions（D1–D7 见 §6）。
    - 更新组合矩阵 — region scope ✅（Slice 12 name + Slice 13 bounds
  explicit-mode-only）；明确 item-mode bounds verify 留 Slice 14+ (computed
  expected) 或 v0.2。
    - 明确 render_region 仍永久 carve-out。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/PROGRESS.md — Slice 13
  段（scope / what changed / verification baseline 占位 / live smoke evidence
  占位）。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/TEMPLATE_SPEC.md —
    - "Field verification" 表追加两行：region_create | region | pos | 
  params.start (optional, tolerance 1e-6)、region_create | region | rgnend | 
  params.end (optional, tolerance 1e-6)。
    - "Fields on region scope (Slice 12)" 子节末尾追加 "Bounds verification
  (Slice 13)" 段，明示：
        - explicit-mode ({name,start,end}) 完全 verify name + pos + rgnend。
      - item-mode ({name,item_id}) 仅 verify name；pos / rgnend 走 Slice 07
  optional-absent 跳过。这是 v0.1 conscious trade-off：避免引入 "computed
  expected"（从 item_id 派生 pos+length）描述符轴。
      - item-mode bounds verify（强后置断言）留 Slice 14+ / v0.2 — 需 "computed
  expected" 轴 + verify.lua 跨 scope ref 解析。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/RESPONSE_BUDGET.md —
  VERIFY_FAILED details 段追加：region_create mismatch 单字段失败时
  details.fields[] ≤ 256 字节增量；多字段失败（理论最多 3 项）≤ 768
  字节增量；wire expected_delta.fields[] 也从 1 项升到 3 项，但 v0.1 总 fields
  上限语义仍是 "至多两字段 per call（item_trim / item_fade）"——region_create
  是新例外（3 字段），更新 v0.1 上限描述为 "至多三字段 per call (region_create
  in Slice 13)"。
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/KERNEL_HARDENING_P
  LAN.md § H2 — 追加注："Slice 13 把 region_create.expectedDelta.fields[] 从 1
  项扩到 3 项，新增 pos/rgnend 两条带 optional:true + tolerance:1e-6。verify.lua
  / region.lua / bridge 不改一行——Slice 12 已写好 read_region_field 的
  pos/rgnend 分支与 Slice 07 已写好 optional-absent 跳过路径，本 slice
  首次激活该组合。explicit-mode 完全 verify；item-mode 仅 verify
  name。computed-expected (item-mode bounds 强后置断言) 留 Slice 14+ / v0.2 独立
  packet。H2 v0.1 收口完成度：10/11 模板 + region scope 从 name-only 升级到
  mixed bounds。"
  - /Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/KERNEL_HARDENING_E
  XECUTION.md § H2 + §0.2 重载协议 — 追加："Slice 13 不改 verify.lua 主路径，但
  wire 首次同时出现 region scope + 多字段 + optional:true。强烈建议 full
  quit/reopen REAPER，确保 generation = 1 + console 行含 loaded error_codes (22 
  codes)，避免旧 chunk 的 manifest 上 region_create 只有 name field 与新 chunk
  的三字段抢命令。验 console 含 bridge ready (generation 1) — loaded error_codes
  (22 codes)。"

  Files NOT touched（明确禁碰）

  - packages/core/src/errors.ts / result.ts / risk.ts / types.ts / refs.ts /
  queue.ts
  - packages/core/src/registry.ts（验证逻辑 Slice 12 时已含 region scope；只跑
  TDD 测试新组合）
  - packages/mcp-server/src/transport/file-queue.ts
  - packages/mcp-server/src/index.ts / tools/{get-state,list-recipes,ping,call-t
  emplate,list-templates}.ts（除两测试文件外）
  - packages/mcp-server/src/templates/*.ts（除 region-create.ts 外的 10 个 TS
  模板）
  - reaper/streetlight_bridge.lua
  - reaper/packs/core/{manifest,refs,undo,error_codes,verify}.lua、templates/*.l
  ua（含 templates/region.lua）、lib/*.lua
  - scripts/error-codes.mjs / manifest-alignment.mjs / setup.mjs / install.* /
  setup-out/ / recipes/*.yaml
  - render_region 模板（永久 carve-out）

  ---
  5. Contract / schema / error-code changes

  Descriptor — region-create.ts 改动

  // 当前（Slice 12）：
  expectedDelta: {
    count: 1,
    creates: true,
    fields: [
      { scope: "region", field: "name", paramPath: "name" },
    ],
  },

  // Slice 13：
  // Slice 13: region bounds verify. Explicit mode (`{name,start,end}`) verifies
  all
  // three fields; item-derived mode (`{name,item_id}`) skips pos/rgnend via 
  Slice 07
  // optional-absent rule. Computed-expected (deriving bounds from `item_id`'s 
  pos +
  // length) is a new descriptor axis deferred to Slice 14+ / v0.2.
  // See docs/TEMPLATE_SPEC.md § "Bounds verification (Slice 13)".
  expectedDelta: {
    count: 1,
    creates: true,
    fields: [
      { scope: "region", field: "name",   paramPath: "name" },
      { scope: "region", field: "pos",    paramPath: "start", tolerance: 1e-6,
  optional: true },
      { scope: "region", field: "rgnend", paramPath: "end",   tolerance: 1e-6,
  optional: true },
    ],
  },

  ▎ paramPath: "end" 是合法的 TS 字符串字面量；Lua 端 params[key] 用 bracket 
  ▎ 访问 (params["end"])，与 region.lua handler 既有写法一致。

  Wire 协议（snake_case, 字面同名）

  jsonc
  "expected_delta": {
    "count": 1,
    "creates": true,
    "fields": [
      { "scope": "region", "field": "name",   "param_path": "name" },
      { "scope": "region", "field": "pos",    "param_path": "start",
  "tolerance": 1e-6, "optional": true },
      { "scope": "region", "field": "rgnend", "param_path": "end",
  "tolerance": 1e-6, "optional": true }
    ]
  }

  不含 nullable。

  Lua check_fields 行为差异：零

  FIELD_READERS["region"].read = read_region_field 自 Slice 12 起就支持 "pos" /
  "rgnend" / "name"；check_fields 主循环 if raw_value == nil and field.optional 
  == true then should_read = false 路径自 Slice 07 起就有；本 slice 首次让
  region scope descriptor 走 optional 分支。

  TS — registry.ts 行为差异：零

  Slice 12 已扩 FIELD_CHECK_SCOPES = 
  {"take","item","track","region"}；validateExpectedDeltaFields
  的所有规则（duplicate / 负 tolerance / dotted paramPath / boolean optional /
  boolean nullable / all-optional iff all-nullable / D5 矩阵 / creates+numeric
  count >= 1）适用本 slice 三字段 mixed-optional 形态——本 slice 不改一行
  registry 验证逻辑。

  VERIFY_FAILED 错误码：不动

  details.fields[] 形状不动；region scope 单字段失败增量 ≤ 256
  字节；三字段全失败上界 ≤ 768 字节（与 MAX_RESPONSE_BYTES = 65536 仍极远）。

  list_templates 元数据

  region_create.expectedDelta.fields[] 长度 = 3；顺序 [name, pos, rgnend]（见 §6
  D6 决策）。

  ---
  6. Decisions for user

  #: D1
  决策项: 是否做 Slice 13 = region_create bounds verify？
  选项: (a) yes — explicit-mode 完全 verify name+pos+rgnend，item-mode 仅 verify
  name (optional-skip);
         (b) yes — item-mode 也强 verify，引入 computed-expected 描述符轴 (Path
  B);
         (c) skip Slice 13，转 H4 idempotency / H6 scaffold / H7 socket。
  推荐: (a) — verify.lua / region.lua / bridge 零改动；首次组合 Slice 07
  optional 与 Slice 12
         region scope；computed-expected 轴留 Slice 14+ / v0.2 独立 packet。

  #: D2
  决策项: descriptor.field 命名约定（region scope）？
  选项: (a) pos / rgnend (匹配 verify.lua Slice 12 synthetic-handle 键名 +
  REAPER
         EnumProjectMarkers3 返回字段约定);
         (b) start / end (匹配 TS params 字段名)。
  推荐: (a) — 与 Slice 12 already-shipped read_region_field 一致；TS params
  命名（start/end）
         与 Lua reader 键名（pos/rgnend）分离是有意为之：paramPath 是 "从哪里读
  expected"，
         field 是 "从 reader 读哪个键"，两端解耦。

  #: D3
  决策项: pos / rgnend 字段 tolerance？
  选项: (a) 1e-6 (与 Slice 09 D_POSITION / Slice 11 D_POSITION 同口径，浮点
  64-bit IEEE 754
         epsilon);
         (b) 0 (严格相等，会被 REAPER float round-trip 微差坑);
         (c) 1e-9 (更严)。
  推荐: (a) — pos / rgnend 都是 double; AddProjectMarker2 -> EnumProjectMarkers3
  round-trip
         在 REAPER 内部已被观察到 epsilon 漂移；1e-6 是 Slice 09/11
  已验证安全的容差。

  #: D4
  决策项: descriptor.fields[] 顺序？
  选项: (a) [name, pos, rgnend] (Slice 12 name 在首位 + 语义 "标识 → 边界"
  顺序);
         (b) [pos, rgnend, name] (Lua handle 键的物理顺序);
         (c) [name, rgnend, pos] (其他)。
  推荐: (a) — name 在首位保持 Slice 12 形态稳定；pos 在 rgnend 前匹配 "start 在
  end 前" 语义；
         便于回归测试逐项比对。

  #: D5
  决策项: item-mode 下 pos / rgnend 失语的契约表述？
  选项: (a) "Slice 13 = explicit-mode strong-bounds + item-mode name-only
  pipeline proof-of-life;
          item-mode bounds verify deferred to Slice 14+/v0.2 (computed-expected
  axis)"
         — 文档化为 conscious trade-off；
         (b) 不文档化，让 list_templates 描述符自表达；
         (c) 在 descriptor 上方注释 + TEMPLATE_SPEC + KERNEL_HARDENING_PLAN
  三处冗余记录。
  推荐: (a) — agent-facing spec 必须明示 "item-mode 下没有 bounds
  verify"，避免误读 Slice 13
         后 item-mode 行为已强化。

  #: D6
  决策项: VERIFY_FAILED orphan-region 副作用文档与 smoke 怎么覆盖？
  选项: (a) 沿用 Slice 12 已建立的 "create + VERIFY_FAILED leaves 1 orphan
  region" 契约;
         smoke S5 / S6 / S7 / S8 各显式触发一次 mismatch path，预期 4 个 orphan
  regions;
         PROGRESS / live smoke evidence 段必须列计数;
         (b) 新建 "bounds-failed orphan" 子类别，独立计数与文档化;
         (c) 不显式记录，让用户自己看 REAPER timeline 对账。
  推荐: (a) — Slice 12 契约可复用；只需扩展 smoke 计数到 4–5 个 orphan regions；
         不引入新副作用类别（bounds mismatch 与 name mismatch 在 LAST_RESULT /
  项目态
         层面无差别）。

  #: D7
  决策项: HANDOFF.md doc-vs-git drift 怎么处理？
  选项: (a) 在本 packet 落盘前先让用户更新 HANDOFF（把 Slice 12 标 committed 在
  6e4a02f),
         Slice 13 packet 引用更新后的状态;
         (b) Slice 13 packet 直接引用 6e4a02f 作为 Slice 12 baseline，HANDOFF
  由用户后续更新;
         (c) 不动 HANDOFF，packet 也不引用 commit hash。
  推荐: (b) — packet 不阻塞 HANDOFF 更新；用户管 git out-of-band，doc
  同步随用户节奏；
         但 packet 明示 "main HEAD 已含 Slice 12 = 6e4a02f"，避免 Codex 执行时被
         HANDOFF 旧文混淆。

  ---
  7. Risks & regression notes

  Slice 12 reader 的 pos / rgnend 路径首次被激活

  - Slice 12 packet 写好了 read_region_field 的三分支（name / pos /
  rgnend），但只有 name 被实际跑过。pos / rgnend 路径在本 slice 首次被
  explicit-mode smoke 走过。
  - 风险：EnumProjectMarkers3 返回的 pos / rgnend 顺序与 REAPER
  内部存储顺序是否完全一致？AddProjectMarker2 写入与 EnumProjectMarkers3 读取的
  round-trip 是否有 epsilon 漂移？
  - 缓解：
    - tolerance 1e-6（D3）作为安全 epsilon。
    - smoke S3 (explicit-mode happy) 显式验证 round-trip 准确性：发 start:0 
  end:1.25 → verify 必须通过；如果 happy path 都 VERIFY_FAILED，说明 tolerance
  不够大，需重决策。
    - smoke S4 用非平凡 start:7.13 end:13.71 再验证一次（防 start:0 假阳性）。

  item-mode 失语的可读性风险

  - item-mode 下 pos / rgnend 被 Slice 07 optional-absent 跳过，agent 可能误读为
  "Slice 13 升级了 region bounds verify = 所有 mode 都更严"。实际上 item-mode
  仍只验 name。
  - 风险：v0.2 / Slice 14+ 实现 computed-expected 之前，item-mode 的 bounds
  实际由 handler 内部 rstart = pos, rend = pos+length 决定，verify
  不复核。理论上 handler bug（如 rend = pos + length + Math.random()）不会被
  verify 抓住。
  - 缓解：
    - D5 (a) 选 "TEMPLATE_SPEC.md 显式声明 item-mode 不验 bounds"；
    - descriptor 上方注释引用 TEMPLATE_SPEC；
    - smoke S2 (item-mode happy) 与 S3 (explicit-mode happy) 都做，确认
  item-mode happy envelope 字节稳定 + verify 通过的同时，PROGRESS 明示
  "item-mode bounds verify is structurally weaker than explicit-mode"。
    - lua-structure.test.mjs grep 守护 region.lua 仍不规范化 params.start /
  params["end"]（确保 handler 直接传 params 进 AddProjectMarker2，便于 verify
  round-trip）。

  optional:true + 跨 mode 共享 wire 的契约

  - wire 上 optional:true 是 verify-runtime 判定的——它不告诉 wire 端"现在是
  explicit 还是 item-mode"。bridge 看到 params.start == nil 才跳过 pos 字段。
  - 风险：raw-queue 攻击面：恶意 wire 把 optional:true 移除，但 params 里仍无
  start → verify 必失败。这是 wire-side bug 的合法捕获，但要确保 mismatch
  message 清晰（"present param expected, nil actual"，复用 Slice 06）。
  - 缓解：smoke S6 (raw remove optional) 显式制造此 case，断言 mismatch message
  + details.fields[0].expected = "present param" + actual = nil。

  "end" Lua 关键字 paramPath 的可靠性

  - paramPath: "end" 在 TS 端是合法字符串字面量；wire 序列化为 JSON
  "param_path":"end" —— 标准 JSON。
  - Lua 端 params[key] 其中 key = "end" 走 bracket 访问，等价于 params["end"] ——
  与 region.lua handler 已有的 rend = params["end"] 同语法。
  - 风险：未来若有 verify.lua 重构使用 params.<key> dot
  访问（不太可能但理论可），params.end 会语法错误。
  - 缓解：lua-structure.test.mjs 加一条 grep 守护 verify.lua 永远用 params[key]
  不用 params.<some_var>-类 dot-via-variable 形式（这是 Lua
  语法本就不支持的，但守护一下防 silly mistake）。

  Slice 04 的结构 verify 优先级在 region scope 多字段场景上首次验证

  - 已在 Slice 11/12 验证 creates + count:"any" / region scope name-only
  上结构优先；本 slice 在 region scope + 多字段 + creates + count:1 上首次验证。
  - 风险：理论上 v0.1 应该一致，但首次 enroll 三字段失败场景。
  - 缓解：S9 (forced structural mismatch on region_create + multi-field
  descriptor) 显式验证。

  Static redlines（防 Slice 13 D-axis 滥用）

  - registry / manifest-alignment 双层守护：本 slice 不动 redlines，但要在 +5/+3
  测试里显式覆盖"mixed-optional + region scope + creates + numeric
  count"是合法组合，反例（如 4 个字段 region scope + 全 optional 但非全
  nullable）继续拒。
  - lua-structure.test.mjs grep 守护：
    - verify.lua 仍含 Slice 12 落定的 read_region_field
  三分支（pos/rgnend/name）。
    - verify.lua 未引入 multi-item / per-item / computed-expected 任何痕迹。
    - region.lua handler 未做 params.start / params["end"] 的规范化（trim /
  round / clamp）。
  - HANDOFF / KERNEL_HARDENING_PLAN 更新组合矩阵：
    - ✅ creates + numeric count + fields (Slice 09)
    - ✅ maybeCreates + numeric count + fields (Slice 10)
    - ✅ creates + count:"any" + fields (Slice 11, first-item)
    - ✅ region scope + 仅 string field "name" (Slice 12, pipeline
  proof-of-life)
    - ✅ region scope + mixed (string name + numeric pos/rgnend) + optional 字段
  (Slice 13)
    - ❌ deletes + fields (v0.1 无 deletes 模板，规则保留)
    - ❌ region scope + computed-expected (item-mode bounds strong-verify)
  (Slice 14+ / v0.2)
    - ❌ count:"any" + multi-item all-items verify (未排期，需 verify.lua 改动)
    - ❌ render_region 任何 verify (永久 carve-out)

  Error-code constants 不退化

  - 失败路径仍走 errs.VERIFY_FAILED。
  - Slice 05 audit 不需重跑（本 slice 不改 Lua），但保持 npm run 
  check:error-codes-fresh 仍报 22 codes。

  REAPER bridge boot 建议 full quit/reopen

  - 本 slice 不改 verify.lua，但 wire 首次出现 region scope + 多字段 +
  optional:true。
  - 旧 chunk 的 manifest 上 region_create 只有 1 字段；新 chunk 上 3 字段。chunk
  切换 race 可能让旧 chunk 收到新 wire 后走 Slice 12 路径（只查首字段）——
  不一定 crash，但 verify 行为不可预期。
  - 缓解：强制 full quit/reopen REAPER；console 必须看到 bridge ready 
  (generation 1) 与 loaded error_codes (22 codes)。

  回归覆盖必查项

  - Slice 06 4 happy envelope 字节稳定。                     
  - Slice 07 item_trim 两个 happy envelope 字节稳定（含 optional 跳过路径）。
  - Slice 08 item_fade 4 happy envelope 字节稳定（含 nullable）。
  - Slice 09 item_duplicate happy envelope 字节稳定。
  - Slice 10 track_create create + reuse 字节稳定。
  - Slice 11 media_import happy envelope 字节稳定（first-item verify）。
  - Slice 12 region_create name-only happy envelope 字节稳定（item-mode
  自然降级为 name-only，与 Slice 12 行为一致）。
  - Slice 04 结构 verify 仍优先于字段 verify。
  - Slice 05 errs.* 接线不退化。
  - Slice 02 get_state include 仍工作。
  - Slice 01 readonly scope 不污染 LAST_RESULT。
  - render_region 仍跳过任何 verify；changed_ids 仍是绝对路径；wire 仍无
  expected_delta。
  - last_result:region:N 仍工作（refs.lua 不被本 slice 影响）。
  - 跨类型 REF_INVALID 仍工作。

  ---
  8. Static test plan

  绝对路径命令：

  cd /Users/Zhuanz/Documents/streetlight-reaper-mcp
  npm test
  npm run build
  npm run check:manifest
  npm run check:error-codes-fresh                            
  git -C /Users/Zhuanz/Documents/streetlight-reaper-mcp diff --check

  通过判据：

  - npm test → 基线 291 + 新增 18 ≈ 309 全绿；若 < 291 视为回归。
  - npm run build → 0 报错（pre-existing TS6310 噪声可忽略）。
  - npm run check:manifest → Streetlight manifest alignment ok (11 templates).
  - npm run check:error-codes-fresh → Streetlight error codes fresh (22 codes).
  + zero forbidden literal usage.
  - git diff --check → 无空白错误。

  焦点测试套件：

  - registry tests + call-template tests + list-templates tests +
  manifest-alignment tests + lua-structure tests 组成 Slice 13 focused
  suite；独立全绿后再跑全量。

  ---
  9. Live REAPER smoke plan
  
  前置（必须）：用户完全退出 REAPER 进程（不只是关项目），重开 → Actions → Show 
  action list → ReaScript: Load… → 选 start_bridge.lua → Run。console 必须含：

  [streetlight] loaded error_codes (22 codes)
  bridge ready (generation 1) — loaded error_codes (22 codes) — templates: …

  generation ≠ 1 或 22 codes 行缺失 → 不通过，回到前置。

  Smoke 步骤（保持 Slice 04–12 的"成功路径 + 故意 mismatch + 多 slice
  回归"三轨）

  S0 reachability：ping → bridge:connected, reaper_version=7.71/macOS-arm64。

  S1 list_templates：11 模板返回；断言：
  - region_create.expectedDelta.fields[] = 3 项，按 D4 顺序：
    - [0] = {scope:"region", field:"name",   paramPath:"name"}（不含 tolerance /
  optional / nullable）。
    - [1] = {scope:"region", field:"pos",    paramPath:"start", tolerance:1e-6, 
  optional:true}。
    - [2] = {scope:"region", field:"rgnend", paramPath:"end",   tolerance:1e-6, 
  optional:true}。
    - 任何字段都不含 nullable。
  - Slice 06–12 已纳入 fields verify 的 10 个模板 metadata 字节稳定。
  - render_region 仍无 expectedDelta。

  S2 prep track + item：
  - track_create name:"Slice13 Live Smoke <ts>" reuse_existing:true → 拿到 track
  GUID（Slice 10 happy 回归）。
  - media_import path:"/System/Library/Sounds/Ping.aiff" 
  track_id:"last_result:track:0" position:0 → 拿到 item GUID（Slice 11 happy
  first-item verify 回归）。

  S3 explicit-mode happy + 平凡 bounds：region_create 
  name:"slice13-r-<ts>-explicit-zero" start:0 end:1。
  - 断言：changed_count=1, changed_ids=["region:slice13-r-<ts>-explicit-zero"]。
  - 验证：bridge 端 structural verify (Slice 04 / Slice 12 路径) 通过；fields
  verify (Slice 13 新激活路径) 三字段全过——name 字符串相等、pos 1e-6
  容差通过、rgnend 1e-6 容差通过。
  - 这是 Slice 13 的核心新行为：region scope 多字段 explicit-mode happy 完整
  verify。

  S4 explicit-mode happy + 非平凡 bounds：region_create 
  name:"slice13-r-<ts>-explicit-nontrivial" start:7.13 end:13.71。
  - 断言：changed_ids=["region:slice13-r-<ts>-explicit-nontrivial"]。
  - 验证：pos round-trip = 7.13 ± 1e-6 通过；rgnend round-trip = 13.71 ± 1e-6
  通过。
  - 这条防 start:0 假阳性 + 验证 REAPER round-trip epsilon 在 1e-6 安全。

  S5 item-mode happy（pos/rgnend optional-skip 路径）：region_create 
  name:"slice13-r-<ts>-item-mode" item_id:"last_result:item:0"。
  - 断言：changed_ids=["region:slice13-r-<ts>-item-mode"]，envelope 字节稳定。
  - 验证：bridge 端 fields verify 走三字段，但因为 params.start / params["end"]
  均缺，pos / rgnend 走 Slice 07 optional-absent 跳过；仅 name 真正比较，通过。
  - 这条验证 Slice 13 在 item-mode 下行为与 Slice 12 字节一致（item-mode happy
  envelope 不退化）。

  S6 字段名 mismatch 强制路径（field:"posX"，raw queue, explicit-mode）：raw
  queue 投 region_create name:"slice13-r-<ts>-raw-posx" start:0 end:1，但 wire
  expected_delta.fields[1].field = "posX"。
  - handler 仍正常 AddProjectMarker2 创建 1 个 region；bridge 端
  read_region_field(handle, "posX") 返回 false, nil, "region field 'posX' not 
  supported"。
  - 断言：VERIFY_FAILED、recoverable:false、details.fields[0].ok=false、details.
  fields[0].field="posX"、details.fields[0].expected=0、details.fields[0].actual
  ="region field 'posX' not supported" (或与 Slice 06 mismatch reason
  同形)、message 含 Slice 04 恢复短语字面量。
  - 副作用：1 个 orphan region 留在工程（D6 决策 (a) 显式记录）。

  S7 paramPath 错位（raw queue, explicit-mode）：raw 发 region_create 
  name:"slice13-r-<ts>-raw-parampath" start:0 end:1，wire params 正常，但
  expected_delta.fields[1].paramPath = "startX"（不存在的 key）+ wire 上仍标
  optional:true。
  - verify 端 params["startX"] == nil 且 optional == true →
  跳过该字段（不是失败）；name / rgnend 仍正常 verify → 通过。
  - 这条验证 paramPath 错位但 optional:true 时的"宽松行为"——按 Slice 07
  契约应该跳过。
  - 副作用：1 个 happy region 留在工程（非 orphan）。

  S8 paramPath 错位 + 移除 optional（raw queue, explicit-mode）：raw 发
  region_create name:"slice13-r-<ts>-raw-noopt" start:0 end:1，wire params
  正常，但 expected_delta.fields[1].paramPath = "startX" 且 wire 上移除
  optional:true。
  - verify 端 params["startX"] == nil 且 optional 不为 true → mismatch
  {expected:"present param", actual:nil} → VERIFY_FAILED。
  - 这一步守护 wire 端 raw 攻击面：optional:true 是 wire-runtime
  判定的，移除即触发严格路径。
  - 副作用：1 个 orphan region。

  S9 数值 mismatch（raw queue, explicit-mode）：raw 发 region_create 
  name:"slice13-r-<ts>-raw-numval" start:0 end:1，wire 把 params.start = 
  999（造成 wire 上 expected ≠ 真实 handler 写入的 pos）。

  看到的）。如果想真正触发 mismatch，需要 wire params.start = 0（handler 写入
  0）但 verify 端 wire expected_delta.fields[1].paramPath = "start" 不变 + raw
  把 wire params 留 start = 0 —— 这样 verify 算出 params["start"] = 0 与 
  readback pos = 0 相等。这条路径无法直接用 raw queue 触发数值 mismatch。
  - 替代：raw queue 发 params.start = 0，但 wire 上加
  expected_delta.fields[1].param_path = "_force_mismatch" 同时改
  expected_delta.fields[1].field = "rgnend" (改成期望 rgnend 等于 0)。此时
  verify 读 params["_force_mismatch"] = nil + optional 不为 true → mismatch。
  - 简化版：S9 直接验"raw 把 wire expected_delta.fields[2].param_path = 
  "end_wrong" + 移除 optional" → params 无此 key → mismatch；这是 paramPath
  错位的另一个 instance。或者 干脆跳过这个 case，因为 wire 端无法直接触发数值
  mismatch（handler 写入 = wire params；wire params = verify 读
  expected；二者天然同源）。
  - 建议：S9 改成"数值 mismatch via field 错位"——把
  expected_delta.fields[2].field = "pos" 同时 paramPath = "end"（强制 verify 读
  readback.pos 与 expected = params.end = 1 对比；readback.pos = 0；mismatch）→
  VERIFY_FAILED + details.fields[0]={field:"pos", expected:1, actual:0, 
  tolerance:1e-6, ok:false}。这是数值 mismatch 真实路径。
  - 副作用：1 个 orphan region。

  S10 结构 mismatch 仍优先（Slice 04 回归 + 在 region scope 
  多字段场景首次验）：raw 发 region_create name:"slice13-r-<ts>-raw-struct" 
  start:0 end:1，expected_delta = {count:2, creates:true, fields:[name, pos, 
  rgnend]}（期望 2 个 region，但 handler 只创建 1 个）。
  - 结构 verify count expected 2 got 1 失败优先返回，top-level details 不含
  fields[]（与 Slice 06–12 一致）。
  - 副作用：1 个 orphan region。

  S11 LAST_RESULT 不污染：S6 / S8 / S9 / S10 之后，发 track_rename 
  last_result:track:0 name:"slice13-survived-<ts>" → 仍作用于 S2 的
  track（LAST_RESULT.tracks 未被 region create + VERIFY_FAILED 污染）。
  - 同时验 LAST_RESULT.regions 仍是 S5 / S7 创建的成功 region（不含 orphan）。

  S12 Slice 12 region scope 回归：再发一次 region_create 
  name:"slice13-r-<ts>-extra-name-only" start:0 end:0.5 → 成功。该路径与 Slice
  13 多字段 happy 一致，但用作"Slice 12 baseline 仍在"的 explicit check。

  S13 Slice 09 / 10 / 11 D5 boundary 回归：
  - item_duplicate last_result:item:0 track_id:"last_result:track:0" 
  position:5.0 → success + Slice 09 D_POSITION verify。
  - track_create name:"Slice13 reuse <ts>" reuse_existing:true → success + Slice
  10 P_NAME verify。
  - media_import path:"/System/Library/Sounds/Ping.aiff" 
  track_id:"last_result:track:0" position:3.0 → success + Slice 11 first-item
  D_POSITION verify。

  S14 Slice 06 / 07 / 08 回归：
  - item_pitch last_result:item:0 semitones:-3 → success + D_PITCH verify。
  - item_move last_result:item:0 position:5.0 → success + D_POSITION verify。
  - item_trim last_result:item:0 length:1.0 → success + D_LENGTH verify +
  D_STARTOFFS skip。
  - item_fade last_result:item:0 fade_in:null → success + nullable verify。

  S15 error-code constants 回归：
  - region_create name:"bad/name" start:0 end:1 → REGION_NAME_INVALID。
  - region_create name:"slice13-r-<ts>-explicit-zero" start:0 end:1 第二次发 →
  REGION_NAME_TAKEN。
  - item_pitch selected:99 → ITEM_NOT_FOUND。
  - media_import path:"/no/such/file" → MEDIA_NOT_FOUND。
  - cross-type track_rename selected:0 仅当 selection 为 item → REF_INVALID。

  S16 get_state include 回归：
  - get_state(tracks, include:["fx"]) → OK；
  - get_state(render, include:["fx"]) → PARAMS_INVALID；
  - get_state(render) → SCOPE_NOT_IMPLEMENTED；
  - get_state(regions) → 返回包含 S3 / S4 / S5 / S6 / S7 / S8 / S9 / S10 / S12
  创建的所有 regions 名（含 orphans —— 用户可肉眼对账）。

  S17 render_region carve-out：render_region 
  region:"slice13-r-<ts>-explicit-zero" output_dir:"<临时 dir>" 
  render_pattern:"slice13-r-<ts>-explicit-zero" → success；临时 dir 含且仅含
  .wav，无 .RPP / .RPP-bak。changed_ids 是绝对 WAV 路径。render_region
  仍跳过任何 verify。临时 render dir 用后必须删干净。

  S18 metadata 终查：list_templates 重读一次（或 S1 已覆盖），断言 render_region
  仍无 expectedDelta（永久 carve-out）；region_create metadata 仍如 S1 所述。

  清理

  - smoke 中创建的 track / item / region 留在 REAPER 项目里由用户手动 Cmd+Z /
  删除（沿用 Slice 04–12 惯例）；临时 render dir 必须删干净。
  - 预期 region 计数留在工程：S3 / S4 / S5 / S7 / S12 的 happy regions (5 个) +
  S6 / S8 / S9 / S10 的 orphan regions (4 个) + S15 REGION_NAME_TAKEN 测试未创建
  = 共 9 个 regions。PROGRESS / 本 packet live smoke evidence
  段必须明确点名"S6/S8/S9/S10 的 4 个 orphan 是预期的 'creates + verify failure'
  副作用，与 Slice 12 同语义但 Slice 13 多了 1 个 raw struct mismatch
  case"，让用户知道不需要 panic。

  通过判据
  
  S0–S18 全绿，且：

  - S3 / S4 的 happy 路径进入 fields verify 且 name + pos + rgnend 全过——这是
  Slice 13 核心断言（region scope explicit-mode 多字段完全 verify）。
  - S5 的 item-mode happy 路径下 pos / rgnend optional-skip 真实工作（与 Slice
  12 行为字节一致）。
  region，但 envelope 是 VERIFY_FAILED。
  - S7 的 paramPath 错位 + optional:true → 跳过该字段，verify 通过；这是 Slice
  07 契约在 region scope 上首次验证。
  - S8 的 paramPath 错位 + 移除 optional → mismatch；wire-runtime optional
  判定真实工作。
  - S9 的字段 errorr 错位（field 指向 readback 的 pos，但 paramPath 指向
  params.end）→ 数值 mismatch + details.fields[0]={field:"pos", expected:1, 
  actual:0, tolerance:1e-6}。 
  - S10 details 不含 fields（结构 mismatch 优先）；这是 region scope
  多字段首次验证此优先级。
  - S11 的 LAST_RESULT.tracks / LAST_RESULT.regions 不被 region create +
  VERIFY_FAILED 污染。
  - S12–S14 的 Slice 06–12 D5 + scope 矩阵不退化。
  - S15–S17 wire code 与 Slice 12 之前完全一致。
  - 任何 path 退化为 INTERNAL_ERROR / 错误码字面量泄漏 →
  不通过，回滚迁移并复盘。
  - list_templates 11 模板字节稳定，仅 region_create 的 fields[] 从 1 项扩到 3
  项——其他 10 个模板 metadata 字节稳定，render_region 仍无 expectedDelta。

  ---
  10. Rollback / commit discipline

  Architect 阶段（本 packet）

  - 不写代码、不 commit、不 push、不 reset、不 branch。
  - 仅产出本 packet（建议落盘到 /Users/Zhuanz/Documents/streetlight-reaper-mcp/d
  ocs/plans/SLICE_13_ARCHITECT_PLAN.md，由用户审核后决定是否写入）。

  Codex 执行阶段

  按 §4 文件清单与 §5 契约伪代码执行；按 §8 静态闸跑 npm test / build /
  check:manifest / check:error-codes-fresh / git diff --check 全绿后再交付。

  Reviewer 阶段
  
  只读复核，按 P1 / P2 / P3 分级出 finding，不直接改代码。

  Live smoke 阶段

  按 §9 步骤执行。若任何 S 步失败：
  - 绝不直接改代码，回到 Architect 提一个新 packet。
  - 失败的 raw-queue mismatch 路径留的 orphan regions / items
  不要自动清理（让用户视觉对账）。

  Commit / push

  - 完全由用户决定。本 slice 不替用户 commit、不 push、不 reset、不 branch。
  - 候选 commit message（仅参考，用户决定）：

  kernel-hardening: slice 13 region-create bounds field checks

  - Extend region_create.expectedDelta.fields[] from 1 to 3 entries.
  - Add region.pos <- params.start (optional, tolerance 1e-6).
  - Add region.rgnend <- params.end (optional, tolerance 1e-6).
  - region.name (Slice 12) kept as the first entry.
  - Activates Slice 12's read_region_field pos/rgnend reader and
    combines it with Slice 07's optional-absent skip rule.
  - 0 Lua changes; 0 verify.lua / region.lua / bridge changes.
  - Explicit mode {name,start,end} verifies all 3 fields; item-mode
    {name,item_id} verifies only name. Computed-expected (item-mode
    bounds strong-verify via item_id -> pos+length) deferred to
    Slice 14+ / v0.2.
  - Decisions: D1=a region bounds; D2=a pos/rgnend; D3=a 1e-6;
    D4=a [name,pos,rgnend]; D5=a TEMPLATE_SPEC + descriptor comment
    + KERNEL_HARDENING_PLAN; D6=a Slice 12 orphan contract reused;
    D7=b packet references 6e4a02f, HANDOFF sync by user.

  Rollback path

  如果 live smoke 任何 S 步失败或 reviewer 出 P1：
  - 不 reset，不 force push（与既有纪律一致）。
  - 由用户决定是否本地 git restore 撤回未 commit 的修改。
  - 若已 commit 未 push：用户决定是否 git reset --soft HEAD~1 撤回 commit
  保留改动，或 git revert 出反向 commit。
  - 重新走 Architect 阶段提新 packet。

  守护：本 slice 不应引入

  - verify.lua 任何改动（含新增 reader / 跨 scope 调用 / multi-item 循环 /
  computed-expected）。
  - region.lua handler 改动（含 params 规范化 / round / trim / 新增字段写入）。
  - streetlight_bridge.lua 调用顺序变化。
  - registry / manifest-alignment 静态规则改动（Slice 12 边界已足）。
  - 任何对 render_region 的 expectedDelta 尝试（永久 carve-out）。
  - 任何 refs.lua / manifest.lua / error_codes.lua 改动。

  ---
  拍板请求
  
  请就 D1–D7 拍板（推荐 a/a/a/a/a/a/b），其余按本 packet 推进。Codex
  执行；reviewer 只读复核；smoke 通过后由你决定是否 commit —— 本 packet 不替你
  commit、不 push、不 reset、不 branch。

  最关键的三个决策点：

  - D1 + D2：是否做 Slice 13 = region bounds verify，且只在 explicit-mode 强
  verify、item-mode 走 Slice 07 optional-skip？推荐 (a)/(a) —— verify.lua /
  region.lua / bridge 零改动；首次组合 Slice 07 与 Slice 12
  已有零件；computed-expected 轴（item-mode bounds 强 verify）留独立
  packet，避免本 slice 同时引入 3 个新轴。
  - D5：item-mode 失语契约如何文档化？推荐 (a) —— TEMPLATE_SPEC + descriptor
  注释 + KERNEL_HARDENING_PLAN 三处冗余记录，避免 agent 误读 Slice 13 后
  item-mode 行为已强化。
  - D7：HANDOFF doc-vs-git drift 怎么处理？推荐 (b) —— packet 直接引用 6e4a02f
  作为 Slice 12 baseline，HANDOFF 同步由用户后续更新；packet 不阻塞 git
  out-of-band 节奏。

  若想换方向
  
  - 直接做 Slice 13 = Path B (computed-expected 轴)：可以，但等于把"region
  bounds verify"与"verify.lua 跨 scope
  读取其它实体"两件事一刀做。请准备好回答：(1) verify.lua 是否允许
  dofile/require refs.lua，或自带 resolve_item_by_ref 副本？(2) expectedSource: 
  "param" | "deriveFromItem" 描述符轴怎么命名 / 怎么序列化到 wire？(3)
  派生失败（item_id 解不到、D_POSITION 读不到）的语义是 VERIFY_FAILED 还是
  INTERNAL_ERROR？这是 3 个新的产品决策。
  - 直接转 H4 idempotency：可以，但 H2 v0.1 收口将停在"region scope
  name-only"（Slice 12 状态），bounds 永远不验。如果 v0.1 release-candidate 要求
  "every undoable mutating template has field verify covering its primary write
  semantics"，应先做 Slice 13 再转 H4。
  - 直接转 H6 scaffold（descriptor → 代码生成）：H2 9/11 已达 H6 启动门槛（Slice
  11 完成时），可以；但 H6 scaffold 生成的"区域类新模板"会照 region_create 的
  descriptor 模板写 fields[]，如果 Slice 13 没把 region bounds verify
  跑通，scaffold 出来的区域模板默认就是 "name-only pipeline
  proof-of-life"——等于把 v0.1 的弱契约固化进生成器。建议先做 Slice 13 把 region
  scope 双字段路径跑活，再让 H6 scaffold 启动。