# 下游发布与安装

本页说明私有 CI 制包、稳定安装与回退；开发与合入 `z` 见[下游开发流程](development.md)。

## CI 制包

稳定安装只使用本仓库 CI 的 Release 制品；本地构建只用于开发验证。

工作流 `.github/workflows/downstream-release.yml` 只能在 `z` 上手动触发，输入为不可变标签 `z-<上游版本>.<序号>`。它检查版本与标签，编译一次并以 SHA-256 校验后复用同一产物，运行构建门禁、包验证、完整回归分组与下游定向回归，全部通过后打包并在本仓库创建 Release。不向 npm 发布；继承的上游工作流保持禁用。`z` 的日常 push 不触发任何 CI，因此候选版本须先在本地跑定向脚本。

授权后创建标签、推送并触发；推送可能因网络静默失败，触发前确认远端已有该标签：

```sh
# TAG 为新的不可变标签；不重打、不覆盖已有 Release。
git push origin z "$TAG"
git ls-remote --tags origin "$TAG"   # 必须有输出
gh workflow run downstream-release.yml --repo z-traveler/dsh-tui --ref z -f tag="$TAG"
gh run watch "$RUN_ID" --repo z-traveler/dsh-tui --exit-status
```

只验证流水线、不创建 Release 时加 `-f publish=false`。`RELEASE.json` 记录源码提交、工作流提交与 run ID，下游身份以它为准，不以包内的上游版本号为准。CI 失败就修复后用下一个序号重新发布，不用本机制包绕过。制品只覆盖 Linux/Node；其他平台须另行验收。

## 本机安装与回退

CI 门禁不加载用户 profile 里的其他插件，因此通过 CI 不代表能在本机组合下启动。本机安装按 `$DSH_HOME/README.md` 的安装器流程进行，每一步都先在 `$DSH_HOME` 的隔离副本中完成：

1. 下载制品到仓库外，核对 `SHA256SUMS`，以及 `RELEASE.json` 中的提交、工作流提交、run ID 与标签一致。
2. 在包声明中把 dsh-tui 指向新的标签与资产校验和；在隔离副本中解析依赖并捕获模板。非冻结解析可能顺带改动与 TUI 无关的传递依赖，捕获后逐项核对模板差异，只保留 TUI 自身的变化。
3. 在另一份隔离副本中用安装器冻结安装两个 profile，再用新包的 `bin/dsh-tui.js` 以该副本为 `DSH_HOME`，从多个真实目录冷启动，确认能进入输入框且版本正确。
4. 以上通过后再由安装器装入正式 profile（保留上一代依赖树用于回退），并用同一份 tarball 更新全局启动器：

```sh
npm install -g --legacy-peer-deps --ignore-scripts "$PACKAGE"
```

安装后从仓库外的多个目录启动全局 `dsh-tui`，确认启动器与 profile 版本一致、DSH 启动完成且无报错，安装路径与配置不引用工作区。已打开的 TUI 需重启才会加载新包。不要使用 `/update` 或 `dsh-tui update`，它们会取回公开上游包。
