# OpenReaper → AI-based DAW：产品想法备忘

- 记录日期：2026-09-11（持续追加）
- **GitHub 正文**：本仓库 `docs/studio/VISION.md`
- **大文件 / 日记 / 验收工程**：NAS `/Volumes/NAS/coding/openreaper-studio/`（本机盘紧时优先 NAS）
- 用途：产品愿景与 UX 备忘；改代码以 GitHub 单库为准

---

## 一句话目标

把 OpenReaper **改造成一个 AI-based DAW**：用户安装一个新东西、点启动，体感像打开原生的 AI DAW，而不是自己拼 MCP / Pi / 脚本 / 主题。

「本机已经接上 Pi」只是开发者调试态；产品态是 **一键出水**。

---

## 分层（不要糊成一块）

| 层 | 是什么 | 作用 |
|---|---|---|
| 皮肤层 | REAPER 主题（PNG + WALTER） | 整页 DAW 观感：简洁、高级；保熟悉按键 |
| Agent 层（脑子） | Pi Coding Agent | 听人话、调 OpenReaper MCP；小、功能够，不自研整套 agent |
| 对话框层（脸） | 浮层 UI（ImGui 可原型；要网页质感则用 WebView） | Suno 味中间输入条；产品身份主要在这里 |
| 引擎层 | REAPER + OpenReaper MCP bridge（六工具） | 真工程、真音频；不暴露给最终用户拼配置 |

产品叙事：**OpenReaper = 安装形态的 AI-based DAW（壳 + 启停 + 脸）**；REAPER / Pi / MCP 都是零件。

---

## 体验原则

1. **无感安装、一点启动**  
   安装器顺带搞定：桥、默认主题、AI 对话框、Pi（捆绑或调用）、MCP 配置、启停动作。用户不用改 `mcp.json`、不用 Load ReaScript。

2. **启动顺序**  
   `OpenReaper Start` → REAPER（openreaper-start）→ MCP bridge → 拉起 Pi（后台）→ 弹出 AI 对话框。  
   关闭时整链拆掉。体感是开/关一个 AI DAW。

3. **视觉：简洁 + 高级**  
   视觉很重要；简洁也重要。靠降噪（少装饰、高对比、留白），**不靠删键**。

4. **习惯不能破**  
   Mute / Solo / Arm / FX / I-O / 推子 / 传输等该有的都在，位置别玩飞（靠近 Default / Reapertips 肌肉记忆）。

5. **AI 是主题的脸，不是外挂丑窗**  
   技术上对话框可以是浮层；产品上当成「这套皮自带的 AI」。

---

## 技术边界（已查证，避免走错路）

### REAPER 主题能 / 不能

- **能**：换皮已有 TCP/MCP/传输等控件；一套主题内多 Layout；Theme Adjuster（尤其 Default 7 系）。
- **不能**：真正「皮肤叠皮肤」；运行时给任意第三方主题打补丁；凭空长出时间线正中的 agent 对话框；网页级 CSS 动画。
- 主题里的 overlay = 按钮阴影图，不是第二层 UI。
- 用户本机当前主题：Reapertips Theme；已装 ReaImGui。

### 对话框与动画

- 整页主题：基本无网页动效。
- ReaImGui：能做可用浮层，默认观感偏「工具」；可染色，但难到 Suno 网页质感。
- **若对话框要接近网页质感/动画**：用 WebView / 小网页叠在 REAPER 上；动的是 AI 脸，不是整页主题。
- 已有样例脚本：`~/Library/Application Support/REAPER/Scripts/OpenReaper/openreaper_dialog_sample.lua`（需 Actions → Load ReaScript；新版 `ImGui_PushFont` 要 3 参含字号）。

### Pi 作为 Agent 层

- 本机已装：`pi`（`~/.npm-global/bin/pi`），`~/.pi/agent`。
- 已装 `pi-mcp-adapter`；`mcp.json` 已配置 openreaper。
- 默认模型：deepseek-v4-flash。
- Pi 有 Interactive / print / **RPC** / **SDK** —— 产品脸应对接 RPC/SDK，而不是让用户盯着 TUI。
- **不要自研整套 agent**；麻烦在脸 + 启停编排，不在重造脑子。

### OpenReaper 文档姿势（v0.1.0）

- 不改用户主题 / 不乱碰 `reaper.ini`（产品若提供「官方默认皮」，应是可选推荐，不是偷偷替换）。
- UI 执行不是 MCP 六工具的职责；对话框是单独产品 UI 面。

