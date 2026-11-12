# Issue tracker: Local Markdown

规格与工单使用本地 Markdown 文件，不使用 GitHub Issues。

- 功能目录：`.scratch/<feature>/`，该目录不入库；规格放 `spec.md`。需要长期保留的结论按 [下游开发流程](../downstream/development.md) 写入仓库文档。
- 需要拆票时，每票单独写入 `issues/<NN>-<slug>.md`，从 `01` 编号，不合并成一个 tickets 文件。
- 分诊用文件顶部的 `Status:`，词表见 [triage-labels.md](triage-labels.md)；讨论追加到 `## Comments`。
- 技能要求“发布工单”时创建本地文件；要求“读取工单”时按给定路径读取。仅给编号且归属不明时先定位功能目录。

使用 wayfinder 时，`map.md` 保存探索地图，每个子任务仍用独立文件。
子任务用 `Type:` 标明类型，`Status: claimed/resolved` 记录执行状态，
`Blocked by: NN, NN` 声明依赖；依赖全部 resolved 后才可认领。
完成时在 `## Answer` 记录结果并更新地图链接。
