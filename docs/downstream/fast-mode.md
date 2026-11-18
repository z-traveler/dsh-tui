# Fast 模式展示

本私有补丁只读取 DSH 后端的 `piAiFast` 会话状态，不为原生的 Claude/Codex 后端增加 Fast 功能。`/fast` 命令、模型适用规则、状态持久化以及请求档位都由后端负责；TUI 不会自己按模型名称猜测是否可用。

当 Fast 模式开启且后端判定当前模型适用时，classic 和 powerline 两种常驻模型栏都会在模型名称后显示一个主题绿色的文字闪电 `⚡︎`（要求状态数据中的 `provider`/`model` 与当前会话显示的路由一致）。如果模式关闭、路由不匹配，或后端没有提供该能力，则不显示标记。这个图标只代表客户端发起了 Fast 请求意图，并不保证服务端实际按加速档位执行。当前会话发生新的降级时，界面会通过现有的 warning toast 提示；恢复历史会话时不会重播旧的降级提示，后台会话的提示也不会弹出到前台。

从 DSH 0.2.2 开始，同会话内切换模型时，Agent 的持久化模型选择接口（`model.select()`）会自动记录公开的、仅用于日志记录的 `model/selection` 事件，让后端能在下次生成前更新 Fast 适用性，因此本补丁不会重复提交该事件。只有在只修改可变路由引用的旧宿主上，本补丁才会在路由确实发生变化后补发一次 `model/selection` 事件；如果后端没有 Fast 能力则不补发。实际的执行路由、模型 ID、推理强度以及原有的 header 显示，依然由原实现负责。

后端协议的数据结构为 `piAiFast = { enabled, supported, applicable, provider?, model?, lastFallback: null | { id, seq, provider, model } }`。其中 `supported` 与开启意图无关，由后端计算；TUI 不据此重算，只读取 `applicable` 并校验显示路由是否一致。适配层按当前绑定的 `Session` 读取状态，对外提供可选的、后端中立的 Channel 视图数据；当能力被移除时会实时隐藏图标，并通过会话绑定身份屏蔽已停放或已释放的会话。降级通知通过 `id` 去重，同时用 `seq` 和绑定基线水位避免把历史失败当成新提示。

本功能的开发验收基线为 TUI 0.19 下游线与 DSH 0.2.2-rc.1；实际安装包也已在未修改的 DSH 0.2.1-rc.5 上验证过旧宿主分支。这属于私有接入契约，并非上游 SDK 保证。升级版本时需重新验证状态读取、公开的模型选择事件、通知水位、两套 footer 显示以及能力缺失时的表现。

运行以下定向检查前需使用隔离的 `HOME`/`DSH_HOME`：

```sh
node --import tsx/esm scripts/downstream/verify-fast-mode.tsx
node --import tsx/esm scripts/downstream/verify-fast-mode-projection.ts
node --import tsx/esm scripts/downstream/verify-fast-mode-render.tsx
```

第一项验证 powerline 字段；第二项使用真实的 `Sessions`/`Projections` 验证状态读取与通知水位；第三项使用两套真实的 footer，在 `inline`/`fullscreen` 模式以及 40/100 列宽度下验证渲染效果。这些脚本只使用 mock 后端，不能替代真实 TUI/DSH 安装包的联调验收，也不能证明真实 Fast 服务端接口可用。
