# 中立卡片契约与 DSH 写入入口分离

公开的 ./cards 只导出无厂商运行时依赖的记录、展示类型与校验；DSH 专属 appendTuiCard 放在 ./cards/dsh。独立审查发现将 writer 静态重导出到 ./cards 会使仅消费展示契约的非 DSH 后端也必须加载可选 session peer，因此采用分离入口，并以拒绝 DSH/React 模块解析的新进程验证中立入口可独立导入。

展示适配复用 ctx.tuiRenderers.registerCard，宿主独占 hasCard/presentCard；独立记录和已有 command/<name> 事实都使用同一纯展示契约。版本1更新提交完整快照，表格严格为矩形且单元格按字面文本阅读；对外展示不是可执行组件或可变闭包。通过显式版本和清晰适配边界留出未来扩展，而不预先引入 patch、删除、动作或通用任务状态机。
