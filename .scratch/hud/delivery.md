# Powerline 输入区域：体验与交付

## 改了什么

在 `/settings` → **底栏设置** → **输入区域风格**选择 `powerline`。
原生 `native` 仍是出厂默认，极简界面保持原生；只在隔离体验环境预选 Powerline，没有替换稳定安装。

Powerline 将模型:强度、数字上下文、费用、订阅窗口、目录、Git 和插件字段融入输入框顶边，
最后一行输入与圆角底边共用一行。先预留右组，再按配置顺序放入完整左字段；
放不下的字段隔一空行移到输入框下方，默认 `drop`，可选 `wrap`。不虚构 Shell/Agent 数据。
工作时显示紧凑阶段、耗时、中断提示，上下各留一空行，空闲时工作行和两侧留白一起撤下；额外 Token 计数默认关闭。
模型图标由 `modelIcons` 按模型 ID 首个匹配，未匹配才用通用 ``。订阅窗口独立于费用显示剩余比例、相对重置倒计时，悬停给出完整日期；过期只提示等待后端更新，不自行补满。
详情是按需浮层，通知也不推动输入框。模型/强度入口、危险权限和插件接缝保留。
费用沿用宿主既有处理，没有新增币种换算或计费规则。卡片、侧栏和工作流不在本轮范围内。

**按你的 AGENTS.md 反馈收敛了接入方式：**

```text
下游 HudPlacement 组合具体风格
  ├─ PromptInput → 中性 PromptChrome（边框、留白、行内控件、外边距）
  └─ StatusLine → 中性 render(view)（宿主已计算的字段和详情）
```

`PromptInput` 和 `StatusLine` 不再导入或判断 Powerline；原生 `EffortInputBorder` 完全未改。
没有复制编辑器/原生渲染器、运行时覆写或依赖升级。接口成员均被实际使用，不建立通用插件框架。
配置表、类型及两套 Schema 是保留宿主设置兼容的必要接入。
相对上游，编辑器/Chat/StatusLine 三处热点合计 +62/-20 行；原生边框、渲染器和依赖文件无改动；04 没有再改这三处热点，详见 `refinements-patch-surface.log`。
完整配置与双语说明见 [input-region.md](../../docs/downstream/input-region.md)。

## Agent 已验证的行为与边界

| 验证 | 当前结果 |
| --- | --- |
| 实际 Chat，inline/fullscreen × 60/180 列 | 90 项通过：默认融合、CJK/多行、左右组、drop/wrap、标签、显式下置、草稿与中段光标、插件详情/点击/撤销、通知、工作行上下留白及框下留白、模型切换图标/fallback、独立额度/重置/刷新/到期/详情 |
| 配置/布局纯模块 | 28 项通过；包含外侧留白 0/2、右组预算、整字段前缀、阈值、样式非法值回落；另有 7 项图标选择/匹配/安全配置检查 |
| 只读 Git 临时仓库（本轮未修改） | 上轮 15 项通过；重命名、分离头、未出生分支、异常、索引不变、缓存边界、超过 TTL 的慢请求共享 |
| 生产设置表单与双注册表 | 保存部分 JSON、非法输入拒绝、清除、实时应用通过；另验证新服务重载保存值 |
| 原生/插件回归 | 本轮原生 HUD 14 项通过；未修改的显示 31 项、插件字段 114 项、原生选区与光标沿用上轮记录，新样式插件交互另由上述 90 项覆盖 |
| 编译/静态接缝 | `compile:src`、i18n、生产设置表单、设置声明、适配器边界、终端尺寸来源、diff 格式检查通过 |
| 真实隔离应用 | 打包产物已加载；PTY 进入底栏设置，预置 Powerline，PTY 切至原生再切回并显示「已保存」，退出码 0；写路径和重载由生产设置回归覆盖 |
| 离线固定指标演示 | 两种模式 PTY 各 16 步：图标/组/工作态/插件/上下文/溢出/风格，以及订阅快照刷新、过期提示、模型轮换，退出码均为 0 |

