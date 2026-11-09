# 01 配置与样式契约
Type: implementation
Status: resolved
Blocked by: none

## Scope
落实 ../spec.md 的文件配置、legacy/pi-like、公共与类型覆盖、已有状态映射契约，使用现有配置接缝；样式逻辑集中独立模块。不要改交互表面或添加 /settings 控件。

## Acceptance
配置可经真实 settings.json 读取/部署配置链到 UI 可用配置；legacy 默认无覆盖不改变旧值；方案切换保留覆盖；颜色可跟主题；坏配置按现有约定处理；为后继卡片接入提供明确类型与宽度收窄方式。已有折叠属性纳入配置契约。

## Verification
先添加可执行聚焦测试并记录 red/green；必要类型编译。后续票补全真实卡片呈现验证。

## Comments
Worker 只写实现及测试，不更新本票状态；主代理审查后更新。无 commit/push 权限。

## Answer
配置契约已集成到本工作树的未提交改动。主代理复跑 scripts/downstream/verify-card-styles.ts：17/17；git diff --check 通过。独立审查首次 block（主题三态塌陷、折叠默认写死），修复后复审 OK with notes。实现 src/cardStyles.ts；真实 settings.json 和 Config 接缝测试通过。已知：ANSI 状态底为满强度色，票 02 需验证文字对比；job defaultExpanded 在未单独切换时优先于 jobGroupFold 的初始展开策略，用户操作仍优先。
