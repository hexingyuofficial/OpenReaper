# 目标

## 一句话
有 REAPER 的用户只装一个包，点启动即得到 **AI-based DAW**（主题 + Pi 脑子 + 对话框脸 + OpenReaper 引擎）。

## 目标
- 无感安装：不另装 Pi / Node / ReaPack / 手改 mcp.json（依赖打进包；已有 Pi 可复用登录）
- 一键启停：REAPER → bridge → Pi → AI 对话框；关闭整链拆除
- 简洁高级默认皮；习惯按键保留
- 对话框：Suno 味；没选不显示芯片，用 + 挂选区/Region/Track/Item/Marker
- 可选：AI 造可自动化的旋钮 Macro；动态动作按钮长在 AI 层

## 非目标（现阶段）
- 整页假 DAW 替换 REAPER
- 用主题实现网页级动画 / 中间对话框
- 从零自研 agent loop（用 Pi）
- 默认暴露完整 REAPER chrome

## 仓库策略（2026-09-16）
- 单库：`hexingyuofficial/OpenReaper` 覆盖演进为 **OpenReaper Studio**（文档见 `docs/studio/`）。
- 旧 MCP-only 安装包线停更；现有 `packages/`、`docs/` 内核文档与 alpha 打包保持可用直至 Studio 替代。
