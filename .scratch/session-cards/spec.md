# 会话事实折叠卡片

Status: ready-for-agent

## 授权与位置

来源：当前对话已确认的三个决策及 `/home/liyihang/projects/dsh-src/dsh-tui-command-cards-handoff.md`（命令卡片完整契约）。只在 `feature/session-cards` 开发，基线 `ad19d0960e7dfbf181ad5171348762cc63270fe8`。不合入 z、不推送、不发布、不切换稳定安装。

执行模式：ticket-driven，因涉及中立事件、共享投影、长正文恢复、Chat 交互与隔离验收，需要持久状态。最小票集：01 实现与定向回归；02 集成审查与隔离验收、交付文档。依赖 01 → 02。任务分支内本地提交用于集成，所有外部 Git/发布操作仍不授权。

## 用户行为与验收

1. DSH 原生 command/run、command/done 形成同一命令实体，按 commandId 配对，保留序列与时间锚点。默认标题及简短摘要，完整正文可展开、滚动至明确末尾，不受旧 200 行/65536 UTF-16/4000 cells 限制。保留成功/错误、取消、consumeDraft 语义，入 executor 前拒绝保留反馈。
2. 实时、恢复、分页一致；不从即时响应重复追加本地文本。已有专属呈现通过 sourceEventSeq 去重。无正文成功命令不生成多余结果卡；短单行普通命令也可成为紧凑卡片。plan 等既有状态/通知保持，不为重复一段长正文再生成本地块。
3. 显式 skill-invocation（准确 kind 为连字符形式）的 user/message 生成独立技能记录：名称和“已加载指令”，默认折叠，展开是当时实际注入的完整正文，不重新读技能文件。用户消息单独保留。只证明指令加载，不能标称任务执行成功。
4. 保留通用 injected 分支“不渲染人工气泡”约束；技能卡片不影响 lastUserText、用户回退锚点，不改变持久事件或模型消息。原本 model-facing 的技能正文仍 model-facing，原本 log-only 的命令结果仍 log-only。展开/折叠不执行命令、不请求模型。
5. 中文、emoji、超长单行按终端显示宽度处理，安全过滤 ANSI/控制字符不等于永久截断。支持既有 inline/fullscreen、窄窗口、既有点击/选择 Enter/Ctrl+O 交互。长会话正文不能绕过既有折叠/恢复内存约束。
6. 真实 command 记录、另一条普通命令、超长正文、技能注入、恢复、去重、模型消息前后相同有定向行为测试。保留现有工具卡行为及其他后端的边界与穷举检查。
7. 隔离真实入口：创建 Agent → 无请求提示 → 普通消息/回复 → 查看展开折叠 → raw → 保存 → 请求计数无额外增加 → 正常退出；覆盖 inline/fullscreen 与窄窗口。使用已有 dsh-context/.acceptance 假模型，不用真实密钥。

## 技术决策与非目标

- 复用现有分层：DSH 翻译 → 中立事实 → 共享投影 → 独立命令/技能记录 → 共用必要卡片正文呈现。不要伪造 tool/call 或调用 callId。
- 此需求是下游行为，遵守默认保持上游的规则，通过一个最小展示配置启用；隔离验收启用，并明确用户入口。不要绑定到无关的 skillMention 补全开关。
- 不新增第三方任意卡片公开框架，不修改 DSH core、dsh-context 捕获逻辑，不新增 skill 失败协议。只读取实际存在的记录，保留其他注入内容不显示。
- 技能只呈现 append 注入（历史缺省 surfaceOp 可作为旧版 append），replace 材料不额外生成卡片。
- 参考 feature/skill-mention 的 501d2735 实现与回归，但不整体合入该分支，不夹带 # 补全或未知失败事件。
- 最终文档 `.scratch/session-cards/delivery.md`；长期配置说明放 `docs/downstream/`，不反复改上游手册。

## 预检事实

主检出 z 干净；git status 明确无 rebase，rebase-merge 路径并不存在。新工作树位于工作区规定目录 `.worktree/dsh-tui/session-cards`。scout 只读报告保留于主会话 subagent-artifacts，未运行测试，不能作为验收通过。
