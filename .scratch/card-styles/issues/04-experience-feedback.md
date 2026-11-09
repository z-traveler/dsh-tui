# 04 实际体验反馈：紧凑、分隔、描边正文和豆沙状态色
Type: bugfix
Status: resolved
Blocked by: 03

## Source
用户实际体验：内部上下空白过多，相邻卡片相连；描边演示正文不可见；job保持透明无色；配色不是全灰，要求柔和豆沙色感，success/failure背景明确区分，状态颜色行为与pi一致。本票覆盖并取代此前默认paddingY=1、job默认状态底色及256色全灰方案。

## Acceptance
1. pi-like 默认卡片上下内边距0，卡片间至少一行未着色空隙；已有转场空行不再无谓叠加。legacy、个人显式padding/gap覆盖语义不变。
2. 描边演示在30/40/80/120列inline/fullscreen能看到真实正文，而非只看到边框；上滚/下滚无未绘制空白带。ScrollBox组装遵循已有契约，不改渲染器/Yoga。
3. job默认普通背景和三态背景都不填充；原glyph/状态文本保留；显式用户样式覆盖仍可配置。
4. 执行类（工具/子代理）running中性淡底、success低饱和灰绿、failure豆沙玫瑰。不是全灰，不是强烈正红正绿。真彩与256色都要真实呈现不同色相，正文可读；16色能力限制如实记录，不通过假断言声称豆沙渐淡。
5. 不改变用户消息近透明底、折叠/点击/Ctrl+O、领域状态和会话真源。修复描边下子代理已复现的宽度溢出，保留legacy外观。

## Diagnosis evidence
只读诊断报告：/home/liyihang/.pi/agent/sessions/--home-liyihang-projects-dsh-src-dsh-tui--/subagent-artifacts/outputs/b32f3db3-0de2-4c03-a125-52cc6da86578/context.md。
复现命令/产物在/tmp/card-styles-diag。真实demo描边压缩到scrollHeight=28等于viewportH=28，正文消失；在临时副本内层Box增加flexShrink=0后内容119行且正文恢复。未接scrollHandle使列表上滚仍按sticky尾部占位；窄屏header折成4行但预算仅扣1行。子代理描边80列实测81显示单元溢出。原PTY烟测仅测启动/退出，未捕获正文缺失，必须补真正内容断言。

## Verification
先补确实在当前实现红的真实ScrollBox+MessageList/demo回归，再最小修复；保留全部旧默认/显式覆盖/状态区分/正文对比断言，只调整被用户明确取代的默认样式期望。编译、聚焦回归、独立审查、真实PTY正文与滚动验收，更新delivery，不提交/推送/安装。

## Answer
实现已在本工作树未提交集成：paddingY0/内部minimumGap1（个人gap保留旧语义），job默认普通/状态底全部透明，真彩灰绿/豆沙玫瑰、256有色槽位。演示共用真实scene并修ScrollBox收缩、header预算和句柄接线；子代理样式内缩路径收起低优先级元数据、标题单行、glyph独立不收缩，legacy不改变。间距缓存新输入用已有cardHeightKey失效，切回legacy首行间距先红后绿。

主代理最终compile、配置25项、render真彩/256/16色217/235/215项、共享demo72项通过；真实入口30/80列×inline/fullscreen四组检查顶部/中段/底部正文可见并正常退出。原jobs-group、scroll-anchor invalidation/remeasurement、component-wrap、timeline-rail、toolcards/问卷/layout、smoke均实跑退出0（精确RGB用tmux truecolor opt-in）。实际截图文本、回归及红证据位于../evidence/issue04；../delivery.md完整记录入口、观察与限制。

工单04初审OK with notes，最终修复/证据/指南独立复核OK—pass，无阻塞项。未发布/提交/推送/安装；完整发布门禁、真实后端人工体验、Windows/ConPTY未跑。极窄终端的既有任务组统计换行和自定义gap时间轴偏移作为边界记录，不借本任务重构上游。
