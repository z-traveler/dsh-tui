# 已核实的基线与技能语义

## Git（实施前实测）

在主检出 `/home/liyihang/projects/dsh-src/dsh-tui` 实际执行：

```sh
git status && git rev-parse --git-path rebase-merge
for kind in rebase-merge rebase-apply; do
  p=$(git rev-parse --git-path "$kind")
  test ! -d "$p" || exit 1
done
git rev-parse HEAD
```

观察：主检出在 z，HEAD `8c6a8ad2a6751ee6076263d6e25a4e61e02bc0f3`，没有进行中 Git 操作，两个 rebase 目录实际都不存在。rev-parse 打印路径不表示目录存在。仅有用户已有 AGENTS.md 修改和本次研究目录；不暂存/修改 AGENTS.md。

`ad19d096` 是旧 card-styles 工作树基线，不是本任务基线；旧 feature/session-cards 工作树来自已完成的交付，不是本轮新建。

主任务工作树 context-notices 的任务分支为 feature/skill-mention-tui-support；两个隔离工单分支从只含规格/ADR 的 `d4685f6f` 创建。不会 abort/reset 主检出，不把本地整合提交推进 z。

## 技能语义（只读 scout 已完成）

- 宿主 rc.5 的 SkillInvocationSource 声明 model-facing instructions，不含执行 outcome。
- 当前 translate.ts 已在 injected 兜底前识别 skillInvocationName，产生独立 skill.invocation。projection.ts 的 skill 行不进入人工气泡，不更新 lastUserText。
- 正常 /name 路径：skill 工具在场由宿主注入，不在场才由 TUI 附件兜底；每次正常手势一条正文。无文本的 command/done 不产生额外命令卡。
- #skill:name 与 /name 成功均使用同一个官方持久来源；失败仍是 model-facing notice。
- 当前技能标题“已加载指令”，展开只改 UI state，foldBack 从会话事件取正文，不重读技能文件、注入或请求模型。
- 因此重复 advisory 中“当前全部隐藏”仅描述旧版本，不能据此重做技能卡或把其改成 log-only。

scout 报告：`/home/liyihang/.pi/agent/sessions/--home-liyihang-projects-dsh-src-dsh-tui--/subagent-artifacts/outputs/19b29124-fa5a-46d4-b158-16613dafe26c/context.md`。本段核查是静态证据，不冒称运行验收；本轮整合后另外补需求回归。

需要实际回归的边界：多技能/部分失败/运行中提交、历史修改/删除文件后的正文、超窗口预览加载原文；不根据理论可能的异常配置预先改 producer。
