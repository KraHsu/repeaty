# 桌面版

[返回首页](../README.md) · [后端部署](SELF_HOSTING.md) · [LeetCode](LEETCODE.md)

桌面版使用 Tauri 2，默认无需账户，学习数据保存在本机 WebView 的 IndexedDB。第一次打开自动添加入门卡组，删除后不会再次自动添加。界面、制卡、复习和备份格式与网页一致。导出使用系统保存对话框，按块写入临时文件，完成后再替换目标；取消不会破坏已有备份。

## 安装与构建

[Desktop 工作流](https://github.com/KraHsu/repeaty/actions/workflows/desktop.yml)提供 Linux `.deb`、Windows NSIS 安装程序和 macOS `.dmg` 构建产物。安装包暂未配置代码签名或 Apple 公证，系统可能要求确认来源。请只使用自己构建或可信发布者提供的程序。

开发环境需安装 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)、Node.js 24.12+ 和 Rust 1.97.1。

```bash
npm ci
npm run desktop:dev
npm run desktop:build
```

构建产物位于 `src-tauri/target/release/bundle/`。前端单独构建使用 `npm run build:desktop`；`dist-desktop/` 依赖原生接口，不能作为普通网页部署。

## 使用上游服务

打开右上角「设置」，填写后端根地址，例如 `https://repeaty.example.com`，保存后登录或创建账户。本机开发服务允许 `http://127.0.0.1:8080`。地址不能包含 `/api`、路径、登录信息或查询参数。

连接上游会切换学习库。本地库与服务端账户库各自保留，不自动同步、合并或覆盖。将地址清空即可回到原本的本地库。两者间搬迁数据请使用 `.repeaty` 导入导出。

界面始终使用安装包自带的代码，不加载上游网页。上游会话仅驻留原生进程内存，关闭应用后需重新登录。原生客户端只允许 Repeaty 的账户、学习库、媒体和备份 API，禁止跟随重定向。

## 阅读材料

「学习材料」中的文本和 Markdown 会自动保存阅读位置和显示方式。点击列表中的「继续阅读」可回到保存处，完全退出并重开应用后仍保留。本地模式离线可用，上游模式保存到当前账户，二者互不覆盖。可将材料延后到指定日期或归档，归档仍保留原文与关联卡片；「加入待阅读」恢复为今天可读。日期按本机时区计算，阅读安排与 FSRS 分开保存。退出前确认「阅读位置已保存」，或点击「保存阅读位置」等待完成。[完整用法](SOURCES.md#继续阅读)

## MCP

在「设置 → MCP 连接」开启本机读取接口，再将连接配置交给支持 Streamable HTTP 的客户端。可查询待复习题目、学习统计和练习摘要。连接默认关闭，仅支持本地库；退出、重载或切库后需重新开启并更新客户端配置。[连接方法与查询范围](MCP.md)

在「学习材料」选中文字，点击「通过 MCP 制卡」并分享，可接收客户端生成的问答、双向和挖空卡草稿。右上角「制卡草稿」中逐条编辑确认后保存；尚未完成时可「保存草稿」，保留修改和附件，重启后继续。连接和分享授权不会恢复。待确认草稿仅存本机，不进入复习或备份，也不发送给上游；确认后的卡片与出处随学习库保留。[操作与重试](MCP.md#从摘录生成草稿)

## 本地插件与数据

桌面版支持所有纯前端插件，并内置可关闭的 LeetCode 本地插件。连接上游后，LeetCode 仍在本机执行，不随学习库位置改变。

在「插件 → LeetCode」保存登录信息后，会通过只读请求验证并显示当前账号。登录失效、网页验证、网络故障和限流分别提示；不会清空代码、待查询提交或已保存的 Cookie。[配置与状态说明](LEETCODE.md#配置与启用)

LeetCode Cookie 通过原生接口写入应用数据目录的独立 `leetcode.credentials.sqlite3`；Unix 文件权限为 `0600`。它不进入学习库、上游请求或导出文件。此文件未加密，本机系统管理员及能读取该目录的进程仍有访问能力。只安装可信的桌面程序和插件。

应用数据目录由系统决定，标识为 `top.krahsu.repeaty`。卸载或清理应用数据前，请导出学习库备份；WebView 数据目录可能与原生配置目录不同，不建议靠手工复制部分文件迁移。

## 测试

```bash
npm run test:e2e:desktop                    # Chromium，模拟 IPC，验证界面和判题流程
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path crates/leetcode-local/Cargo.toml
npm run desktop:build -- --debug --bundles deb
# Linux：需 WebKitWebDriver、tauri-driver、Xvfb 和 xdotool
npm run build:server
cargo build --locked --manifest-path server/Cargo.toml
xvfb-run -a node scripts/test-desktop-native.mjs
```

原生测试会启动独立的临时账户服务及应用数据目录，不读取平时使用的数据。判题测试只使用模拟响应，不向真实 LeetCode 账号提交代码。
