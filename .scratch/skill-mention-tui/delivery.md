# 技能提及：全部 TUI 宿主支持

状态：TUI 宿主能力已交付，定向验证、独立审查和隔离体验入口准备完成；用户亲自体验尚未进行。未推进 z、推送、发布或切换稳定安装。

## 交付内容

1. **正常插件补全 API**：`@deepseek-harness-tui/dsh-tui/input-completions` / `ctx.tuiInputCompletions.register()`。默认启动页与聊天输入框都支持异步、多来源候选；按来源优先级排序，多源时逐项标注来源。Tab/Enter 只替换查询片段，不发送、不加载技能；保留光标后文、内建 `/`/`@`、图片占位、会话隔离及卸载清理。
2. **通用上下文通知卡**：只按 `form: 'notice'` 与合法 summary 判定，不特判插件名字；显示来源与摘要，展开持久正文，保留原消息 id/seq/time。不猜严重级别，不额外 toast/响铃，不改变模型可见性。
3. **既有成功技能卡的完整验收**：基线已支持的“已加载指令”卡继续使用，不重复实现、不当执行结果、不生成人工气泡。补充真实 core 多技能/部分失败、长正文、恢复及删除文件后的快照验证。

`sessionCards` 默认开启，统一控制命令/技能/新增通知卡；显式 false 保留旧形态。补全不受此开关控制。

技能发现、权限、匹配排序、规范插入值和实际加载仍由 skill-mention 项目拥有。本次没有改它的仓库，也没有宣称它已经发布正式 `./tui` 入口；下面的可安装测试插件通过正常 API 复用它的匹配函数，证明宿主接缝可供其接入，不是生产 TUI 的硬编码技能功能。

## 观察证据

- 补全 **53/53**，既有启动页 **279/279**，会话卡 **79 项**通过（含 working=true 时一条输入、两张技能卡、一次投递）；真实 Cordis activation、PromptInput、Launchpad、翻译器→channel→Chat，不只是 helper。
- 真入口曾暴露“仅接 PromptInput 会漏掉默认启动页”；补测试先 red，再共用 hook/菜单接通启动页。取消不配合的异步来源、同词光标后缀、notice 来源/空白也有 red→green 记录。
- 隔离 DSH profile 实际显示 **21 项**（技能源最多20项＋第二工单来源）；40列 inline 仍能读来源标签。
- Tab 接受 alpha 后仍停在启动页；再 Enter 才加载并生成一个模型请求。一次提交 beta＋unreadable，beta 成功卡和失败通知分别出现，累计请求只从1增加到2；模型实际收到两份成功正文及失败说明。
- 任意来源 `acceptance-ledger` 的220行通知，真实终端可读 `NOTICE_BODY_END`。
- 删除当前 alpha 文件后恢复旧会话，实际仍读到 `ALPHA_INSTRUCTIONS_END`；恢复进程计数为 `LOCAL_REQUESTS=0`。

详细命令、计数、失败修复和未跑项见 [verification.md](evidence/verification.md)。终端证据：[窄屏补全](evidence/pty-inline-40-menu.txt)、[接受不提交](evidence/pty-tab-no-submit.txt)、[部分失败](evidence/pty-partial-failure.txt)、[模型边界](evidence/pty-model-boundary.txt)、[长通知](evidence/pty-generic-notice-full.txt)、[删文件后恢复](evidence/pty-restored-deleted-alpha.txt)、[恢复进程零请求](evidence/pty-restored-no-model-request.txt)。这些是**代理已验证**，不是用户已经亲自验收。

## 风险与恢复

- 当前是私有任务分支 `feature/skill-mention-tui-support`，代码版本 `7ccd7345`，基线 `8c6a8ad2`，DSH rc.5、TUI0.18.0。真实稳定安装未改变；用户已有 AGENTS.md 修改未动。
- 通用规则也使既有 `subagent-settled` 等核心 notice 在默认开启时显示通知卡，可能增加 Agent Teams 转录中的可见记录；它不代表新增子代理执行，也不生成人工气泡。既有 model-selection 专属提示保持原样。
- 无会话格式迁移：新增的是现有持久事实的 UI 投影。撤回代码即可撤回新呈现；已保存的 DSH 上下文仍保持原模型语义。
- 同次查询等待所有参与来源完成；慢来源会延迟菜单，取消/卸载立即终止宿主等待。目前没有额外超时配置。
- 长历史的600条转录记录窗口保持原有有界折叠。旧卡正文先降预览，点“加载更早”后恢复持久全文，不从当前技能文件重建。
- 没跑发布前全量门禁、全部CI分组、Windows ConPTY及真实 Claude/Codex/付费模型；本次跑了必要编译、包/边界/适配器门禁、输入/投影/卡片及共享UI相关回归。

