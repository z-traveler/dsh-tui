# 对话卡片样式（下游）

[English](card-styles.en.md)

`cardStyles` 仅控制对话内容，不改变输入框、补全、审批、问卷、浮层或侧栏。无配置时保持现有外观。这里的“透明”指无背景填充或极淡的实色底，不是 alpha 透明度。

## 启用与配置层级

在 `~/.dsh-tui/settings.json` 的现有 `values` 中合入以下字段，保留其他设置：

```json
{
  "version": 1,
  "values": {
    "cardStyles": {
      "preset": "pi-like",
      "kinds": {
        "tool": { "previewLines": 6 },
        "summary": { "defaultExpanded": true }
      }
    }
  }
}
```

也可在 Cordis/profile 的 `dsh-tui` 行 `config.cardStyles` 中声明同样的对象。用户文件的整个 `cardStyles` 对象优先于部署对象，**两者不深合并**；用户只写 `kinds` 时也不会继承部署对象的 `preset`。部署配置重启生效；运行中的用户设置监听可能即时应用，重启是可靠的应用方式。不新增 `/settings` 控件，也不复用 Agent 的 `/preset`。

对象内部按 **基础方案 → `common` → `kinds.<类型>`** 覆盖，状态色逐状态合并。切换 `preset` 不会清空覆盖。

| 方案 | 默认表现 |
| --- | --- |
| `legacy`（缺省） | 保持现有背景、布局与折叠；工具背景继续由 `toolBackground` 决定 |
| `pi-like` | 普通卡片无边框，上下文通知保留左侧细线；用户为柔和可辨的底色，工具/子代理为柔和状态底，仍保留原缩进与零内边距；`custom`（通用卡片/技能/已适配命令）为独立紫色面、横纵各一格内边距，展开时标签/标题/正文分层；后台任务默认透明且组内紧贴，其它普通卡片之间至少一行不着色呼吸空间；助手、思考、摘要与 `other` 无填充 |

自定义卡片的颜色角色为 `customMessageBackground` / `customMessageLabel` / `customMessageText` / `customMessageHint`；它们与工具状态色分开，深浅色参考 Pi 的自定义消息。无需额外配置 `kinds.custom` 就会生效；显式覆盖仍优先。该自定义卡面逐色参考 Pi 1.4.0，亮色正文/标签对卡面的对比分别约 3.98:1 / 4.36:1，不宣称满足 4.5:1 AA；需要更强对比时可在自定义主题中加深这两个角色。工具状态面的既有 AA 门禁不变。

两套方案默认都不改变折叠策略。`pi-like` 接管工具背景，不再读取 `toolBackground`；个人覆盖仍优先。颜色不切换主题：暗色盘三态用一张贴近黑底的固定小色表（执行中中性近黑、成功极淡灰绿、失败极淡豆沙玫瑰），亮色盘的执行中仍是主题自己的中性面、成功/失败用淡 sage/rose；低色档退到可辨槽位以保住可读性，见下两节。用户卡面与 Edit 代码区跟随**终端底色**，见下文。

## 类型与属性

`kinds` 支持：

| 键 | 内容 | 已有折叠覆盖 |
| --- | --- | --- |
| `user` | 用户消息、团队消息 | `defaultExpanded`，仅已有超长单行裁剪 |
| `assistant` | 助手正文，含流式 | `defaultExpanded`，仅已有超长单行裁剪 |
| `thinking` | 思考块 | `defaultExpanded`；`previewLines` 只调流式 ticker，不给落定折叠块新增正文 |
| `tool` | 工具调用及结果 | `defaultExpanded`、`previewLines` |
| `subagent` | 子代理消息 | 无；保留原详情入口 |
| `job` | 后台任务 | `defaultExpanded` 调整已有任务组的初始展开，不改变分组条件；`progressStyle` 控制对话卡的进度呈现（见下节） |
| `notice` | 上下文通知（如 `tool-jobs`、`subagent-settled`） | 保留原有点击、消息选择 Enter、Ctrl+O 展开；不新增折叠配置 |
| `summary` | 压缩摘要 | `defaultExpanded`；折叠为文字预览，没有预览行数 |
| `custom` | 通用自定义卡片、技能、已有命令的卡片展示适配 | 保留宿主原有 Ctrl+O/选中 Enter/点击 |
| `other` | 通知、中断、本地回显/输出、回合用量等 | 无 |

