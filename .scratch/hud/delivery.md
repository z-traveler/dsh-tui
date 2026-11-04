# HUD 下游补丁交付

本文件记录上一轮三项布局配置候选的证据。当前 [spec.md](spec.md) 已扩展为 Powerline 输入区域；以下结果不代表新规格已实现或通过验收。未发布或替换稳定安装。

## 改了什么

在 `/settings` → **底栏设置**调整三个选项：

| 选项 | 行为 | 原生默认值 |
| --- | --- | --- |
| `statusBar.placement` | 输入框上方或下方 | `below` |
| `statusBar.separator` | 圆点或 Powerline 细分隔符 | `dot` |
| `statusBar.order` | 逗号分隔字段顺序；非空时合为一行 | 空串，保留原生布局 |

推荐顺序：`model,thinking,contextUsage,cost,cwd,gitBranch`。
其他可用 ID：`tokens,cache,tps,mode,goal,sessionTitle,sessionId`。
显示开关仍有效，未列出的可见字段追加在后。极简界面忽略这三个布局选项。
未知或重复 ID 在设置页拒绝保存；手改文件的无效列表回落原生布局。
Powerline 字形需要字体支持 U+E0B1，不支持时选圆点。HUD 在上方时，模型等选择器在 HUD 上方展开。

本次重做将新增行为收进独立布局模块：`Chat` 只新增 import 和一对无布局节点的包裹标签；
`StatusLine` 在现有字段计算之后调用排序函数。没有复制状态栏、移动原有输入框属性、
改变指标算法或修改 Core。上游手册、既有测试、CI 列表与依赖锁恢复原样；下游说明和测试单独维护。

## 行为证据与风险

- 本轮先跑新增回归：接线前配置被丢弃，断言失败；接线后通过。
- 14 项定向检查覆盖配置保存/重载、全部 13 个字段、默认布局、分类开关、权限/插件字段保留、
  CJK 与窄屏，以及 inline/fullscreen 下上下切换后的草稿和继续输入。
- 原有显示回归 31 项、状态栏交互回归 114 项通过；没有修改这些测试。
- 隔离 tarball 安装成功，PTY 启动真实 DSH profile 后进入“底栏设置”，看到了三个 HUD 选项和分隔符，正常退出。
  离线演示在两种显示模式都显示了示例模型、25% 上下文与草稿，正常退出。

这些是 Agent 验证，不是你的视觉验收。真实字体、显示器颜色和长期交互仍需下面的体验步骤。
全量门禁留到发布前；上一版实现的全量测试不作为本版证据。
费用、上下文悬停仪表与辅助提示行沿用上游，不承诺与 pi 完全相同。

恢复原生布局只需把三个选项设为 `below`、`dot`、空串。稳定安装和原有用户配置没有被替换。
发布或回退按[发布流程](../../docs/downstream/release.md)，不要用 `/update` 覆盖私有下游。

## 实现阅读顺序

1. [Chat 接入点](../../src/screens/Chat.tsx)：只包裹原来的 PromptInput/StatusLine。
2. [HudPlacement](../../src/components/HudPlacement.tsx)：无额外布局 Box，稳定子节点身份。
3. [hudLayout](../../src/hudLayout.ts)：配置校验、分隔符、字段排序；未列出字段不丢失。
4. [StatusLine](../../src/screens/StatusLine.tsx)：沿用既有指标、点击与悬停，空 order 仍走原生路径。
5. [定向回归](../../scripts/downstream/verify-hud.tsx)：配置与真实渲染边界，不调用模型。

配置声明仍需接入上游两套 Schema、类型及设置词条，这是保留宿主兼容的必要改动；不另造配置存储。

## 已准备的体验环境

从仓库根目录执行。Node `v24.16.0`、pnpm `11.21.0`，PATH 上的 DSH CLI 为 `0.2.1-rc.5`；依赖和编译产物已准备。

### A. 真实应用与设置页

```sh
cd /home/liyihang/projects/dsh-src/dsh-tui
bash .local/hud-app/start.sh
```

安装与配置均在 `.local/hud-app/`：`home/`、`dsh-home/`、`packages/`。
启动脚本清空继承环境，只传入路径和终端参数；没有复制真实凭据、登录或发送模型请求。
已通过隔离目录的配置文件预置：关闭首次引导和启动页，启用上方 HUD、细分隔符、推荐顺序及低对比卡片主题。
PTY 验证启动读入与设置控件可见；保存/重载由生产 Schema 回归验证，不把预置文件当作 UI 保存的证据。
没有已结算用量时，费用/上下文缺席是正常行为，完整指标用 B 演示。
此准备态不纳入 Git；删除或换机器后，可用仓库现有的
`DSH_TUI_DEV_ROOT="$PWD/.local/hud-app" DSH_TUI_DEV_FAST=1 node scripts/dev-test.mjs --no-launch`
重建隔离安装，再以该目录的 `home`/`dsh-home` 启动并在设置页选择 HUD 选项。
不要运行 `dev:copy-config`；本次已验证的是分步制包与安装，一键重建路径未另跑。

