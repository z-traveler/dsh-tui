# AGENTS.md

dsh-TUI（`@deepseek-harness-tui/dsh-tui`）是 DeepSeek Harness 的终端界面应用，不修改 DSH 核心代码，只消费它的公开导出。DSH 是首要适配目标和首方后端。本包正在从「DSH 插件」演进为「自带入口和组装根的独立终端应用」，之后 DSH 会和 claude / codex 一样按需在进程内作为后端加载。Agent、会话、模型、工具、持久化和策略域依然归 DeepSeek Harness 管理，本包只负责使用这些能力。改动前请先阅读共享开发契约 [docs/contributing.md](docs/contributing.md) 与上游边界契约 [ADAPTER.md](ADAPTER.md)。整体结构见 [docs/architecture.md](docs/architecture.md)，独立宿主的方案与非目标见 [docs/standalone-host-design.md](docs/standalone-host-design.md)。

## 仓库布局

```
src/index.ts        公共 Cordis 插件入口、配置 Schema、对运行时实现的惰性移交
src/dsh-adapter/plugin.ts  运行时实现：TTY 校验、服务注册、Agent 创建/恢复、React 树挂载与收尾
src/dsh-adapter/host-entry.ts  本包入口：非 DSH 内核不组合完整 DSH profile（改组合轻量 profile：本包的行 + profile 声明的第三方插件）、在裸 Cordis 根上挂运行时；路由判定在 src/hostEntryRoute.ts（docs/standalone-host-design.md）
src/dsh-adapter/channel.ts  Channel 入口：后端中立核心（channel/core/）+ 仅 DSH 会话挂载的扩展（channel/extensions.ts）
src/agent/          后端中立的会话领域：AgentEvent、AgentSession、类型化能力（无 I/O、无厂商依赖）
src/channel/        共享视图映射（AgentEvent → 视图状态）与审批/问卷等中立 store
src/backends/claude/  实验性 Claude Agent SDK 后端；多后端结构见 docs/agent-backend-design.md
src/backends/codex/  Codex app-server 原生后端：协议、hub、翻译器与能力；不捆绑 Codex npm 依赖
src/dsh-adapter/oauth/    内置订阅 OAuth：provider 路由、/auth、凭据存储与问卷桥接
src/screens/        Chat.tsx 交互协调器与状态栏呈现
src/components/     功能组件；design-system/ 是主题感知原语
src/components/sidePanel/  侧栏分栏（几何、标签栏、PanelHost、键盘扩展口）与内置面板适配
src/themeCatalog.ts  内置、静态 JSON 与运行时插件主题的统一列表/解析
src/ui.ts           本地渲染器、主题化 Box/Text 与公共 TUI 原语的首选门面
src/ink/            Ink 系渲染器与终端实现——敏感基础设施，改动聚焦并附专用回归
src/native-ts/      渲染器使用的 Yoga 布局引擎
src/terminal-utils/ 终端格式化与呈现辅助
src/dsh-adapter/    唯一允许 import 官方 @deepseek-ai/* 的位置；themes.ts 提供 tuiThemes 插件扩展口
src/*Prefs.ts 等    ~/.dsh-tui 下的持久化用户偏好与会话元数据；src/tuiSettingsFile.ts 是 /settings 的 dsh-tui 分区（settings.json）
.agents/skills/     仅供仓库维护者使用的项目技能，不随 npm 包分发
presets/            随包分发的 preset（liangshen）
bin/dsh-tui.js      dsh-tui 直达命令入口
vendor/dsh-std      vendored 依赖（frozen lockfile 构建，见 scripts/build 相关脚本）
tui-profile/        仓内 TUI Profile：插件准入 + 私有协议定义（纯文件，随本仓代码修订）
cordis.patch.yml    profile 安装的包级覆盖层；行序、行 ID 与 insert/override 语义关键
cordis.yml          直接 Cordis/DSH 启动的完整裸组合示例
scripts/            无头回归、复现环境、探针与诊断；运行前先读脚本头部说明
docs/               根 README 之外的完整文档；中文无后缀，英文 .en.md 后缀
lib/                由 src/ 生成的产物——忽略入库、随 npm 分发，绝不手改
```

完整仓库地图与运行时链路见 [docs/contributing.md](docs/contributing.md)。

## 命令

```sh
pnpm install --frozen-lockfile  # pnpm 11；Node ^22.19 || >=24（CI 用 Node 24）
pnpm compile                    # 干净编译 src/ → lib/types/（先删整个 lib/；vendor 构建未变则跳过）
pnpm build                      # compile + 全部构建门禁
pnpm verify:build               # 构建门禁（边界/契约/patch surface/plugin 系列等），并行、不重复编译；--jobs 1 串行排查
pnpm verify:package             # npm tarball 目标完整 + 入口 smoke import
pnpm smoke                      # 通用无头屏幕组装冒烟
```