`custom` 是整类自定义卡片的卡面。单张卡片想更低密度时，由展示快照声明 `density: 'compact'`（见 [自定义卡片规范](custom-cards.md)）：只去掉那一张卡的底色、边框、内边距与间隔，主题角色、折叠与选中都不变，同类型的其它卡片保持这份配置。不要为了单张卡片去改 `kinds.custom`。

`common` 与每类覆盖均可写：

| 属性 | 值 |
| --- | --- |
| `background` | `none`、主题颜色键、合法显式颜色 |
| `foreground` | 仅用于用户输入消息的文字色（其他类型不消费）：主题键或显式颜色；未指定保留 `userPromptLabel`（DSH 主题橘红） |
| `bold` | 仅用于用户输入消息是否加粗（其他类型不消费）：`pi-like` 默认 `false`，`legacy` 默认 `true`；类型覆盖优先于公共覆盖 |
| `border` | `none`、`single`、`double`、`round`、`bold`、`singleDouble`、`doubleSingle`、`classic`、`arrow`、`dashed` |
| `borderColor` | 主题键或显式颜色；有边框而未指定时用 `promptBorder` |
| `paddingX` | 左右各 0–8 列 |
| `paddingY` | 上下各 0–4 行 |
| `gap` | 在原有行间距上额外增加 0–4 行；`pi-like` 默认已为普通卡片保留一行呼吸空间（后台任务组内不保留），显式 `gap` 回到原有的「额外间距」加法语义并替换该下限，不会两者叠加 |
| `defaultExpanded` | 布尔值，仅上表支持的类型；不配置即继承原行为 |
| `previewLines` | 1–40，仅工具与流式思考；工具显式指定时同时覆盖文本/diff 预算，未设保留文本 3 行/diff 8 行 |
| `states` | 仅工具/子代理/后台任务，见下节 |
| `progressStyle` | `line` 或 `bar`；`common` 可写但只有 `job` 消费，见「Job 进度线」 |

数值取整并夹到范围；未知类型、非法字段丢弃，回落到方案值。颜色支持主题键、`#rgb`/`#rrggbb`、`rgb()`、`ansi256()`、`ansi:` 等已有主题格式。不要依赖 8 位 hex 的 alpha：终端不会据此半透明合成。

默认展开只是初始值；原有点击和 `Ctrl+O` 优先，默认展开的行点击可收起。`thinkingFold`、`jobGroupFold`、`foldTerminalCommand` 仍管理各自已有机制；不增加新的折叠交互。

## 状态标识与代码框

`pi-like` 的子代理与 workflow 成员使用单列状态标识：聊天卡片运行时为细小 braille spinner，列表中为点号；成功 `✓` 使用主题成功色，失败 `×` 使用错误色，取消/未知为灰色 `·`。侧栏、团队列表、详情页与转录加载提示采用同一套克制字形，状态文字仍保留；`legacy` 及用户/工具正文中的 emoji 不改。

回复中的 fenced 代码块在未显式配置 `codeFrameStyle` 时，`pi-like` 默认 `full`，`legacy` 默认 `light`。已有独立设置 `values.codeFrameStyle`（或部署行 `config.codeFrameStyle`）的显式 `light/full` 始终优先；用户与部署层均未设置时才跟随方案。它不是 `cardStyles` 内部字段。极窄终端保留原有无框 fallback；Edit 工具的专用 diff 视图不受这个代码框设置控制。

Powerline 的实时任务计数放在主 HUD 行；如果加入计数会令溢出区域增加一行，则省略该计数，避免任务开始/结束时挤动转录。完整任务仍可通过 `/jobs` 查看。

## 上下文通知卡

`pi-like` 的通用上下文通知采用左侧紫色细线、紫灰底：暗色真彩为 `#19151f`，浅色为 `#f3eef7`。标题显示通知来源；折叠时摘要独占下一行，展开时显示完整保存正文，不再重复摘要。它与用户卡、执行状态卡分开，不从消息中的 completed/failed 或退出码推导背景。256 色回退为中性灰阶，16 色只保留线条与标签。

可通过 `cardStyles.kinds.notice` 覆盖背景、边框、间距和内边距；`background: none` 取消底色，`border: none` 取消细线，指定常规边框则改为完整边框。legacy 默认保留原通知样式。这里只修改持久化通知的呈现，不改变模型接收消息、唤醒、持久化或任务状态。

## 执行状态底色

`pi-like` 默认在工具与子代理卡上区分执行中、成功、失败；后台任务默认透明，只有个人显式 `states` 时才涂状态底，原状态符号和文字照旧显示。已有状态在呈现边界映射，不修改会话事件或持久化数据。取消、停止、终止及未知状态使用普通卡面，不冒充成功或失败。

