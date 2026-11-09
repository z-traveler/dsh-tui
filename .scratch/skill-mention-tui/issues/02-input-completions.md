# 02 通用输入补全插件接缝

Type: implementation
Status: claimed
Blocked by: none

## Scope

正常可安装 Cordis 插件可注册补全源，不复制主输入框，不在 TUI 实现技能发现、匹配或注入。完整契约见 spec.md：异步查询、token 级替换、只读会话身份、来源优先级、多源逐项来源标签、Tab/Enter 不提交、Esc 关闭、内建补全不回归、陈旧结果隔离和 activation 清理。

## Acceptance / Verification

真实 activation 注册与 dispose、多个来源优先级和标签、异步乱序/编辑/移光标/换会话/卸载隔离、来源抛错不拖垮其他来源、运行中候选优先于排队提交、保留后文/文件行号/原子图片。通过真实 PromptInput 的行为测试而非只有 helper。公开入口正常打包，API/生命周期文档足以供 skill-mention 实现其 ./tui provider。

## Answer

待实现、独立审查和整合。
