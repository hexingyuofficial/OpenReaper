# 与 Cursor 怎么配合

## 角色
- **本助手（openreaper产品）**：需求澄清、决策记录、任务拆解、验收、NAS 文档；需要改代码时派/指导 Cursor 云端 agent。
- **Cursor（本机 IDE + Cloud Agent + Pro）**：在 `hexingyuofficial/OpenReaper` 上开分支改代码、开 PR；本地可打开 NAS 施工目录做对照。
- **仓库**：单库覆盖为 Studio；**对外 README 等做出后再改**。

## 日常流程
1. 在 GitHub **`docs/studio/specs/`**（或 NAS 镜像）写清一条可开工规格（目标、约束、完成标准）。
2. 助手用 Cloud Agent（或你给的 Cursor 提示词）对 GitHub 仓库开工。
3. PR 出来后在 Zhuanz1 / NAS 验收；结论写进 **`docs/studio/journal/`**（NAS 可存长日志）。
4. 合并策略：早期可直接进 `main` 或短命 `studio/*` 分支，避免长期双产品线。

## 路径
| 用途 | 路径 |
|---|---|
| 代码（GitHub） | `https://github.com/hexingyuofficial/OpenReaper` |
| 本机 clone（示例） | `/Users/Zhuanz/Documents/openreaper` |
| Studio 文档（GitHub） | 本仓库 `docs/studio/` |
| 施工文档 / 大文件 / trial | `/Volumes/NAS/coding/openreaper-studio` |

## 注意
- 本机盘紧：构建产物、大 clone、dist 优先 NAS。
- 不新建第二 GitHub 库。
- 旧 0.1.0 安装包线停更；能力可复用进 Studio。

## 远程指挥（推荐）

助手可通过 **Cursor Cloud Agent** 直接对 `https://github.com/hexingyuofficial/OpenReaper` 派活：

1. 用户在本聊天说目标（或点头开某一 Day）
2. 助手调用云端 agent（无需用户复制提示词）
3. Agent 开分支 / 改代码 / 开 PR
4. 助手验收并汇报；用户在外可只看 PR 或回复「继续 Day N」

本机 Cursor IDE 仍可用来浏览/微调；**默认主路径是助手遥控云端 agent**，方便外出操作。