```json
{
  "preset": "pi-like",
  "common": {
    "border": "round",
    "borderColor": "promptBorder"
  },
  "kinds": {
    "tool": {
      "states": {
        "running": "toolCardBackgroundDim",
        "success": "#183321",
        "failure": "#3a2028"
      }
    }
  }
}
```

普通 `background` 与 `states` 独立：改普通底色不会关闭动态底色。`states.success: "none"` 表示成功时使用普通卡面；要完全无填充，需要同时设置 `background: "none"` 和三个状态为 `none`。

默认状态面是低对比、贴底的柔和色：暗色真彩盘三态都接近终端黑底——执行中 `#0d1013`（中性）、成功 `#0e1b14`（极淡灰绿）、失败 `#21161d`（极淡豆沙玫瑰），仍能靠一点色相分出状态；亮色盘的执行中仍是主题自己的中性面。成功/失败不是全灰，也不用饱和正红正绿。内置主题的真实渲染回归要求三态底色两两不同、默认正文对比至少 4.5:1，原状态符号和文字仍保留。真彩暗面的细阶只在真彩输出下可见，低色档的取舍见下。

| 色档 | 暗色主题 | 亮色主题 |
| --- | --- | --- |
| 真彩（逐通道色） | 执行中 `#0d1013`（中性近黑）；成功 `#0e1b14`（极淡灰绿）；失败 `#21161d`（极淡豆沙玫瑰） | 执行中=主题中性面；成功 `#e8efe9`（sage）；失败 `#f3e6ea`（rose） |
| 256 色 | 236 灰（执行中）/ 23 深青绿（成功）/ 95 豆沙玫瑰（失败） | 254 灰 / 151 sage / 181 rose |
| 16 色 | 黑（执行中）/ 蓝（成功）/ 红（失败） | 白 / 绿 / 亮红 |

真彩档按主题明暗使用上表的小色表。256 色档显式选择有色槽位，避免 RGB 量化把成功与失败压成同一色；但它**无法表达真彩里的近黑细阶**：暗色盘执行中仍是中性灰 `#303030`（236），成功是深青绿 23、失败是豆沙玫瑰 95，色差比真彩明显。16 色档使用可辨且可读的降级槽位，**不能呈现柔和色盘，也不保证成功底为绿色**。这些是色档能力限制，不代表三档看起来一样。真彩暗色三态使用固定近黑色表；仅有ANSI名字的暗色主题，其执行中仍回退中性槽位。亮色的执行中沿用主题中性面，无法取得该颜色时再退到色档槽位。对比验证以标准终端调色板为前提，用户重定义终端 0–15 色槽可能改变效果。显式 `states` 覆盖在任何色档都按用户给的颜色画，其区分度和可读性由用户负责。关闭颜色时保留原状态符号，不再有背景区分。

tmux 内在启动时自动查询当前 pane 所属会话的客户端能力：所有已连接客户端均报告 `RGB` 时保留检测到的真彩输出；存在不支持的客户端、没有连接客户端、查询失败或超时则保守降至 256 色。不修改 tmux 配置，也不要求支持 RGB 的正常会话额外设置环境变量。已有 `DSH_TUI_TMUX_TRUECOLOR=1` 仍可显式跳过该检查；`FORCE_COLOR=0/1/2` 保留用户指定的色档。能力结果在启动时确定，变化后需重启。

## Edit / diff 正文

`pi-like` 的预置卡面下，Edit 一类 diff 卡的呈现与 `legacy` 不同：卡头仍保留轻微的执行状态底，代码区（unified 正文与 split 双栏）回到 `useTerminalBackground()` 报的**终端实际底色**（选中/悬停时外层改用整行高亮底，见下），所以不再被整张状态面压暗。split 的增删行改铺自己的极淡衬底——新增灰绿、删除豆沙玫瑰，上下文行保持终端底；这层衬底在普通、选中与悬停三种状态下都保留，指针移上去不会丢掉增删行的区别。主体文字的语法高亮、解析、对齐与词级算法一行不改，不会把整行未改动的代码染成红绿。双栏的 changed 词继续加粗并保留语义色。unified 与 split 共用同一个小模块（`src/components/diffAppearance.ts`）的呈现数据；unified 与 16 色档没有行衬底，文字行为与上一轮相同（16 色档如实降级，只靠词色区分增删）。

