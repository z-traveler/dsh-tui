# DSH 订阅额度

## 使用

当 DSH 会话的 provider 提供 `subscriptionQuota` 能力时，Powerline 状态栏的模型段会显示其有效额度窗口，例如 `gpt-5:high week:80% (6d)`。这需要在 `dsh-llm-pi-ai` 下游中显式启用同名配置；仅仅选择 `openai-codex` 或使用官方原版 provider 包不会自动获得该能力。这个配置属于 provider 侧，而不是 TUI 自身的开关。

本功能只在 TUI 中展示额度，不提供 Web 端展示、登录流程、新增命令、持久化账本或费用估算。额度查询与鉴权均由 provider 负责，TUI 不读取凭据，也不直接请求账户接口。

## 可选能力

Cordis 的 `subscriptionQuota` 服务提供以下接口：

```ts
query(route: { provider: string; model: string }): Promise<{
  windows: readonly { name: string; utilization: number; resetsAt?: number }[]
  fetchedAt: number
  expiresAt: number
} | undefined>
```

用量 `utilization` 表示已用比例（`0` 到 `1`），时间均为 epoch 毫秒。返回 `undefined` 表示当前没有可展示的数据，并不代表额度充足。首版 provider 只提供 `seven_day` 周窗口；颜色阈值、悬停详情和重置倒计时沿用现有的 Powerline 展示样式。原生 Codex、Claude 后端的数据接入方式和窗口选择逻辑保持不变。

在会话绑定、路由切换以及每轮对话结束时，TUI 会触发后台查询，查询时使用当前前台路由，而不是上一个请求的旧路由。一旦切换会话或切换路由，界面会立即清除旧读数，在途的迟到结果也不能写入新的绑定。`expiresAt` 决定的是 provider 请求缓存的新鲜度，而不是界面上已显示读数的撤下时间：TUI 在空闲和等待刷新期间会保留最近一次成功读数（不会在 60 秒后凭空消失），也不会为此增加定时轮询。只有当新返回的结果已过期、查询失败或返回不可用时，才会清除当前读数，且清除读数不会阻止继续调用模型。会话释放绑定或 `subscriptionQuota` 能力被撤销时，相关状态会被清理。

重置倒计时只负责更新界面显示，不会进行联网轮询，也不会在到达重置时间后自行把额度补满。临时缓存、账户隔离、认证刷新以及并发查询合并均由 provider 负责。

## 验证

```sh
node --import tsx/esm scripts/verify-subscription-quota.ts
node --import tsx/esm scripts/downstream/verify-subscription-display.ts
node --import tsx/esm scripts/downstream/verify-powerline-input.tsx
```

显示回归测试覆盖了原生后端策略、DSH 规范化窗口、剩余百分比、颜色阈值、重置时间以及 `inline`/`fullscreen` 模式和窄屏表现。离线演示入口是 `scripts/downstream/hud-demo.tsx`，按 `Alt+0` 可切换后端场景，按 `Alt+9` 可更新订阅样例；样例数据不代表真实账户状态。
