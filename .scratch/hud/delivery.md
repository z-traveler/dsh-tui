# Powerline 输入区域：当前体验指南

## 这一版按什么显示

本机实际参考与来源位置见 [reference.md](reference.md)，不再用自行设计的独立额度栏代替参考。
以下省略图标、上下文等其他字段：

```text
DeepSeek  deepseek-flash:high
Codex     gpt-5:high week:80% (6d)
Claude    claude-sonnet-4-5:high 5h:80% (2h) week:24% (6d)
```

- 订阅窗口紧跟模型/强度，共用一个不可拆分字段。Codex 仅 week，Claude 为 5h/week，其他后端及缺失窗口隐藏；费用开关不控制它，不按模型名字猜订阅身份。
- 剩余值四舍五入后，低于 10 红、低于 25 黄、其余绿；重置括号淡显。倒计时向上取整为 m/h/d，不足一分钟为 `now`，不会据此补满额度。
- 按用户确认保留演示映射：DeepSeek ◆、GPT ◉、Claude ✳；它们是自定义示例，不是官方图标或 Pi 自带默认。出厂未配置或规则未匹配仍以 `` 兜底。
- 每个图标后只加一格，不再为 Claude 等宽图标给窄图标补空格。按各自显示宽度计布局预算，不强求名称同列。裸 `✳` 等单符号明确为 VS16 emoji 呈现；显式选择符保留。一格、两格/CJK、emoji 前缀的自然宽度已做无头终端断言，但不冒充真实字体像素验收。
- 工作行上下各一空行，空闲时一起撤下；输入框下方一空行。此前确认的留白保留。
- 原生 `native` 仍为默认，极简界面保持原生；原生编辑器、边框和渲染器未改。费用按宿主处理，不新增金额换算。卡片、侧栏和工作流不调整。

配置说明见 [input-region.md](../../docs/downstream/input-region.md)。此前独立 `quota` 字段不再使用：窗口随 `model` 显隐和溢出。

## 先重启你正在看的演示

**演示没有热更新。检测到你仍有旧演示运行，我没有替你结束它。请在旧演示里 Ctrl+C 退出，再执行：**

```sh
cd /home/liyihang/projects/dsh-src/dsh-tui
node --import tsx/esm scripts/downstream/hud-demo.tsx
# 原生终端滚动模式：
node --import tsx/esm scripts/downstream/hud-demo.tsx --inline
```

这是三个独立的离线后端场景，不是实际模型/账户迁移。使用实际 Chat/Channel，但拒绝消息提交；
没有读取真实凭据、调用模型或联网获取额度。初始为 DeepSeek、25.0%/100k、历史成本样例 `$0.1250`，无订阅窗口。
Git 只读查询当前本地工作树，其数字不是固定样例。样例 HOME 在 `.local/hud-demo/home/`。

下列是**演示键，不是产品快捷键**：

| 操作 | 预期观察 / 失败信号 |
| --- | --- |
| 启动 DeepSeek 场景 | ◆ 演示图标，无 week/5h 订阅窗口；Alt+0 切换后看 ◆/◉/✳ 后都只留一格，窄图标不为 ✳ 补空格 |
| Alt+0 一次 | 切到 Codex：模型段末尾 `week:80% (6d)`，不出现 5h；没有独立额度分隔段 |
| 再 Alt+0 | 切到 Claude：模型段末尾 `5h:80% (2h) week:24% (6d)`，80% 绿、24% 黄，括号淡显 |
| 在 Codex/Claude 按 Alt+9 | 更新模拟快照；可见黄/红低剩余和到期 `(now)`，继续按会回到新快照；不联网，不因到期自动加满。DeepSeek 会提示先切换场景，不凭空生成额度 |
| fullscreen 悬停模型段 | 原有模型信息及额度详情、完整本地重置日期浮出，输入框不移动 |
| Alt+5 两次 | 紧凑工作行及其上下留白出现/撤下；与输入框隔一空行 |
| 输入 CJK/多行草稿，移动光标，Alt+4 两次 | 原生/Powerline 往返，不丢草稿、中段光标或输入焦点 |
| Alt+1 / Alt+2 / Alt+3 | 切位置 / Nerd-ASCII 图标模式 / 目录前移；显示设置在场景间共用。自定义规则只在 Nerd 模式生效 |
| Alt+7；悬停；再 Alt+7 | 插件 `构建 42%` 保留原值、语义色、详情和撤销生命周期 |
| Alt+8 | 当前场景的上下文 25/75/95% 循环，数值而非进度条 |
| 缩窄后 Alt+6 | drop/wrap；整个模型/强度/订阅段一起溢出，不拆开凑首行。过宽字段不强行缩小 |
| Ctrl+C | 正常退出并恢复终端 |

如果显示仍是 `5小时 余… ↻…` 或 DeepSeek 仍有 ◆，就是旧演示进程/旧文件，不是这版默认场景。
若 Alt 被终端拦截，可用真实设置页；字体缺字时选 ASCII，并设置 `separator:"|"`。

## 真实隔离应用与模型图标配置

```sh
bash .local/hud-app/start.sh
```

仍是 `.local/hud-app/` 下的独立 HOME/profile，`env -i` 启动；本轮包已更新，没有切换全局稳定安装。
在 `/settings` → **底栏设置** → **输入区域风格**选择 Powerline。
真实应用不会为没有上报数据的后端造出上下文占用或订阅额度；换成一个 GPT 名称也不等于接入了 Codex 订阅。
本轮不在真实应用提交测试消息、登录或复制账号配置。

要自定义图标，在 **Powerline 外观选项**的现有 JSON 中合入规则；以下仅示意语法，不是品牌默认图标：

```json
{"icons":"nerd","modelIcons":[{"pattern":"^my-model$","icon":"M"}]}
```

