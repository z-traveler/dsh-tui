# 01 — 可配置 Powerline 布局与格式

Status: claimed
Blocked by: none

来源：[规格](../spec.md)。执行范围：独立的配置、完整字段布局、颜色/图标和只读 Git 状态模块；
不改原生组件。布局先右后左，溢出到下方，支持 drop/wrap；配置校验与默认回落，静态彩虹、ASCII 回退。
Git 仅异步缓存读取，包含数字计数，读取失败不伪造干净。

验证：纯配置/布局行为测试、临时 Git fixture；不跑全量。交付：独立提交及定向证据。
