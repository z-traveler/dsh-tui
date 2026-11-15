# DSH 订阅额度

## 使用

DSH 会话的 provider 提供 `subscriptionQuota` 能力后，Powerline 模型段显示其有效窗口，例如 `gpt-5:high week:80% (6d)`。`dsh-llm-pi-ai` 下游须显式启用同名配置；仅选择 `openai-codex` 或使用官方 provider 包不会自动获得该能力。该配置属于 provider，不是 TUI 开关。

本功能只增加 TUI 展示，不增加 Web 展示、登录、命令、持久化账本或费用估算。查询与鉴权归 provider；TUI 不读取凭据、不请求账户接口。

## 可选能力

Cordis 的 `subscriptionQuota` 提供：

```ts
query(route: { provider: string; model: string }): Promise<{
  windows: readonly { name: string; utilization: number; resetsAt?: number }[]
  fetchedAt: number
  expiresAt: number
} | undefined>
```

用量是已用比例（0…1）；时间均为 epoch 毫秒。`undefined` 表示没有可展示数据，不代表额度充足。首版 provider 只提供 `seven_day` 周窗口；展示沿用原有颜色、悬停详情和重置倒计时。原生 Codex、Claude 的数据接入和窗口选择保持不变。

会话绑定、路由切换和回合结束触发后台查询，采用当前前台路由，而非上一个请求的旧路由。切换会话或路由立即清除旧值；迟到结果不得写入新绑定。`expiresAt` 决定 provider 请求缓存的新鲜度，不是已显示读数的撤下时间：TUI 在空闲和刷新等待期间保留最近一次成功读数，不会在 60 秒后静默消失，也不为此增加后台轮询。新答复已过期、查询失败或返回不可用时清除读数，不阻止模型调用。释放会话绑定或撤销能力时清理状态。

倒计时只更新显示，不进行联网轮询，不因重置时间到达而自行补满额度。临时缓存、账户隔离、认证刷新和并发查询合并由 provider 负责。

## 验证

```sh
node --import tsx/esm scripts/verify-subscription-quota.ts
node --import tsx/esm scripts/downstream/verify-subscription-display.ts
node --import tsx/esm scripts/downstream/verify-powerline-input.tsx
```

显示回归覆盖原生后端策略、DSH 规范化窗口、剩余百分比、颜色、重置时间以及 inline/fullscreen 和窄屏。离线演示入口是 `scripts/downstream/hud-demo.tsx`，`Alt+0` 切换后端场景，`Alt+9` 更新订阅样例；样例不代表真实账户。
