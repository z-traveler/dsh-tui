# Fast 模式展示

本私有补丁仅消费 DSH 后端的 `piAiFast` 会话投影，不为原生 Claude/Codex 内核增加 Fast 功能。后端负责 `/fast`、模型规则、持久状态与请求档位；TUI 不按模型名称猜测资格。

开启且后端认定当前模型适用时，classic/powerline 常驻模型栏在模型名称后显示主题绿色文字闪电 `⚡︎`。投影的 provider/model 必须与当前会话显示路由一致；关闭、不匹配或能力缺失不显示。它表示请求意图，不证明服务端兑现加速。当前会话的新降级通知通过既有 warning toast 显示，不重播恢复历史，也不将后台会话提示投到前台。

DSH 0.2.2 起，同会话模型选择由 Agent 的 durable seam（`model.select()`）记录公开的 log-only `model/selection` 事件，后端可在下一次生成前更新适用性，本补丁不重复提交。只有可变路由引用的旧宿主，本补丁在真实路由改变后补发同一事件；无 Fast 能力时不提交。执行路由、模型 ID、推理强度与原有 header 仍由原实现拥有。

后端 wire 契约为 `piAiFast = { enabled, supported, applicable, provider?, model?, lastFallback: null | { id, seq, provider, model } }`。`supported` 独立于意图，由后端计算；TUI 不据此重算，只消费 `applicable` 并比较显示路由。适配层按绑定 Session 读取，提供可选的后端中立 Channel 视图；能力移除时实时隐藏，绑定身份屏蔽停放/释放会话。通知由 `id` 去重，`seq` 与 Session 基线避免将历史失败当成新提示。

开发验收基线为 TUI 0.19 下游线、DSH 0.2.2-rc.1；实际安装包也已在未修改的 DSH 0.2.1-rc.5 上验证旧宿主分支。这是私有接入契约，不是上游 SDK 保证。升级时复验投影、公开模型选择事件、通知水位、两套 footer 和能力缺失行为。

定向检查需隔离 HOME/DSH_HOME：

```sh
node --import tsx/esm scripts/downstream/verify-fast-mode.tsx
node --import tsx/esm scripts/downstream/verify-fast-mode-projection.ts
node --import tsx/esm scripts/downstream/verify-fast-mode-render.tsx
```

第一项验证 powerline 字段；第二项使用真实 Sessions/Projections；第三项用两套真实 footer，在 inline/fullscreen、40/100 列验证。它们不替代 mock 后端的实际 TUI/DSH 制品验收，也不证明真实 Fast 服务可用。