修复前后证据：新增 Git 检查先复现用户 Git 配置把未跟踪数隐藏为 0，修复后为 1；
慢请求现在持续共享，缓存 TTL 从完成时起算。布局留白和控制符本轮集成的通过证据在 `refinements-layout.log`，不补造缺失的旧版 red 截图。
本轮没有重建完整旧版视觉截图来充当 Before；先前的三项布局候选不是扩展规格的通过证据。

两项测试环境事实避免误读：无头终端须启用仓库已有的现代 Emoji 宽度表，否则鲸鱼会产生假残影；
显示颜色断言需清除继承的 TMUX 并使用 truecolor。没有为此修改底层渲染器或放宽断言。

这些都是 Agent 验证，**不代表你的视觉验收**。字体、配色观感、IME、长期交互、Windows/macOS 实机仍未验收。
全量 CI、发布门禁和真实模型请求没有运行。
合并模型/强度的两个点击区域、真实 activity 摘要、正数上传计数和分离头 Git 的呈现尚无专项自动断言；不把插件点击或 Git 纯模块检查当作这些场景已验收。

## 如何审查

1. [HudPlacement](../../src/components/HudPlacement.tsx)：下游组合点，检查编辑器键和 Provider 身份保持。
2. [PromptChrome](../../src/components/PromptChrome.tsx)、[StatusLinePresentation](../../src/components/StatusLinePresentation.ts)：检查中性接口及原生回落；原生状态/键处理不外移。
3. [Powerline 模块](../../src/powerline/)：配置、宽度分配、具体边框和字段呈现；指标来自宿主，Git 是独立只读缓存。
4. [真实 Chat 回归](../../scripts/downstream/verify-powerline-input.tsx)与 [生产设置回归](../../scripts/verify-settings-compat.mjs)：检查草稿/中段光标、真实表单保存/清除，不把预置文件当作 UI 保存证据。

## 已准备的体验环境

仓库：`/home/liyihang/projects/dsh-src/dsh-tui`。Node `v24.16.0`、pnpm `11.21.0`、DSH CLI `0.2.1-rc.5`。
编译产物、隔离包及配置已准备，本轮 PTY 子进程均已退出，未启动另行维护的服务。
没有复制真实凭据或历史会话，也没有发送模型请求。

### A. 真实应用与设置

```sh
cd /home/liyihang/projects/dsh-src/dsh-tui
bash .local/hud-app/start.sh
```

脚本用 `env -i` 启动，HOME/profile 都在 `.local/hud-app/`，预选 Powerline、中文及低对比静态主题。
应用刚启动没有已结算费用/上下文时，相关字段缺席正常；固定值请看 B。
**不要在真实应用提交测试草稿或添加凭据；本轮只体验输入、设置和原生选择器。**

| 场景 / 操作 | 预期与失败信号 |
| --- | --- |
| 输入 `/settings`，选 **底栏设置**，Enter；在 **输入区域风格**用左右键切换，Esc 返回 | 立即切换，不出现双重 HUD；关闭后再启动仍保留选择。字段缺失、自动恢复旧值、输入失效都是失败 |
| 同页 **Powerline 外观选项**输入 `{"icons":"ascii","separator":"|","left":["cwd","model","context","cost","quota","git","plugins"]}` | 目录前移、ASCII 图标；未填值继续跟随预设。不是保存整个预设快照 |
| 输入 `{"icons":"bogus"}` 或破损 JSON | 拒绝保存；Esc 放弃。留空则恢复预设 |
| **HUD 位置**明确选下方，再选上方 | 下置为框下的普通状态行，上置融入顶边；不额外画第二个框。未设置的位置：原生下方、Powerline 顶边 |
| 输入草稿，移动光标，切换风格再继续输入；打开 `/model` 后 Esc 返回 | 草稿、光标和焦点保留；选择器在 HUD 上方浮出，不永久占提示行 |

Powerline 的顺序/分隔符由外观选项 `left/right/separator` 控制；旧的 **HUD 字段顺序 / HUD 分隔符**只控制原生风格。
极简界面不会套用 Powerline。真实 UI 的左右键切换与「已保存」提示已由 Agent 验证；写路径/重载另由生产设置回归验证。JSON 编辑及字体观感仍可按上表亲自体验。
两次 Ctrl+C 退出。恢复本次体验预设：选择 Powerline、上方，清空外观选项；恢复原生则只选 `native`。

