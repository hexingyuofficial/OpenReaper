# 验收交接协议（长期自跑）

## 硬规则
1. **先开好再喊你**：任何「可以试用 / 请验收」之前，必须在 `Zhuanz1.local` 执行本仓库 **`scripts/studio/trial-open.sh`**，确认 NAS 上 `engineering/trial/READY` 存在且时间戳是本轮的（见脚本内 `STUDIO_ROOT`）。
2. **试用机固定**：验收默认机 = `Zhuanz1.local`（REAPER 在 `/Applications/REAPER.app`）。你远程连这台即可上手。
3. **一轮一件事**：每轮 Cloud Agent / 合并完成后，助手自测 → trial-open → 才在本 Grok Bot 聊天里通知你。
4. **没开好不交**：脚本失败或 REAPER 没起来 → 修启动链，不把半成品甩给你。

## 长期自跑
| 层 | 做什么 |
|---|---|
| 本助手（总指挥） | 拆任务、派 Cursor 云端、验收前门禁、在本聊天提醒你 |
| Cursor 云端（打工仔） | 改 `hexingyuofficial/OpenReaper` 代码与文档 |
| GitHub 监听 routine | PR/CI/review 事件唤醒总指挥跟进；可验收时先 trial-open 再提醒 |

## 对你说的话模板
> 本轮可试用了。Zhuanz1 上 REAPER 已打开。请远程连上验收：〔清单〕。PR：〔链接〕。

## Day1 说明
当前为 **文档入库日**；一键 Studio 启停尚未承诺可用。在 P0 完成前，trial-open 可能仅打开 REAPER / 占位工程，不表示「Studio 产品态已就绪」。
