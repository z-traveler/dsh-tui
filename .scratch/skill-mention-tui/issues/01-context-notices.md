# 01 通用上下文通知卡

Type: implementation
Status: resolved
Blocked by: none

## Scope

按 spec.md 的通用 notice 决定，实现独立中立事件/行、按 form 的 DSH 适配、原消息 id/seq/time、摘要与完整正文、默认折叠与展开、sessionCards 开关、长历史折叠与持久恢复。保留已有 model-selection 等分支，不改成功技能生产者或模型可见性。

## Acceptance / Verification

换任意 producer kind、不带私有 name/message 仍可显示；live/replay 同形；replacement 隐藏；同来源多条独立；长 CJK/emoji/ANSI 正文安全且不静默截断；foldBack 取持久完整内容；点击/Ctrl+O/Enter 正常；关闭开关隐藏新增卡。使用真实 DSH translator + channel + 无头 UI，先失败再实现，必要 TypeScript 编译和已有会话卡/翻译器聚焦回归。

## Answer

已整合通知实现 e4c48443 与修复7ccd7345。独立工单及整体验收审查无阻断；来源/id/seq/time/完整首尾空白、正文、foldBack、append/replacement、关闭开关和默认中性呈现均验证。整合会话卡回归79项通过，真实220行通知末尾可见，恢复进程零模型请求。证据见 ../evidence/verification.md 与 ../delivery.md。
