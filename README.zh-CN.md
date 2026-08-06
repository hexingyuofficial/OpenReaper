# OpenReaper

OpenReaper 是一个以证据为边界的 REAPER MCP 桥接与任务运行时。支持 MCP
的代理可以检查工程，执行经过审查的 Macro、Template 和 Recipe，从 REAPER
实时读回验证结果，并保留有界证据。当前候选版本是面向 macOS 和 Windows
x64 的 `0.1.0-alpha.1`。

OpenReaper 恰好提供六个面向代理的 MCP 工具：

```text
ping  get_state  list_templates  list_recipes  call_template  call_recipe
```

正常流程是：描述目标，让代理发现合适的 Macro 或 Recipe，执行一次有界调用，
然后读取 REAPER 验证后的结果。产品不暴露 raw Lua、任意 REAPER Action、
shell 执行、raw SQL、硬件/设备 I/O 或未经审查的执行器。

## 五分钟开始

1. 安装对应平台的软件包。
2. 安装后重启 MCP 客户端，让它重新载入 `openreaper` 服务配置。
3. 通过 OpenReaper 软件包内的启动命令打开 REAPER。
4. 对代理说：`检查当前 REAPER 工程，告诉我哪些功能已经就绪。`

macOS 使用 `./install.command`，然后运行：

```text
~/.openreaper/current/bin/openreaper-start
```

Windows 在解压后的软件包中使用原生 Windows PowerShell：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-openreaper.ps1
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

Windows 软件包需要 Node.js 20 或更高版本，不依赖 Git Bash、Git、WSL、
SSH、SWS、ReaPack 或第三方插件。当前 Windows 支持范围是已经实测的
Windows 11 x64 build 26200 与对应稳定版 REAPER；其他组合仍需证据验证。

## 产品能力

发现界面提供十五个平级 Macro。常见任务优先使用一个 Macro，可复用的多阶段
流程使用一个 Recipe。只有没有 Macro 覆盖请求时，才使用有类型原因的直接
Template fallback。每次写入都必须在 live REAPER 中解析目标，并在 REAPER
读回后才能报告为已应用。

候选版本覆盖经过审查的媒体放置、波形/读回事实、source/item/take
normalization 和 Remove Silence 流程。Remove Silence 提供软件包内的
`Remove Silence...`、`Repeat Remove Silence with Last Settings` 两个 Action
以及 Macro 路径，支持 `all`、`leading`、`trailing`、`edges`、`internal`
五种 scope。Normalization 使用 REAPER 原生 normalization 计算，支持
LUFS-I、RMS-I、peak、true peak、LUFS-M max 和 LUFS-S max。它声明的是
source/item/take pre-FX 范围，不是 post-FX normalization。

四个官方 Recipe 是：

```text
recipe.mix.create_bus_processing
recipe.midi.create_instrument_part
recipe.media.create_layered_sound_effect_variants
recipe.items.create_sound_variations
```

官方、用户编写和 fork 的 Recipe 共用 generic runner、聚合读回和
Whole-Recipe Undo。Recipe 串行执行；不支持或过期的目标会 fail closed，
并返回有类型的恢复方式。

## 安全与限制

OpenReaper 不会静默修改用户的 REAPER 配置、主题、license、插件、源媒体或
用户 Recipe。安装器只注册 OpenReaper 明确拥有的条目，并保留无关 MCP 配置。
License、插件扫描、恢复、升级、版本和未知决策弹窗保持由用户处理并 fail
closed。硬件播放和录音需要可用音频设备；离线工程、媒体、render 和 Bridge
流程不需要音频设备。

每个完整且已接受的 Template、Macro、Action 和 Recipe 都受内部重复证据
`<30000ms` 性能门约束。支持范围只覆盖实测 OS、架构、REAPER 版本、配置
路径和有证据的模式。Linux、Windows ARM、Intel macOS、任意插件状态复制、
post-FX normalization 和未实测组合均不在当前声明范围内。

## 继续阅读

- [Agent Start Here](docs/AGENT_START_HERE.md) / [中文](docs/AGENT_START_HERE.zh-CN.md)
- [用户指南](docs/USER_GUIDE.zh-CN.md) / [English](docs/USER_GUIDE.md)
- [开发者指南](docs/DEVELOPER_GUIDE.zh-CN.md) / [English](docs/DEVELOPER_GUIDE.md)
- [支持矩阵](docs/SUPPORT_MATRIX.md)
- [运行手册](docs/RUNBOOK.md)

## 检查

在仓库根目录运行：

```bash
npm test
```

默认检查覆盖 ABI、catalog、runtime、打包 helper 和 Recipe contract。Live
REAPER 验收需要显式运行，并使用 fresh evidence root。
