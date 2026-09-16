# 7 日 Pro 用量冲刺（真实施工，不空转）

目标：7 天内把 Cursor Pro 额度主要花在 **OpenReaper Studio P0** 上。

## Day 1 — 规格与仓库对齐
- 把 NAS 愿景/目标精简成仓库内 `docs/studio/`（PR，暂不改首页营销文案）
- 盘点现有包结构：哪些可复用进 Studio 启停/对话框

## Day 2–3 — 一键启停编排
- 设计并实现 Start/Stop 脚本链：REAPER → bridge → Pi → 对话框占位
- 有 Pi / 无 Pi 检测分支（文档级 + 最小代码）

## Day 4–5 — AI 对话框最小脸
- + 挂上下文（空则不显示芯片）
- 输入框 → 打到 Pi/MCP 的最小通路（哪怕先 mock 再接真）

## Day 6 — 默认简约态
- Screenset / 工具条白名单草案落地（能脚本化的就脚本化）

## Day 7 — 串起来验收 + 日记
- 本机走通一遍；缺口列表；决定是否改 GitHub 对外说明

每日结束：在 **`docs/studio/journal/YYYY-MM-DD.md`**（GitHub）记进度与 Pro 任务摘要；大附件与冗长日志可只写 NAS 镜像路径。
