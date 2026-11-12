# 私有下游

本目录记录 `z` 分支相对上游 dsh-TUI 的全部私有功能。上游文件只保留接入点和配置声明，功能说明、契约与验证都在这里；上游 README 与用户手册不描述下游功能。

开发流程见 [development.md](development.md)，制包、安装与回退见 [release.md](release.md)。

## 功能

`z` 上每个功能对应一个提交。新增或修改功能时，先读对应文档。

| 功能 | 启用方式 | 文档 | 主要模块 |
| --- | --- | --- | --- |
| Powerline 输入区与 HUD | `/settings` → 状态栏 → 输入区域风格 `powerline` | [input-region.md](input-region.md) | `src/powerline/`、`src/hudLayout.ts`、`src/components/PromptChrome.tsx`、`HudPlacement.tsx`、`src/dsh-adapter/powerline-settings.ts` |
| 会话事实卡片（命令结果、显式技能） | `sessionCards`，默认开启 | [session-cards.md](session-cards.md) | `src/dsh-adapter/backend/session-card-facts.ts`（翻译）、`src/channel/session-card-projection.ts`（投影）、`src/dsh-adapter/channel/session-card-restore.ts`（恢复）、`src/components/messages/SessionCardRow.tsx`、`CommandCardRow.tsx` |
| 插件输入补全与上下文通知卡 | 插件注册 `ctx.tuiInputCompletions` | [input-completions.md](input-completions.md) | `src/input-completions.ts`、`src/dsh-adapter/input-completions.ts`、`src/components/useInputCompletions.ts`、`InputCompletionSuggestions.tsx`、`messages/ContextNoticeCardRow.tsx` |
| 对话卡片样式 | `cardStyles.preset`，默认 `legacy` | [card-styles.md](card-styles.md) | `src/cardStyles.ts`、`src/components/cardSurface.tsx`、`transcriptCards.tsx`、`diffAppearance.ts` |
| 自定义卡片 | 插件 `tuiRenderers.registerCard` 与卡片记录 | [custom-cards.md](custom-cards.md) | `src/cards.ts`、`src/cards-dsh.ts`、`src/channel/card-*.ts`、`src/dsh-adapter/cards.ts`、`card-presenters.ts`、`src/components/messages/CustomCardRow.tsx` |
| 当前会话接口 | 插件注入 `tuiSessions` | [session-api.md](session-api.md) | `src/dsh-adapter/tui-sessions.ts` |
| 子代理固定区 | `subagentInputDock`，默认关闭 | [subagent-input-dock.md](subagent-input-dock.md) | `src/components/SubagentInputDock.tsx`、`PinnedSubagentReference.tsx`、`Chat/subagentDockLayout.tsx`、`Chat/subagentCardBudget.ts` |
| Omni 宿主桥接 | 插件注入 `tuiIntegration` | [omni-seams.md](omni-seams.md) | `src/dsh-adapter/foreground.ts`、`integration.ts`、`src/utils/promptEditorLaunch.ts` |
| 插件模态浮窗 | 插件 `tuiScenes.registerModal/openModal` | [plugin-modals.md](plugin-modals.md) | `src/dsh-adapter/modal-registry.ts`、`modal-stack.ts`、`src/modal-options.ts`、`src/scene-modals.ts`、`src/components/PluginModals.tsx` |
| Fast 模式展示 | 后端提供 `piAiFast` 投影时自动显示 | [fast-mode.md](fast-mode.md) | `src/fastMode.ts`、`src/dsh-adapter/channel/fast-mode.ts` |

演示与回归脚本在 `scripts/downstream/`，可复用的演示配置在 `scripts/downstream/fixtures/`。设计决策记在 `docs/adr/`，术语记在根目录 `GLOSSARY.md`。

## 上游接入点

下游逻辑都在上表的模块中；上游文件只保留 import、调用点和声明。跟进上游时冲突主要出现在这些接入点较多的文件：

- 声明：`src/adapter/ports/channel-view.ts`、`src/agent/events.ts`（行与事件类型）、`src/settings/definitions.ts`、`src/dsh-adapter/index.ts`、`src/i18n.ts`、`src/theme.ts`、`src/tuiDisplayPrefs.ts`
- 交互与渲染：`src/screens/Chat.tsx`、`src/components/PromptInput.tsx`、`src/components/MessageList.tsx`、`src/components/Chat/SubagentMessage.tsx`、`src/screens/Launchpad.tsx`、`src/screens/StatusLine.tsx`
- 宿主服务：`src/dsh-adapter/plugin.ts`、`src/dsh-adapter/scenes.ts`

修改上游文件时只加调用点和声明，新逻辑放进对应功能的模块；新增功能时同步本表。
