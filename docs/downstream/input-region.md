# 输入区域

你可以在 `/settings` → **底栏设置** → **输入区域风格** 中选择 `powerline`；出厂默认仍为 `native` 原生风格。极简界面保持原生样式。切换风格不会清空草稿或重置光标，消息卡片和侧栏也都不受影响。

在 `powerline` 风格下，状态栏（HUD）会融入输入框的顶边，最后一行输入内容与圆角底边共用同一行。运行状态行上下各留一空行，空闲时这三行会一起收起；输入框下方保留一空行后再放置溢出字段。悬停在对应字段上时，详情浮层按需出现，不额外占用固定提示行。当未显式设置 HUD 位置时，原生风格放在输入框下方，`powerline` 则融入顶边；如果明确选择了 `below`，状态行统一位于输入框下方。

## 订阅窗口随模型显示

下面仅示意展示形态，省略了图标与其他字段，不代表真实账户余额或样例数值：

```text
DeepSeek: deepseek-flash:high
Codex:   gpt-5:high week:80% (6d)
Claude:  claude-sonnet-4-5:high 5h:80% (2h) week:24% (6d)
```

展示规则如下：

- **数据驱动**：依据是后端提供的规范化窗口数据，不靠模型名字去猜测订阅类型。原生 Codex 只显示周窗口，Claude 显示五小时和周窗口；DSH 的订阅通道可通过可选的[额度能力](subscription-quota.md)提供窗口数据。没有数据的后端不显示额度，缺失的窗口也不占位。
- **颜色与倒计时**：剩余百分比四舍五入后，低于 10 显示红色、低于 25 显示黄色、其余显示绿色；括号内的重置时间用淡色显示。倒计时向上取整为 `m`/`h`/`d`，不足一分钟显示 `now`。界面每分钟刷新一次倒计时文字，但不会发起网络轮询，也不会在倒计时归零时自行把额度补满。
- **悬停详情**：悬停在模型字段上可以查看原有的模型信息、窗口用量以及完整的本地重置日期时间。
- **字段归属**：订阅数据与模型名称/推理强度共用**一个不可拆分的字段**，空间不足时随模型字段一起溢出或隐藏，且不依赖费用开关。早先独立的 `quota` 字段已弃用，配置里的 `left`/`right` 应保留 `model`。没有上报数据时界面不造数；额度查询在 DSH 的 provider 内完成，不新增登录流程，也不做费用或币种换算。时间戳由生产者统一规范化为毫秒，UI 端不做单位猜测。

## 插件状态字段多段语义色

插件可以在同一个 `tuiStatus.setField` 字段中提供多段文本及语义色，原生与 Powerline 状态栏都会按段显示。旧宿主会静默忽略未知的 `segments` 选项；需要多色的插件必须先检查版本探针：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { TuiStatusFieldSegment } from '@deepseek-harness-tui/dsh-tui/api'

