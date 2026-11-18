# Omni 所需的宿主桥接

本补丁为 Omni 的 DSH 集成提供两个专用小接口，并非通用插件框架。TUI 本身不依赖 Omni，也不负责实现通知、diary、tmux、quickfix 或 Neovim 历史记录等功能。它只负责对外发布当前的前台会话绑定状态，并在用户按 Ctrl+G 启动外部编辑器时交出必要的上下文。

这两个接口通过现有的 `dsh-tui-extensions` 插件行挂载为 `ctx.tuiIntegration`。如果环境里没有挂载该插件行，或者没有插件注册编辑器提供者，TUI 会保持原有的启动和编辑行为。前台绑定状态的发布逻辑集中在 `src/dsh-adapter/foreground.ts` 中，Channel 核心只调用 `startForegroundPublication()`。

## 前台绑定

```ts
ctx.tuiIntegration.getForeground():
  { readonly sessionId: string; readonly cwd: string } | undefined
ctx.tuiIntegration.onChange(listener: () => void): () => void
```

- `sessionId` 与现有的 `tui/*` 事件同源；`cwd` 是当前实时工作目录，而不是项目的初始目录。DSH 消费方应自行通过 `ctx.agents` 解析会话并过滤掉非 DSH 会话或子代理。
- 调用 `onChange` 订阅时，如果当前已有前台绑定，会立即触发一次通知；之后在绑定变化或释放时通知。回调函数本身不携带变化前后的状态，消费方应通过同步的 `getForeground()` 读取当前值，不要自己维护第二份前台状态账本。
- 会话绑定完成时，目录和会话身份会在同一段同步流程中写入，期间可能触发多次内部变更事件。为了避免对外发出字段新旧混杂的中间状态，发布逻辑会把通知合并到微任务中执行，等同步写入结束后再读取稳定状态。如果当前 Channel 的 owner 在微任务执行前已经释放，排队中的发布会被丢弃；owner 释放时会同步对外发布 `undefined`。
- 同一个组合根（composition root）同一时间只由一个活跃 Channel 驱动。旧 owner 释放后可以创建新的替代 Channel 接管，但不支持同根多活 Channel 并存的仲裁协议。
- 如果 `tuiIntegration` 服务在启动之后才挂载，或者在运行中被替换，发布逻辑会自动重新绑定到新服务；常规状态更新则直接使用已缓存的宿主句柄，不会重复查询服务。

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

- 同一时间只能注册一个编辑器提供者；第二次注册会打印告警并被拒绝，不会形成多个提供者的调用链。只有当已有提供者卸载或显式注销后才会释放槽位，被拒绝的注册调用所返回的清理函数不会清掉当前有效的提供者。
- `sessionId` 标识草稿所属的会话，供消费方在异步准备期间防止串会话。上下文中没有包含未使用的 `cwd` 字段；如果需要更多会话信息，消费方应直接从后端会话数据源读取。
- 如果提供者返回 `undefined` 或抛出异常，都会直接退回普通编辑器启动流程；异常只记录日志，不中断用户编辑。
- TUI 依然保留 `$VISUAL`/`$EDITOR` 解析、临时草稿文件管理、终端与 stdin 交接、子进程启动、内容读回及草稿写入输入框的完整控制权。提供者返回的 `env` 只作用于这一次子进程，不会修改全局环境变量或用户的编辑器配置。
- `dispose` 会在子进程退出或启动失败后被 `await` 等待执行完成，且一定早于终端状态恢复。UI 组件层只通过 props 传递回调，不引入对 adapter 的值依赖。

## 生命周期与维护

订阅和编辑器注册都复用 `requirePluginCaller` 与 `bindCallerEffect`，生命周期归属于调用方所在的插件实例。来自根上下文、其他组合根、伪造 fiber 或已卸载插件实例的调用都不会生效，也不会留下残留回调。这两项操作分别登记为 `host.integration.subscribe` 和 `host.integration.register-editor`，严格遵守现有的 shadow 策略，没有任何单独豁免。

升级或维护时，应重点验证前台绑定的发布顺序、服务晚挂载、服务替换以及编辑器准备与清理的执行顺序，而不是只看补丁能否无冲突地重放：

- `scripts/verify-foreground-seam.ts`：覆盖真实 Channel 的有/无桥接路径，以及真实 DSH 服务链下的 `/bg`、rewind、目录迁移、工作区切换、延迟创建与释放竞态。
- `scripts/verify-prompt-editor-seam.tsx`：覆盖真实 Cordis、编辑器子进程以及 `Chat` → `PromptInput` → 启动的完整路径，验证单提供者限制、失败降级、`argv`/`env` 传递、草稿返回和清理逻辑。
- `scripts/verify-adapter-shadow.ts`：覆盖能力分类，以及 `passive`/`replay` 模式下两项注册被拒绝的行为；运行环境变化不能影响已捕获的模式。
- `scripts/verify-plugin-lifecycle.ts`：覆盖共享的 root、异根、伪造 fiber 与插件卸载边界。

相关改动依然会接触 `Chat`、`PromptInput` 和 Channel 启动位置；虽然在上游文件中只增加了很小的调用点，但这些位置的交互语义变更风险依然存在。在真实终端中测试 Neovim 与 `inline`/`fullscreen` 模式的体验只能作为集成验收的补充，不能替代上述自动化回归测试。
