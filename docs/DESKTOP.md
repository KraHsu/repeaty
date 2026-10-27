# 桌面客户端

Repeaty 使用 Tauri 2、Vue 与 Rust。客户端直接打开学习目录，不需要账户或后台服务；安装包自带界面，学习数据存储在选择的文件夹中。

本分支正在接管桌面存储，尚未发布新安装包。已发布的 0.27.0 安装包仍是此前实现；不要将发布页旧包当成本分支的验证产物。

## 开发与构建

安装 Node.js、Rust 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)，然后运行：

```bash
npm ci
npm run desktop:dev
```

构建当前平台安装包：

```bash
npm run desktop:build
```

`npm run desktop:build -- --debug --no-bundle` 可生成包含网页资源的调试程序，无需开发服务器。只用 `cargo build` 得到的开发程序依赖 Vite 开发地址。

## 工作目录

首次启动，在「工作目录」选择空文件夹创建学习库，入门卡组自动添加。选择「打开目录」可打开另一个学习库。应用会记住最近目录，重启后继续打开上次的学习库。

卡片正文和材料写为 Markdown，图片和音频单独存放；SQLite 保存调度、历史、阅读状态和持久草稿。偏好和插件开关也随目录保存。评分不会扫描 Markdown 或重写整库。

在 `notes/` 新建笔记文件后，进入「工作目录 → 重新扫描」，选择卡组与题型并确认添加。问答使用单独一行 `<!-- repeaty:answer -->` 分隔题面与答案，挖空可直接写 `{{c1::内容}}`。已有文件的正文编辑、改名保留身份与进度。方向或挖空编号被移除时保留退役记录，重新添加时恢复原卡片与调度。

外部删除文件后，可确认移除，并在「已移除的笔记」中搜索、分页和恢复。恢复路径已有文件时，可以改用其他 `notes/` 路径；不会覆盖占用路径的文件。应用内编辑和删除也保留可恢复记录。材料正文、格式和附件变化经确认后保存为新版本；已有摘录继续读取原版。「历史版本」可查看旧正文和位置。Markdown 支持 `assets/` 中的相对路径图片和音频，同名替换后可确认接受。外部修改会自动列入待处理列表；侧栏显示数量，返回窗口时会补检。见[目录结构与边界](WORKSPACE_MODE.md)。

本分支的工作目录格式已更新为 3，不自动迁移未发布的格式 1 / 2。请新建目录测试；旧目录保留。

备份或复制前先关闭学习库，再复制整个文件夹，包括 `.repeaty` 和 `assets`。没有旧库迁移或桌面上游切换功能；程序不会清理旧库。已有 `.repeaty` 内容导入仍可使用，但它不是包含所有辅助数据的目录备份。

## 阅读、插件与 AI

「学习材料」保存原文快照、摘录、阅读位置、阅读安排和理解反馈。材料可独立阅读，也可从学习概览进入混合队列。位置与评分在重启后保留；本轮队列不跨重启恢复。见[阅读用法](SOURCES.md)。

在「设置」中调整通知、答题历史及插件开关。纯前端插件和内置 LeetCode 本地插件共用当前学习库；LeetCode 判题在本机执行。登录凭据保存在设备的独立凭据库，不进入工作目录。复制学习库到新设备后需重新配置登录信息。见[LeetCode 配置](LEETCODE.md)。

在「设置 → MCP 连接」连接 Codex、Claude Code 或 Claude Desktop。MCP 默认关闭；分享摘录和接收草稿需要主动开启。待确认草稿、附件和编辑内容保存在当前目录，重启后可以继续确认；MCP 密钥及分享授权不会随目录复制。见[MCP](MCP.md)。

## 本地验证

```bash
npm test
npm run typecheck
npm run test:workspace:native
npm run test:e2e:desktop
cargo test --locked --manifest-path crates/workspace-store/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path crates/leetcode-local/Cargo.toml
npm run desktop:build -- --debug --no-bundle
# Linux：需 tauri-driver、WebKitWebDriver、Xvfb、xdotool
GSETTINGS_BACKEND=memory GTK_USE_PORTAL=0 GIO_USE_VFS=local \
  dbus-run-session --config-file=scripts/fixtures/minimal-desktop-session.conf -- \
  xvfb-run -a node scripts/test-workspace-native.mjs
```

浏览器回归通过测试桥连接真实 Rust 存储，只替代文件选择器、MCP 连接和插件联网。原生测试另外验证真实系统选择器、Tauri IPC、WebKit 与进程重启；均使用临时目录，不读取平时使用的数据，也不向真实 LeetCode 提交。

完整构建与三平台打包 CI 仅运行于 main，功能分支与 PR 只做基本单元测试。本机 Linux 通过不代替 Windows / macOS GUI 验收。