只有真的带对比的正文才贴终端底：正文行里有 patch，或 old/new 对带旧文（`oldText !== null`）。新建文件的 `write` 全是 `+` 行、也没有语法高亮，贴底只会把卡面从每一行正文剥掉、卡头剩一条孤立色带，所以它和 `read`/`bash` 一样整卡保留卡面。

只对「`pi-like` + 当前生效面来自方案预置」启用：`legacy` 与当前生效的个人 `background`/`states` 面保持原样。选中/悬停时正文外层仍是整行真实的高亮底（选中 = `messageActionsBackground`，悬停 = `toolCardBackground`）：卡头、卡片粗 gutter 与上下文行由此保留 selection/hover 反馈，不被一块黑色子盒盖掉；split 的 changed 行继续铺各自的内容层衬底（与 legacy 的分层一致），所以增删区别一直在。changed 词始终按各自的衬底重挑可读槽位，不随高亮清空；上下文与其它未改动文本仍用原语法色，与未选中一致。

行衬底按「主题 diff 词色极少量混入实际终端底部」推导，没有新增配色表：真彩暗色终端约 `#101b13`（新增）/ `#201214`（删除），亮色终端是近白淡绿/淡玫瑰。256 色档直接发显式槽位——暗色 22/52（`#005f00` / `#5f0000`），亮色 151/181（sage / rose）——不再量化成 palette 59 一类的中灰；仅有 ANSI 名字的主题没有通道可混，真彩档也回落到同一组显式槽位。16 色档没有可用的极淡阶，衬底让回终端底，只用词色区分增删。词色按各自的实际底色挑：普通 unified 仍用主题的 `diffAddedWord`/`diffRemovedWord`（纯黑上约 5.03:1 / 5.92:1）；split 的 changed 词若压在行衬底上不足 4.5:1，只调整这一层词色——真彩档按同色相提亮/压深，256 色档暗底发浅绿/浅玫瑰槽位 194/224、亮底发 22/52。高亮底另算一层（用于 unified 的增删词，以及 16 色档没有行衬底的 split）：256 色档的暗高亮底会量化成 palette 59 一类中灰，主题词色压上去只有约 2.6/2.0:1（增/删），于是改用明确的 194/224；亮高亮底沿用 22/52；真彩档仍按真实高亮底把词色提亮/压深到 4.5:1。16 色档没有这些细阶，只能发终端自己的绿/红槽位，选中/悬停对比度取决于用户重定义的 0–15 色（回归只在默认深色盘上断言 ≥2:1，且高亮底与终端黑可能同槽）。真实渲染回归在 unified/split、oldText-newText 与 patch、上下文/changed 词上读实际单元格，要求增删行底不同且贴近黑/白、未改动 keyword/变量的实际前景与 legacy 逐格一致（等 cli-highlight 真正落色后再比较）、changed 词对各自行底达标、上下文行不染底、选中/悬停高亮仍可见；120 列双栏的选中与真实悬停回归还要求 old/new 行底始终不同、卡头/粗 gutter/上下文保留反馈、移出后内容衬底仍在，并保留 legacy 原 fg/bg 与显式覆盖。

## Job 进度线

`kinds.job.progressStyle` 只控制**对话里的后台任务卡**：`pi-like` 默认
`line`，`legacy` 默认 `bar`；显式配置优先，非法值回落方案默认。`line` 是细线 + 弱化余段 + producer 原始的 `n/m` 计数：没有背景填充、没有块状字符、不额外显示百分比；颜色只表示比例（前 1/3 主题 `accent`、中段 `ide`、后段 `success`），细线与计数使用同一阶段色，不把低进度染成失败红，也不改变 job 的状态符号或领域事实。它不是 `n/m`（自由文本、`0/0`、溢出的数字）时原文透传，不编造进度；超过总数只夹视觉比例，计数照旧。header 仍占原来的固定窄槽：计数长了先缩短细线，连两格都不够就只留计数——只留计数时仍按可解析的比例取阶段色——并按槽宽截断，不把标题/基础字段挤到换行。

```json
{
  "preset": "pi-like",
  "kinds": {
    "job": { "progressStyle": "bar" }
  }
}
```

`line` 只属于对话任务卡；共享的 `/jobs` 面板不传这个参数，任何方案下仍是原块状 `bar`，`legacy` 的对话卡也保持原样。切换方案不会清掉这个覆盖。

## 用户卡面与终端底色