## 阅读路线

1. [公开类型与入口](../../src/input-completions.ts) 与 [API/生命周期文档](../../docs/downstream/input-completions.md)：插件能做什么、不能做什么。
2. [服务](../../src/dsh-adapter/input-completions.ts)：activation 归属、触发范围、只读会话身份、多源排序、取消与卸载。
3. [输入 hook](../../src/components/useInputCompletions.ts)、[PromptInput](../../src/components/PromptInput.tsx)、[Launchpad](../../src/screens/Launchpad.tsx)：陈旧结果栅栏、接受/关闭与既有按键优先级。
4. [DSH 适配](../../src/dsh-adapter/backend/translate.ts) → [共享投影](../../src/channel/projection.ts) → [通知卡](../../src/components/messages/ContextNoticeCardRow.tsx) / [历史恢复](../../src/dsh-adapter/channel/transcript.ts)：原始身份、顺序、正文和模型语义。

## 已准备的体验环境

```sh
cd /home/liyihang/projects/dsh-src/.worktree/dsh-tui/context-notices
DEMO="$PWD/.scratch/skill-mention-tui/acceptance"
bash "$DEMO/run.sh" fullscreen
# 或：窄终端里运行
bash "$DEMO/run.sh" inline
```

- Node24.16、pnpm11.21；任务源码已编译，公开包入口检查通过。
- 独立 HOME/DSH_HOME/profile 位于 `$DEMO/state`，合成 workspace 有自己的 Git 边界，避免发现真实仓库技能。
- 通过官方 `dsh plugin --profile skill-mention-tui add <绝对路径>` 链接安装任务 TUI、skill-mention core0.1.1、测试补全 bundle；`--dump-config` 与实际加载均核对。
- 只有 localhost HTTP/SSE 模型替身；凭据是脚本内明确的合成值，进程清除继承环境并阻止外部 fetch。**无需填写真实 API key，也不要填写。**
- 如果出现首次引导，按 **Esc** 跳过；看到启动页输入框后再操作。未登录引导可能在重启时再次出现，这是测试环境故意不配置真实账号的结果。
- `run.sh` 使用已存在的固定 rc.5 宿主 `/home/liyihang/projects/dsh-src/dsh-context/.acceptance/host/node_modules/@deepseek-ai/dsh/lib/bin.js`；该路径若被移走会响亮失败，不会偷偷切换到全局安装。
- alpha/beta 是真实文件技能（用户可调用、模型不可调用）；unreadable 是总会抛合成读取错误的 provider；model-only 不应出现在用户候选中；sample-01…20用于滚动。

### 体验1：来源、优先级与不提交

1. 启动后输入 `#`，**等列表可见**。技能来源在前，逐项有 `[技能候选]`；向下移动20项可见低优先级 `[工单候选]`。
2. Esc 关闭列表；Ctrl+C 清空非空草稿。输入 `#al`，等 alpha 出现后按 Tab。
3. 应只得到可编辑的 `#skill:alpha `，仍在启动页，没有回复或技能卡。再按 Enter 才提交，出现独立“已加载指令”卡及本地合成回复。
4. `/demo-count` 应显示本进程请求数1。再用 Ctrl+O 或点击卡片阅读正文和 `ALPHA_INSTRUCTIONS_END`；查看不增加请求。

失败信号：Tab/首次接受 Enter 就发送；低优先级抢在前面；多源没有来源；输入被替换成整份草稿；已加载被标成任务执行成功。

### 体验2：部分失败不是成功卡

输入 `#skill:beta #skill:unreadable`。若候选仍开着，第一次 Enter 接受，列表关闭后再 Enter 发送。

应只有一条原输入、beta 成功卡、独立中性失败通知、一次本地回复；无 unreadable 成功卡，也没有额外人工气泡。`/demo-evidence` 展开后应有 BETA_BODY_PRESENT、FAILURE_CONTEXT_PRESENT=true。若按体验1连续操作，LOCAL_REQUESTS=2。

失败信号：失败阻断整批、伪装为工具执行或成功加载、失败对模型隐藏、一次输入增加多轮请求。

### 体验3：通用来源与完整通知正文

执行 `/demo-notice`，应出现来源 `acceptance-ledger` 的中性通知，不依赖 skill-mention 的 name/message。展开后向正文末尾滚动，应读到 `NOTICE_BODY_END`；再次 `/demo-count` 不增加请求数。