### B. 固定指标的安全离线演示

```sh
node --import tsx/esm scripts/downstream/hud-demo.tsx
# 原生终端滚动模式：
node --import tsx/esm scripts/downstream/hud-demo.tsx --inline
```

这是实际 Chat/Channel 的离线 fixture，**不是完整后端会话**；拒绝消息提交，不调用模型。
初始 DeepSeek/high、25.0%/100k、历史成本报告 `$0.1250`，以及模拟订阅窗口（5小时剩余75%、7天剩余60%），不是账单或真实账户额度。模型轮换不会伪造新的花费。
Git 仍只读查询当前本地工作树，数字不是固定样例。演示状态只活在本进程，HOME 在 `.local/hud-demo/home/`。

下列都是**演示键，不是产品快捷键**：

| 操作 | 观察 |
| --- | --- |
| 输入 CJK 和多行草稿；移动光标；Alt+4 两次 | 原生/Powerline 来回切换，输入继续有效；无双重编辑器 |
| Alt+1 | 顶边融合 / 框下状态行切换 |
| Alt+2 | Nerd / ASCII 图标切换；费用数值不变 |
| Alt+3 | 目录前移 / 恢复预设组顺序 |
| Alt+5 两次 | 实际阶段 fixture 开始/结束，工作行上下各一空行，与输入框隔开；结束时工作行和两侧留白一起撤下 |
| Alt+7；fullscreen 悬停插件字段；再 Alt+7 | `构建 42%` 按插件原值和语义色显示，详情浮出，撤销后消失 |
| Alt+8 多次 | 上下文 25% / 75% / 95% 循环，后两者黄/红；没有进度条 |
| 缩窄终端并 Alt+6 | drop/wrap 切换，字段保持完整，溢出在输入框下方；不能把长字段挤碎塞进首行 |
| Alt+0 | DeepSeek/GPT/Claude 样例模型轮换；在 Nerd 模式观察 ◆ / ◉ / ✳ 随模型变化。这些是演示配置，不是内置品牌默认值 |
| Alt+9 多次；fullscreen 悬停额度 | 刷新模拟窗口快照，依次可见较低剩余、重置已过期的「待更新」、再恢复新快照；悬停看完整本地重置日期。不是联网刷新 |
| Ctrl+C | 退出并恢复终端 |

在实际设置页可使用部分覆盖 `{"icons":"nerd","modelIcons":[{"pattern":"^deepseek","icon":"◆"},{"pattern":"^gpt","icon":"◉"},{"pattern":"^claude","icon":"✳"}]}`。
匹配模型 ID 而非显示别名，按列表顺序、忽略大小写；未匹配仍显示 ``。ASCII 模式统一为 `model`，none 模式隐藏图标。
`quota` 默认在费用后，既有自定义 left/right 列表需自行加入 `quota` 才会显示。真实 start.sh 不会为没有上报数据的后端造出用量或额度。

若 Alt 被终端拦截，可先用 A 的设置页；字体缺字时选 ASCII 并设置 `separator:"|"`。
详情可能盖住工作行或转录尾部，这是按需浮层的取舍，不为它永久保留空行。

## 风险、回退与复核

- 稳定安装、全局配置和共享分支未切换，未 push/发布。`native` 是可逆的恢复入口；Powerline 覆盖可保留或清空。
- `.local/` 的隔离配置与产物不会随代码回退消失；不需要时可删除 `.local/hud-app/`、`.local/hud-demo/`，证据建议保留。
  不要运行 `dev:copy-config` 或 `/update` 来覆盖私有候选。
- 首次组合打包/安装命令超过 120 秒未返回，被工具终止；不能把该次记作正常退出。
  后续分步重新打包、隔离安装已成功；本轮 04 安装在 40 秒限时内正常退出 0，日志为 `refinements-install.log`。
  本轮 8 个相关模块与编译目录逐一比对一致，SHA-256 留存在 `refinements-install-integrity.log`；新产物的应用与设置 UI 再次正常启动、退出。
  首次迟退原因未定位，保留原始记录供发布安装复核。
