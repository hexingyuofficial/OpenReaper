<div align="center">

# OpenReaper

**让 Agent 安全地理解、操作并验证 REAPER 工程。**

Evidence-bound MCP bridge and task runtime for REAPER.

[![Release](https://img.shields.io/github/v/release/hexingyuofficial/OpenReaper?display_name=tag&sort=semver&color=1677ff)](https://github.com/hexingyuofficial/OpenReaper/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-2ea44d)](https://github.com/hexingyuofficial/OpenReaper/releases/latest)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933)](https://nodejs.org/)

[下载最新版本](https://github.com/hexingyuofficial/OpenReaper/releases/latest) ·
[用户指南](docs/USER_GUIDE.md) ·
[Agent Start Here](docs/AGENT_START_HERE.md) ·
[支持矩阵](docs/SUPPORT_MATRIX.md)

</div>

<details open>
<summary><strong>English</strong></summary>

## What It Does

OpenReaper gives an MCP-capable agent a bounded way to inspect a REAPER project,
run reviewed Macros, Templates, and Recipes, and verify changes through live
REAPER readback. Evidence is retained in bounded, machine-readable form.

The public surface has exactly six MCP tools:

```text
ping  get_state  list_templates  list_recipes  call_template  call_recipe
```

The agent discovers the right route, runs one bounded call, and reports what
REAPER actually verified. OpenReaper does not expose raw Lua, arbitrary REAPER
Actions, shell execution, raw SQL, hardware/device I/O, or an unreviewed
executor.

## Install In Five Minutes

1. Download the package for your platform from the [latest release](https://github.com/hexingyuofficial/OpenReaper/releases/latest).
2. Install it, then restart your MCP client so it reloads the `openreaper` server.
3. Start REAPER through the packaged OpenReaper start command.
4. Ask your Agent:

   > Inspect the current REAPER project and tell me what is ready.

### macOS

Run `./install.command`, then:

```text
~/.openreaper/current/bin/openreaper-start
```

### Windows

Use native Windows PowerShell from the extracted package:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-openreaper.ps1
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

Windows requires Node.js 20 or newer. Normal operation does not require Git,
Git Bash, WSL, SSH, SWS, ReaPack, or third-party plugins.

## Product Surface

OpenReaper presents fifteen peer Macros for common tasks, two official Recipes
for reusable multi-stage work, and direct Templates as a typed long-tail
fallback. Every write resolves its target in live REAPER and requires readback
before it is reported as applied.

The `0.1.0` release covers reviewed workflows for media placement,
waveform/readback truth, source/item/take normalization, and Remove Silence.
Remove Silence is available through the Macro route and the packaged
`Remove Silence...` Action. Normalization uses REAPER's native calculation for
LUFS-I, RMS-I, peak, true peak, LUFS-M max, and LUFS-S max; the accepted scope
is source/item/take pre-FX, not post-FX.

Official Recipes:

```text
recipe.mix.create_bus_processing
recipe.midi.create_instrument_part
```

## Safety By Design

- Live REAPER readback is the source of truth for writes.
- Ambiguous, stale, unsupported, or oversized targets fail closed before mutation.
- User-owned REAPER state, source media, unrelated MCP configuration, and saved Recipes are preserved.
- License, plugin scan, recovery, upgrade, version, and unknown decision windows remain user-mediated.
- Hardware playback and recording require a configured device; offline project, media, render, and Bridge workflows do not.

Support is limited to tested OS, architecture, REAPER version, configuration
path, and evidence-backed modes. Linux, Windows ARM, Intel macOS, arbitrary
plugin-state cloning, post-FX normalization, and untested combinations are not
claimed.

## Documentation

| Need | Start here |
| --- | --- |
| Install and use OpenReaper | [User Guide](docs/USER_GUIDE.md) |
| Give an Agent the correct operating rules | [Agent Start Here](docs/AGENT_START_HERE.md) |
| Build or extend the runtime | [Developer Guide](docs/DEVELOPER_GUIDE.md) |
| Check tested support and limits | [Support Matrix](docs/SUPPORT_MATRIX.md) |
| Understand startup and recovery | [Runbook](docs/RUNBOOK.md) |
| Read the Chinese guide | [中文用户指南](README.zh-CN.md) |

## Development Checks

```bash
npm test
```

The checks cover the ABI, discovery, catalog, runtime, packaging helpers, and
Recipe contracts. Live REAPER evidence is opt-in and uses a fresh evidence root.

</details>

<details>
<summary><strong>中文</strong></summary>

## OpenReaper 是什么

OpenReaper 为支持 MCP 的 Agent 提供一条有边界的 REAPER 工程操作路径：检查
工程，执行经过审查的 Macro、Template 和 Recipe，通过 REAPER 实时读回验证
结果，并保留有界证据。

公开面恰好包含六个 MCP 工具：

```text
ping  get_state  list_templates  list_recipes  call_template  call_recipe
```

Agent 先发现合适的能力，再执行一次有界调用，最后报告 REAPER 实际验证的结果。
OpenReaper 不暴露 raw Lua、任意 REAPER Action、shell 执行、raw SQL、硬件/设备
I/O 或未经审查的执行器。

## 五分钟开始

1. 从[最新 Release](https://github.com/hexingyuofficial/OpenReaper/releases/latest)下载对应系统的软件包。
2. 安装后重启 MCP 客户端，让它重新载入 `openreaper` 服务。
3. 通过软件包内的 OpenReaper 启动命令打开 REAPER。
4. 对 Agent 说：

   > 检查当前 REAPER 工程，告诉我哪些功能已经就绪。

### macOS

运行 `./install.command`，然后：

```text
~/.openreaper/current/bin/openreaper-start
```

### Windows

在解压后的软件包中使用原生 Windows PowerShell：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-openreaper.ps1
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

Windows 需要 Node.js 20 或更高版本。正常运行不依赖 Git、Git Bash、WSL、
SSH、SWS、ReaPack 或第三方插件。

## 产品能力

OpenReaper 提供十五个平级 Macro，用于常见任务；提供两个官方 Recipe，用于
可复用的多阶段流程；Direct Template 只作为有类型的长尾 fallback。每次写入
都必须在 live REAPER 中解析目标，并在读回后才能报告为已应用。

`0.1.0` 发布版本覆盖经过审查的媒体放置、波形/读回事实、source/item/take
normalization 和 Remove Silence。Remove Silence 提供 Macro 路径和软件包内的
`Remove Silence...` Action。Normalization 使用 REAPER 原生计算，支持 LUFS-I、
RMS-I、peak、true peak、LUFS-M max 和 LUFS-S max；支持范围是
source/item/take pre-FX，不是 post-FX。

官方 Recipe：

```text
recipe.mix.create_bus_processing
recipe.midi.create_instrument_part
```

## 安全边界

- 写入以 live REAPER 读回为事实来源。
- 目标含糊、过期、不支持或超出上限时，会在 mutation 前 fail closed。
- 用户的 REAPER 状态、源媒体、无关 MCP 配置和已保存 Recipe 会被保留。
- License、插件扫描、恢复、升级、版本和未知决策弹窗由用户处理。
- 硬件播放和录音需要已配置设备；离线工程、媒体、render 和 Bridge 流程不需要。

支持范围只覆盖已实测的系统、架构、REAPER 版本、配置路径和有证据的模式。
Linux、Windows ARM、Intel macOS、任意插件状态复制、post-FX normalization 和
未实测组合均不在当前声明范围内。

## 文档入口

| 需求 | 文档 |
| --- | --- |
| 安装和使用 | [中文用户指南](docs/USER_GUIDE.zh-CN.md) |
| 给 Agent 的操作规则 | [中文 Agent 指南](docs/AGENT_START_HERE.zh-CN.md) |
| 开发和扩展 | [中文开发者指南](docs/DEVELOPER_GUIDE.zh-CN.md) |
| 支持范围与限制 | [支持矩阵](docs/SUPPORT_MATRIX.md) |
| 启动与恢复 | [运行手册](docs/RUNBOOK.md) |
| English | [English README](README.md) |

## 开发检查

```bash
npm test
```

默认检查覆盖 ABI、discovery、catalog、runtime、打包 helper 和 Recipe contract。
Live REAPER 验收需要显式运行，并使用 fresh evidence root。

</details>

<div align="center">
<sub>OpenReaper 0.1.0 · verified capabilities, bounded execution, live readback</sub>
</div>
