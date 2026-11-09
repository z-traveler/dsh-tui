# 技能提及的全部 TUI 宿主支持

## 授权与执行

权威需求：`/home/liyihang/projects/dsh-src/dsh-skill-mention-tui-requirements.md` 完整正文，加本次会话 Q1–Q4 决定。只交付 TUI 宿主能力，技能发现、用户权限过滤、匹配排序、`#skill:name` 插入值与实际加载由技能插件负责。允许用可安装的合成 provider 验证公开接缝。

执行模式：ticket-driven。两条相互独立的实现线分别使用隔离工作树，主代理整合、处理冲突、复验、审查并准备体验入口。按用户调用 go-delivery 的工单整合流程，仅在本地任务分支使用提交；不合入 z、不 push/tag/发布、不切换稳定安装。

基线 `8c6a8ad2a6751ee6076263d6e25a4e61e02bc0f3`，DSH 0.2.1-rc.5，TUI 0.18.0。主检出 AGENTS.md 有他人改动，不修改、不复制或暂存。当前无进行中的 Git 操作。已有技能卡已交付，不重复实现；工作区旧 skill-mention 探索分支不是验收依据。

## 已定行为

- 通用补全 API 不要求插件复制 PromptInput；采用现有活跃 Cordis activation、owner/effect 清理与 host-only facade 的服务模式。
- 宿主管理 token、光标、菜单、接受与替换；provider 提供触发规则、有序候选（稳定 id、名称、可选描述、替换文本）、优先级和来源标签，以及异步查询。
- 多个匹配来源共同呈现，按来源优先级数值降序；同级按注册顺序，同源保持返回次序。多源可视选项逐项标注来源，不以相同文案合并不同来源。
- 内建 /、@ 保持原优先级与行为。Tab/Enter 接受插件候选仅替换 token，不发送、不加载技能；Esc 只关闭菜单。
- 保护后文、@path#L12 和原子图片 [Image #1]；草稿、光标、会话、来源变化即使 query 字符串相同也拒绝旧结果；卸载取消查询、关闭菜单、撤销监听。
- provider 获得足够作用域身份的只读会话上下文，不获得任意写草稿/提交能力。技能插件可通过官方 agents.get(SessionId) 与 agentPresets.serviceFor 查技能 registry。
- 技能卡仍消费实际持久 skill-invocation/instructions，表示“已加载指令”而非执行成功；人工输入独立，模型工具沿用工具卡。回放、长正文、恢复、运行中输入、多技能、文件删除后的历史快照须验收。
- 通用上下文通知仅按合法 form notice/summary 匹配，不特判插件名、不依赖 name/message。保存原消息 id、seq、time、summary 与完整 content 正文；append/旧无 marker 才出卡，replacement 副本不重复出卡。
- 通知卡默认折叠，来源标签与摘要可见，点击/Ctrl+O/选中 Enter 展开全文；只呈现记录，无新增 toast/OS 通知/响铃，不猜严重级别。
- 保留既有专属分支（如 model-selection）及其提示口径。未知/不合法 form 维持原不透明回退。
- sessionCards 默认 true，同时控制命令/技能/新增通知卡；false 保留旧行为。补全独立，不受此开关影响。
- 展开及恢复仅消费历史，不读技能当前磁盘文件、不重注入、不额外模型请求。长历史保持有界折叠及按持久锚点恢复，不能丢全文。

## 工单与依赖

- [01 通知卡](issues/01-context-notices.md)：通用 notice 完整投影、渲染、折叠恢复及回归。
- [02 补全接缝](issues/02-input-completions.md)：公开注册 API、异步输入菜单、多来源、按键及生命周期回归、接口文档。
- [03 整合验收](issues/03-integration-acceptance.md)：依赖 01/02；整合、独立审查、源码/编译/聚焦回归、真实插件入口与隔离人体验入口、delivery.md。

## 验证与体验

使用既有可执行脚本（没有根 test/lint），新行为先有判别性失败用例。服务测试通过真实 Cordis activation，不仅 helper；输入通过真实 PromptInput，通知通过 DSH translator → channel → UI。

最终选择：必要 TypeScript 编译、边界/公开包导出、翻译器/中立投影/现有卡片、输入补全与引用/图片回归，及共享 UI 的必要 askpanel/toolcards 定向回归。不冒称未运行的全量检查通过。

隔离 HOME/DSH_HOME/profile、合成技能/数据/可控模型替身，无真实密钥/会话/付费模型。准备 inline/fullscreen、窄终端、跨会话、运行中输入与恢复的真实入口。最终报告区分代理已验证证据与用户仍需亲自体验的操作。

交付位置：本任务工作树 `.scratch/skill-mention-tui/delivery.md`；不得覆盖别人的交付文件。长期说明放 docs/downstream，字段/类型/生命周期契约同步到正常插件 API 文档。