---

## 竞品/参照与主题生态（2026）

- 交互参照：Suno Studio 中间浮动对话框（上下文芯片、输入、发送）。
- 热门主题：Reapertips（免费、讨论最多）、nvk_THEME（现代感强；基础可免，付费买 Settings/着色脚本等）、Flat Madness、Default 7 + Adjuster、reARK / paRT 等。
- nvk 卖的是配套能力，不是单纯卖 PNG。
- 录屏策略：**炫主题保底 + 对话框产品感**；不要指望纯皮肤一比一复刻整页网页端。

---

## 可行性判断（助手观点）

**能做到。**

- 「一点启动的 AI DAW 体感」：工程问题（安装器 + 启停编排 + 默认皮 + 对话框 + Pi RPC），不是物理不可能。
- 「像 Suno 网页一样整页动画」：整页靠主题做不到；对话框用 WebView 有机会接近。
- 「给别人也能装」：比本机打通多一截（捆绑 Pi、模型/密钥、权限、签名、卸载）；建议分阶段。

### 建议分期

1. **P0 本机产品态**：一键 Start/Stop（REAPER+bridge+Pi+对话框），默认简洁皮，对话框能说话并打到 OpenReaper。
2. **P1 脸升级**：对话框 WebView 化，动效/质感接近网页。
3. **P2 分发**：安装包给他人（Pi 捆绑策略、模型登录、主题可选、卸载干净）。

---

## 待拍板（回家可续聊）

- 第一版只服务本机，还是安装包就要能给别人？
- 对话框第一版：继续 ImGui 糙原型，还是直接 WebView？
- 官方默认皮视觉锚点：更像 nvk 现代冷静 / Reapertips 熟悉加强 / 更素的 Linear·Suno 灰黑？
- Pi 对外分发：捆绑安装 vs 检测本机已有 Pi？

---

## 相关本机路径（调试机 Mac，仅供对照）

- OpenReaper 安装：`~/.openreaper/current/`
- 摩擦/工程笔记：`~/openreaper/`、`~/Desktop/OpenReaper_*.md`
- Pi：`~/.pi/agent/`（含已接 openreaper 的 `mcp.json`）
- 对话框样例：`~/Library/Application Support/REAPER/Scripts/OpenReaper/openreaper_dialog_sample.lua`

---

## 文件说明

- 愿景正文以 **GitHub `docs/studio/`** 为准；NAS 可保留镜像或施工笔记。
- 助手电脑上的历史备忘路径 `/workspace/openreaper-product/` 仅作归档对照。

---

## 附录：Agent 层 — Pi vs 自研（2026-09-11 检索结论）

### 建议（助手）

**用 Pi 当脑子，自研只做脸 + 启停 + OpenReaper 技能约束。不要从零自研整套 agent。**

### 你关心的两点

1. **自研慢 / 重复造轮子 / 可能更差** — 成立。要自研等于重做：多厂商 API、OAuth 刷新、会话树、压缩、工具循环、错误恢复。Pi / OpenClaw 生态已经踩过这些坑。
2. **登录面要宽（不只 API Key）** — Pi 官方支持订阅 OAuth：`/login` 可选 ChatGPT Plus/Pro (Codex)、Claude Pro/Max、GitHub Copilot、**xAI (Grok/X 订阅)**、OpenRouter、Radius；另有大量 API Key 厂商。Grok 也有扩展包（如 `pi-xai-oauth` / `pi-xai-supergrok`）。文档：https://pi.dev/docs/latest/providers

### 嵌入方式（产品该怎么用 Pi）

- **首选 SDK 嵌入**（OpenClaw 同款）：`createAgentSession()`，自有对话框订阅事件流；不是让用户盯着 Pi TUI。
- 备选：`pi --mode rpc`（非 Node / 进程隔离时）。
- 工具面：默认 coding 工具可收窄；OpenReaper 走已有 MCP（`pi-mcp-adapter`）或自定义 tools 只暴露六工具 + 音频技能。

### Pi 的代价（要接受）

- 依赖上游版本与许可；分发要捆绑或检测本机 Pi。
- 订阅 OAuth 条款/稳定性随厂商变（Claude 第三方 harness 计费规则等需产品里写清楚）。
- 品牌上是「OpenReaper 内嵌 Pi 引擎」，不是「做一个叫 Pi 的 DAW」。

### 什么时候才值得自研 agent

