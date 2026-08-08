# OpenReaper 用户指南

状态：OpenReaper 0.1.0 候选版本。所有支持声明仍以证据为准。

OpenReaper 让你通过和代理对话来操作 live REAPER 工程。你不需要理解
Macro、Template、SQLite、对象 ref、artifact 或桥接内部。只需描述想要的结果；
代理应该选择已支持的路径、完成操作，并从 REAPER 读回验证。

## 基本流程

多数会话应该很简单：

1. 用普通语言描述任务。
2. 让代理检查当前工程或选择对象。
3. 只有任务跨过真实安全边界时，才批准一个有界范围。
4. 让代理执行普通、可撤销的工作，不要停在计划阶段。
5. 阅读简短结果：改了什么、REAPER 验证了什么、还有什么需要处理。

可以这样说：

```text
检查这个工程，告诉我现在选中了什么。
把这些选中 item 的开头对齐。
给人声轨添加当前已支持的温和 ReaComp 链。
把选中的轨道渲染成 WAV。
保存当前工程。
```

代理不能把计划、预览或 dispatch 成功当成工作完成。写操作只有经过 live
REAPER 读回后，才能报告成功。

## Macro 产品面

OpenReaper 有 15 个平级、可见、可执行的 Macro，不再有 Primary/Secondary
等级。

| Macro | 当前职责 |
|---|---|
| `macro.project.inspect` | 读取紧凑的 live 工程概览。 |
| `macro.project.query` | 查询工程索引中的候选目标、覆盖状态和变化。 |
| `macro.project.delete_targets` | 预览并执行已支持、已确认的目标删除，再读回确认消失。 |
| `macro.project.apply_layout` | 应用已支持的轨道/文件夹创建、排序、颜色和嵌套。 |
| `macro.project.file` | 保存当前工程，或使用已接受的 save-as 路径。 |
| `macro.routing.apply` | 应用已支持的工程内部 routing，并验证 live 路由图。 |
| `macro.media.place_assets` | 按已接受的有界放置模式导入获准媒体。 |
| `macro.items.analyze` | 读取 Item/take 事实，以及已支持的音频或时序测量。 |
| `macro.items.apply` | 排列 Item、选择 Active Take，或应用已接受的属性、fade、精确 trim、Take playback 和 snap offset。 |
| `macro.midi.apply` | 创建有界 clip、编辑或量化现有音符，或插入 CC event，并精确读回 Take。 |
| `macro.fx.apply_chain` | 从 REAPER 已安装 FX 清单为 Track/Take 应用有界 chain，并验证完整最终链。 |
| `macro.fx.set_controls` | 设置现有受支持 FX 的已接受控制，并逐项验证。 |
| `macro.controls.set` | 设置已接受的工程、轨道、transport 和 send 控制，包括工程 BPM。 |
| `macro.automation.apply` | 应用已支持的 Envelope 点、lane/Track mode、FX 参数点和 Automation Item 操作。 |
| `macro.render.targets` | 把已支持的工程、选择、region、Item 或 Track 目标渲染到受管目录中的 WAV/OGG。 |

每个 Macro 都有有界 schema。“可执行”不代表任何想象出来的 mode 都已接受。
精确 Macro 手册才是支持字段、限制、风险、确认、读回和 held mode 的权威。

## 发现机制

默认情况下，代理会看到包含全部 15 个 Macro 的紧凑菜单，并根据当前意图推荐
最合适的 1-3 个。这样既能保持普通任务轻快，也不会隐藏完整产品面。

只有代理请求精确 Macro ID 时，才展开完整 action manual。旧 Macro ID 不显示在
菜单里；仍受支持的旧 ID 只作为隐藏兼容映射，指向当前 canonical Macro。

直接 Template 是合法的长尾 fallback，但不是普通路径。只有没有可见 Macro
覆盖任务时，代理才能使用，并记录一种有类型的原因，例如：

- Macro 没有覆盖这个任务；
- 所需 mode 超出当前已接受范围；
- 目标无法通过 Macro 安全解析；
- 该领域尚未接受；
- 在当前响应预算下，一个有界原子 Template 更合适。

fallback 仍必须是已接受、可发现的 Template。OpenReaper 不暴露 raw Lua、raw
REAPER Action、任意 shell、raw SQL 或隐藏 recipe executor。

## 启动或重连

可以这样说：

```text
用 OpenReaper 打开 REAPER。
重新连接我的 REAPER 会话。
检查 OpenReaper 是否健康。
```

对于已经安装的软件包，代理应该：

1. 运行 `~/.openreaper/current/bin/openreaper-start`。
2. 等固定的包内 launcher 自动启动 Bridge，并读取命令输出的提示。
3. 仅当启动助手明确报告 manual recovery fallback 时，才运行 REAPER
   Action：`OpenReaper: Start MCP bridge`。
