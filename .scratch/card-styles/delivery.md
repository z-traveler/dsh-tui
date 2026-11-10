# 对话卡片样式交付

## 结果与验收

首轮功能已发布并按授权安装为 `z-0.18.0.12`。后续真实环境反馈调整已由用户整体验收，本轮授权提交、合入 `z`、推送、私有 CI 发布与本机正式安装；候选标签为 `z-0.18.0.13`。

- 默认 `legacy` 保留既有外观及 `toolBackground: none/subtle/strong`，不按工具状态自动换底。
- 显式启用 `cardStyles.preset: pi-like` 后使用近黑淡状态底、零内边距、普通卡片一行呼吸间距；job 默认透明、组内紧贴。
- Edit 双栏删除/新增分别有极淡玫瑰/灰绿衬底，主体保留原语法高亮和局部修改词强调。选中、悬停仍保留行底区别，卡头、gutter 和上下文保留高亮反馈。
- 对话 job 默认细线，完成段和计数按比例使用主题 accent/ide/success；`kinds.job.progressStyle: bar` 可恢复原进度条。legacy 和 `/jobs` 默认不变。
- 配置仍按方案 → common → kinds 覆盖；用户 `values.cardStyles` 整块替换部署块。不新增 `/settings` 控件，不更改后端或持久化事实。

参数与能力限制见 [中文说明](../../docs/downstream/card-styles.md) / [English](../../docs/downstream/card-styles.en.md)。

## 首轮集成与验证（z-0.18.0.12）

功能代码提交 `3b8321ec` 已重放到发布前的 `z`（`1609c7cb`）；`range-diff` 核对通过。唯一文本冲突在发布 workflow，保留已有 session-cards/input-completions 门禁，并加入本功能门禁。

- 用户人工演示验收通过。
- 独立审查通过，详见 [审查记录](evidence/release/review.md)。审查者未执行命令，主代理负责实际验证。
- `pnpm compile` 通过；完整构建门禁通过（执行与 `pnpm verify:build` 相同的 `node scripts/run-verify-build.mjs`）。
- 配置检查 30 项、共用 demo 通过；真彩/256/16 三档真实单元格、动态进度、配置切换、分组更新和 SGR 悬停回归通过。
- 整合后的 `verify-session-cards.tsx`、`verify-input-completions.tsx` 与 `pnpm verify:package` 通过。
- 本地首次运行遇到 backdrop 色阶、公式图片和会话卡片失败；公式图片失败在未改动的 `z` 同样复现。清除继承环境、使用临时 HOME 后原断言全部通过，未修改产品代码或放宽测试。完整门禁在该隔离环境重新运行通过。
- 原红绿证据与实际 PTY 单元格记录见 [工单06证据](evidence/issue06/)，发布前日志见 [发布证据](evidence/release/)。

完整四组回归和制包由私有发布 CI 再次执行；只有全部成功才创建 Release。源码、工作流和制品身份以该 Release 的 `RELEASE.json`、`SHA256SUMS` 与 CI run 为准。

## 后续真实环境验收（z-0.18.0.13）

- 修复空思考/仅 token 计数切到正文时的 hooks 顺序崩溃；保留两种预设的回归。
- 增强用户卡暗底可见度，加入用户文字色与粗细覆盖；输入框与回复保持一行间距。
- pi-like 使用统一单列子代理/工作流标记；代码围栏未显式设置时默认完整边框，显式 light/full 继续优先。
- 上下文通知采用左侧细线、紫灰卡面，摘要分行、展开完整保存正文，不更改消息投递与任务事实。
- tmux 根据当前会话所有客户端的 RGB 能力自动保留真彩；失败、未知或无客户端时保守降到 256 色。
- 本地真实验收入口使用单份 TUI 实现、内核 flock 租约及可恢复的临时 profile 包链接；退出恢复原 CI 安装，不复制凭据和会话。
- 合入另一 agent 的实时 jobs 计数主 HUD 修复，并补足主栏恰好满宽时不增高溢出区的边界保护。实际 Presenter 测高先红（3 行 vs 2 行）再绿；包含 inline/fullscreen、60/180 列与结束后高度恢复。
- 独立静态审查后，修复验收入口重复转发 Ctrl+C、运行/落定标记列宽不一致；前景色/粗细文档明确仅供用户输入使用。
- 用户已完成正式 profile、真实凭据/会话/后端的整体验收。发布制品仍须通过私有 CI 的完整门禁、四组全量回归与包验证；最终源码、工作流、run 与 SHA-256 以该 Release 元数据和仓库外安装记录为准。

## 边界与回退

16 色不能表达极淡增删行底；256 色使用更强的语义槽位，任意自定义终端调色板不保证标准盘对比。tmux 真彩能力在启动时检测，客户端变化后需重启；已有 `DSH_TUI_TMUX_TRUECOLOR=1` 可显式跳过检测。Windows/ConPTY 未验收，本地开发验收入口依赖 Linux 的 flock。

移除用户与部署层 `cardStyles`，或使用无个人覆盖的 `{ "preset": "legacy" }` 即恢复旧外观，不迁移会话。稳定安装、下载制品核验及回退遵循 [发布流程](../../docs/downstream/release.md)，本轮正式安装仅使用通过私有 CI 的仓库外制品；保留上一版包和配置备份。

主工作树既有 `AGENTS.md` 和 `.scratch/skill-notice-protocol/` 未纳入本功能提交。