匹配原始模型 ID、忽略大小写，按列表首个匹配；未匹配仍用 ``。不要为了示例覆盖掉已有的其他 JSON 选项。
ASCII 模式统一为 `model`，none 隐藏图标。留空外观选项恢复预设；选择 native 恢复原生，不必删除覆盖。
两次 Ctrl+C 退出真实应用。

## 已验证与未验证

本轮 Agent 证据，不是你的视觉验收：

| 边界 | 结果 |
| --- | --- |
| 实际 Chat，inline/fullscreen × 60/180 列 | 98 项：中段光标、CJK/多行、留白、插件、图标名称起始列、模型附属周额度、颜色阈值、淡色重置、刷新/到期/详情 |
| 订阅展示契约 | 8 项：Codex/Claude/其他后端、窗口顺序/缺失、阈值、剩余值取整、ceil m/h/d/now、不伪造补满；旧格式 red 为 `5h 80% left reset 2h · 7d…144h`，新格式 green 为 `week:80% (6d)` |
| 图标选择/前缀、终端宽度 | 16 + 4 项：◆/◉/fallback 为两格前缀，✳️ 为三格（各含一格间隔）；宽规则不影响窄图标，覆盖 VS16、CJK、ASCII/none、模拟终端实测名称列；模拟器把 ✳️ 当一格的 red 由图标 worker 报告记录，主集成复核 green |
| 配置/布局、原生 HUD | 28 + 14 项通过；生产设置表单保存/清除/重载、编译、i18n、边界、设置声明、源码与终端尺寸检查通过 |
| 原生后端适配边界 | Claude 76 项 controls + 32 项 notices；Codex 126 项 controls。已有 CLI 记录证明秒时间戳，Claude 新断言先 red，再在窗口投影处统一乘 1000；不修改 raw info，不导致 notice 二次转换 |
| 离线交互 | 两种模式各 18 步退出 0；DeepSeek 初始画面无 week，Codex/Claude 文字和 now/刷新场景均验证 |
| 隔离二进制 | 安装/模块比对与真实入口证据见下方产物记录 |

已有源码和原始 CLI 记录现在确认 Codex/Claude 的窗口在适配器边界统一为 epoch 毫秒。
前一版的“单位未知/1970 风险”不再留给 UI 猜测；根因在本轮用回归修正。没有据此声称真实账号认证/联网额度已验收。
真实字体、Windows/macOS、IME、VS15/ZWJ/复杂组合和东亚模糊宽度仍需人工检查。测试模拟器补齐了 VS16，但没有改生产渲染器或证明所有 Unicode 组合。
旧版正常显示的原生显示 31、插件字段 114、Git 15、选区/原生光标记录保留，不把它们伪称为本轮新执行的数量。
全量 CI/发布门禁留到发布前；没有根级 test/lint 或真实模型调用通过的声称。

## 接入、回退与证据

- 阅读顺序： [实际参考](reference.md) → `src/powerline/quota.ts` / `modelIcon.ts` → `fields.tsx` / `Status.tsx` → 下游 `HudPlacement`。
  继续复用中性 PromptChrome/render(view)，不在原生编辑器或状态栏生产器散落具体风格判断。
- 05 唯一必要的原生后端行为补正是 Claude 窗口秒→毫秒（`93c047c9`，在 `src/agent/events.ts` 的 RateLimitView、`src/adapter/ports/channel-view.ts` 的 ChannelRateLimit 明确毫秒约定，并补回归），没有新增请求、认证、计费或后端架构。
- `native` 可恢复原生，覆盖留空可恢复预设。稳定安装、全局配置、共享分支没切换，未 push/发布。
  本机 `.local/hud-app/`、`.local/hud-demo/` 是可删除的准备态；建议保留 `.local/hud-evidence/`，不运行 dev:copy-config 或 /update 覆盖私有候选。
- 基线 v0.18.0 / `1d0d946f`；04 交付 `04b703f7`；05 图标 worker `7be34e47` 经 cherry-pick 整合为 `64c98f24`，单位补正 `93c047c9`，产品代码 `932f159b`。
- 最新单间隔修正证据为 `.local/hud-evidence/single-gap-*.log`：red 捕获 `G  ` 不等于 `G `，green 为图标16/宽度4/真实Chat98及编译通过；此前检查记录为 `alignment-*.log`；旧版真实 PTY 输入保存在 `alignment-before/`，不重造 Before。
  当前 PTY 为 `powerline-demo-{fullscreen,inline}.ansi`，初始无额度场景为对应的 `*-initial-scene.ansi`。
  `scripts/downstream/` 下本轮执行的文件为 `verify-powerline-input.tsx`、`verify-subscription-display.ts`、`verify-model-icon.ts`、`verify-model-icon-width.ts`、`verify-powerline-layout.ts`、`verify-hud.tsx`；均使用 `node --import tsx/esm`，具体说明见文件头。
- 当前隔离产物在 `.local/hud-app/packages/single-gap/`；`single-gap-install.log` 记录安装及模型图标模块 cmp 退出 0。单间隔修正后两种演示模式各18步退出0（`single-gap-demo-pty.log`）。此前 reference 包8模块比对和真实应用38步退出0的记录保留在 `alignment-*.log`，不算本轮重新执行。稳定安装未切换。
- 独立代码复审 `2a05a824` OK；交付复审 `637de5b1` OK with notes，已修正源码行号、原始/视图时间单位和整合提交的对应关系。原始报告在 `alignment-review-{code,delivery}.md`，审查为只读，不冒充执行者。
- 05 工单完成实现、定向检查和隔离体验准备。Agent 启动验证不代替你的实机字体/视觉验收；未运行全量发布门禁。