本仓库**没有根级 `test` 或 `lint` 脚本**，请勿声称运行过它们。静态检查依靠 TypeScript 构建，行为验证依靠聚焦回归脚本和复现环境。多数用普通 `node` 调用的脚本会导入 `lib/types/`，运行前先执行 `pnpm build`；直接导入 TypeScript 源码的脚本会在文件头注明 `node --import tsx/esm <script>`。不要仅凭文件扩展名推断输入层（例如 `verify-themes.mjs` 实际上是通过 tsx 导入 `src/`）。此外，`scripts/` 中还包含取证和交互工具（堆分析、PTY 探针、回放捕获、性能探针等），它们不是有界测试，不要把整个目录当作测试套件全量运行。

- 按改动范围选择验证方式：改动共享渲染、`Chat`、提示或问卷布局、工具卡片、主题原语或 `ink/` 核心时，必须运行 CI 回归；局部改动则运行对应的聚焦脚本，对照表见 [docs/contributing.md](docs/contributing.md)。只要改动在终端上可见，除无头断言外，在环境允许时还应在 inline 和 fullscreen 两种模式及窄终端宽度下手动走一遍受影响流程。
- 纯文档、纯 workflow 或纯 YAML 的改动无需重建（除非同时改了 TypeScript 输入）。

## 上游边界与契约

- 厂商包按目录严格隔离：`@deepseek-ai/*` 只允许出现在 `src/dsh-adapter/`，`@anthropic-ai/*` 只允许出现在 `src/backends/claude/`。后端中立层 `src/agent/` 和 `src/channel/` 不能导入厂商包、`src/dsh-adapter/` 或 `src/backends/`。UI 层不能导入 `src/backends/`，从 `src/dsh-adapter/` 也只能做纯类型导入（存量值导入的 allowlist 只减不增）。完整规则见 [ADAPTER.md](ADAPTER.md)，`pnpm run verify:boundary` 会扫描全部源码，越界即失败。
- 版本线、peer 范围与 blessed 包清单的校验在 `src/dsh-adapter/contract.ts`。本地检测到偏差会打警告，CI 上 `verify:contract` 直接失败。
- 本包入口按宿主的 realpath 加载已安装 `dsh` 的模块：清单、复刻面与偏差的唯一配置源是 `src/dsh-adapter/host-contract.ts`，实际加载只在 `host-dsh.ts` 中进行（对 `@deepseek-ai/*` 仅作 `import type`）。`verify:contract` 会运行假宿主回退验证，当环境里有已安装的宿主时，还会运行能力探测并校验复刻指纹（`host-replica.snapshot.json`）。宿主 CLI 不是直接依赖，当版本线推进时，需在装有对应版本 `dsh` 的机器上复核。详见 [ADAPTER.md](ADAPTER.md)「独立入口的宿主契约」。
- 运行时或发布类型中引用的 `@deepseek-ai/*` 框架包，必须同时列入 `peerDependencies` 和 `devDependencies`（由 `verify:manifest-deps` 门禁检查）；仅测试或脚本使用的框架包只放进 `devDependencies`。
- `cordis.patch.yml` 对官方插件行的修改已快照在 `patch-surface.snapshot.json` 中，修改后需保持同步（由 `verify:patch-surface` 门禁检查）。

## 约定与红线

