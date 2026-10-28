# LeetCode

将力扣题目加入卡组，在 Repeaty 中编写代码、提交判题，并保存完整的作答与提交历史。支持中国站和国际站，运行于桌面版。

## 使用

1. 添加卡片时选择「添加 LeetCode 题目」，或将笔记类型设为「插件题目」后选择 LeetCode。
2. 选择站点，输入题目链接或英文标识，点击「读取题目」。可以同时填写自己的解题笔记。
3. 复习时选择编程语言，编写代码并提交。判题结果会保存在当前学习库中。
4. 选择手动评分或按判题结果自动评分。未确认的提交可以关联原始提交编号后继续查询，不会因此重复提交。

读取公开题目不需要配置账号。提交判题需要先在「设置 → 连接 → LeetCode」保存对应站点的登录信息。也可在插件管理页点击「配置插件」直接进入。

## 配置登录信息

中国站和国际站分别保存登录信息。打开力扣网站并登录，不会自动连接 Repeaty，也不会自动导入浏览器中的登录状态。

1. 在对应的 [中国站](https://leetcode.cn/) 或 [国际站](https://leetcode.com/) 登录账号。
2. 打开浏览器开发者工具，进入「应用（Application）」或「存储（Storage）」下的 Cookie。
3. 复制 `LEETCODE_SESSION` 和 `csrftoken` 的**值**，粘贴到对应站点的两个输入框。不要包含名称、空格或分号。
4. 点击「保存登录信息」。保存后会验证账号；之后也可点击「刷新状态」重新检查。

已保存的值不会回填到输入框。登录过期时重新登录网站并更新这两个值；遇到网站验证提示时，先在网站完成验证，再刷新状态。

「清除登录信息」只清除本机对应站点的账号配置，需要再次确认。它不会删除学习库中的题目、代码或历史。

详细说明见 [LeetCode 配置文档](https://github.com/KraHsu/repeaty/blob/main/docs/LEETCODE.md#配置与启用)。

## 数据与权限

- 插件代码、题目、笔记、调度、完整作答记录与插件数据随当前学习目录保存。
- 插件只向声明的 `leetcode.cn` 和 `leetcode.com` 域名联网。
- Cookie 仅保存在本机设备私有存储中，由桌面版直接连接力扣，不会进入卡组导出或发送给上游服务。
- 复制学习库到另一台设备后，需要重新确认插件代码并配置登录信息。关闭或卸载插件会保留原有学习与历史数据。

## 开发

本插件是独立项目。运行预构建包不需要 Node.js；修改源码时需要 Node.js 24.15+ 和公开的 `@repeaty/plugin-api` SDK。

在仓库根目录安装依赖后，进入此插件目录运行：

```sh
npm test
npm run typecheck
npm run build
npm run dev
```

安装 `dist/leetcode.repeaty-plugin` 即可更新插件，无需重编译 Repeaty。也可通过 `npm run dev -- --outdir /path/to/test-library/.repeaty/plugins/leetcode` 输出到专用测试学习库，再在插件管理页重新扫描并确认启用。

独立 SDK 的安装方式见 [插件开发文档](https://github.com/KraHsu/repeaty/blob/main/docs/PLUGINS.md#独立开发与构建)。
