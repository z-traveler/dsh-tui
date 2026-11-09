# 对话卡片样式交付

## 结果与验收

用户已完成隔离演示验收，并授权提交、合入 `z`、推送和私有 Release；未授权稳定安装切换。

- 默认 `legacy` 保留既有外观及 `toolBackground: none/subtle/strong`，不按工具状态自动换底。
- 显式启用 `cardStyles.preset: pi-like` 后使用近黑淡状态底、零内边距、普通卡片一行呼吸间距；job 默认透明、组内紧贴。
- Edit 双栏删除/新增分别有极淡玫瑰/灰绿衬底，主体保留原语法高亮和局部修改词强调。选中、悬停仍保留行底区别，卡头、gutter 和上下文保留高亮反馈。
- 对话 job 默认细线，完成段和计数按比例使用主题 accent/ide/success；`kinds.job.progressStyle: bar` 可恢复原进度条。legacy 和 `/jobs` 默认不变。
- 配置仍按方案 → common → kinds 覆盖；用户 `values.cardStyles` 整块替换部署块。不新增 `/settings` 控件，不更改后端或持久化事实。

参数与能力限制见 [中文说明](../../docs/downstream/card-styles.md) / [English](../../docs/downstream/card-styles.en.md)。

## 集成与验证

功能代码提交 `3b8321ec` 已重放到发布前的 `z`（`1609c7cb`）；`range-diff` 核对通过。唯一文本冲突在发布 workflow，保留已有 session-cards/input-completions 门禁，并加入本功能门禁。

- 用户人工演示验收通过。
- 独立审查通过，详见 [审查记录](evidence/release/review.md)。审查者未执行命令，主代理负责实际验证。
- `pnpm compile` 通过；完整构建门禁通过（执行与 `pnpm verify:build` 相同的 `node scripts/run-verify-build.mjs`）。
- 配置检查 30 项、共用 demo 通过；真彩/256/16 三档真实单元格、动态进度、配置切换、分组更新和 SGR 悬停回归通过。
- 整合后的 `verify-session-cards.tsx`、`verify-input-completions.tsx` 与 `pnpm verify:package` 通过。
- 本地首次运行遇到 backdrop 色阶、公式图片和会话卡片失败；公式图片失败在未改动的 `z` 同样复现。清除继承环境、使用临时 HOME 后原断言全部通过，未修改产品代码或放宽测试。完整门禁在该隔离环境重新运行通过。
- 原红绿证据与实际 PTY 单元格记录见 [工单06证据](evidence/issue06/)，发布前日志见 [发布证据](evidence/release/)。

完整四组回归和制包由私有发布 CI 再次执行；只有全部成功才创建 Release。源码、工作流和制品身份以该 Release 的 `RELEASE.json`、`SHA256SUMS` 与 CI run 为准。

## 边界与回退

16 色不能表达极淡增删行底；256 色使用更强的语义槽位，任意自定义终端调色板不保证标准盘对比。生产环境的 tmux 真彩策略不变；RGB 客户端可显式使用已有 `DSH_TUI_TMUX_TRUECOLOR=1`。真实后端、Windows/ConPTY 未验收。

移除用户与部署层 `cardStyles`，或使用无个人覆盖的 `{ "preset": "legacy" }` 即恢复旧外观，不迁移会话。稳定安装、下载制品核验及回退遵循 [发布流程](../../docs/downstream/release.md)，本次发布不自动安装。

主工作树既有 `AGENTS.md` 和 `.scratch/skill-notice-protocol/` 未纳入本功能提交。
