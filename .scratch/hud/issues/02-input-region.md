# 02 — 宿主输入区域接入

Status: resolved
Blocked by: 01

来源：[规格](../spec.md)。接入原生/powerline 风格、融合边框、模型与强度、上下文显示、
插件字段/富状态区域、详情浮层、工作状态精简；不复制状态栏或改计费。默认路径保持原生。

验证：真实 Chat/StatusLine 渲染、草稿/焦点、inline/fullscreen、CJK/窄屏与插件协议。
配置用生产 Schema round-trip，必要编译；不跑全量。

已验证：62 项真实 Chat 行为、27 项布局/配置、15 项 Git、生产设置表单保存/清除与双注册表兼容、编译通过。
独立复审：5475c493，PASS，无遗留代码阻塞；审查不代替主代理执行测试。
按用户的补丁纪律要求收敛：PromptInput 仅消费中性 PromptChrome，StatusLine 仅增补 render(view)，原生 EffortInputBorder 无修改。
风格组合在下游 HudPlacement；没有复制编辑器、原生渲染器或指标算法。隔离应用、演示及最终证据在 03 完成。
