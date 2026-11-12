# 下游发布与安装

本页说明私有 CI 制包、稳定安装与回退；开发与合入 `z` 见[下游开发流程](development.md)。

## 私有 CI 制包

稳定安装只使用本仓库 CI 的 Release 制品；本地构建只用于开发验证。

工作流 `.github/workflows/downstream-release.yml` 只能在 `z` 上手动触发，输入为不可变标签 `z-<上游版本>.<序号>`。它检查版本与标签，编译一次并以 SHA-256 校验后复用同一产物，运行构建门禁、包验证、完整回归分组与下游定向回归，全部通过后打包并在本仓库创建 Release。不向 npm 发布；继承的上游工作流保持禁用。`z` 的日常 push 不触发任何 CI，因此候选版本须先在本地跑定向脚本。

授权后创建标签、推送并触发：

```sh
# TAG 为新的不可变标签；不重打、不覆盖已有 Release。
git push origin z "$TAG"
gh workflow run downstream-release.yml --repo z-traveler/dsh-tui --ref z -f tag="$TAG"
gh run watch "$RUN_ID" --repo z-traveler/dsh-tui --exit-status
```

只验证流水线、不创建 Release 时加 `-f publish=false`。`RELEASE.json` 记录源码提交、工作流提交与 run ID，下游身份以它为准，不以包内的上游版本号为准。CI 失败就修复后用下一个序号重新发布，不用本机制包绕过。制品只覆盖 Linux/Node；其他平台须另行验收。

## 本机安装与回退

本机安装按 `$DSH_HOME/README.md` 的安装器流程进行：在其包声明中把 dsh-tui 指向新的标签与资产校验和，先在隔离 profile 验证，再由安装器装入正式 profile；安装器保留上一代依赖树用于回退。全局启动器使用同一份已校验的 tarball：

```sh
npm install -g --legacy-peer-deps --ignore-scripts "$PACKAGE"
```

安装后从仓库外启动 `dsh-tui`，确认实际加载的包来自该 Release，安装路径与配置不引用工作区。不要使用 `/update` 或 `dsh-tui update`，它们会取回公开上游包。
