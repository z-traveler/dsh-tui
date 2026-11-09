# 06 Diff增删行衬底与细线进度
Type: implementation
Status: resolved
Blocked by: 05

## Source / decisions
用户认为pi-like Edit不如legacy的-/+行区分；确认恢复新增/删除的不同淡行底色，主体文字保持原版语法高亮，不额外整行染红绿，原有修改词强调保留。双栏是这项反馈的主要路径；窄屏统一视图沿用原文字行为，不增加染色算法。
用户选择细线进度，并允许按进度着不同色。新形式为pi-like对话job卡默认，可文件配置切回当前bar；legacy和/jobs面板保持原样，非对话交互表面不扩范围。

## Acceptance
1. pi-like split增删行恢复可辨极淡衬底：新增灰绿、删除豆沙玫瑰；暗色贴近黑，context贴终端底。语法色/解析/对齐/词级真源算法不动，不把未改动的代码全文染红绿。当前选中/hover反馈与可读性保留，不能鼠标移上去就丢增删行区别。
2. 原legacy diff前景/背景/hover、个人生效背景/状态覆盖均不变。保持统一diff原增删文字、折叠及小终端布局行为，避免再建一套diff渲染器。
3. 新配置 cardStyles.kinds.job.progressStyle = line | bar；pi-like默认line，legacy默认bar；明确配置优先，非法值回落方案默认。仅对话job卡消费新默认，共享JobProgress未传参数仍bar，/jobs面板不动。
4. line用细线/弱化余段/计数，不用块状字符和背景填充；低/中/高进度复用主题accent/ide/success，颜色只表达比例，不改job状态；不把低进度染失败红，不额外加百分比。计数源仍producer progress字符串；无效/非n/m时保留原文，无伪造进度。
5. 字段宽度不撑开header，保持原计数/进度槽位的紧凑与透明。0/中间/满/超过总数/总数0/自由文本及窄屏有验证。动态切style和同一job的进度更新实际反映在真实卡片（含分组），不维护第二份progress状态。

## Verification
先加当前实现会红的真实单元格回归（line两侧bg可区分、语法色原样、word局部强调、progress无块/背景、ratio变色/配置回切bar）；再最小接入与实现。复用现有进度/JobCard/主题/配置通路；不改后端/持久化/renderer，不新增依赖/公共配置框架。定向编译、卡片/diff/progress旧回归、真彩/256/16能力降级、共用demo与真实PTY验收、独立审查，更新delivery。发布与稳定安装另需用户授权。

## Answer
已实现并通过配置、三档真实渲染、SGR 悬停、进度动态更新及整合回归。增删行衬底在选中/hover 时保留，主体语法色与 legacy 一致；细线与有效计数同阶段色，分组进度更新复用既有 jobsSig 缓存输入，无第二份状态。独立审查与用户人工验收通过；用户已授权合并推送及私有发布，未授权安装。完整证据与发布门禁见 ../delivery.md。
