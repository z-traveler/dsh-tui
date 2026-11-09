# 03 整合、审查与隔离体验

Type: integration
Status: resolved
Blocked by: 01, 02

## Scope

整合两条实现线，复验全部 require 的 TUI 侧要求，对既有成功技能卡补充真实 core 部分失败/多技能/运行中/历史验证。独立只读 whole-change review，修复阻断，不因已有卡片已实现而重复写入事实。

## Acceptance / Verification

必要编译、API/export/boundary、DSH 翻译/中立投影、会话卡、真实 PromptInput 输入行为与共享 UI 受影响回归通过。准备隔离 HOME/DSH_HOME/profile、真实可安装测试 provider 和可控模型替身，在 inline/fullscreen 与窄终端验证入口。公开 API 文档和 delivery.md 可让用户亲自体验；记录实际命令、计数、未跑项、恢复/清理，不使用真实凭据、不触稳定安装。最终 git diff --check 且用户已有 AGENTS 修改保留。

## Answer

01/02已整合至7ccd7345，必要编译/包/边界/输入/呈现/共享UI回归通过；整体验收审查OK with notes。审查要求的忙碌多技能覆盖已增至79项卡片，恢复零请求证据、核心subagent-settled可见性说明和vendor借用软链现场已处理。整体验收及跟进复核均无阻断，五项审查意见已逐项关闭，最终报告与隔离入口已准备。开发 node_modules 软链保留但不暂存，vendor借用软链已清理。未做稳定分支合入或发布。
