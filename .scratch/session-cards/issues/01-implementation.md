# 01 实现与定向回归

Type: implementation
Status: resolved
Blocked by: none

权威：../spec.md 所有产品与分层约束。范围：两种卡片的中立类型、DSH 翻译、共享投影、内存折叠与恢复、共用正文显示、Chat 去重与交互、最小 opt-in 配置、定向测试与长期配置文档。不得编辑其他 worktree 或仓库，参考技能分支但不合并无关功能。

验证：先建立旧行为失败证据，再定向回归和 pnpm compile；必要边界/领域/翻译/黄金投影，三个既有 UI 冒烟回归。不要默认运行全部脚本。对已有脚本失败先定位，不删除或放宽有效断言。

交付：任务分支本地提交（不 push），完整路径和命令结果，剩余验收风险。前台负责 02 审查和隔离体验。

## Answer

在 `feature/session-cards`（base `ad19d096`）完成整个展示切片，全部经真实 channel +
真实 Chat/xterm 回归：

- 中立事实：`command.result`（命令结算，含 `commandId`/name/args/outcome/text/
  `coveredBySeq`/seq/time）与 `skill.invocation`（显式技能加载的 canonical 正文）。
- DSH 翻译：`command/run` + `command/done` 按 `commandId` 配对成一条 `command.result`
  （只有 run 时不投影、只有 done 时不造名字）；`skill-invocation` 来源只在 append
  （或缺省 `surfaceOp` 的旧日志）时生成 `skill.invocation`，replace 副本仍走
  injected 隐藏分支。Claude/Codex 声明不产生这两类事件。
- 共享投影：开关 `sessionCards`（默认 false）开启时按 `commandId` 出 `command` 行、
  按记录出 `skill` 行；`coveredBySeq`（既有专属呈现，如 /compact）与无正文成功命令
  不出卡；技能记录不生成用户气泡、不动 `lastUserText`。
- 呈现：`CommandCardRow`（⏵/✗ + `/名字 输入` + 首行摘要 + 行数 + 展开提示）与
  `SkillCardRow`（`[技能] 名字 · 已加载指令`），正文只在展开时以完整文本绘制（无
  200 行 / 65536 码元 / 4000 单元截断），随转录滚动读到末行；渲染期一次
  `cleanCardBody` 去 ANSI/控制字符但不截断。
- 内存：`foldRows` 把 command/skill 正文降为预览，`foldBack` 按 `commandId` /
  记录 seq 从日志恢复。
- Chat：开启开关时注册表命令结果不再经 dispatcher 的本地报告重复铺一遍（错误 toast
  保留，草稿/取消/拒绝语义不变）；`command`/`skill` 进入 `SELECTABLE_KINDS`。
- 关联必要修复：`enterSelection` 原先从 `selectionActive=false` 时的 `NO_ROWS` 闭包
  取最后一行，光标永远为空（base 上所有行类型的「选择 Enter 展开」都失效）；改为当场
  按同一 `SELECTABLE_KINDS` 从 `channel.rows` 取列表（2 行），并附命令卡/技能卡/
  普通用户行定位的回归断言。
- 配置与文档：`Config.sessionCards`（Schema 默认 false）→ plugin 启动选项 → channel
  view `sessionCardsEnabled` → 投影依赖；`cordis.patch.yml` / `cordis.yml` 注释示例；
  `docs/downstream/session-cards.md`（中英）说明两类卡片、去重、恢复与内存约束。

定向回归：`scripts/downstream/verify-session-cards.tsx`（41 项，覆盖 pairing、去重、
无正文/错误、恢复一致、技能卡边界、开关关闭、折叠恢复、inline/fullscreen × 40/100
列、Ctrl+O/点击/选择 Enter、展开不执行命令）、`scripts/verify-dsh-translate.ts` 新增
11 项翻译断言，以及 compile / projection-golden / agent-domain / boundary / i18n /
patch-surface / 既有 report 回归 / 三个 UI CI 回归（`repro-toolcards.tsx` 的 7 项失败
在未改动的主检出 `z` 上同样复现，属既存基线）。

剩余风险：真实隔离入口的全流程验收（inline/fullscreen、窄窗口、raw、save、请求计数）
由 02 负责。