### 体验4：禁用补全与原有输入

`/demo-completions` 会禁用测试插件的两个补全源；再打 `#` 没有插件菜单，内建 `/` 仍可用。再执行该命令恢复。接受候选不会直接加载技能：裸 `#name` 提交仍是普通文本；手打规范 `#skill:name` 由 core 处理。

正式包删除曾通过官方 CLI 在独立 profile 验证，随后恢复安装。测试 profile 关闭代码 HMR；需要验证包级变更时重启，不以目录里仍有配置行证明插件已运行。effect 撤回、菜单关闭和查询取消还由53项真实激活/输入回归覆盖。

### 体验5：多会话、忙碌与引用

- 在一个会话输入 `#be`，切换 `/new` 或其他会话后重新查询；旧会话候选不能写入新草稿。异步相同 query、移动光标和换绑定的拒旧行为已有可控延迟回归。
- `/demo-slow` 切换下一轮本地响应到8秒，提交一条普通文字，运行中输入 `#be`；看到菜单后 Tab/Enter只接受候选，不应发送 steer/queue。真正发送仍需下一次提交。再次 `/demo-slow` 恢复立即响应。
- 句中补全保留后文；`@a.ts#L12`、`[Image #1]` 不被技能源误触发。可通过按方向键把光标移到引用前的 `#` 查询处体验。此处不生成真实图片附件；真实绑定图片的编辑/保护另有回归通过。

### 体验6：删除当前文件后仍读旧快照

已留存可恢复的真实体验会话 `83f8b582-9bcf-4205-8a73-9f38d5de5a36`。

```sh
node "$DEMO/fixtures.mjs" delete-alpha
node "$DEMO/prepare-profile.mjs" 83f8b582-9bcf-4205-8a73-9f38d5de5a36
bash "$DEMO/run.sh" fullscreen --patch "$DEMO/state/resume-fullscreen.yml"
```

先关闭正在挂载同一会话的体验终端，否则挂载锁会正确拒绝。旧 alpha 卡和通知仍应存在，Ctrl+O展开并向上滚动可读原 `ALPHA_INSTRUCTIONS_END`；在这个恢复进程中**另行执行** `/demo-count` 为0，证明查看没请求模型；历史转录里原有的1/2计数是旧命令结果，不是恢复进程计数。失败信号是读到当前文件、失去正文或恢复触发加载/模型。

结束后恢复合成文件，不改旧会话：

```sh
node "$DEMO/fixtures.mjs" reset
```

## 清理与复验

清空草稿并等本地请求结束后，双击 Ctrl+C 正常退出；已实测退出码0。保留 `$DEMO/state` 方便体验和回看；它不是稳定安装配置。代理保留了独立 tmux socket `skill-mention-tui` 的验收会话，可通过 `tmux -L skill-mention-tui ls` 查看；同名恢复会话仍挂载时先在其中正常退出。

以后修改注册/卸载重跑补全53项及插件生命周期；改输入优先级同时跑279项启动页、文件引用和图片绑定；改事件/卡片重跑翻译器、79项卡片、黄金投影和本页恢复场景。用户仍需亲自体验上述交互，自动化不代替用户验收。

## 证据与审查

- 规格：[spec.md](spec.md)，工单：[01](issues/01-context-notices.md) / [02](issues/02-input-completions.md) / [03](issues/03-integration-acceptance.md)。已定领域边界见根 GLOSSARY.md 与 docs/adr/0001…0006。
- 实现提交：文档基线 d4685f6f、通知整合 e4c48443、补全整合6e9c6c61、修复与默认入口7ccd7345；本报告描述代码提交7ccd7345，后续纯报告提交不改变该代码版本。
- 工单01/02、完整改动和收尾复核均为 OK with notes，无阻断发现；来源标签、文档漂移、死 API、测试前置条件、运行中多技能覆盖、恢复进程零请求证据及 vendor 临时软链均已处理，见 [review.md](evidence/review.md)。开发 node_modules 软链仍保留供体验/复验，未暂存。
- [Git/技能语义预检](evidence/preflight.md) 已执行实际目录检查与只读 scout：当前基线不是 advisory 的 ad19d096；不存在进行中的 rebase，未 abort/reset。技能卡基线已实现，仍是 model-facing instructions，非执行结果。
- [全部验证、替代条件和未跑项](evidence/verification.md)。未使用真实密钥/真实会话/付费模型；当前正式 skill-mention TUI provider 仍由其项目接入，本任务只交付宿主契约与可安装夹具。
