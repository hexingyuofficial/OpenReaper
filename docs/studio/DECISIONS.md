# 决策记录

| 日期 | 决策 | 备注 |
|---|---|---|
| 2026-09-11 | Agent 层用 Pi，不自研 loop | OAuth 面宽；SDK/RPC 嵌脸 |
| 2026-09-11 | 对话框不走主题，走浮层/WebView | 主题无法长出 AI 壳 |
| 2026-09-11 | 有 REAPER → 单包可用 | 依赖内置；登录是账号不是安装 |
| 2026-09-16 | 工作区放 NAS `/Volumes/NAS/coding/openreaper-next` | 本机仅剩 ~13GB |
| 2026-09-16 | 产品线定位：下一代 OpenReaper | 曾讨论 next 或 sibling 仓库 |
| 2026-09-16 | ~~GitHub 新库 `OpenReaper-Studio`~~ | **已废止** — 见下行单库决策 |
| 2026-09-16 | NAS 路径改名为 `openreaper-studio` | 与 Studio 产品线对齐 |
| 2026-09-16 | **单库覆盖为 Studio** | 不新建第二库；`hexingyuofficial/OpenReaper` 即 OpenReaper Studio；旧 0.1.0 安装包产品线停更，开发全部转向 Studio |
| 2026-09-16 | GitHub 对外改口延后 | 做出 Studio 再改 README/描述；决策先落 `docs/studio/`，远程文案暂不动 |
| 2026-09-16 | 与 Cursor 协作方式 | 助手拆任务/写规格 → Cursor 云端 agent 改 `hexingyuofficial/OpenReaper` → 本机/NAS 验收；大文件与施工日记在 NAS |
| 2026-09-16 | 7 日内用 Cursor Pro | 用真实 Studio 施工任务消耗 Pro（非空转），优先 P0：规格入库、启停壳、对话框脸、Pi 嵌入调研实现 |
| 2026-09-16 | 云端默认 Grok + Composer | Studio 施工云端任务用 `grok-4.6` / `composer-2.5`；修 IDE 自有 OpenAI Key 以恢复 Claude |
| 2026-09-16 | 远程试用标准 | P0 后远程连开发机一点启动即可试；未完成前不宣称可试用 |