export const inject = ['tuiStatus']
export function apply(ctx: Context) {
  if (ctx.tuiStatus.fieldSegmentsVersion !== 1) {
    throw new Error('This plugin requires status field segments v1')
  }
  const segments: readonly TuiStatusFieldSegment[] = [
    { text: 'API', tone: 'accent' },
    { text: ' · ' },
    { text: '42%', tone: 'success' },
  ]
  ctx.tuiStatus.setField('example:status', 'API · 42%', {
    tone: 'dim', maxCells: 32, segments,
  })
}
```

- `segments` 为 1–8 个 `{ text, tone? }`；`tone` 使用现有的 `dim`、`accent`、`success`、`warning`、`error`，省略时继承字段的 `tone`。分段只影响着色，不会拆分字段或在 Powerline 段间插入分隔符。
- 字段与各段均清除不安全控制符、ANSI 和 bidi 标记并折叠空白；段内或段间有意保留的空格可分配给对应段，但只裁剪整串的首尾空白。清洗后的分段拼接必须与未截断的字段文本完全相同；分段边界不得切开字素（例如 ZWJ emoji、旗帜或组合字符），且各段宽度之和必须等于整串宽度。不符合任一条件时拒绝写入并警告。
- 所有段共享字段的终端列宽上限（默认 16，范围 1–32）；截断结果及省略号与普通字段一致。宿主冻结规范化的段数组和段对象，更新字段时必须重新传入 `segments`；省略或显式设为 `undefined` 会清除旧分段，其他选项仍按原有规则继承。

回归验证（运行前先安装依赖并执行 `pnpm build`）：

```sh
pnpm run verify:status-fields
node --import tsx/esm scripts/downstream/verify-status-field-segments.tsx
node --import tsx/esm scripts/downstream/verify-powerline-input.tsx
```

## 模型图标

未做额外配置时，默认使用通用图标 ``。离线演示脚本中按确认使用了 `DeepSeek ◆`、`GPT ◉`、`Claude ✳` 这组自定义映射，请注意它们只是演示配置，并非官方品牌图标或出厂默认值。

你可以在 **Powerline 外观选项**的现有 JSON 中合入 `modelIcons` 字段，下面仅作语法示意：

```json
{"icons":"nerd","modelIcons":[{"pattern":"^my-model$","icon":"M"}]}
```

匹配与宽度规则：

- 按模型 **ID**（而非显示别名）做不区分大小写的正则匹配，第一条命中的规则生效；未命中任何规则时仍使用通用图标。
- `nerd` 模式下支持安全的 1–8 显示单元宽度配置。每个图标及默认图标后面只加 1 个空格，布局时按各自的显示宽度计算预算，不会因为其他规则更宽而补齐空格，也不强制模型名称纵向对齐。
- 裸单符号（如 `✳`）会明确以 emoji 形式（VS16）渲染，避免字体自行在 1 格或 2 格宽度之间摇摆；已显式带有的选择符会保留。
- `ascii` 模式下统一显示 `model`，`none` 模式下隐藏图标。实际渲染效果取决于终端字体，显式 VS15、ZWJ/复杂组合字符以及东亚模糊宽度字符不承诺跨终端完全一致。

## 布局和其他覆盖

外观选项保存的是**部分覆盖配置**：未填写的字段继续跟随当前预设，留空即可恢复预设。界面拒绝保存非法的已知样式；如果是手工改坏了配置文件，非法项会在加载时安全回退到默认值。

原生的 **HUD 字段顺序 / HUD 分隔符 / 紧凑状态栏 / 上下文进度条** 这些设置不会控制 Powerline。原有的显隐开关、插件名单和危险权限提示则继续保留。

配置示例：

```json
{"left":["marker","model","context","cost","cwd","git","plugins"],"right":["agent"],"icons":"ascii","separator":"|","padding":1,"secondaryOverflow":"drop","path":"basename","context":"full"}
```

具体布局与字段规则：

- **左右分组与溢出**：先为 `right` 组预留空间，再按 `left` 组的顺序逐个放入完整字段。默认的 `secondaryOverflow: "drop"` 会在首个溢出行遇到放不下的字段时停止继续添加；设为 `"wrap"` 则允许继续换行（`maxRows` 范围为 1–32）。单个字段过宽时不会强行压缩。
- **边距与格式**：`padding`（0–8）控制整行 HUD 左右两侧的留白，而不是每个字段的间距。`path` 可选 `basename`/`abbreviated`/`full`；`context` 可选 `full`/`percent`，上下文警告/错误阈值默认严格大于 70% 变黄、大于 90% 变红。
- **目录追踪**：目录字段及悬停详情跟随后端上报的当前工作目录；未发生目录切换时保留工作区显示名称。切换当前目录不会改变会话原本的项目归属。
- **颜色规则**：`modelColors` 按首次匹配原则生效，只要提供了列表就会整体替换预设颜色规则；高推理强度的静态彩虹效果可通过 `colors.thinking` 覆盖。`colors` 支持所有宿主颜色格式，可用键为 `marker`、`model`、`path`、`gitClean`、`gitDirty`、`context`、`warning`、`error`、`separator`、`border`、`cost`、`thinking`、`plugin`、`agent`、`quota`（其中 `quota` 表示健康的剩余额度颜色，默认 `success`，低余额时改用 `warning`/`error`）。
- **可选字段与插件**：`tokens`/`cache`/`tps`/`sessionTitle`/`sessionId` 这些可选字段还需要开启对应的原生开关才会显示；没有 Shell 或 Agent 信息时不占位置。插件字段保留原有的槽位、语义色、详情、点击和生命周期，富视图也保留独立展示区，不会去解析插件文本来反推指标。
- **其他细节**：工作行的 Token 计数默认关闭。Git 缓存只读，读取失败时不会假装仓库是干净的。

如果想切回原生样式，只需在设置中选择 `native`，无需删除任何自定义覆盖配置。
