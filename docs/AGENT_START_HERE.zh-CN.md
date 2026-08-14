# OpenReaper Agent Start Here

状态：OpenReaper 0.1.0 发布文档的中文 Agent 启动指南。英文
`docs/AGENT_START_HERE.md` 是唯一 runtime source；本文是对应的人类可读
翻译，不参与 MCP projection。

## 首轮流程

流程：`ping -> 用用户原话搜索 -> 优先选择一个 Macro 或官方 Recipe -> 精确
展开 -> 一次 call_template 或 call_recipe -> live readback`。

1. 用 `ping` 确认服务已加载，并读取 readiness 与 startup guidance。
2. 用用户原话查询 `list_templates`；可复用或多阶段意图同时查询
   `list_recipes`。不要先猜大小写、字段、ref、enum 或 Recipe identity。
3. 用精确 id 展开选中的 Macro 或官方 Recipe，再提供输入。
4. 只调用一次 `call_template` 或 `call_recipe`；不要在 Agent 循环中重放
   Recipe stage 或 target。
5. REAPER live readback 才是写入真相；SQLite / Project Index 只负责导航。

OpenReaper 恰好提供六个工具：`ping`、`get_state`、`list_templates`、
`list_recipes`、`call_template`、`call_recipe`。不存在第七个工具，也不存在
raw executor。

保存的 Recipe 使用 `call_recipe` 的七个 operation：`validate`、`save`、
`list`、`get`、`delete`、`run`、`resume`。从 `list_recipes` 发现 revision 后，
必须原样复用完整的 `recipe_id`、`version`、数字 `revision`、`content_hash`
和 `validation_result_id`。不要只凭模糊 Recipe id 执行，也不要自行重放步骤。

当前提供两个官方 Recipe：

- `recipe.mix.create_bus_processing`
- `recipe.midi.create_instrument_part`

官方、用户和 fork Recipe 共用 generic runner、一次公开 `call_recipe`、完整
plan、REAPER 侧批处理、一次聚合 readback/evidence 和一次 Whole-Recipe Undo。

## Recipe 快速用法

Recipe 是“保存下来的声明式批处理程序”，不是 Agent 对话。一个现有 Macro
已经完整覆盖单次有界操作时用 Macro；需要两个或更多有序阶段、把同一固定
计划应用到许多精确目标，或希望断线重连后继续复用时用 Recipe；需要判断、
教学或动态工作流时用 Skill。Agent 只在执行前选择依赖并绑定输入，执行后解释
聚合 readback；Recipe 执行期间 Agent 不逐阶段、逐目标循环。

临时 Recipe 的机械写法：读取
`product_surface.recipe_productization.lifecycle.minimal_draft_template`，精确展开
每个依赖，复制 id/version/risk/descriptor hash/capabilities，替换所有 `COPY_`
值，然后执行 `validate -> save -> run`。例子：“对 63 个精确选中的对白音频
Item 套同一固定清理计划。”Recipe 保存固定计划，批处理 Macro 在一个阶段内
处理全部 63 个目标，不能发 63 次调用。该 Macro 上限为 64 时，1-64（包括
63）都合法，65 必须在 mutation 前失败。终态 evidence 保留后，如只用一次，
用完整 saved identity 和 `confirm=true` 执行 `delete`；如需长期保存，省略
`delete`，重连后用 `list/get` 找回同一精确 revision 再运行。inline 或未保存
draft 永远不能执行。

升级后，如果某个被保留的用户 Recipe revision 与当前 dependency catalog
不再一致，`list_recipes` 会将它标记为 `REVISION_STALE`，同时保持官方 Recipe
和其他有效 Recipe 可用。不要自动改写或执行 stale revision；提示用户需要
revalidate/rebase，并在合适时继续使用不受影响的 Recipe。

优先使用十五个平级 Macro。只有 Macro 不覆盖任务、mode 尚未接受、目标无法
安全解析、领域尚未接受，或预算更适合原子调用时，才使用 direct Template，并
记录 typed fallback reason。不要用多个 Template 调用拼出隐藏 workflow。

对于同时放置的音频层，每个 source 使用独立 Track，避免意外的同 Track 重叠。
Remove Silence 使用 `macro.items.apply` 的 `mode=remove_silence`，或软件包内的
`Remove Silence...` / `Repeat Remove Silence with Last Settings` Action。支持
`all`、`leading`、`trailing`、`edges`、`internal` 五种 scope。Macro 与
Action 共用一个 REAPER-side 批处理计划，不得逐 Item 或逐片段通过 MCP 循环。

