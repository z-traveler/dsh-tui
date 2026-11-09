# 03 隔离体验与交付
Type: verification
Status: resolved
Blocked by: 02

## Scope / Acceptance
完成 ../spec.md 的隔离无凭据 fixture 体验入口（inline/fullscreen/窄屏）、定向验证、独立全改动审查、必要修复和 docs/downstream 长期配置说明；依据 go-delivery 规范编写 ../delivery.md。逐条记录自动证据与人工验收路径；不得把未运行说成通过。

## Verification
集成工作树 compile、聚焦新旧回归、git diff --check。独立只读审查无阻塞。保留安全体验入口。发布全量门禁与稳定安装不在权限范围。

## Comments
无 commit/push 权限；实现以 feature/card-styles 的未提交改动交付。

## Answer
主代理完成定向编译/回归与最终三档颜色矩阵（各183 PASS）、隔离HOME的PTY四场景和文件配置demo入口。长期双语说明 docs/downstream/card-styles{,.en}.md，验收样例 settings.example.json，交付 delivery.md。全改动独立审查 pass，缓存/间隔修复和折叠组头最后一行另经复审 pass，无阻塞项。发布全量门禁/Actions、真实DSH会话人工验收及Windows未跑，均已披露；自动PTY不冒充用户亲自观感。未改稳定工作树/安装，未提交/推送。

后续用户配色反馈：pi-like 默认改为主题中性雾灰面+12%淡状态色，256色改相邻灰阶；16色保留受限降级。配置回归增至20项，主代理最新真彩/256/16色真实渲染185/193/183项通过，compile与diffcheck通过。自定义hex/混合色声明复用既有parseFixedColor，无法混色时回落柔和灰阶；个人覆盖不变。配色窄改及后续边角修复独立复审pass，最新三档证据保存在evidence/soft-*.txt。

用户消息近透明反馈已落实：默认用户/团队消息不借hover蓝色，使用既有终端背景混入3.5%正文色；256色最近灰阶，16色用户面无填充，显式覆盖与legacy不变。主代理compile、23配置回归、真彩/256/16渲染194/202/192项和PTY四场景通过。demo改为auto主题，inline30专门应答白色OSC11以验证浅色背景路径；文档披露ThemeProvider黑/白回退限制。实现及最后体验入口/文档复核PASS，无提交/推送/安装变更。
