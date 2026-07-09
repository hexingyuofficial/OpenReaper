# OpenReaper 用户指南

状态：Alpha3 首个产品版本草案。

OpenReaper 让你用自然语言和代理协作，在 REAPER 里理解项目、执行安全操作、读回结果并复用工作流。你不需要理解模板、宏、SQLite、artifact、桥接内部或架构层级；这些是项目内部机制。本指南只讲你可以怎么说、什么时候需要授权，以及遇到阻塞时怎么恢复。

OpenReaper 的支持声明必须绑定证据。当前有些 Alpha3 能力已经作为静态能力或 plan-only 产品面被接受，但 live/customer support 仍然只限于有对应证据的行。本指南会说明目标体验，也会在关键位置标明当前限制。

## 基本流程

多数会话应该像这样：

1. 用普通语言告诉 OpenReaper 你想做什么。
2. 让代理检查当前项目或选择对象。
3. 如果任务会改动项目，批准一个有边界的操作范围。
4. 让代理在这个范围内完成普通、可撤销的工作。
5. 阅读简短结果：改了什么、验证了什么、下一步是什么。

可以直接这样说：

```text
检查一下项目，告诉我现在选中了什么。
把选中的人声变亮一点，但保持可撤销。
帮我创建一条安全的人声录音轨。
把这个清理流程保存成可复用的工作流。
```

代理应该自己选择合适的 OpenReaper 能力。你不需要知道任务内部用的是工作流、查询、artifact、宏还是模板。

## 启动或重连

可以这样说：

```text
打开 OpenReaper。
用 OpenReaper 打开 REAPER。
重新连接我的 REAPER 会话。
检查 OpenReaper 现在是否健康。
```

对于可安装的 macOS alpha 包，启动应该由代理协助完成：

1. 代理运行 `~/.openreaper/current/bin/openreaper-start`。
2. 等 REAPER 进程稳定，并读取命令输出里的 pid、log 和下一步 Action 名称。
3. 代理优先尝试运行 REAPER Action：`OpenReaper: Start MCP bridge`。
4. 如果代理没法操作 REAPER UI，再请你帮一个小忙：打开 Actions，搜索
   `OpenReaper: Start MCP bridge`，点击 Run。
5. 代理重连名为 `openreaper` 的 MCP server。
6. 代理运行一个有边界的 live probe，例如
   `call_template(template.transport.read_state)`，确认 bridge 真的连上后
   才继续说“已连接”。

你不应该需要自己找 bridge 文件，也不需要理解 bridge 路径。这个启动路线不要求安装 SWS，也不会接管 SWS 的 startup action。

启动窗口处理会刻意收窄：OpenReaper 只可以自动关闭已知的
`Project Settings` / `Notes` 里的 "show notes on project load" 窗口。license/evaluation、recovery、plugin/FX、version 或未知 REAPER 窗口都属于用户选择窗口，不应自动关闭。如果 live probe 没连上，代理应该先检查 REAPER 是否有等待处理的窗口，或者请你处理这个窗口；然后再运行 bridge Action、重连、重新 probe。

如果启动被阻塞，代理应该用普通语言解释，而不是让你理解 transport root、owner/generation、请求目录或 session id。典型恢复提示应该像这样：

```text
现在无法连接 REAPER。我会先用 openreaper-start 启动；如果 REAPER 有窗口挡住，请处理它。然后运行 OpenReaper: Start MCP bridge，重连并检查 live probe。
```

如果会话已经过期或身份不匹配，先重连再允许写操作。这可以避免把动作发到错误的 REAPER bridge/session。

## 观察项目

先问大问题，再追问细节：

```text
这个项目里有什么？
给我一份简洁的项目地图。
显示当前选中的轨道、item 和 take。
上一步之后发生了什么变化？
找出看起来像人声的轨道。
找出带压缩器或 EQ 的轨道。
显示离线的媒体文件。
显示副歌附近的 marker 和 region。
```

对于大项目，OpenReaper 应该先总结，再按需分页、查询或 hydrate 细节。默认不应该一次性倾倒整个项目、每个 FX 参数、每条 routing、每个 automation 点或所有媒体分析结果。

如果代理说需要 refresh，就让它 refresh。这表示缓存中的项目状态可能已经过期，OpenReaper 正在重新向 REAPER 确认后再做决定。

## 查询和读回细节

可以问更聚焦的问题：

```text
找出静音的轨道。
列出选中 item 的开始时间和长度。
显示选中人声轨上的 FX。
显示鼓 bus 发到哪些 send。
找出超过 30 秒的媒体源。
在修改前先 hydrate 这些 refs。
```

有用的说法：

- `summary`：只要简洁回答；
- `details`：需要更多字段；
- `selected`：目标是当前 REAPER 选择；
- `refresh first`：项目可能变过，先刷新；
- `read it back`：操作后读回验证。

读回应说明哪些内容是从 REAPER 验证过的，而不只是计划要做什么。如果读回结果和请求不一致，代理应该报告 blocker 或恢复路径，而不是把它包装成成功。

## 安全地执行操作

对于普通、可撤销的创作操作，可以批准一个任务范围，而不是每一步都确认：

```text
这个任务中，你可以调整选中人声轨的音量、声像、item fade 和 stock plugin 参数。
不要删除、导出、覆盖、修改硬件 I/O，也不要扫描私人文件夹。
```

在这个范围内，代理应该快速执行并给出简洁检查点。但下面这些边界仍然必须停止并确认：

- 破坏性删除；
- 覆盖或导出；
- 硬件、输入、输出或控制面板变更；
- 涉及隐私的扫描；
- 付费或授权下载；
- 含糊的不可逆操作；
- 写入前目标 stale 或无法重新解析。

