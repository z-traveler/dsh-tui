# Omni 所需的宿主桥接

本补丁为 Omni 的 DSH 集成提供两个窄接口，不是通用插件框架。TUI 不依赖 Omni，也不实现通知、diary、tmux、quickfix 或 Neovim 历史。它只发布自己拥有的前台绑定，并在 Ctrl+G 启动时交出必要上下文。

接口由既有 `dsh-tui-extensions` 行挂载为 `ctx.tuiIntegration`。未挂载该行或没有编辑器提供者时，保留原启动行为。前台发布的实现集中在 `src/dsh-adapter/foreground.ts`；Channel 核心只调用 `startForegroundPublication()`。

## 前台绑定

```ts
ctx.tuiIntegration.getForeground():
  { readonly sessionId: string; readonly cwd: string } | undefined
ctx.tuiIntegration.onChange(listener: () => void): () => void
```

- `sessionId` 与现有 `tui/*` 事件同源；`cwd` 是实时工作目录，不是项目初始目录。DSH 消费方自行通过 `ctx.agents` 解析并过滤非 DSH/子代理。
- 已有绑定时，订阅立即通知一次；以后在绑定变化及释放时通知。回调不携带前后状态，消费方通过同步 getter 读取当前值，不维护第二份前台账本。
- 采纳尾部会同步写入目录和身份，中间可能 emit；发布合并到微任务，避免混合的新旧字段。owner 释放后，已排队的发布被丢弃；释放同步发布 `undefined`。
- 同一个组合根只由一个当前 Channel 驱动。支持旧 owner 释放后创建替代 Channel，不新增同根多活 Channel 的仲裁协议。
- 服务晚挂载或被替换时重新绑定；普通状态 wake 使用已解析的宿主句柄，不重复查询服务。

## 一次 Ctrl+G 启动

```ts
interface PromptEditorPrepareContext {
  readonly sessionId: string
  readonly file: string
  readonly argv: readonly string[] // [命令, ...参数, 草稿文件]
}
interface PromptEditorLaunch {
  readonly argv: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  dispose?(): void | Promise<void>
}
ctx.tuiIntegration.registerEditor((context: PromptEditorPrepareContext) =>
  PromptEditorLaunch | undefined | Promise<PromptEditorLaunch | undefined>): () => void
```

- 一次只能注册一个编辑器提供者；第二次注册告警并拒绝，不形成有序 provider 链。卸载或显式注销后释放槽位，拒绝注册返回的清理函数不会清除现有提供者。
- `sessionId` 标识草稿所属会话，供消费方防止异步准备期间串会话。移除未被消费的 editor `cwd`；需要额外会话事实时从其真源读取。
- 提供者返回 `undefined` 或抛错，均回到普通启动；错误只记录日志。
- TUI 保留 `$VISUAL`/`$EDITOR` 解析、临时草稿、终端与 stdin 交接、子进程启动、读回及草稿采纳。`env` 只覆盖本次子进程，不修改全局环境或用户编辑器配置。
- `dispose` 在子进程退出或启动失败后 await，且先于终端恢复。UI 只通过 props 传递回调，不引入 adapter 值依赖。

## 生命周期与维护

订阅和注册复用 `requirePluginCaller`、`bindCallerEffect`，属于调用插件的激活。root、异根、伪造 fiber、已卸载激活不能遗留回调。两项副作用分别登记为 `host.integration.subscribe` / `host.integration.register-editor`，遵守既有 shadow 策略，没有单独豁免。

升级时应重点验证前台采纳的发布顺序、晚挂载、服务替换及编辑器准备/清理顺序，而不是只看补丁能否无冲突重放：

- `scripts/verify-foreground-seam.ts`：真实 Channel 的有/无桥接路径；真实 DSH 服务链的 `/bg`、rewind、目录迁移、工作区切换、延迟创建与释放竞态。
- `scripts/verify-prompt-editor-seam.tsx`：真实 Cordis、编辑器子进程及 Chat→PromptInput→启动路径；单提供者、降级、argv/env、草稿返回和清理。
- `scripts/verify-adapter-shadow.ts`：能力分类，以及 passive/replay 模式下两项注册被拒绝；运行环境变化不能改变已捕获的模式。
- `scripts/verify-plugin-lifecycle.ts`：共享的 root/异根/伪造 fiber/卸载边界。

宿主改动仍接触 `Chat`、`PromptInput` 和 Channel 启动位置；小的调用点不能消除这些位置的语义变更风险。真实终端的 Neovim、inline/fullscreen 体验由集成验收补充，不替代上述自动化回归。
