# Cursor 模型与本机修复（2026-09-16）

## 云端 agent 可用模型（助手可直接指定）
常用（按你的偏好）：
- `grok-4.6`（工作主力之一）
- `composer-2.5`（工作主力之一，别名 composer）

也可用但不作默认：Claude Opus/Sonnet、GPT-5.x、Gemini 等（见 Cloud Agent models 列表）。

**云端任务走 Cursor 账号/Pro，不走你 IDE 里填的 OpenAI Key。**  
所以：IDE 里 Claude 挂了，不一定挡住我派 Grok/Composer 云端干活。

## IDE 里 Claude 等自带模型挂了——原因线索
本机 Cursor 状态库里存在：
- `secret://cursorAuth/openAIKey`（你曾贴过自己的 OpenAI Key）

这常会让部分模型走「自有 Key / 错误路由」，表现为 **Claude 等订阅模型不可用**，而自带目录看起来「坏了」。

### 建议修复（你在 Cursor UI 里做最安全）
1. Cursor → Settings → **Models**
2. 找到 **OpenAI API Key**（或类似自有 Key）→ **Clear / 删除**
3. 若有 **Override OpenAI Base URL** → 清空并关闭
4. 完全退出 Cursor 再开
5. 模型列表里再试 Claude；日常开发可选 Grok / Composer

助手也可在你确认后从本机状态里清掉该 secret（需你点头，避免误删）。

## 工作默认模型策略（Studio 7 日）
| 用途 | 模型 |
|---|---|
| 日常改代码云端任务 | `composer-2.5` 或 `grok-4.6` |
| 难问题 / 架构 | 可临时升 Claude（修好订阅后） |
| 不默认 | 自有 API Key 覆盖 |

## 远程试用预期
- **现在**：还没有「一点启动的漂亮 Studio」可试用。
- **P0 做出后**：你远程连上 `Zhuanz1.local`（向日葵等）→ 跑一键 Start → 应看到简约 REAPER + AI 对话框，可上手试。
- 验收路径：助手说「某段做好了」→ 给你 Start 命令/PR → 你远程点一下验收；不是看聊天里的截图就算试用完成。
