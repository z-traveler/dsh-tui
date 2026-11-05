# 下游发布与安装

## 开发与同步

在 `feature/*` 开发；默认只运行改动面的回归与 `pnpm compile:src`。
初次检出先执行 `git submodule update --init --recursive`、`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm compile`。
HUD 改动运行 `node --import tsx/esm scripts/downstream/verify-hud.tsx`；其他区域按上游贡献指南选测试。

跟进上游时，先 `git fetch upstream --tags`，从 `z` 建候选分支，执行
`git rebase --onto <新上游标签> <旧上游基线>`。用
`git range-diff <旧基线>..<旧z提交> <新基线>..HEAD` 核对每个个人补丁，
完成验证后才经授权推进 `z`。不要把上游整段合并历史混进个人补丁序列。

## 发布门禁

仅在准备发布、工作树干净且人工体验已验收后执行：

```sh
set -e
pnpm build
pnpm verify:package
DSH_TUI_LANG=zh node --import tsx/esm scripts/downstream/verify-hud.tsx
for group in render-scroll input-terminal session-workspace channel-ui; do
  DSH_TUI_LANG=zh node scripts/run-ci-group.mjs "$group"
done
```

以上是本机门禁；发布前还须对照 `.github/workflows/ci.yml` 补齐发布目标适用的
平台、安装包及宿主集成检查。四组回归不等于完整 CI，缺少必需环境时暂停发布。
任一项失败都停止发布。通过后经授权合入 `z`，打不可变标签
`z-<上游版本>.<序号>`，并保存上游基线、代码提交与验证结果。
不使用上游的 npm 发布工作流。

## 制包与安装

从已验证的标签检出制包，使用每个标签独立的产物目录：

```sh
# TAG 是已获批准并检出的下游标签。
OUT="$HOME/.local/share/dsh-releases/dsh-tui/$TAG"
mkdir -p "$OUT"
node scripts/with-publish-manifest.mjs npm pack --ignore-scripts --pack-destination "$OUT"
sha256sum "$OUT"/*.tgz > "$OUT/SHA256SUMS"
```

制品目录必须在工作区外，profile 会持久化 tarball 的绝对 `file:` 引用。
包名保持宿主兼容；下游产物用标签、提交和 SHA-256 识别，不能只看包内的上游版本号。
不要从 Git URL 安装：源码含 workspace 依赖与子模块，安装包必须包含编译产物。

稳定切换前退出正在运行的 TUI，备份 `~/.dsh-tui` 配置及 DSH profile，保留上一个安装包。
取得安装授权后，用同一 tarball 对齐 profile 和全局启动器：

```sh
# PACKAGE 为已校验 tarball 的绝对路径。
dsh plugin --profile dsh-tui add "$PACKAGE"
npm install -g --legacy-peer-deps "$PACKAGE"
```

在 TUI 中用 `/theme status`、`/settings` 和一轮实际交互确认版本与配置。
私有下游不要使用 `/update` 或 `dsh-tui update`，它们会取回公开上游包。
回退时把 `PACKAGE` 换成保留的旧包，重新执行两条安装命令；必要时恢复配置备份，
不删除会话或凭据。制包、发布和安装是独立步骤，不因开发验收自动获得授权。