4. 重连名为 `openreaper` 的 MCP server。
5. 在声称 bridge 已连接前，先运行一次有界 live probe。

Windows 对应的原生 PowerShell 启动命令是：

```powershell
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

Windows 正常运行不依赖 Git Bash、Git、WSL、SSH、SWS、ReaPack 或第三方
插件；需要 Node.js 20 或更高版本。

正常的代理辅助启动会隐藏 PowerShell launcher、Doctor 和 MCP 宿主窗口，
REAPER 本身保持可见。手动执行命令时打开的 PowerShell 窗口是操作者终端，
不是 OpenReaper 产品界面。验收和自动化 launcher 必须隐藏该宿主，不能隐藏
REAPER。

仅 macOS 的首次启动必须选择 `once`、`always` 或 `manual`。只有获得许可后，
OpenReaper 才可以自动关闭精确匹配的 Project Settings / Notes、`Ignore all
missing files` 以及 media-items-offline warning。Windows 不自动化或分类原生
REAPER 弹窗，必须由用户处理全部启动阻塞。license、recovery、plugin、version、
含决策的窗口和未知窗口始终 fail-closed。此启动路径不要求 SWS。

## Project Index 与 live 真相

SQLite 是快速导航和工程理解层，不是工程本身，也永远不是写入权威。REAPER
live 状态才是真相。

对于大工程，OpenReaper 可以保留完整的内部索引知识，同时只返回紧凑的公开分页。
公开响应限制不能静默地把后面的轨道或其他目标从内部知识中删掉。覆盖不完整时，
索引不能证明某个目标不存在；代理必须刷新或报告 incomplete coverage，不能给出
definitive not-found。

写入前，代理必须重新解析精确 live 目标。写入后，必须从 REAPER 逐行读回受影响
对象。结果应该分开报告：

- mutation 是否已 dispatch；
- live readback 是否符合请求；
- Project Index 刷新或 invalidation 是否成功。

索引维护失败不能改写已经由 REAPER 验证的工程变化；仅有 dispatch success 也不能
把 change 标记为 `applied`。

## 常见任务

你只需要描述任务：

```text
给我一份紧凑的工程地图。
找到最后一条名为 Backing Vox 的轨道。
把工程速度设为 126 BPM。
创建并排列这些轨道和文件夹。
把这些获准音频文件放到选中的轨道上。
显示选中 item 的峰值和时序事实。
给选中的 item 顺排，并留一小段间隔。
创建这个有界 MIDI clip，然后量化其中已有的音符。
给 Lead Vox 添加 ReaEQ 和 ReaComp；已有精确 ReaEQ 就复用，并验证最终 chain。
插入这些 automation 点并读回。
把这些精确 item 渲染成 OGG。
```

OpenReaper 应该先总结，再只展开任务需要的细节。你不需要自己构造 ref，也不需要
自己判断该用 Macro、Template、artifact 还是 SQLite query。

## 移除静音与响度标准化

对于选中的音频 Item，OpenReaper 提供两个软件包内 REAPER Action：
`Remove Silence...` 和 `Repeat Remove Silence with Last Settings`。前者收集
设置，后者复用最近一次已接受设置。代理可通过 `macro.items.apply` 的
`mode=remove_silence` 使用同一个共享批处理核心。支持 `all`、`leading`、
`trailing`、`edges`、`internal` 五种 scope，以及 threshold、minimum
silence、前后 padding、minimum kept audio 和 fade 设置。

OpenReaper 会在任何修改前分析完整选择，保留源文件、Track 和时间线位置，整个
批次只产生一次 Undo。全静音 Item 会保留并明确报告；MIDI 和不支持的 Item 会
fail closed。上限是 64 个精确选中的音频 Item；65 个或更多必须 zero-write。

响度标准化使用 `macro.items.apply` 的 `mode=normalize_level`。支持 LUFS-I、
RMS-I、peak、true peak、LUFS-M max 和 LUFS-S max，并调用 REAPER 原生
normalization 计算。这是 source/item/take pre-FX normalization，不是 post-FX
输出标准化。同样适用 64 Item 上限、溢出 zero-write、一次 native batch、一次
读回和一次 Undo。

## 授权与安全

OpenReaper 不应该要求你为每个小型可撤销步骤逐次授权。好的流程是一次有界授权，
随后直接执行并返回简洁检查点。

下面这些情况仍必须停止：

- 破坏性删除；
- 需要确认后果的 overwrite、save-as 或 render；
- 硬件、device、input 或 output routing；
- 涉及隐私的扫描；
- 付费或授权下载；
- 含糊的不可逆操作；
- stale 或无法解析的写入目标。

工程内部 routing 不等于授权硬件/device I/O。媒体和工程文件路径必须通过各自已接受
的路径和 managed-root 规则；本指南不承诺任意文件系统访问。
`macro.project.file` 支持 save/save-as、列出已打开工程、用绝对 `.RPP` 路径和
`overwrite=true` 显式创建已保存的工程页签、在页签中打开已有绝对 `.RPP` 路径，
以及激活一个精确的已保存工程引用。任意文件系统访问和隐式切换工程仍不受支持。

## 结果与恢复

操作后，代理应该告诉你：

- 它尝试了什么；
- 哪些精确目标发生变化；
- REAPER 读回了什么；
- 索引维护是否成功；
- 哪些内容尚未验证；
- 如何 retry、refresh、undo 或 cleanup。

dry run 必须明确说明 mutation 已跳过，并在适用时给出精确可执行 retry。如果读回与
请求不一致，代理应该返回 blocker 或 partial result，不能包装成成功。

## 工作流与扩展包

工作流是由已审查 OpenReaper action 组成的可复用过程。即使内部可移植格式是
recipe 文件，正常产品语言仍应叫“工作流”。分享前必须 scrub 机器相关路径、request
ID、project ref、私人备注、secret 和不可移植假设。

Pack 可以增加已审查的插件控制、媒体库辅助或领域工作流。Pack 应说明来源、依赖、
权限、证据、alias 和未支持范围。Pack metadata 或 portability 不代表任意扩展执行、
global alias execution 或所有插件都受支持。

## 常见阻塞

| 阻塞 | 含义 | 恢复方式 |
|---|---|---|
| REAPER not ready | 无法连接 live bridge。 | 启动或重连，处理等待中的 REAPER 窗口，运行 bridge Action，再次 probe。 |
| Stale session | bridge 身份与当前 run 不再匹配。 | 写入前先重连。 |
| Wrong or ambiguous target | 请求无法解析成一组已接受的精确 live 目标。 | 缩小请求、选择目标，或让代理 query 并 refresh。 |
| Needs refresh | 索引或缓存事实可能 stale 或 incomplete。 | 决策或写入前先从 REAPER 刷新。 |
| Missing plugin | 精确请求的插件未安装或未接受。 | 选择已安装且受支持的插件，不要静默替换。 |
| Mode held | Macro 存在，但精确 mode 尚未接受。 | 使用已接受 mode，或带有类型原因地显式发现 direct-Template fallback。 |
| Needs confirmation | 操作跨过硬风险边界。 | 核对具体后果，确认符合意图后再授权。 |

## 当前证据边界

当前候选产品面包含 15 个可见可执行 Macro 和六个 MCP 工具。部分 Macro 家族的
真实支持范围仍比名称窄：

- MIDI 支持有界 `create_clips`、按 index 编辑现有音符、量化和 PPQ CC 插入；不支持
  在现有 Take 中任意新建音符、编辑已有 CC、text/sysex 或隐式插入乐器。
- FX chain apply 可以搜索已安装清单，并用 duplicate、preset、bypass 和 reorder 策略
  管理有界 Track/Take chain。初始 semantic controls 与 `macro.fx.set_controls` 仍限于
  已审核映射，例如已接受的 ReaComp 映射；不承诺任意插件语义。
- Item 分析支持已发布的 `quick`、`audio`、`timing`、`full` profile；compare、
  MIDI、loop profile 仍 held。
- Item apply 支持对齐、顺排、分布、锚定、把精确 Item 移到现有 Track、已接受 Item
  属性、精确 Active Take 选择、fade、精确 trim、Take playback、snap offset、
  原生 level normalization 和共享核心 silence removal。Item-level pan 不是已证明
  字段；明确的 Active Take pan 应使用已接受的 Take 控制路径。
- Automation 支持精确手册中发布的 mode；不暴露实时 touch/write/latch、任意曲线、
  raw Action 或 chunk mutation。
- Render 使用 managed render root 和已接受的 WAV/OGG target mode，不承诺任意输出
  路径、overwrite、外部 encoder 或所有格式。
- 工程文件支持 save/save-as、列出已打开工程、用绝对 `.RPP` 路径和
  `overwrite=true` 显式创建已保存的工程页签、在页签中打开已有绝对 `.RPP`
  路径，以及激活一个精确的已保存工程引用。任意文件系统访问和隐式切换工程
  仍不受支持。
- 硬件/device I/O 仍在产品边界外。

指南、代理或 Pack 的支持声明都应该匹配精确手册和当前证据，而不是未来计划中的
mode。
