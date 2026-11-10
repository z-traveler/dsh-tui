---
status: accepted
---

# 显式接受插件记录外部调用的私有下游例外

实现核对发现目标 dsh-session 的 README.md（Write experimental plugin records）明确写有“Plugins outside this repository must not call it either”。先前研究仅引用公开声明中的仓库内门禁，错误推论外部插件可调用；公开导出和运行时可行不代表官方支持外部调用。

ADR 0011 的用户批准仅基于实验性与跨格式迁移尽力保留风险，并未覆盖这项外部调用禁令。因此暂停独立卡片载体写入相关实现，不绕过或仿造 API；中立展示模型、注册生命周期与已有 skill/command 事实的适配可继续。

用户在获知上述禁令后明确选择 A：接受将该调用作为不受上游支持的私有下游例外。恢复通过正式导出的 appendPluginRecord 实现，不修改或绕过宿主 API，不将其描述成官方第三方插件扩展协议。公开 API 注释、开发规范与交付说明均须披露这项下游耦合及跨格式迁移风险；不得指导仅安装官方 DSH 的普通插件假定存在本包的卡片宿主能力。
