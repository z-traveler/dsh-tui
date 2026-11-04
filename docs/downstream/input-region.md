# Input region / 输入区域

## 中文

在 `/settings` → **底栏设置** → **输入区域风格**选择 `powerline`；出厂仍为 `native`。
极简界面始终使用原生布局。切换风格不清空草稿或重置光标。

Powerline 将 HUD 融入输入框顶边，最后一行输入与圆角底边共用一行。
主行放不下的完整字段移到输入框下方，默认第二行遇到首个放不下的字段就停止。
工作时在 HUD 上方显示一行紧凑阶段、耗时和中断提示，其前留一空行；空闲时一起撤下。
详情悬停按需浮现，不预留空白提示行。消息卡片和侧栏不变。

- **HUD 位置**：未设置时，原生在框下，Powerline 融入顶边；明确选择 `below` 时，Powerline 状态行位于框下。
- **Powerline 外观选项**：填写部分 JSON 覆盖，未填写的值继续跟随预设；留空恢复预设。非法已知样式在设置页拒绝保存；手改文件的非法值安全回落。
- 原生的 **HUD 字段顺序 / HUD 分隔符 / 紧凑布局 / 上下文进度条**不控制 Powerline；改用下列选项。原有字段显示开关、插件名单、危险权限提示仍有效。
- **工作状态行 Token 计数**：默认关闭，仅影响 Powerline；开启显示原有宿主输入计数和输出估算。

```json
{
  "left": ["marker", "model", "context", "cost", "cwd", "git", "plugins"],
  "right": ["agent"],
  "icons": "ascii",
  "separator": "|",
  "padding": 1,
  "secondaryOverflow": "drop",
  "path": "basename",
  "context": "full"
}
```

`left/right` 同时决定显隐和顺序；可选附加字段为 `tokens/cache/tps/sessionTitle/sessionId`，
仍须打开对应原生开关。模型与强度始终作为一个完整字段。没有真实数据的 Shell/Agent 不占位。
`plugins` 表示插件左槽；插件右槽仍保留在右组。插件文字不参与指标推算，富视图保留独立区域。

其他覆盖：`icons` 为 `nerd/ascii/none`；`path` 为 `basename/abbreviated/full`；
`context` 为 `full/percent`；`secondaryOverflow` 为 `drop/wrap`，`maxRows` 限制溢出行数（1–32）。
`padding` 是每组两侧的 HUD 留白（0–8），不是每个字段的留白。无法完整放入一行的字段不强行缩小。
`marker` 默认 `🐋`。`warnPercent/errorPercent` 默认 70/90，严格超过阈值才警告。
`colors` 支持主题色名及宿主已有颜色格式，键为
`marker/model/path/gitClean/gitDirty/context/warning/error/separator/border/cost/thinking/plugin/agent`。
`modelColors` 是按顺序匹配的 `[{"pattern":"deepseek","color":"#6e9bc5"}]`；提供该列表会替换预设规则。
高强度默认静态逐字彩虹；设置 `colors.thinking` 为其他颜色可统一覆盖。
费用及上下文来源沿用宿主，没有新增币种换算或计费。Git 只读查询本地状态，失败不显示伪造的干净状态。

恢复原生只需选择 `native`，无需删除 Powerline 配置。隔离体验和验证记录见
[本地交付指南](../../.scratch/hud/delivery.md)。

## English

Choose **Input region style → powerline** under `/settings` → **Status bar**.
The factory default remains `native`; Minimal UI always uses native presentation.
The style switch preserves the draft and cursor. Powerline fuses the HUD into the top edge and
shares the bottom edge with the final editor row. Whole fields overflow below the editor;
`drop` stops at the first non-fitting field on the second row, while `wrap` continues on bounded rows.
A compact working row and its preceding blank row disappear together when idle.
Hover details float without reserving an empty footer row. Cards and sidebars are unchanged.

The JSON above is a **partial override**, not a preset snapshot. Empty settings restore the preset.
`left/right` control visibility/order; the existing per-field switches still apply.
Native `order/separator/compact/contextBar` do not control Powerline. Unset placement means native
below / Powerline fused above; explicit `below` puts the styled row below the frame.
`padding` applies around each HUD group, not each field. Optional fields, color keys, enum values
and numeric bounds are listed above using their exact configuration names.

Model and effort remain indivisible. Missing Shell/Agent data is not fabricated. Plugin slots,
semantic tones, callbacks, details and lifetime remain host-owned; rich views stay separate.
Model colors use first-match regex rules; supplying `modelColors` replaces the defaults.
The strongest effort uses static rainbow text unless `colors.thinking` overrides it.
Costs and usage retain host accounting; local Git queries are cached, read-only and never report
an unavailable repository as clean. **Working-line token counters** are off by default.
Choose `native` to recover the original presentation without deleting overrides.