如果 OpenReaper 创建或修改了对象，undo 和 cleanup 路径应该可见。请求有风险时，代理应先解释后果，再询问是否继续。

## 常见创作请求

当前和计划中的产品级请求包括：

```text
创建一条人声录音轨。
做一个快速人声清理链。
把选中的 item 做成 reverse riser。
对齐这些选中 item 的开头。
用选中音频的切片做一个 starter beat。
把选中轨道音量降一点。
把选中 item 的 fade-in 设为 20 ms。
静音吉他轨发到 delay bus 的 send。
```

有些创作 starter 仍是 draft workflow 或 plan-only macro，直到对应支持行获得更强证据。代理应该说明一个请求现在是可运行、只能计划，还是因为缺少 live 证据而阻塞。

## REAPER Stock 插件

OpenReaper 正在把 REAPER 自带插件理解为音乐控制，而不是裸参数编号。你可以说：

```text
让这个人声压缩更温和一点。
给选中人声加一个 high-pass filter。
让 delay 更暗、更小声。
用普通语言读回 ReaComp 设置。
```

当前 Alpha3 状态：

- 优先 stock plugin 集合已有 semantic maps 和 starter actions；
- agent execution flow 会验证 FX 身份、hydrate 新鲜参数元数据、规划写入并请求读回；
- ReaComp 已有有边界的 live write/readback 证据；
- 其他优先 stock plugins 的 broad live support 仍需要有边界证据，才能公开转成支持措辞。

如果插件缺失或 FX 身份不清楚，代理应停止，并让你插入/选择目标插件，或改用受支持的 stock 工具。

## 工作流

工作流是可复用的 OpenReaper 过程。你可以说：

```text
把这个保存成工作流。
分享前 scrub 这个工作流。
分享这个 workflow packet。
安装这个工作流。
fork 这个工作流，并改成鼓组版本。
```

分享前，OpenReaper 应 scrub 私密或机器相关信息：

- 本地路径；
- request id；
- project ref；
- 不应公开的 artifact alias；
- 私人备注；
- secrets 或 tokens；
- 其他机器无法复现的假设。

当前 Alpha3 workflow portability 支持本地 save、scrub、share、install 和 fork 入口。工作流仍通过正常的代理编排 OpenReaper 调用运行。没有公开的 `call_recipe` 快捷方式，也没有隐藏的工作流执行器。

## 扩展包

在用户语言里，pack 指可安装或可分享的扩展。一个 pack 可能添加插件控制、声音库搜索、领域工作流或本地私有辅助能力。

可以这样问：

```text
显示已安装 pack 和它们的支持状态。
这个 pack 可以安全分享吗？
如果这个 pack 通过验证，就安装它。
为什么这个 pack 现在是 disabled？
```

一个 pack 应明确报告：

- official、partner、DLC、experimental 或 local 状态；
- 需要哪些插件、服务、索引或媒体源；
- 需要哪些权限；
- 证据和支持状态；
- 是否有 alias；
- 哪些内容被阻塞或尚不支持。

当前 Alpha3 pack portability 会验证 manifest 和 packet 安全。pack enable/disable/update/uninstall/global alias promotion 仍是 readiness-gated，不代表真实扩展包执行或 global alias support 已启用。

## 常见阻塞

| 阻塞 | 含义 | 怎么做 |
|---|---|---|
| REAPER not ready | 代理无法连接 live REAPER 会话。 | 让代理运行 `openreaper-start`；如果 REAPER 有窗口等待处理，先处理它，再运行 `OpenReaper: Start MCP bridge`、重连并 probe。 |
| Stale session | 当前 bridge/session 身份不可信。 | 写操作前先重连。 |
| Wrong selection | 任务需要选中的轨道、item、take 或 FX。 | 选中目标后再问一次。 |
| Needs refresh | 缓存状态可能过期。 | 允许代理从 REAPER 刷新。 |
| Missing plugin | 请求的插件未安装或未找到。 | 安装、插入插件，或选择受支持的 stock 工具。 |
| Missing evidence | 路径存在于计划/静态功能里，但尚未 live-supported。 | 把它当计划处理，或打开有边界的证据窗口。 |
| Needs confirmation | 操作跨过硬风险边界。 | 确认后果确实符合意图再批准。 |
| Privacy scrub failed | 工作流或 pack 仍包含私密/本地数据。 | 删除或改写标出的数据后再分享。 |

## 一个好回答应该包含什么

操作后，代理应该回答：

- 它做了什么；
- 改动了哪些目标；
- 来自 REAPER 的读回，或明确说明读回仍在等待；
- 是否有 blocker；
- recovery、undo、cleanup 或下一步。

例如：

```text
我调整了选中人声轨的音量和 ReaComp threshold，并从 REAPER 读回确认。
当前轨道音量是 -2.0 dB，ReaComp threshold 已降低。
没有导出、删除或硬件 routing 改动。
```

## 当前证据边界

OpenReaper 当前拥有：

- 冻结的五工具表面；
- compact discovery；
- 已审查的 template 和 recipe contracts；
- Alpha2 在声明的本地 manual-bridge fixture 上的广泛 template live 证据；
- Alpha3 已接受的项目查询、startup health planning、workflow/pack portability gates、orchestration planning、generic controls 和 stock plugin fluency；
- ReaComp stock-plugin 的有边界 live 证据；
- 仅针对 `recipe.project.cleanup_fingerprint_report` 的 recipe-level live/local portability 证据。

除非后续证据路线明确扩大范围，不要假设 broad live support、自动 REAPER 启动、真实 extension-pack enablement、global alias execution、公开 `call_recipe`、隐藏执行器，或任意机器支持。
