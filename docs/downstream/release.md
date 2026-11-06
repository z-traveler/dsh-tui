# 下游发布与安装

## 开发与同步

在 `feature/*` 开发，日常只运行改动面的回归与必要编译。
初次检出执行 `git submodule update --init --recursive`、`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm compile`。
HUD 改动的定向入口为 `node --import tsx/esm scripts/downstream/verify-hud.tsx`；会话卡片用 `node --import tsx/esm scripts/downstream/verify-session-cards.tsx` 与 `node --import tsx/esm scripts/verify-plugin-command-output.mjs`。其他区域按贡献指南选测试。

跟进上游时，从 `z` 建候选分支，把个人补丁 rebase 到选定稳定标签，
用 `git range-diff` 核对旧、新补丁序列；通过验证并获授权后再推进 `z`。
不改写上游标签，不把上游合并历史混入补丁序列。

## 私有 CI 制包

稳定安装只使用 **私有仓库 CI 的 Release 制品**；本地构建用于开发验证，不替代 CI 来源。
工作流为 `.github/workflows/downstream-release.yml`，只接受手动触发的不可变 `z-<上游版本>.<序号>` 标签。
它检查版本与标签、运行构建门禁、包验证、四组完整回归及下游定向回归，
使用已有 publish-manifest 转换器打包，在全部成功后向当前私有仓库创建 Release。
不向 npm 发布，不使用继承的上游发布工作流；继承工作流保持禁用。
下游定向回归仅自动挂在此发布工作流中，`z` 的日常 push 不触发继承的 CI。
因此候选 rebase 后应先运行对应的本地定向脚本，不能把日常分支的 CI 状态视为已验证下游行为。

人工体验验收、独立审查和本地定向检查完成后，经授权合入 `z`、创建标签并推送私有 `origin`：

```sh
# TAG 为已批准的不可变标签；不可重打或覆盖同名 Release 资产。
git push origin z "$TAG"
gh workflow run downstream-release.yml --repo z-traveler/dsh-tui --ref z -f tag="$TAG"
gh run list --repo z-traveler/dsh-tui --workflow downstream-release.yml
gh run watch "$RUN_ID" --repo z-traveler/dsh-tui --exit-status
```

源码只编译一次，后续任务校验 SHA-256 后复用同一产物；vendor 缓存仍由构建器逐文件校验。
耗时回归使用现有耗时装箱分片：render-scroll/channel-ui 各六片，session-workspace 三片，input-terminal 一片；每项仍只运行一次，发布等待全部分片成功。
仅验证流水线、不创建 Release 时，在触发命令加 `-f publish=false`，不会覆盖已安装版本。
工作流定义可在 `z` 上维护，构建源码始终检出输入标签。
`RELEASE.json` 同时记录源码提交、工作流提交和 run ID/attempt；不只凭包内的上游版本号认定下游身份。
CI 失败就停止安装，修复原因后重新运行；不以本机制包绕过失败，不覆盖既有 Release。
本流程覆盖本机使用的 Linux/Node 包；其他目标平台须补对应平台验收，不能把 Linux 结果当成 Windows/macOS 验收。

## 从仓库安装

稳定切换前退出正在运行的 TUI，备份配置与 DSH profile，并保留上一份包用于回退。
只清理被替换的安装，不删除会话或凭据。

```sh
# TAG、RUN_ID、COMMIT 分别为已成功发布的标签、CI run 和标签对应的完整提交。
OUT="$HOME/.local/share/dsh-releases/dsh-tui/$TAG/ci-$RUN_ID"
mkdir -p "$OUT"
gh release download "$TAG" --repo z-traveler/dsh-tui --dir "$OUT" \
  --pattern '*.tgz' --pattern RELEASE.json --pattern SHA256SUMS
(cd "$OUT" && sha256sum -c SHA256SUMS)
```

核对 run 成功且其 headSha 与 `RELEASE.json` 的 workflowCommit 一致，workflowRef 来自 `refs/heads/z`；标签解析出的源码 SHA 与 commit 一致，repository/tag/runId 同样匹配；
下载目标若已有不同制品，不覆盖，应保留并调查。
profile 会持久化 tarball 的绝对 `file:` 路径，所以目录必须在工作区外。
取得安装授权后，用这一份下载的包对齐 profile 与全局启动器：

```sh
PACKAGE=$(ls "$OUT"/*.tgz)
test -f "$PACKAGE"
dsh plugin --profile dsh-tui add "$PACKAGE"
npm install -g --legacy-peer-deps --ignore-scripts "$PACKAGE"
```

从仓库外运行 `dsh-tui`，确认实际加载的 profile 副本、配置和交互；
校验安装文件与下载制品一致，安装路径、配置及模块链接不引用工作区。
保存 Release URL、run ID、提交、校验和及安装核验记录。

私有下游不要使用 `/update` 或 `dsh-tui update`，它们会取回公开上游包。
回退时从上一份成功的私有 Release 下载并核验包，再执行相同安装命令；必要时恢复备份配置。
提交、推送、CI 发布与稳定切换分别需要授权；开发验收不自动授权发布。