- 重置时间已核对 Codex 的秒→毫秒适配及既有 usage 命令；其他后端的真实 deadline 单位尚未验证，接口注释与部分适配路径存在单位差异；非 Codex 后端若上报秒级值，会显示待更新/1970 年日期。本轮不猜测转换、不修改后端；不把离线快照当作真实账户或跨后端验收。
- 当前隔离 tarball 在 `.local/hud-app/packages/powerline-refinements/`；前两版包仍保留在相邻目录。
  这是本机准备态，不承诺全新机器一键重建。没有运行全量发布/打包门禁，不可据此切换稳定版。
- 修改中性接口/编辑器几何后重跑 A 的切换和 B 的 CJK/多行；修改布局后重跑窄屏和左右组；
  修改插件/配置生命周期后重跑保存、清除、浮层及撤销；发布前再跑全量门禁和跨平台人工体验。

## 交付依据

- 来源：[spec.md](spec.md)，本机参考的归属说明保留在规格；代码和配置采用宿主中性命名。
- 模式：本地 Markdown 票据驱动。01 配置/布局/Git，02 输入区域接入，03 首轮验收，04 体验留白、图标及订阅演示；主代理整合、验证，工作树隔离委派只读 Git、布局与模型图标切片。
- 基线：`v0.18.0` / `1d0d946f459da5149aba64cc6cc0ef7da304053c`。
  旧候选/规格检查点 `01fa0cea`；模块整合 `f3a981b0`、`ce37d8fd`、`698e95b9`；输入接口整合 `d9134d1d`，首轮产品代码 `ae4b31dd`（补正未知上传计数，同时收窄 Chat 的显示拼接）；04 图标切片 `0ee044d4`，当前已验证产品代码 `531c9613`。
  首次验收提交 `d5227d4f` 后，04 在原有下游模块及字典/设置提示中迭代，不改原生编辑器、原生状态栏生产器、渲染器或后端。当前 04 的代码提交与产物见下方证据说明。
- 执行命令：`pnpm compile:src`；以下五项均用 `node --import tsx/esm` 执行：
  `scripts/downstream/verify-powerline-layout.ts`、`scripts/downstream/verify-powerline-git.ts`、
  `scripts/downstream/verify-powerline-input.tsx`、`scripts/downstream/verify-hud.tsx`、`scripts/downstream/verify-model-icon.ts`。
  同样执行 `scripts/` 下的 `verify-settings-compat.mjs`、`verify-settings-definitions.ts`、`verify-adapter-boundary.ts`、`verify-display-settings.tsx`、`verify-status-fields.tsx`、`verify-input-selection.tsx`、`verify-native-cursor.tsx`；
  `verify-i18n.ts`、`verify-source-hygiene.mjs`、`pnpm verify:terminal-size-source`；`git diff --check`。没有根级 `test/lint` 或全量 CI 通过的声称。
- 本轮证据：`.local/hud-evidence/refinements-*.log`、`refinements-pack.json`、PTY 的 `powerline-app.ansi`、`powerline-demo-{fullscreen,inline}.ansi`；早期 `powerline-*.log` 保留历史，不能拿旧数量替代本轮 90 项结果。
  `.local/hud-evidence/smoke-powerline.py` 为本机有界 PTY 复核脚本。打包使用 `npm pack --ignore-scripts`，没有借生命周期脚本运行全量门禁。
- 独立审查：布局/Git、中性接口和首轮最终代码复审 PASS；04 代码及交付复审均 OK（无运行态阻塞，文档精度建议已处理）；单位及真实账户验证边界见风险节。只读审查没有代替主代理执行测试。
  首轮归档在 `.local/hud-evidence/powerline-review-{architecture,code,delivery}.md`，04 归档在 `.local/hud-evidence/refinements-review-{code,delivery}.md`。
- 保留：集成工作树及布局、Git、模型图标三个 worker 工作树和 `/tmp/dsh-hud-baseline.eGs0OD`；基线仅做过 TMUX 环境失败的对照，不代替当前分支验证。
  先前候选交付记录可从 `01fa0cea:.scratch/hud/delivery.md` 恢复。
