# 05 贴近黑底、Edit正文层次与紧凑对齐
Type: implementation
Status: resolved
Blocked by: 04

## Source / Goal
用户要求：背景再淡、终端黑底上只要一点视觉效果；Edit文本灰色突兀，核实并优化原diff配色；pi-like job卡之间与原方案一样紧贴；pi-like文字前多出的1空格与legacy对齐。

## Acceptance
1. pi-like默认水平paddingX=0；保留原组件自身gutter/缩进，不能以去掉工具⎿或用户❯实现。paddingY=0和普通卡片一行未染色呼吸间隔保持。用户显式padding/gap仍优先。
2. job普通/状态背景默认透明，组内不加方案呼吸行；原转场、连接线/状态字形、分组/折叠与legacy一致。
3. 暗色默认卡片更贴近黑：running中性近黑、success仅极淡灰绿、failure仅极淡豆沙玫瑰，仍能分出状态。用户近透明3.5%维持，显式配色不改。256/16精度限制诚实记录，不伪称能表达任意暗色细阶。
4. Edit真实unified/split（oldText/newText及patch）：保留增删/修改词语义和语法/上下文层次，pi-like代码区贴近终端底，不被整张状态面压暗，也不出现256色同一中灰衬底。只做呈现接入，禁止改diff解析/对齐/词级真源算法。legacy及用户显式背景优先不变。
5. 真彩体验通过已有DSH_TUI_TMUX_TRUECOLOR开关，当前tmux客户端RGB已只读验证，不改tmux/全局安装或production颜色能力政策。隔离demo允许跳过保守clamp，FORCE_COLOR=2/1仍验证降级，不强行把所有终端设3档。

## Direct evidence
/tmp/edit-card-probe/probe.tsx已真实渲染。原版unified增删词色存在且不dim；pi-like成功面压低正文对比至2.72/3.20（真彩）和2.37/3.04（256）。split在256中原有diffRemovedDimmed/diffAddedDimmed都变palette59中灰，修改词约2.02。原diff算法/词色本轮未变，不是原版默认全灰。报告 /home/liyihang/.pi/agent/sessions/--home-liyihang-projects-dsh-src-dsh-tui--/subagent-artifacts/outputs/dedc8297-be38-4657-91c5-3c9aeee1ad3b/context.md。
宿主只读观测：TERM=tmux-256color，COLORTERM=truecolor，tmux client_termfeatures包含RGB；已有真彩开关未设置，ink/colorize默认clamp到256。

## Verification
先真实红测试（diff正文实际cell contrast、普通/双栏上下文/changed字词、job成员相邻行、横向前缀对齐、暗色默认亮度），再最小修复。编译、聚焦三档渲染、diff原回归（tmux下带truecolor opt-in）、共用demo正文和真实PTY复验。保留原assertions，明确调整被用户取代的默认值；不删语义/宽度/legacy/显式覆盖断言。同步双语下游说明与delivery，独立审查，无commit/push/install。

## Answer
默认0X/0Y、job.minimumGap0和透明面已实现；暗色真彩状态近黑#0d1013/#0e1b14/#21161d，ANSI-name running和低色档如实降级。CardSurface只下传现有preset/面来源/终端背景；narrowed仍尺寸契约，pi-like子代理独立按preset维持紧凑标题。diffAppearance独立模块提供unified/split共享呈现：默认pi-like代码区贴终端底、卡头状态面保留，optional SplitDiffView.presentation只管衬底/词色，不改diff真源/算法。普通/选中/真实SGR hover都有语义前景与实际对比检查；legacy上下文hover档位曾被改变，main补先红后绿与显式个人面保护测试，恢复旧条件。

主代理最终compile、config27、render真彩/256/16色278/292/272、共用scene72均通过。原diff-split/diff-patch/jobs-group/scroll-anchor invalidation与remeasurement/component-wrap/timeline/toolcards/问卷/layout/smoke均退出0。真实demo30/80列×inline/fullscreen，在真彩和256各4组共8组实际顶/中/底正文及正常退出通过；当前issue05目录持久化文本/JSON并记录观察到的近黑SGR字节。

代码/首次修复与legacy hover最后guard独立复审OK，无阻塞项。证据、当前体验入口/色档限制、真实后端/Windows/全发布门禁未验说明见../delivery.md与../evidence/issue05。demo仅在隔离进程启用已有真彩选项，尊重FORCE_COLOR2/1；production政策/tmux/真实HOME/安装未改，无暂存/提交/推送/发布。
