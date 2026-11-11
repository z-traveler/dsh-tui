# 当前 TUI 会话接口（实验性）

`ctx.tuiSessions` 是只读的前台绑定接缝，供插件得知 TUI 当前前台会话及在线派生的会话；不暴露 Channel 或 Agent 写能力，也不提供会话内容。

## 接入

插件在 `inject` 中声明 `tuiSessions`，从 `@deepseek-harness-tui/dsh-tui/extensions` 加载 Context 类型（纯类型也可从 `./api` 导入）：

```ts
import type {} from '@deepseek-harness-tui/dsh-tui/extensions'

export const inject = ['tuiSessions']
export function apply(ctx: Context) {
  const stopBinding = ctx.tuiSessions.subscribe(snapshot => {
    // undefined：会话尚未就绪或 TUI 已解绑；否则为 { sessionId, backend? }。
  })
  const stopDerived = ctx.tuiSessions.onDerived(({ kind, sourceSessionId, sessionId }) => {
    // kind 为 'fork' 或 'rewind'；这是在线创建出的会话。
  })
  // 可提前调用 stopBinding() / stopDerived()；activation 结束时宿主也会清理。
}
```

## 语义

- `current()` 同步读取当前快照：`{ sessionId, backend? }` 或 `undefined`。
- `subscribe(listener)` 注册时立即同步投递当前值，之后跟随前台绑定变化，涵盖延迟启动、新建、恢复、后台与 agent view。插件晚启动或热重载无需等待下一次切换。
- `onDerived(listener)` 只通知本 TUI 的在线 fork/rewind，含不切换前台的 `/fork` 与树操作；不回放历史，也不推测或持久化历史会话的派生类型。树操作的 `sourceSessionId` 是实际派生来源，不一定是切换前的前台会话。
- 前台切换通知可能先于派生通知，消费者应分别处理两者。
- 两种订阅归调用者的活跃插件 activation；手动 disposer 幂等，卸载插件或服务会移除订阅。监听器抛错只记录，不中断会话操作。
- 与已有 `tui/session-switched` 通知一样，此只读接缝不要求 intercept grant。

## 验证

```sh
node --import tsx/esm scripts/verify-tui-sessions.ts
node --import tsx/esm scripts/verify-fork-resume.ts
```
