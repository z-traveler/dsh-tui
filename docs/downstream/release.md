# 下游发布与安装

本页说明下游的 CI 打包、稳定安装与回退流程；日常开发与合入 `z` 分支见[下游开发流程](development.md)。

## CI 制包

本仓库按公开的个人下游发布，源码和 Release 制品都会公开；推送前请确认不包含个人配置、凭据或会话数据。正式环境的稳定安装只允许使用本仓库 CI 产出的 Release 制品，本地构建仅用于开发验证。

工作流 `.github/workflows/downstream-release.yml` 只能在 `z` 分支上手动触发，并传入不可变标签 `z-<上游版本>.<序号>`。它会校验版本与标签，只编译一次并通过 SHA-256 校验后复用同一份构建产物，然后运行构建门禁、包校验、完整回归分组以及下游定向回归；全部通过后才打包并在本仓库创建 Release。本仓库不向 npm 发布，继承自上游的工作流保持禁用。日常往 `z` 分支 push 不会触发任何 CI，因此候选版本必须先在本地跑完定向脚本。

获得授权后，创建标签、推送并触发工作流。推送可能因网络问题静默失败，触发前先确认远端已经收到该标签：

```sh
# TAG 为新的不可变标签；不要重打，也不要覆盖已有的 Release。
git push origin z "$TAG"
git ls-remote --tags origin "$TAG"   # 必须有输出
gh workflow run downstream-release.yml --repo z-traveler/dsh-tui --ref z -f tag="$TAG"
gh run watch "$RUN_ID" --repo z-traveler/dsh-tui --exit-status
```

如果只验证流水线、不创建 Release，可以加上 `-f publish=false`。`RELEASE.json` 记录了源码提交、工作流提交与 run ID，下游身份以它为准，不以包内保留的上游版本号为准。CI 失败时应在修复后使用下一个序号重新触发发布，不要用本机打包来绕过 CI。当前制品仅覆盖 Linux/Node 环境，其他平台需要另外验收。

## 本机安装与回退

CI 门禁不会加载用户本地 profile 中的其他插件，因此通过 CI 并不代表在本机的完整插件组合下一定能正常启动。本机安装按 `$DSH_HOME/README.md` 的安装器流程进行，并且每一步都要先在 `$DSH_HOME` 的隔离副本中验证：

1. 将制品下载到仓库目录之外，核对 `SHA256SUMS`，并确认 `RELEASE.json` 中的源码提交、工作流提交、run ID 与标签一致。
2. 在包声明中把 `dsh-tui` 指向新的标签与资产校验和；先在隔离副本中解析依赖并捕获模板。由于非冻结解析可能会顺带改动与 TUI 无关的传递依赖，捕获后需逐项核对模板差异，只保留 TUI 自身的变化。
3. 在另一份隔离副本中用安装器冻结安装两个 profile，然后用新包的 `bin/dsh-tui.js` 以该副本作为 `DSH_HOME`，从多个真实目录冷启动，确认能正常进入输入框且版本号正确。
4. 以上步骤全部通过后，再通过安装器装入正式 profile（保留上一代依赖树用于回退），并用同一份 tarball 更新全局启动器：

```sh
npm install -g --legacy-peer-deps --ignore-scripts "$PACKAGE"
```

安装完成后，从仓库外的多个目录启动全局 `dsh-tui`，确认启动器与 profile 版本一致、DSH 启动完成且无报错，同时确认安装路径和配置没有引用本地工作区。已经打开的 TUI 实例需要重启才会加载新包。不要使用 `/update` 或 `dsh-tui update`，它们会去拉取公开上游包。