仅当：必须完全自有模型网关与合规、或 Pi 授权/嵌入满足不了安装包，且你们有专人养 auth+loop。对当前「先做成 AI DAW」目标，过早。

### 和 AI DAW 分期对齐

- P0：Pi（本机已有）+ 对话框脸 + 一键启停  
- 以后若要换引擎：脸和启停可保留，换 SDK 实现——所以更不该先自研 loop。

---

## 附录：已有 Pi 再装 OpenReaper AI DAW — 会冲突吗？

**结论：** 可以做到不冲突。关键是安装策略，不是 Pi 本身互斥。

### 风险点
- 覆盖全局 `pi` 二进制 / 强制升或降版本
- 全量重写 `~/.pi/agent/settings.json`、`mcp.json`（冲掉用户其它 MCP/扩展）
- 两个实例写同一 session 文件

### 应共享
- `auth.json` 登录态（OAuth / API Key）——用户一次登录，终端 Pi 与 AI DAW 共用

### 推荐策略
1. 检测已有 Pi → 复用，不装第二份全局命令
2. OpenReaper 使用独立 `agentDir` 或 `--session-dir`（隔离 DAW 会话与专用技能）
3. MCP：仅在缺少 `openreaper` 时追加，禁止覆盖整文件
4. 若必须捆绑 Pi：放应用私有目录，不碰用户全局 `pi`

一句话：**一个登录，两套入口；会话分开，配置合并不覆盖。**

---

## 分发目标（已钉）

**有 REAPER 的用户：只装 OpenReaper AI DAW 即可用，不再安装其它依赖。**

- 用户前提：已安装 REAPER（产品不负责发 REAPER）。
- 安装包内置：OpenReaper 桥/MCP、Pi（或等价运行时）、对话框、默认主题、一键启停；不要求用户自装 Node / ReaPack / 手改 mcp.json。
- 仍需要的「非安装」步骤：首次模型登录（订阅 OAuth 或 API Key）——账号态，不是再装软件。
- 已有 Pi 的机器：复用登录与二进制（可选）；无 Pi 的机器：用包内捆绑。对外话术统一为「装一个包」。

---

## UX 追加（2026-09-11）：登录菜单 · 更简约美术 · 选择上下文芯片

### 模型登录
- 做成应用内 **菜单/设置**（选 Claude / ChatGPT / Grok 等并登录），不是安装步骤。
- 登录态可与本机 Pi `auth.json` 策略对齐（复用或独立，见前文并存附录）。

### 美术方向
- 再检阅、再简约：对齐当下 AI 产品气质（深色、少装饰、圆角、高留白）。
- Suno Studio 作 **对话框与上下文呈现** 的参照，不整页抄 DAW。
- REAPER 习惯按键保留；视觉降噪，不删功能。

### 上下文芯片（学 Suno「能看见选了什么」）
Suno 例：芯片 `4 bars - MIDI Track` + 输入「Write a bassline on this track」。

REAPER 选择更富，需统一成「当前焦点」芯片，而不是只支持一种选区：

| 选择类型 | 芯片示意 |
|---|---|
| 时间选区 | `8 bars · 选区` |
| Region | `Region「Verse」` |
| Marker | `Marker「Drop」` |
| Track（单/多） | `Track Kick` / `3 tracks` |
| Item 音频/MIDI | `Item「bass.wav」` / `MIDI clip` |
| 组合 | 主芯片 + 可展开明细 |

**原则**
1. 永远有芯片；无选择时用 `工程` 或 `光标处`。
2. 优先级草案：时间选区/Region > Item > Track > Marker；多选合并为主芯片。
3. 芯片可移除/编辑，防止 AI 用错作用域。

**待续**：多选冲突时的合并文案与「用户手动钉住上下文」是否要做。

---

## UX 追加：空选择不显示芯片 · + 挂载 · 插件速搜/参数 Macro

### 上下文芯片（修订）
- **没选就不显示芯片**（推翻「永远有芯片 / 默认工程」草案）。
- 对话框上保留 **+**（Suno 同款）：用户主动添加上下文。
- 点 + 可选：时间选区 / Region / Track / Item / Marker 等，钉成可叉掉的芯片。

### 野想法：打字/数字速搜插件
- 类似 Spotlight / 命令面板：在对话框或 + 流程里键入，过滤并添加插件。
- 技术上可走 OpenReaper 列 FX / 挂轨能力 + UI 搜索；列为 **加分项**，非 P0。

