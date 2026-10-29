# Structured Study

独立材料插件示例：把一个 `.study.json` 文件中的章节导入学习材料，在章节正文选取文字，使用软件的摘录和制卡流程。

需要带材料 SDK 的 Repeaty。插件仅使用公开 `@repeaty/plugin-api`、Vue 和共享控件；在开发时独立构建，运行时无需 Node，不访问网络或设备文件权限。

## 使用

1. 构建后在「插件」页安装 `dist/structured-study-example.repeaty-plugin`。
2. 打开「学习材料」中的插件导入入口，选择「学习章节文件」，加载本目录 `example.study.json`。
3. 检查候选列表后确认导入。打开章节，在正文选中文字，然后保存摘录或用摘录制卡。
4. 关闭或卸载插件后，已保存的纯文本、原件、摘录、卡片和学习记录仍属于学习库。再次启用插件即可恢复章节阅读器。

阅读器中的「把选区保存为摘录」命令演示通过公开事务接口保存选区；材料检索中的「章节正文」提供器演示正文候选与版本定位。搜索按批读取最多100章，不维护另一个学习数据库；大量材料的正式提供器应使用可重建的派生索引。

原件不会被此插件修改；不把导入当成外部文件持续同步。每个文件最多1 MiB、16章，每章需要不同的`id`、`title`、`body`。同一文件的重复导入由宿主识别。格式固定为`version: 1`，文字支持中文和换行，不执行内嵌HTML或脚本。

## 开发

在本目录安装开发依赖后运行：

```sh
npm run typecheck
npm test
npm run build
```

仓库已有依赖时，也可从仓库根目录执行：

```sh
node packages/plugin-api/build.mjs docs/examples/material-plugin
node --test docs/examples/material-plugin/test/*.test.mjs
```

`format.ts`通过任务上下文的`createWorker`在后台线程解码UTF-8、解析JSON并校验章节，原始字节以transfer方式交给Worker。取消导入会结束等待；任务完成、失败、取消或卸载时由宿主终止Worker并释放blob URL。Node单元测试或旧宿主没有工厂时，才使用小文件和分批让出的回退。

原始字节、版本身份、资产保存、去重、事务与撤销由宿主管理。`ChapterReader.vue`只显示正文并报告绑定材料版本的选区，没有第二套卡片存储或评分实现。