1. 输入 `/settings`，在“常规”页向下选择 **底栏设置**，Enter 进入。
2. 用方向键选择 **HUD 位置**，左右键切换，再按两次 Esc 返回聊天。HUD 应只出现一处。
3. 同样切换 **HUD 分隔符**；在 **HUD 字段顺序**按 Enter 编辑，用 Backspace 清除原值后输入 `cwd,model,thinking,contextUsage,cost,gitBranch` 并确认，目录应前移。返回聊天打开 `/model`，选择器应位于 HUD 上方，Esc 可返回。
4. 字段顺序输入 `model,unknown` 后确认，应提示无效且不保存；Esc 放弃草稿。
5. 关闭再启动，合法设置应保留。按两次 Ctrl+C 退出。

失败信号：选项缺失、保存后恢复旧值、HUD 重复、输入框不可用或退出后终端未恢复。
这些更改只影响隔离环境；想恢复本次推荐值，在同一设置页重新选择 above、powerline-thin 和上面的推荐顺序。

### B. 带固定指标的离线交互

```sh
node --import tsx/esm scripts/downstream/hud-demo.tsx
# 原生终端滚动模式：
node --import tsx/esm scripts/downstream/hud-demo.tsx --inline
```

这是实际 Chat/Channel 的离线 fixture，不是连接到模型的完整应用。状态仅在本次进程中变化，
示例 HOME 在 `.local/hud-demo/home/`。演示键不是产品快捷键：

| 操作 | 预期观察 |
| --- | --- |
| 输入一段草稿，不发送；Alt+1 | HUD 在输入框上下切换，草稿保留，继续输入仍有效 |
| Alt+2 | 圆点/细分隔符切换；字段值不变 |
| Alt+3 | 目录前移或恢复推荐顺序，25% 上下文与示例费用仍在 |
| 缩窄到约 60 列，再拉宽 | 字段在一行内裁切；输入框可用，不产生重复 HUD |
| Alt+4 | 恢复原生下方、圆点与布局 |
| Ctrl+C | 退出并恢复终端 |

若 Alt 被终端拦截，先用 A 的设置页；若细分隔符显示方框，使用支持 Powerline 的字体或切回圆点。
演示拒绝消息提交，不会调用模型；完整对话、认证和跨平台行为不在本轮验收范围。

两个环境都已停止，未留下常驻服务或监听端口。体验完可删除 `.local/hud-app/`、`.local/hud-demo/`；
需要继续复核时保留 `.local/hud-evidence/`。改动布局、配置写回或输入框接入点后，分别重走对应场景。

## 交付依据

- 来源：[spec.md](spec.md)，由本次对话整理。目标是以克制的补丁实现 HUD 位置、分隔符和顺序，默认保持上游；
  不改卡片、Core、领域计费或稳定安装。测试边界为配置解析/保存及实际终端渲染。
- 模式：**direct execution**；没有关联票据，统一在 `feature/pi-hud` 集成。
- 基线：`v0.18.0` / `1d0d946f459da5149aba64cc6cc0ef7da304053c`；结果**未提交、未发布**。
- 精确改动范围：`AGENTS.md`；`src/adapter/ports/channel-display.ts`、`src/dsh-adapter/{index,plugin}.ts`、
  `src/screens/{Chat,StatusLine}.tsx`、`src/settings/definitions.ts`、`src/tuiDisplayPrefs.ts`；
  新增 `src/hudLayout.ts`、`src/components/HudPlacement.tsx`、`scripts/downstream/{verify-hud,hud-demo}.tsx`、
  `docs/agents/{issue-tracker,triage-labels,domain}.md`、`.scratch/hud/{spec,delivery}.md` 和 `docs/downstream/release.md`。
  工作区 `../AGENTS.md` 另行重写，保留子仓库独立 Git 历史。
- 已运行：`pnpm compile:src`；上述 HUD 回归；`verify-display-settings.tsx`、`verify-status-fields.tsx`、
  `verify-settings-definitions.ts`、`verify-settings-compat.mjs`、`verify-adapter-boundary.ts`；`git diff --check`。
- 环境证据：`.local/hud-evidence/` 内保存 red/green、编译、设置、边界和 PTY 日志；
  `pack.json`、`install.log` 记录试用包与隔离安装；旧版自有补丁备份在 `v1/`。
- 未运行：本轮全量 CI、真实模型调用、Windows/macOS 人工终端验收、稳定安装切换。
- 独立审查：代码审查与本地 Markdown 文档复审均 **pass**，无阻塞发现；复审记录见 `.local/hud-evidence/review.md`。测试优先级、选择器锚点、发布门禁和证据归属说明已修正。
- 保留的工作区：本开发分支及 `.local/` 体验环境；临时旧基线 worktree `/tmp/dsh-hud-baseline.eGs0OD` 未用于本轮测试。