`pi-like` 的用户卡面（用户消息与团队消息同一份配置）跟着**终端实际底色**走：默认面把当前主题的正文色按约 12% 混在实际终端背景上，让用户消息有可辨的柔和衬底，便于定位（终端没有真实 alpha，这是实色而非半透明）。深色主题的正文色更亮，于是极轻提亮；浅色主题极轻压暗。终端底色取 `ThemeProvider` 已有的 `useTerminalBackground()`：OSC 11 的回答，缺失时按主题明暗取纯黑/纯白，探测结果可用且与主题明暗相容时，随实际终端底色轻微变化；强制/手选主题、背景未探测到，或探测结果与主题明暗不符而被丢弃时，既有黑/白回退不能保证贴底体感。

用户输入文字默认仍用 `userPromptLabel`，`pi-like` 不加粗；可通过 `kinds.user.foreground` 和 `kinds.user.bold` 覆盖，例如 `"user": { "foreground": "userPromptLabel", "bold": false }`。现有 `background`、边框与内边距配置继续有效；团队消息共享卡面但保留自己的发送者文字样式。

它不借悬停或选中高亮（`userMessageBackgroundHover` 在 `dark` 是 #3B5BDB 高饱和蓝，`messageActionsBackground` 是选中反馈）：选中反馈仍优先，选中的卡片照旧用原选中色，与卡面可分辨。

低色档没有这么淡的底可用，按同一「可辨且可读」的取舍降级：

| 色档 | 用户卡面默认底 |
| --- | --- |
| 真彩（逐通道色） | 终端底色与正文色约 12% 的实色混色，深色底上约 `#1c1c1b`，保留柔和但可辨的区别 |
| 256 色 | 与该混色最近的中性灰阶槽位（232–255）；近白取到 255（#eeeeee），近黑取到 232 |
| 16 色 / 关闭颜色 | 不填充 |

256 色档不走 6×6×6 量化：那一档会把近黑或近白的实色抬成一整块 `#5f5f5f` 级别的灰（`rgb(30,30,34)` 会落到 palette 59），所以显式发终端自己的灰阶，仍无色相。16 色档呈现不了这么淡的底，铺一块饱和色离「近透明」更远，所以这一档的默认用户面不填充，布局（卡片间呼吸行与原有缩进）照旧。仅有 ANSI 名的主题（`dark-ansi`、`pink-ansi`）没有通道可混，真彩档也按 256 色槽位绘制。显式 `background` 不是预置面：任何色档都原样绘制，不被替换。

## 回退与维护

要完整恢复旧外观，删除用户和部署层的 `cardStyles`，或将生效对象设为 `{ "preset": "legacy" }`（不要留 `common`/`kinds` 覆盖）。不需要迁移会话数据。

下游逻辑集中于 `src/cardStyles.ts`、`src/components/cardSurface.tsx`、`src/components/diffAppearance.ts` 与 `src/components/Chat/JobLineProgress.tsx`。各卡片只接入表面属性、内容宽度作用域、diff 呈现数据、进度样式与原折叠接缝；投影、diff 解析/算法及交互面板未改。上游更新后复跑：

```sh
node --import tsx/esm scripts/downstream/verify-card-styles.ts
node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
FORCE_COLOR=2 node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
FORCE_COLOR=1 node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
node --import tsx/esm scripts/downstream/verify-card-demo.tsx
```

真实布局回归覆盖 `MessageList` 与体验入口共用同一份场景（`verify-card-demo.tsx` 检查正文可见与滚动无空白带）；颜色矩阵读取终端单元格，不仅比较配置字符串。开发用的无凭据体验入口：

```sh
node --import tsx/esm scripts/downstream/card-styles-demo.tsx --width 40
# inline 或自定义用户配置文件：
node --import tsx/esm scripts/downstream/card-styles-demo.tsx --inline --settings scripts/downstream/fixtures/card-styles.settings.json
```

体验脚本自行隔离 HOME，使用 `auto` 主题按终端背景选择明暗；终端不回答背景探测时回退深色。它在动态加载 UI 之前用 `DSH_TUI_TMUX_TRUECOLOR ??= '1'` 显式保留真彩暗面的细阶；显式 `FORCE_COLOR=2/1` 仍照常降级。正常应用自动检测 tmux 客户端能力，规则见上文。它不调用后端，不影响稳定安装。`Alt+1/2/3` 切换旧版/新方案/边框覆盖；提供 `--settings` 时 `Alt+4` 回到文件方案；`Alt+o` 全展开，方向键或 `j/k` 滚动，`Ctrl+C` 退出。需要真实 TTY。