Normalization 使用 `mode=normalize_level`，metric 只能是 `lufs_i`、`rms_i`、
`peak`、`true_peak`、`lufs_m_max`、`lufs_s_max`。这是 REAPER 原生的
source/item/take pre-FX normalization，不是 post-FX。两种音频操作最多处理
64 个精确选中的音频 Item；更大选择必须在 mutation 前返回 zero-write。

## 平级 15 个 Macro 菜单

所有 Macro 都是平级入口，只按精确 id 展开完整 manual：

- `macro.project.inspect`
- `macro.project.query`
- `macro.project.delete_targets`
- `macro.project.apply_layout`
- `macro.project.file`
- `macro.routing.apply`
- `macro.media.place_assets`
- `macro.items.analyze`
- `macro.items.apply`
- `macro.midi.apply`
- `macro.fx.apply_chain`
- `macro.fx.set_controls`
- `macro.controls.set`
- `macro.automation.apply`
- `macro.render.targets`

## 15 个 Macro 最小示例

用用户原话搜索并精确展开所选 Macro，再按 manual 提供 schema-valid 输入：

- `macro.project.inspect`：检查工程是否就绪并告诉我当前工程路径。
- `macro.project.query`：找出当前选中的 Item 和精确引用。
- `macro.project.delete_targets`：删除确认过的精确目标。
- `macro.project.apply_layout`：创建文件夹 Track 和子 Track。
- `macro.project.file`：保存当前工程。
- `macro.routing.apply`：把选中的 Track 路由到指定 Bus。
- `macro.media.place_assets`：导入并放置这批音频。
- `macro.items.analyze`：分析选中 Item 的响度、瞬态和静音。
- `macro.items.apply`：批量修改选中 Item。
- `macro.midi.apply`：量化选中的 MIDI 音符。
- `macro.fx.apply_chain`：给精确 Track 或 Take 添加 FX chain。
- `macro.fx.set_controls`：设置精确 FX 参数。
- `macro.controls.set`：修改并读回 Track、Item、Take 或 transport 控制。
- `macro.automation.apply`：在精确 live ref 上写 Automation。
- `macro.render.targets`：渲染接受的目标并返回输出证据。

## 分页、预算与恢复

- 返回 `cursor` 时继续分页，不能把不完整覆盖报告成 definitive not-found。
- 遇到预算错误时缩小 `limit`、fields 或 include。
- 通过 `get_state` 的 `scope=artifact` 与 `artifact_ref` 取回 artifact。
- 通过 `call_recipe get` 与 `evidence_ref` 取回保留的 Recipe 证据。
- readiness 或预算修复后最多重试一次；generation 改变后重新解析 ref。
- 写操作始终以 REAPER live readback 为准，SQLite 不能授权 mutation。

## 安全边界（不得绕过产品）

不得搜索源码、安装树、HOME 或媒体库来虚构能力；不得使用 raw Lua、raw
REAPER Action id、shell/process、raw SQL 或 UI 自动化绕过产品；不得把
placeholder ref 当成真实目标；不得操作 hardware/device I/O。

使用官方 `openreaper-start`。准备就绪必须同时有匹配 Bridge heartbeat 和真实
public read probe。macOS 和 Windows 的启动弹窗都只做只读观察，OpenReaper 不会
点击或关闭它们。遇到阻塞时返回 `STARTUP_USER_ACTION_REQUIRED` 并保留 REAPER
PID 和 Bridge generation；请用户处理弹窗后运行
`openreaper-start --recover-existing`，不要启动第二个 REAPER。

## 经 Schema 检查的示例

```text
ping {}
list_templates {"query":"create a MIDI clip and add a compressor","limit":25}
list_templates {"ids":["macro.midi.apply"],"fields":["id","inputSchema"]}
call_template {"id":"macro.project.file","input":{"operation":"save_current"}}
call_template {"id":"macro.items.apply","input":{"mode":"set_properties","target":"selected","properties":{"volume_db":-3},"dry_run":false}}
```

完整 Macro manual 只通过精确 id 的 `list_templates` expansion 获取。不要要求
Agent 在 expansion 前虚构字段。

## 文档维护

- 只编辑英文文档标记的 compact 区作为 MCP initialization 的唯一来源。
- 中文文档必须同步声明与标题，但不得成为第二个 runtime contract。
- 英文 compact 区超过 16384 UTF-8 bytes、marker 缺失或顺序错误时必须
  fail closed，不能静默截断。
