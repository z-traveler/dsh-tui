# 本机参考：订阅窗口与模型图标

本次直接读取本机实际扩展与主题，不运行额度获取逻辑、不读取凭据。实现来源：
`~/.pi/agent/git/github.com/z-traveler/pi-powerline-footer/`。

- `segments.ts:87–129`：订阅窗口属于 model 段，紧跟名称/强度。OpenAI/Codex 只显示 `week:80% (6d)`；Claude 订阅依次显示 `5h:80% (2h) week:24% (6d)`。其他提供方不显示这些窗口。
- `segments.ts:121–125`：剩余百分比四舍五入后，低于 10 为 error，低于 25 为 warning，其余 success。只给额度上色，括号重置时间淡显。
- `weekly-quota.ts:177–184`：小于一分钟为 `now`；分钟/小时/天向上取整，分别如 `20m`、`5h`、`6d`。重置时不会据此把额度填满。
- `icons.ts:56–58, getIcons()`：内置 Nerd 模型图标统一为 `\uEC19`，主题可覆盖；不是按模型品牌自动选择。
- 当前 `~/.pi/agent/extensions/powerline-footer/theme.json` 只覆盖三类模型颜色，没有 ◆/◉/✳ 映射。那些字符是 DSH 离线演示的自定义样例，用户已允许保留；须统一图标槽位，不能充作参考自带或官方品牌图标。

DSH 对齐的是这些展示规则，数据仍来自现有 Channel 的订阅窗口。Codex/Claude 原始窗口时间均为 epoch 秒，经原生适配器后 Channel 视图统一为 epoch 毫秒，不能把参考扩展接收秒的格式化函数直接用于该视图；不复制参考扩展的登录、凭据读取或网络请求代码。
每模型图标覆盖是用户额外要求，保留配置能力；演示的 ◆/◉/✳ 作为用户认可的覆盖配置，不改变出厂 fallback；不同宽度的自定义图标按统一显示单元槽位处理。
