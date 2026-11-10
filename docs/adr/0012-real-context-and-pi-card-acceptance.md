# 将真实 model-context 接入与 Pi 级阅读体验纳入本轮

用户明确最低交付应覆盖现有 skill、model-context 及 Pi 风格 custom 卡片的同等体验，因此在先前基础契约范围上增加 dsh-context 的真实 TUI 展示适配。这里同等体验指内容可读性和交互完整度：统一卡面/主题、标题摘要、展开完整正文、Markdown/表格、同卡更新、历史恢复、inline/fullscreen 与窄终端验证，不承诺与 Pi 逐像素一致或开放任意组件。

model-context 专有协议与报告语义由 dsh-context 的 TUI 入口拥有，不在通用 TUI 核心识别该插件或解析其协议。默认、first、prompt、stats/all 和 raw 均须有可读展示，保留完整工具定义、长正文及原有超限保护；现有 Web 消费者与 core 生产路径保持可用。prompt copy 的编辑器写入不属于卡片展示能力，不纳入本轮；其卡片只显示真实状态，不伪装写稿成功。

为消费现有 log-only 命令事实，通用卡片适配注册可绑定宿主提供的 command/<命令名> 业务类型，输入由宿主从命令结果构造，包含 commandId 对应身份及 name/args/outcome/text；未注册时保持原通用命令卡。该接缝不额外写入插件记录，不伪造命令或模型消息，也不把 dsh-context 业务依赖加入通用 TUI。
