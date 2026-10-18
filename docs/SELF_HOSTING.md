# 部署带后端版

[返回首页](../README.md) · [插件开发](PLUGINS.md) · [LeetCode 配置](LEETCODE.md)

带后端版由一个 Rust 进程提供网页与 API，SQLite 保存学习数据和附件。适合个人自用，一个服务对应一个学习库；访问密钥不是用户账号，不区分多人数据。GitHub Pages 只发布纯前端版，不会启动或部署这个服务。

## 本机启动

需要 Node.js 24.12+（24.x）、Rust（CI 使用 1.97.1）及系统 C 编译工具。SQLite 随 Rust 依赖编译，无需另装数据库服务。在仓库根目录执行：

```bash
npm ci
npm run build:server
cargo run --release --locked --manifest-path server/Cargo.toml
```

打开 `http://127.0.0.1:8080`。默认仅监听本机，网页目录为 `dist-server/`，数据库自动创建在 `data/repeaty.sqlite3`。停止后再次启动会继续使用同一个数据库。初次访问是空库，不会自动读取另一个网址的 IndexedDB；迁移原数据请先在原页面导出 `.repeaty`，再在此处导入。

生产部署也可以先执行 `cargo build --release --locked --manifest-path server/Cargo.toml`，随后直接运行 `server/target/release/repeaty-server`。运行目录会影响默认相对路径，长期运行建议设置绝对路径。

## 配置

通过进程环境变量配置；程序不会自动读取 `.env`。可由 shell、systemd 或容器注入。不要给敏感配置添加 `VITE_` 前缀，它会将值暴露给网页构建。

| 变量                                         | 默认值                 | 说明                                                       |
| -------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `REPEATY_BIND`                               | `127.0.0.1:8080`       | Rust 监听的 IP 与端口                                      |
| `REPEATY_ORIGIN`                             | `http://` 加监听地址   | 浏览器访问的完整来源，含必要端口，不含路径                 |
| `REPEATY_DATABASE`                           | `data/repeaty.sqlite3` | SQLite 文件路径                                            |
| `REPEATY_WEB_DIR`                            | `dist-server`          | 后端版网页产物目录                                         |
| `REPEATY_API_TOKEN`                          | 未设置                 | 访问密钥，设置时至少 24 字符；非本机监听或公开域名必须设置 |
| `REPEATY_PLUGINS`                            | `leetcode`             | 启用的后端插件 ID，逗号分隔；空字符串关闭所有后端插件      |
| `LEETCODE_CN_SESSION` / `LEETCODE_CN_CSRF`   | 未设置                 | 中国站登录会话与 CSRF 值，需成对设置                       |
| `LEETCODE_COM_SESSION` / `LEETCODE_COM_CSRF` | 未设置                 | 国际站登录会话与 CSRF 值，需成对设置                       |

访问密钥可以用 `openssl rand -hex 32` 生成，再保存到部署环境的私密配置中。网页首次连接时输入该值，仅保存在当前标签页的 `sessionStorage`，不写入学习备份。

例如，仅关闭 LeetCode 并保持本机使用：

```bash
REPEATY_PLUGINS='' cargo run --release --locked --manifest-path server/Cargo.toml
```

若通过反向代理公开访问，使用 HTTPS，将 `REPEATY_ORIGIN` 设为实际网址（如 `https://repeaty.example.com`），设置访问密钥，代理同时转发网页与 `/api/`，并保留对应的 `Host`。可保持 Rust 监听 `127.0.0.1:8080`。后端版目前部署在独立来源的根路径，不支持 `/repeaty/` 子目录。代理需允许至少 64 MiB 请求体；单个媒体仍限 10 MiB。

服务只接受与配置匹配的 Host / Origin 和客户端请求头，不提供跨域 API。修改域名或端口后需同步修改 `REPEATY_ORIGIN`；提示地址不匹配时应修正配置。

## 数据与备份

卡组、笔记、卡片、复习记录、媒体元数据及常用筛选分别存储；每条记录一行，媒体保存为独立 BLOB。评分通过增量提交更新记录，不重写整个学习库或附件。修订号检查与记录写入处于同一事务，过期页面写入会被拒绝，刷新后再修改。

服务保留最近 10 个增量快照。恢复、导入和删除前保存快照；未引用上传在保留一天后随后续清理回收，仍被快照引用的附件保留。快照和当前数据在同一个数据库中，不能替代独立备份。

两种备份方式：

- 在「数据与备份」导出 `.repeaty`，可恢复到任一版本，包含卡片、进度与原始附件。插件代码、访问密钥、LeetCode 会话及未完成的浏览器草稿不包含在内。
- 备份 SQLite：停止服务后复制数据库，或使用 SQLite 的在线备份功能，例如 `sqlite3 data/repeaty.sqlite3 ".backup '/backup/repeaty.sqlite3'"`。运行期间使用 WAL，不能仅复制主文件而忽略未合并的 WAL 内容。

不要将数据库放在网页目录或提交到 Git。升级前先备份 SQLite；当前数据库版本为 1，服务拒绝打开更新版本的数据库。纯前端旧数据的迁移由导入流程完成。

## 使用边界

带后端版不启用 Service Worker，不支持断开服务后继续编辑。服务不可达时显示连接错误，不会切换到另一份浏览器学习库。界面语言、插件开关和 LeetCode 作答草稿仍按浏览器保存。

服务不是云同步系统：多个页面可读取同一个库，但不会实时刷新彼此内容，过期写入返回冲突。SQLite 负责持久化；当前启动仍将完整结构化学习记录读入前端内存，搜索也在前端执行。一次结构化提交上限 64 MiB，超出时会拒绝且不更改学习库；媒体单独上传，不计入该请求。SQLite 不意味着可以无限扩大浏览器内存中的学习库。
