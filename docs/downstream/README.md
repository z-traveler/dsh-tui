# 私有下游

本目录记录 `z` 分支相对上游 dsh-TUI 的全部私有功能。上游文件里只保留必要的接入点和配置声明，具体的功能说明、接口契约与验证方式都放在这里；上游 README 和用户手册不记录下游功能。

开发流程见 [development.md](development.md)，打包、安装与回退流程见 [release.md](release.md)。

## 功能

`z` 分支上每个功能对应一个独立提交。新增或修改功能前，请先阅读对应的功能文档。

| 功能 | 启用方式 | 文档 | 主要模块 |
| --- | --- | --- | --- |
| Powerline 输入区与 HUD | `/settings` → 状态栏 → 输入区域风格 `powerline` | [input-region.md](input-region.md) | `src/powerline/`、`src/hudLayout.ts`、`src/components/PromptChrome.tsx`、`HudPlacement.tsx`、`src/dsh-adapter/powerline-settings.ts` |
| 插件状态字段多段语义色 | `ctx.tuiStatus.setField` 的 `segments`（`fieldSegmentsVersion === 1`） | [input-region.md](input-region.md#插件状态字段多段语义色) | `src/dsh-adapter/status-field-segments.ts`、`src/screens/StatusLine.tsx`、`src/powerline/Status.tsx` |
| 会话事实卡片（命令结果、显式技能） | `sessionCards`，默认开启 | [session-cards.md](session-cards.md) | `src/dsh-adapter/backend/session-card-facts.ts`（数据解码）、`src/channel/session-card-projection.ts`（状态映射）、`src/dsh-adapter/channel/session-card-restore.ts`（历史恢复）、`src/components/messages/SessionCardRow.tsx`、`CommandCardRow.tsx` |
| 插件输入补全与上下文通知卡 | 插件注册 `ctx.tuiInputCompletions` | [input-completions.md](input-completions.md) | `src/input-completions.ts`、`src/dsh-adapter/input-completions.ts`、`src/components/useInputCompletions.ts`、`InputCompletionSuggestions.tsx`、`messages/ContextNoticeCardRow.tsx` |
| 命令结果写稿 | 插件注册 `ctx.tuiInput.registerCommandDraft` | [command-drafts.md](command-drafts.md) | `src/tui-input.ts`、`src/dsh-adapter/command-drafts.ts`、`src/components/commandDraftFill.ts`、`src/components/PromptInput.tsx`、`src/dsh-adapter/channel/external-commands.ts` |
| 对话卡片样式 | `cardStyles.preset`，默认 `legacy` | [card-styles.md](card-styles.md) | `src/cardStyles.ts`、`src/components/cardSurface.tsx`、`transcriptCards.tsx`、`diffAppearance.ts` |
| 自定义卡片 | 插件 `tuiRenderers.registerCard` 与卡片记录 | [custom-cards.md](custom-cards.md) | `src/cards.ts`、`src/cards-dsh.ts`、`src/channel/card-*.ts`、`src/dsh-adapter/cards.ts`、`card-presenters.ts`、`src/components/messages/CustomCardRow.tsx` |
| 当前会话接口 | 插件注入 `tuiSessions` | [session-api.md](session-api.md) | `src/dsh-adapter/tui-sessions.ts` |
| 子代理固定区 | `subagentInputDock`，默认关闭 | [subagent-input-dock.md](subagent-input-dock.md) | `src/components/SubagentInputDock.tsx`、`PinnedSubagentReference.tsx`、`Chat/subagentDockLayout.tsx`、`Chat/subagentCardBudget.ts` |
| Omni 宿主桥接 | 插件注入 `tuiIntegration` | [omni-seams.md](omni-seams.md) | `src/dsh-adapter/foreground.ts`、`integration.ts`、`src/utils/promptEditorLaunch.ts` |
| 插件模态浮窗 | 插件 `tuiScenes.registerModal/openModal` | [plugin-modals.md](plugin-modals.md) | `src/dsh-adapter/modal-registry.ts`、`modal-stack.ts`、`src/modal-options.ts`、`src/scene-modals.ts`、`src/components/PluginModals.tsx` |
| Fast 模式展示 | 后端提供 `piAiFast` 状态数据时自动显示 | [fast-mode.md](fast-mode.md) | `src/fastMode.ts`、`src/dsh-adapter/channel/fast-mode.ts` |
| DSH 订阅额度 | provider 启用 `subscriptionQuota`，使用 Powerline 输入区 | [subscription-quota.md](subscription-quota.md) | `src/dsh-adapter/channel/subscription-quota.ts`、`src/powerline/quota.ts` |

演示与回归脚本放在 `scripts/downstream/`，可复用的演示配置放在 `scripts/downstream/fixtures/`。架构与设计决策记录在 `docs/adr/`，领域术语定义在根目录 `GLOSSARY.md`。

## 上游接入点

下游功能的核心逻辑都放在上表列出的独立模块中，上游文件里只保留 import、调用点和配置声明。跟进上游合并时，冲突主要集中在以下接入点较多的文件：

- 声明：`src/adapter/ports/channel-view.ts`、`src/agent/events.ts`（行与事件类型）、`src/settings/definitions.ts`、`src/dsh-adapter/index.ts`、`src/i18n.ts`、`src/theme.ts`、`src/tuiDisplayPrefs.ts`、`src/extensions.ts`、`src/adapter/kernel/runtime.ts`（宿主能力表）
- 交互与渲染：`src/screens/Chat.tsx`、`src/components/PromptInput.tsx`、`src/components/MessageList.tsx`、`src/components/Chat/SubagentMessage.tsx`、`src/screens/Launchpad.tsx`、`src/screens/StatusLine.tsx`
- 宿主服务：`src/dsh-adapter/plugin.ts`、`src/dsh-adapter/scenes.ts`、`src/dsh-adapter/extensions.ts`

修改上游文件时，请只添加调用点和声明，把新逻辑放进对应功能的独立模块中；新增功能时记得同步更新本表。
