# 当前 TUI 会话接口（实验性）

`ctx.tuiSessions` 是一个只读的前台会话查询接口，用来让插件知道 TUI 当前正在展示哪个前台会话，以及在运行过程中新派生出了哪些会话。它不暴露 Channel 或 Agent 的写入能力，也不提供会话内容。

## 接入

插件在 `inject` 中声明 `tuiSessions`，并从 `@deepseek-harness-tui/dsh-tui/extensions` 引入 Context 类型扩展（仅需要纯类型时也可以从 `./api` 导入）：

```ts
import type {} from '@deepseek-harness-tui/dsh-tui/extensions'

export const inject = ['tuiSessions']
export function apply(ctx: Context) {
  const stopBinding = ctx.tuiSessions.subscribe(snapshot => {
    // undefined 表示会话尚未就绪或 TUI 已解绑；否则为 { sessionId, backend? }。
  })
  const stopDerived = ctx.tuiSessions.onDerived(({ kind, sourceSessionId, sessionId }) => {
    // kind 为 'fork' 或 'rewind'，表示在当前 TUI 运行期间新创建出的会话。
  })
  // 可以保存返回值手动提前取消订阅；插件激活结束时宿主也会自动清理。
}
```

## 语义

- **`current()`**：同步读取当前的前台会话快照，返回 `{ sessionId, backend? }` 或 `undefined`。
- **`subscribe(listener)`**：注册时会立刻同步回调一次当前值，之后跟随前台会话切换持续通知（涵盖延迟启动、新建、恢复、切回后台及切换 agent view）。即使插件加载较晚或经过热重载，也不必等下一次切换才能拿到当前会话。
- **`onDerived(listener)`**：只通知本 TUI 运行期间在线发起的 `fork` 或 `rewind` 操作（包括不切换前台的 `/fork` 和会话树操作）。它不会回放历史记录，也不会去推测或持久化历史会话的派生关系。对于会话树操作，事件里的 `sourceSessionId` 是实际被派生的源会话 ID，不一定等于切换前的前台会话。
- **事件顺序**：前台会话切换的通知可能会早于派生通知到达，消费端请分别处理这两个事件，不要假设固定的先后顺序。
- **生命周期与隔离**：两种订阅都自动绑定调用方的活跃插件作用域。手动调用返回的取消函数是幂等的；插件卸载或服务销毁时宿主也会移除对应订阅。监听器内部抛错只会被记录日志，不会中断正常的会话操作。
- **权限**：和已有的 `tui/session-switched` 通知一样，这个只读接口不需要申请 `intercept` 权限（grant）。

## 验证

运行以下命令执行测试：

```sh
node --import tsx/esm scripts/verify-tui-sessions.ts
node --import tsx/esm scripts/verify-fork-resume.ts
```