- **源码与产物分离**：只改 `src/`，绝不直接修改 `lib/`，也不要提交 `lib/` 下生成的产物。
- **以持久化记录为准**：后端的持久化会话记录（DSH 会话事件日志、Claude 转录文件）是对话记录的唯一权威来源。不要为了界面响应而提前插入可能与持久化结果冲突的助手或工具记录，同时保持事件顺序、序列锚点与 call-ID 匹配。
- **职责分层**：状态映射属于共享模块 `src/channel/projection.ts`；TUI 动作属于 channel 核心 `dsh-adapter/channel/core/` 与 DSH 扩展 `channel/extensions.ts`（新后端应通过会话能力接入，不要写进 channel 代码）；交互模式与按键优先级属于 `Chat.tsx`；终端协议、布局与帧差分属于 `ink/`。不要为了写界面方便就在 TUI 中重新实现 DSH 的域服务，应通过 channel 或现有注册表扩展口来适配。
- **资源绑定生命周期**：通过 Cordis 注册的资源必须用 `ctx.effect` 或现有的统一退出通道来清理。渲染失败必须明确报错并以非零状态码退出；正常退出前要恢复终端状态（raw 模式、光标、alt-screen、同步输出、鼠标与焦点）。
- **保持渲染静默**：TUI 运行期间不要使用 `console.log` 或向 stdout 输出诊断信息；调试请走按需开启的 stderr 或日志路径（`DSH_TUI_DEBUG`、`DSH_TUI_RENDER_LOG`）。
- **TypeScript 规范**：使用纯 ESM，相对导入保留 `.js` 后缀，纯类型依赖优先使用 `import type`。不要因为 Ink 系渲染器的类型限制而引入 `any`，改用 `unknown` 并做类型收窄。代码遵循两空格缩进、单引号、无分号的既有风格，不要批量格式化渲染器文件。
- **终端宽度按显示单元计算**：不要用 JS 字符串长度替代终端列宽，需考虑 ANSI 转义、组合字符、emoji 与东亚宽字符，统一使用仓库自带的宽度、切片和换行辅助函数。
- **尺寸只有一个来源**：`ink/` 之外一律通过 `useTerminalSize()` 获取尺寸（页边距与分栏会逐层收窄它），不要直接读取 `stdout.columns/rows` 或自行监听 resize。确实需要物理终端尺寸的场景，必须登记到 `verify:terminal-size-source` 的 `ALLOWED` 列表中并写明理由。
- **双语文档同步**：行为、配置、快捷键与限制需要在 `README.md`（英文默认）和 `README_ZH.md`（中文）两份文档中保持同步。插件配置、slash 命令、主题、渲染器、技能发现的跨文件同步清单见 [docs/contributing.md](docs/contributing.md)。
- **密钥保护**：交互启动时读取 `DEEPSEEK_API_KEY`；诊断信息只能报告该变量是否已设置，绝不能泄露完整值。
- **PR 流程**：创建或更新 PR（包括改写描述）一律使用 `.agents/skills/pr`。
- **Git 安全**：只暂存显式列出的文件路径，不要使用 `git add .` 或 `git add -A`。不要运行破坏性清理命令；未经明确要求不要 commit、打 tag、push 或发布。发布由 `v*` tag 触发，且版本号必须与 `package.json` 完全一致。

## 代码审查原则

审查 PR 时，以**不引入新 Bug、最小必要改动、保持代码简洁**为核心原则：

1. **防止回归**：优先检查新增 Bug、竞态、资源泄漏、性能退化及兼容性问题，特别关注共享代码（`src/agent/`、`src/channel/` 等后端中立层）对其他后端和既有功能的影响。
2. **避免过度设计**：识别重复实现、无必要的抽象、冗余封装及过度防御性编程。只有存在更简单的等效方案时才报告，不误判必要的安全校验和错误处理。
3. **严格控制范围**：改动应围绕 PR 目标及关联 Issue，不夹带无关重构、格式化、依赖升级或其他功能修改。必要的测试和文档同步除外。
4. **保证实质价值**：关注无效代码、重复逻辑、无意义的文件拆分和缺乏有效断言的测试。不以代码行数或提交次数判断贡献价值，不推测贡献者动机。
5. **审查必须有据**：只报告本次 PR 引入的实质问题，说明具体位置、触发条件和实际影响，优先给出最小修复建议。不为凑评论而挑刺。

## 编辑本文件

`CLAUDE.md` 是指向 `AGENTS.md` 的符号链接，修改时请直接编辑 `AGENTS.md` 本身。每条规则应尽量自包含，具体细节链接到权威文档；在保证表意清晰的前提下尽量精简。

## 私有下游

本仓库是 dsh-TUI 的私有下游：`z` 分支基于上游稳定标签维护，包含一串下游功能提交，每个功能对应一个独立提交。下游功能清单、上游接入点与各功能文档见 [docs/downstream/README.md](docs/downstream/README.md)，工作区通用规则见 `../AGENTS.md`。

- 日常开发、提交整理、验收以及跟进上游同步，按 [下游开发流程](docs/downstream/development.md) 执行；制包、安装与回退按 [发布流程](docs/downstream/release.md) 执行。
- 修改已有下游功能前，先阅读对应的功能文档。新逻辑应放进独立模块，上游文件里只保留调用点和声明。
- 下游功能的说明只记录在 `docs/downstream/`（中文）、`docs/adr/` 与 `GLOSSARY.md` 中，不要修改上游 README、`docs/` 手册和 `guide/`。上文的「双语文档同步」仅适用于上游功能。
- 日常验证只需运行与改动相关的定向回归和必要编译，不必每次都跑全量；全量门禁由发布 CI 负责运行。
- 小范围的外观微调可以直接修改，用固定演示场景核对可见效果即可，不需要每轮微调都拆工单或写报告。
- 涉及 Omni 集成时，需同时阅读工作区中的 `../dsh-omni/AGENTS.md`。本包只负责提供通用扩展能力，不实现 Omni 的具体业务。
- `.scratch/` 是不纳入版本库的本地工作区。

## Agent skills

- **Issue tracker**：本地 Markdown 工单管理，见 [issue-tracker.md](docs/agents/issue-tracker.md)。
- **Triage labels**：问题分类标签说明，见 [triage-labels.md](docs/agents/triage-labels.md)。
- **Domain docs**：领域文档索引，见 [domain.md](docs/agents/domain.md)。
