# 输入区域

在 `/settings` → **底栏设置** → **输入区域风格**选择 `powerline`；出厂仍为 `native`。
极简界面保持原生。切换风格不清空草稿或重置光标。消息卡片和侧栏不变。

HUD 融入顶边，最后一行输入与圆角底边共用一行。工作行上下各留一空行，空闲时三行一起撤下；
输入框下方保留一空行，再放溢出字段。详情悬停按需浮现，不另占固定提示行。
未设置 HUD 位置时，原生在框下、Powerline 融入顶边；明确选 `below` 则状态行位于框下。

## 订阅窗口随模型显示

以下省略图标和其他字段；这是展示形式，不是账户余额或真实样例金额：

```text
DeepSeek: deepseek-flash:high
Codex:   gpt-5:high week:80% (6d)
Claude:  claude-sonnet-4-5:high 5h:80% (2h) week:24% (6d)
```

依据是会话后端及其上报数据，不靠模型名猜订阅身份。Codex 只显示周窗口；Claude 显示五小时、周窗口，缺失的窗口不占位；其他后端不显示这些订阅窗口。
剩余百分比四舍五入后：低于 10 红、低于 25 黄、其余绿；括号内重置时间淡显。
倒计时向上取整为 m/h/d，小于一分钟显示 `now`，每分钟刷新文字，不联网轮询，也不因到期自行补满额度。
悬停模型段可看原有模型信息、窗口用量和完整本地重置日期。

订阅数据与名称/强度共用**一个不可拆分字段**，随模型段一起溢出或隐藏，不依赖费用开关。
此前独立的 `quota` 字段不再使用；`left/right` 里应保留 `model`。没有上报数据时不造数。
数据仍由宿主提供；没有新增登录、账户请求或费用/币种换算。原始秒时间戳在原生适配器转换为毫秒，不在 UI 猜测单位。

## 模型图标

出厂未配置时用通用 ``。离线演示按用户确认采用 DeepSeek ◆、GPT ◉、Claude ✳ 自定义映射；它们是演示配置，不是官方品牌图标或出厂默认。
在 **Powerline 外观选项**的现有 JSON 中合入 `modelIcons`，例如以下仅示意语法的自定义项：

```json
{"icons":"nerd","modelIcons":[{"pattern":"^my-model$","icon":"M"}]}
```

按模型 **ID** 而非显示别名做不区分大小写的正则匹配，首个匹配生效，未匹配仍用通用图标。
Nerd 模式支持安全的 1–8 显示单元配置；每个图标和 fallback 后只加一格间隔，布局按各自显示宽度计预算，不因其他规则更宽而补空格，也不强求模型名称同列。
裸单符号 `✳` 等明确为 emoji 呈现（VS16），不让字体自行在一/两格之间选择；显式选择符保留。
ASCII 模式统一为 `model`，none 模式隐藏图标。真实字体仍需人工确认；显式 VS15、ZWJ/复杂组合及东亚模糊宽度不承诺跨终端完全一致。

## 布局和其他覆盖

外观选项保存**部分覆盖**；未填值继续跟随预设，留空恢复预设。非法已知样式拒绝保存；手改文件的非法项安全回落。
原生 **HUD 字段顺序 / HUD 分隔符 / 紧凑状态栏 / 上下文进度条**不控制 Powerline。原有显隐、插件名单和危险权限提示保留。

```json
{"left":["marker","model","context","cost","cwd","git","plugins"],"right":["agent"],"icons":"ascii","separator":"|","padding":1,"secondaryOverflow":"drop","path":"basename","context":"full"}
```

先预留右组，再按左组顺序放入完整字段。默认 `drop` 在首个溢出行遇到不适合的字段就停止，`wrap` 继续换行（`maxRows` 1–32）；字段过宽不强行缩小。
`padding` 为每组两侧 HUD 留白（0–8），不是每字段留白。路径为 `basename/abbreviated/full`，上下文为 `full/percent`；阈值默认严格超过 70/90 黄/红。
`modelColors` 是首个匹配的颜色规则，提供列表会替换预设；高强度静态彩虹可由 `colors.thinking` 覆盖。
`colors` 支持宿主颜色格式，键为 `marker/model/path/gitClean/gitDirty/context/warning/error/separator/border/cost/thinking/plugin/agent/quota`；`quota` 为健康剩余额度色，默认 success，低余额用 warning/error。
可选字段 `tokens/cache/tps/sessionTitle/sessionId` 还须开启对应原生开关；缺失的 Shell/Agent 不占位。
插件字段保留槽位、语义色、详情、点击和生命周期，富视图保留独立区域，不解析插件文字推算指标。
工作行 Token 计数默认关闭。Git 缓存只读，失败不伪装成干净。

恢复原生只需选择 `native`，无需删除覆盖。