### 更贴 P0：用 Macro 控插件参数
- **可行且优先**：人话或快捷 → OpenReaper template/recipe 调 FX 参数（挂 EQ、拧频段、存可复用 Recipe 等）。
- 比完整插件浏览器更早交付「AI 在控混音」的体感。

### 建议优先级
1. + 挂上下文（空则不显示）
2. 参数类 Macro / Recipe
3. 打字速搜插件（有余力）

---

## UX 澄清：旋钮 Macro（可自动化）— 不是 MCP 批处理

用户所指 **Macro** = REAPER 里一个可拧的旋钮控件：
- 拧它 → 映射调节一个或多个插件参数（Parameter Link / Modulation / JS Macro / FX Container 暴露参数等）
- 该旋钮作为 FX 参数 → **可上轨道自动化 / 包络**

**可行性：可以。** 属 REAPER 成熟能力。

AI/OpenReaper 角色：根据自然语言「造钮 + 接线」；之后用户手拧或自动化。对话框不替代拧钮，而是生成可控宏控件。

限制：映射设计、第三方插件参数暴露质量不一；需在产品里选好默认 Macro 载体（JS / Container）。

---

## 暴露面：必须有什么 · 怎么越少露越好 · REAPER 前端能改多远（检索 2026-09-11）

### 引擎能力（给 AI，不等于默认 UI）
建议保证、但默认不必全露：
- 工程 / Track / Item（含 MIDI）
- 时间选区 · Region · Marker
- 传输（播/录/循环）
- FX 挂载与参数、旋钮 Macro（可自动化）
- 渲染导出、Undo

策略：**能力进 OpenReaper MCP + Pi；不进默认工具条。**

### 界面分档（越少暴露）
1. **创作态默认**：时间线 + 轨基本 M/S/Arm/音量 + AI 对话框 + 精简传输  
2. **进阶**：混音台 / FX 链 / 钢琴卷帘 → 菜单、快捷键、二次工具条  
3. **专家**：偏好 / 主题 / Action → 远离主路径  

手段：默认 Screenset + Customize menus/toolbars + 简约主题（WALTER 按高度藏钮）+ Theme Adjuster 参数。

### 前端按钮天花板（REAPER）
**能：**
- 工具条/菜单任意绑定 Action/脚本（Options → Customise menus/toolbars）
- 多工具条、Toolbar Docker、开合抽屉
- Screensets/Layouts 保存整窗布局
- WALTER 隐藏/重排 TCP·MCP·Transport；`define_parameter` 做「藏 Mute」类滑杆
- REAPER 7 `custom` 主题按钮挂 **全局** command_id

**难/不能：**
- 主题 custom 按钮难以稳定做成「仅作用于所在轨」
- 插件 UI、部分系统对话框无法主题化成 Suno
- AI 对话框不能靠主题生成（浮层/WebView）

### 产品建议
默认只露播放三件套 + 必要轨控 + AI 对话框；Macro 旋钮由 AI 按需生成。  
体感可到「极简 AI DAW」；上限仍是「底下完整 REAPER」，不是纯网页 DAW。

---

## UX 讨论：实时动态按钮（非默认工具条白名单）

用户意思：不是预先规定必须露出哪些钮，而是 **需要时 AI 能立刻给一个按钮**（可选能力，非必须）。

### 何处适合「随时长出来」
1. **AI 对话框临时动作条**（优先）：会话中出现「导出这轨 / 再湿一点」等，可钉可叉。
2. **轨上旋钮 Macro**：现场插入可拧、可自动化的工程控件。
3. **浮动 ImGui/动作条**：需要时弹出，不改主工具条。

### 何处不适合
- REAPER 主工具条 / 主题 `custom` 钮：偏静态，实时插入体验差。

原则：动态按钮长在 **AI 层或工程 Macro**，不硬改默认 chrome。

---

## 开发机（2026-09-16）

- 机器：`Zhuanz1.local`（OpenReaper 原开发机 / 验收默认机）
- 源码（本机 clone）：`/Users/Zhuanz/Documents/openreaper` → 对应 **GitHub** `https://github.com/hexingyuofficial/OpenReaper.git`（branch `main`）
- Studio 文档（GitHub）：`docs/studio/`（本目录）
- NAS 施工区：`/Volumes/NAS/coding/openreaper-studio`（大文件、日记、`engineering/trial/`）
- 协作：改仓库优先派 Cursor 云端 agent；产品决策与规格以 GitHub + NAS 镜像为准
