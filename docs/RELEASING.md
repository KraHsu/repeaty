# 自动发布

`main` 上的版本号尚未发布时，Desktop 工作流会自动创建对应的 GitHub Release。例如 `package.json` 为 `0.26.0` 时，发布标签是 `v0.26.0`。

发布必须满足以下条件：

- 同一个 `main` 提交的 CI（含 Pages 部署）通过。
- Linux、Windows 和 macOS 桌面任务全部通过。
- 前端、Rust、Tauri 与锁文件中的版本一致。
- 该提交仍是最新的 `main`，三个安装包均来自本次 Desktop 工作流。

PR 和其他分支不会发布。流程使用 GitHub 自带的 `GITHUB_TOKEN`，仅发布任务拥有 `contents: write`；不需要另配 PAT。仓库条件默认限定为 `KraHsu/repeaty`，fork 如需启用，应修改 Desktop 工作流中的仓库条件。

## 产物

Release 复用已通过检查的安装包，不再另外构建：

| 平台                | 安装包                            |
| ------------------- | --------------------------------- |
| Linux x86_64        | `Repeaty_<version>_amd64.deb`     |
| Windows x64         | `Repeaty_<version>_x64-setup.exe` |
| macOS Apple Silicon | `Repeaty_<version>_aarch64.dmg`   |

同时提供 `SHA256SUMS`。流程核对 GitHub 返回的文件摘要；所有文件均上传并核对后，才将草稿公开。发布说明由合并记录生成，并附构建提交、升级备份和未签名说明。

Windows / macOS 安装包尚未配置代码签名或公证。自动构建、MCP smoke 和 Linux 原生测试不代替 Windows / macOS 的实际安装与 GUI 验收。

## 版本号

发布一个新版本时，在同一分支更新：

- `package.json` 与 `package-lock.json` 的根包版本。
- `server/Cargo.toml`、`src-tauri/Cargo.toml`、`crates/leetcode-local/Cargo.toml`、`crates/workspace-store/Cargo.toml`。
- 对应四个 `Cargo.lock` 中的自身包版本，以及桌面锁文件中嵌入的本地插件版本。
- `src-tauri/tauri.conf.json`。

运行 `node scripts/release.mjs check` 核对版本，再完成正常测试与 PR。合并后自动发布；已有公开 Release 的同版本提交只做正常检查和部署，不替换下载文件。需要发布后续修复时，增加版本号。

带预发布标识的版本（如 `1.0.0-rc.1`）自动标记为 Pre-release，不替换 Latest。稳定的 `1.0.0` 还要求 [发布清单](RELEASE_1_0.md) 全部完成，脚本不会代为勾选或跳过验收。

## 开发阶段的检查

功能分支推送和 PR 只运行 **Unit tests**：应用单元测试与发布脚本的单元测试。草稿与待合并 PR 使用同一规则；同一分支的新提交会取消过期的单元测试运行。合并要求对应提交的 Unit tests 通过。

完整 CI、三平台持久化、浏览器端到端、桌面安装包、Pages 部署和自动发布只在 `main` 执行。CI / Desktop 的手动入口也限制为 `main`，在其他分支选择这些入口时不会启动构建任务。不要再为功能分支手动启动重型工作流。

Unit tests 是独立工作流，不替代发布所需的同一 `main` 提交的完整 CI。原有发布门槛与安装包来源检查保持不变。

修改桌面布局时，本地运行 `npm run test:e2e:desktop`，覆盖普通尺寸与短窗口；修改原生目录接口时，本地运行对应 Rust、跨语言和原生客户端测试。类型、格式与必要构建检查也在提交前按修改范围验证。三平台完整 CI 在合并后的 `main` 执行。

## 失败与重试

上传中断或校验失败时保留未公开草稿，不发布缺包的版本。对于由流程创建、提交号相同的草稿，重新运行失败的发布任务即可重新上传并继续。遇到人工草稿、标签指向其他提交、产物过期或来源不一致时，任务会停止，避免覆盖已有内容。

若上传期间 `main` 推进，流程会保留草稿并停止发布旧提交。检查该草稿与标签后处理；不要把其他提交构建的安装包混入原版本。已公开的 Release 永不自动覆盖。

也可以在 Actions 中对 `main` 手动运行 Desktop 工作流：它会重新检查、构建并按相同规则发布。CI 失败时应先修复；发布任务等待同一提交的 CI，不能使用其他提交的绿色结果。

本地可执行 `node --test scripts/release.test.mjs` 验证发布规则。`plan` 模式只读取 GitHub 状态，不创建标签或 Release；需提供 `GITHUB_REPOSITORY`、`GITHUB_SHA`、`GITHUB_RUN_ID` 和只读令牌。
