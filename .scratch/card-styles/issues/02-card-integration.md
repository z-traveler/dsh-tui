# 02 对话卡片集成
Type: implementation
Status: resolved
Blocked by: 01

## Scope / Acceptance
按 ../spec.md 全部对话内容类型接入票 01 样式契约。覆盖 streaming/settled、工具/子代理/后台任务状态背景，已有折叠的默认状态和预览行数，个人覆盖优先；宽度预算正确，嵌套 diff 不遮盖背景，选中和 hover 清楚，legacy 无覆盖兼容。禁止修改交互表面与领域状态。

## Verification
真实卡片渲染的 legacy 与 pi-like、类型覆盖、三状态、取消普通背景、窄屏和折叠回归；必要编译与受影响现有定向回归。保持原点击/Ctrl+O。

## Comments
无 commit/push 权限；主代理负责审查及票状态。

## Answer
全部对话内容卡片已接入；独立 UI 审查 OK with notes，门禁注册、工具内容尺寸作用域和临时探针已闭合。颜色量化缺陷经过额外修复，禁止以状态字形代替底色区分来放宽断言。主代理重跑 compile、18项配置回归、FORCE_COLOR=2 真实渲染177项，以及工具/任务组/长行/滚动锚点/Divider/测量深度/问卷布局回归与smoke均通过。worker另跑 FORCE_COLOR=3/1 两档各177项通过。旧精确RGB断言在tmux下需 DSH_TUI_TMUX_TRUECOLOR=1（同样失败已与基线对照）。全部最终改动仍需03全改动独立审查。
