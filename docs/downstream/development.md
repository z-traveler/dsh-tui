# 下游开发流程

本页规定私有下游从需求到合入 `z`、再到跟进上游的流程。补丁、分支命名与上游同步的通用约束见工作区 `../AGENTS.md`；制包、安装与回退见[发布流程](release.md)。

## 分支与提交

- `main` 只镜像上游，`z` 是稳定分支，发布标签只打在 `z` 上。主检出 `dsh-tui/` 固定停在 `z`，只用于查看和发布核对，不在其中开发，也不留未提交改动。
- `z` 是上游稳定标签之上的一串功能提交，每个功能一个提交，提交信息使用 conventional 前缀。功能清单见 [README.md](README.md)。
- 新需求从最新 `z` 建 `feature/<功能>` 分支，并在工作区 `.worktree/dsh-tui/<功能>/` 建对应工作树；同一需求只用这一个分支，不另开串联分支。
- 合入前把功能分支整理好：修改已有功能时，将改动并入该功能在 `z` 上的提交（`git commit --fixup` 后 `rebase --autosquash`）；新功能整理为一个提交。整理后 rebase 到最新 `z` 并以 fast-forward 合入，`z` 不产生 merge 提交。改写 `z` 后用 `--force-with-lease` 推送。
- `z` 顶端已打发布标签后，改动以新提交追加在顶端，不改写已发布的历史，以免标签脱离 `z`；这些提交在下次跟进上游时再并入对应功能提交。
- 交付完成后移除工作树和已合入的分支。

## 需求与记录

- `.scratch/` 是不入库的本地工作区，存放规格、工单、交付记录与验收产出；格式见 [issue-tracker.md](../agents/issue-tracker.md)。其中的内容不作为长期依据。
- 需要长期保留的内容在合入前写进仓库：功能说明、接口契约与验证命令写入 `docs/downstream/<功能>.md` 并更新 [README.md](README.md) 的功能表；跨任务有效的设计决策写 `docs/adr/`；术语写根目录 `GLOSSARY.md`。可复用的演示配置放 `scripts/downstream/fixtures/`。
- 下游文档只用中文，不写本机绝对路径、工作树路径、提交 SHA、CI run 或验收过程。
- 上游 README、`AGENTS.md` 上游部分、`docs/` 与 `guide/` 下的上游手册不写下游功能；上游贡献指南中“同步 README 与用户手册”的要求不适用于下游功能。

## 实现

- 业务插件需要的 TUI 能力（卡片、输入补全、浮窗、会话与外部集成接缝）在本仓以通用接口实现，业务规则、数据与计算留在业务插件。
- 新逻辑放进独立模块，上游文件只加调用点和配置声明；不复制上游组件。
- 新增的外观与布局默认保持上游行为，通过配置启用。卡片类改动须同时适配 `legacy` 与 `pi-like` 卡面。
- 代码、注释、标识符与测试名不提及 Pi 等外部参照；参照来源只写在文档中。
- 读取未在 `inject` 中声明的可选 Cordis 服务用 `ctx.get('<服务>')` 探测；直接读 `ctx.<服务>` 会在该服务已注册时抛错，导致启动失败。测试须覆盖「服务已注册、但调用方激活未注入」的情形。

## 验证与验收

1. **定向验证**：运行改动面相关的 `scripts/downstream/verify-*` 与上游聚焦脚本，加上必要编译；不逐次跑全量。改动 `channel/`、`dsh-adapter/` 等共享路径时，另跑包含它的 CI 回归分组（`node scripts/run-ci-group.mjs <组> --shard <n>/<总数>`）：上游测试常用最小假宿主调用这些路径，定向脚本覆盖不到。
2. **可见效果**：终端可见改动用 `scripts/downstream/*-demo.tsx` 的固定演示场景核对。演示默认使用 `pi-like` 卡面和中文内容，覆盖多实例、更新、失败、窄屏，以及 inline 与 fullscreen 两种模式。演示与真实运行不一致时，先查明是演示问题还是实现问题。
3. **真实环境**：用户要求真实环境验收时，`node scripts/downstream/run-local-dst.mjs` 编译仓库代码，临时挂载到正式 `dsh-tui` profile 并沿用其凭据与会话，退出时恢复原包。运行期间不要用同一 profile 再启动 TUI。
4. **交付入口**：交给用户的命令先由 agent 原样运行，确认启动无报错、功能可见，并说明要操作什么、观察什么。
5. **收尾**：用户验收通过后只修阻塞问题，整理提交并合入 `z`，再按发布流程制包；发布 CI 运行全量门禁。

## 跟进上游

1. 从 `z` 建候选分支与工作树，`git rebase --onto <上游稳定标签> <当前基线标签>`。冲突集中在 [README.md](README.md) 列出的上游接入点；解决时同时保留上游与下游意图，已被上游实现的下游改动直接删除。
2. 用 `git range-diff` 逐个核对新旧功能提交。
3. 编译、typecheck，运行全部 `scripts/downstream/verify-*` 及冲突文件相关的上游脚本；共享渲染或 `Chat` 有冲突时补跑上游 CI 回归。
4. 通过后推进 `z`，同时把 `main` fast-forward 到上游并推送。

上游标签用 `git fetch upstream --tags` 获取。本仓库启用了 `fetch.prune`，对 origin 使用显式标签 refspec 拉取会删除本地的上游 `v*` 标签。

初次检出执行 `git submodule update --init --recursive`、`pnpm install --frozen-lockfile --ignore-scripts` 与 `pnpm compile`。
