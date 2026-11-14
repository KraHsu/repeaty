<script setup>
import { computed, ref } from 'vue'
import { demo, navigate, commit } from './state.js'

const plugins = [
  {
    id: 'history',
    manifestId: 'review-history',
    name: '答题历史',
    initials: '历',
    version: '1.6.0',
    description: '复习时查看当前卡片最近的评分记录。',
    environment: '桌面与网页',
    category: 'study.review',
    settingsPath: '学习 / 复习',
    permissions: [],
    paragraphs: [
      '在复习卡片上方显示当前卡片最近的评分，便于回顾之前的记忆情况。',
      '四种颜色分别表示重来、困难、良好和简单，虚线圆表示本次作答。没有历史评分时，只显示本次作答标记。',
    ],
    steps: [
      '启用答题历史后，复习时会显示当前卡片已保存的评分。',
      '在“设置 → 学习 → 复习”中调整显示条数，范围为最近 1–50 次评分。',
      '开启“翻面后才显示历史”，可在回忆答案时暂时隐藏历史。',
    ],
    data: '插件只读取已有评分，不修改调度或评分结果。显示偏好保存在当前学习库中；关闭或卸载插件会保留历史和偏好。',
  },
  {
    id: 'leetcode',
    manifestId: 'leetcode',
    name: 'LeetCode',
    initials: '</>',
    version: '1.6.0',
    description: '将力扣题目加入卡组，编写代码并提交判题。',
    environment: '桌面应用',
    category: 'connections.leetcode',
    settingsPath: '连接 / LeetCode',
    permissions: ['https://leetcode.cn', 'https://leetcode.com', '设备凭据'],
    paragraphs: [
      '将力扣题目加入卡组，在 Repeaty 中编写代码、提交判题，并保存完整的作答与提交历史。支持中国站和国际站。',
      '读取公开题目不需要配置账号。提交判题前，需要在“设置 → 连接 → LeetCode”保存对应站点的登录信息。',
    ],
    steps: [
      '添加卡片时选择“添加 LeetCode 题目”，或在插件题目中选择 LeetCode。',
      '选择站点，输入题目链接或英文标识，再读取题目。',
      '复习时选择编程语言，编写代码并提交。判题结果保存在当前学习库中。',
      '根据需要手动评分，或按判题结果自动评分。',
    ],
    data: '插件仅向声明的力扣域名联网。Cookie 保存在本机设备私有存储中，不进入卡组导出。题目、笔记、调度和完整作答记录随学习目录保存；关闭或卸载插件不会删除这些数据。',
  },
  {
    id: 'typed',
    manifestId: 'typed-answer',
    name: 'Typed answer',
    initials: 'Aa',
    version: '1.6.0',
    description: '先输入答案，再查看参考答案并比较。',
    environment: '桌面与网页',
    permissions: [],
    paragraphs: [
      '输入答案后再查看参考答案的示例题型，适用于桌面版和网页版。比较时忽略大小写与首尾空格。',
      '此插件没有全局配置项。每张卡片的题目和预期答案在卡片编辑器中设置。',
    ],
    steps: [
      '添加卡片时选择插件题型 Typed answer。',
      '填写题目和预期答案。',
      '复习时先输入答案；匹配后可使用全部评分，未匹配时只能选择重来。',
    ],
    data: '不需要联网、设备凭据或文件权限。题目、预期答案与学习进度保存在当前学习库中，关闭或卸载插件不会删除这些数据。',
  },
]
const aliases = { 'review-history': 'history', 'typed-answer': 'typed' }
const selected = computed(
  () =>
    plugins.find((plugin) => plugin.id === (aliases[demo.selectedPlugin] ?? demo.selectedPlugin)) ??
    plugins[0],
)
const enabledCount = computed(
  () => plugins.filter((plugin) => demo.data.enabledPlugins[plugin.id]).length,
)
const pendingDisable = ref(null)
const dialogVisible = computed({
  get: () => !!pendingDisable.value,
  set: (visible) => {
    if (!visible) pendingDisable.value = null
  },
})
function selectPlugin(id) {
  navigate('plugins', { selectedPlugin: id })
}
function configure(plugin) {
  navigate('settings', { settingsCategory: plugin.category })
}
function togglePlugin(plugin, enabled) {
  if (!enabled) {
    pendingDisable.value = plugin
    return
  }
  commit((data) => {
    data.enabledPlugins[plugin.id] = true
  }, `已启用 ${plugin.name}`)
}
function confirmDisable() {
  const plugin = pendingDisable.value
  if (!plugin) return
  if (
    commit((data) => {
      data.enabledPlugins[plugin.id] = false
    }, `已停用 ${plugin.name}，已有数据保留`)
  )
    pendingDisable.value = null
}
</script>

<template>
  <div class="plugins-view">
    <header class="page-head">
      <div><h1>插件</h1></div>
      <PButton label="安装插件包" outlined disabled title="插件包安装需在桌面客户端完成" />
    </header>
    <div class="plugins-layout">
      <aside class="plugin-list-panel">
        <div class="list-heading">
          <h2>学习库插件</h2>
          <span class="muted meta">{{ enabledCount }} / {{ plugins.length }} 已启用</span>
        </div>
        <nav class="plugin-list" aria-label="插件列表">
          <button
            v-for="plugin in plugins"
            :key="plugin.id"
            type="button"
            class="plugin-list-item"
            :class="{ selected: selected.id === plugin.id }"
            :aria-current="selected.id === plugin.id ? 'page' : undefined"
            @click="selectPlugin(plugin.id)"
          >
            <span class="plugin-mark" aria-hidden="true">{{ plugin.initials }}</span>
            <span class="plugin-list-copy"
              ><strong>{{ plugin.name }}</strong
              ><span class="plugin-list-environment">{{ plugin.environment }}</span></span
            >
            <span
              class="list-state"
              :class="{ enabled: demo.data.enabledPlugins[plugin.id] }"
              :aria-label="demo.data.enabledPlugins[plugin.id] ? '已启用' : '已停用'"
              :title="demo.data.enabledPlugins[plugin.id] ? '已启用' : '已停用'"
            ></span>
          </button>
        </nav>
        <div class="plugin-list-note">
          <p>插件与学习目录一同保存。</p>
          <p>关闭插件会保留题目、历史与设置。</p>
        </div>
      </aside>

      <article class="plugin-detail" :aria-labelledby="`plugin-title-${selected.id}`">
        <header class="plugin-detail-heading">
          <div class="plugin-title-row">
            <span class="plugin-mark large" aria-hidden="true">{{ selected.initials }}</span>
            <div>
              <div class="plugin-name-line">
                <h2 :id="`plugin-title-${selected.id}`">{{ selected.name }}</h2>
                <span class="version">v{{ selected.version }}</span>
              </div>
              <p class="muted">{{ selected.description }}</p>
            </div>
          </div>
          <div class="plugin-enable-row">
            <div>
              <label :for="`enabled-${selected.id}`">{{
                demo.data.enabledPlugins[selected.id] ? '已启用' : '已停用'
              }}</label>
            </div>
            <PToggleSwitch
              :input-id="`enabled-${selected.id}`"
              :model-value="demo.data.enabledPlugins[selected.id]"
              @update:model-value="togglePlugin(selected, $event)"
            />
          </div>
          <PMessage v-if="demo.saveError" severity="error" :closable="false">{{
            demo.saveError
          }}</PMessage>
          <div v-if="selected.category" class="plugin-configure">
            <div>
              <span class="meta muted">配置位置</span>
              <p>设置 <span aria-hidden="true">/</span> {{ selected.settingsPath }}</p>
            </div>
            <PButton
              label="配置插件"
              :disabled="!demo.data.enabledPlugins[selected.id]"
              @click="configure(selected)"
            />
          </div>
          <p v-else class="no-configuration muted meta">
            没有全局配置项。在每张卡片中填写题目和预期答案。
          </p>
        </header>

        <div class="plugin-readme">
          <div class="readme-heading">
            <h3>介绍与使用</h3>
            <span class="meta muted">README</span>
          </div>
          <p v-for="paragraph in selected.paragraphs" :key="paragraph">{{ paragraph }}</p>
          <h4>开始使用</h4>
          <ol>
            <li v-for="step in selected.steps" :key="step">{{ step }}</li>
          </ol>
          <h4>数据与权限</h4>
          <p>{{ selected.data }}</p>
          <PMessage v-if="selected.id === 'leetcode'" severity="info" :closable="false"
            >LeetCode 的读取题目、登录和判题需要桌面客户端。</PMessage
          >
        </div>

        <section class="plugin-metadata" aria-labelledby="plugin-info-heading">
          <h3 id="plugin-info-heading">插件信息</h3>
          <dl>
            <div>
              <dt>插件标识</dt>
              <dd>
                <code>{{ selected.manifestId }}</code>
              </dd>
            </div>
            <div>
              <dt>运行环境</dt>
              <dd>{{ selected.environment }}</dd>
            </div>
            <div>
              <dt>安装位置</dt>
              <dd>
                <code>.repeaty/plugins/{{ selected.manifestId }}/</code
                ><span class="path-note">桌面学习目录中的位置</span>
              </dd>
            </div>
            <div>
              <dt>访问权限</dt>
              <dd>
                <template v-if="selected.permissions.length"
                  ><span
                    v-for="permission in selected.permissions"
                    :key="permission"
                    class="permission-item"
                    >{{ permission }}</span
                  ></template
                ><span v-else>无原生能力</span>
              </dd>
            </div>
          </dl>
        </section>
        <footer class="plugin-manage-actions">
          <div class="actions">
            <PButton label="安装或更新官方插件" outlined disabled /><PButton
              label="重新扫描插件"
              text
              disabled
            /><PButton label="卸载插件" severity="danger" text disabled />
          </div>
          <p class="muted meta">插件包安装、更新、扫描与卸载需在桌面客户端完成。</p>
        </footer>
      </article>
    </div>

    <PDialog
      v-model:visible="dialogVisible"
      modal
      :header="`停用 ${pendingDisable?.name ?? '插件'}？`"
      :style="{ width: '440px' }"
      :breakpoints="{ '600px': '92vw' }"
      :draggable="false"
    >
      <p class="disable-message">
        插件提供的交互将暂停。题目、调度、评分历史和设置都会保留，可以随时重新启用。
      </p>
      <PMessage v-if="demo.saveError" severity="error" :closable="false">{{
        demo.saveError
      }}</PMessage>
      <template #footer
        ><PButton label="取消" text @click="pendingDisable = null" /><PButton
          label="停用插件"
          @click="confirmDisable"
      /></template>
    </PDialog>
  </div>
</template>

<style scoped>
.plugin-list-panel {
  min-width: 0;
  max-width: 100%;
}
.plugin-configure {
  flex-wrap: wrap;
}
.plugins-view {
  padding-bottom: 32px;
}
.eyebrow {
  font-size: 0.875rem;
  color: #52665a;
  margin: 0 0 4px;
}
.intro {
  margin: 8px 0 0;
  font-size: 1rem;
}
.plugins-layout {
  max-width: 1210px;
  display: grid;
  grid-template-columns: 288px minmax(0, 1fr);
  gap: 30px;
  margin-top: 32px;
}
.plugin-list-panel {
  position: sticky;
  top: 24px;
  align-self: start;
}
.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 4px 18px;
  gap: 10px;
}
.list-heading h2 {
  font-size: 0.875rem;
  font-weight: 650;
  margin: 0;
  color: #52665a;
}
.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plugin-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 86px;
  width: 100%;
  padding: 16px 14px;
  border: 1px solid transparent;
  border-radius: 11px;
  color: #243c31;
  text-align: left;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.plugin-list-item:hover {
  background: #edf1e8;
}
.plugin-list-item.selected {
  background: #e5eddf;
  border-color: #c5d4bc;
}
.plugin-list-item:focus-visible {
  outline: 3px solid #6c9275;
  outline-offset: 3px;
}
.plugin-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #d8e1d4;
  color: #34674d;
  font-size: 1.125rem;
  font-weight: 650;
  font-family: 'Segoe UI', 'Microsoft YaHei UI', sans-serif;
}
.plugin-mark.large {
  flex-basis: 56px;
  width: 56px;
  height: 56px;
  font-size: 1.4375rem;
  border-radius: 13px;
  background: #edf2e9;
}
.plugin-list-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}
.plugin-list-copy strong {
  font-weight: 600;
  font-size: 1rem;
}
.plugin-list-environment {
  font-size: 0.875rem;
  color: #52665a;
}
.list-state {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #adb8a8;
  flex-shrink: 0;
  margin-left: 2px;
}
.list-state.enabled {
  background: #487557;
}
.plugin-list-note {
  margin: 24px 8px;
  color: #52665a;
  font-size: 0.875rem;
  line-height: 1.65;
  border-top: 1px solid #d8e1d4;
  padding-top: 16px;
}
.plugin-list-note p {
  margin: 0 0 6px;
}
.plugin-detail {
  border: 1px solid #d8e1d4;
  background: #fff;
  border-radius: 14px;
  padding: 30px 34px;
  min-width: 0;
}
.plugin-title-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.plugin-name-line {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.plugin-name-line h2 {
  font-size: 1.5rem;
  margin: 0;
  line-height: 1.45;
  font-weight: 650;
}
.version {
  color: #52665a;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.plugin-title-row p {
  font-size: 0.875rem;
  line-height: 1.7;
  margin: 7px 0 0;
}
.plugin-enable-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  margin: 24px 0;
  padding: 18px 0;
  border-top: 1px solid #e5ebe1;
  border-bottom: 1px solid #e5ebe1;
}
.plugin-enable-row label {
  font-weight: 600;
  font-size: 1rem;
}
.plugin-enable-row p {
  margin: 5px 0 0;
}
.plugin-configure {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
.plugin-configure p {
  margin: 6px 0 0;
  font-size: 1rem;
}
.plugin-configure p > span {
  color: #8b9d83;
  margin: 0 5px;
}
.no-configuration {
  margin: 0 0 28px;
  line-height: 1.7;
}
.plugin-readme {
  border-top: 1px solid #d8e1d4;
  padding: 25px 0 20px;
}
.readme-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 17px;
}
.readme-heading h3,
.plugin-metadata h3 {
  font-size: 1.125rem;
  font-weight: 650;
  margin: 0;
}
.plugin-readme p {
  font-size: 1rem;
  line-height: 1.8;
  margin: 0 0 16px;
  color: #344d3e;
}
.plugin-readme h4 {
  font-size: 1rem;
  font-weight: 650;
  margin: 26px 0 12px;
}
.plugin-readme ol {
  font-size: 1rem;
  line-height: 1.8;
  padding-left: 23px;
  margin: 0;
}
.plugin-readme li {
  padding-left: 3px;
  margin: 9px 0;
  color: #344d3e;
}
.plugin-metadata {
  border-top: 1px solid #e5ebe1;
  padding-top: 24px;
}
.plugin-metadata dl {
  margin: 18px 0 0;
}
.plugin-metadata dl > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 16px;
  padding: 10px 0;
  font-size: 0.875rem;
  line-height: 1.7;
}
.plugin-metadata dt {
  color: #52665a;
}
.plugin-metadata dd {
  margin: 0;
  color: #344d3e;
  overflow-wrap: anywhere;
}
.plugin-metadata code {
  font-family: Consolas, monospace;
  font-size: 0.875rem;
}
.path-note {
  display: block;
  color: #64765c;
  font-size: 0.875rem;
  margin-top: 3px;
}
.permission-item {
  display: block;
}
.plugin-manage-actions {
  padding-top: 24px;
  margin-top: 18px;
  border-top: 1px solid #e5ebe1;
}
.plugin-manage-actions .actions {
  gap: 8px;
}
.plugin-manage-actions p {
  margin: 15px 0 0;
  line-height: 1.6;
}
.plugins-view :deep(.p-button) {
  min-height: 44px;
}
.plugins-view :deep(.p-message-text) {
  font-size: 0.875rem;
  line-height: 1.6;
}
.disable-message {
  font-size: 1rem;
  line-height: 1.75;
  margin: 0 0 16px;
}
@media (max-width: 1050px) {
  .plugins-layout {
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 22px;
  }
  .plugin-detail {
    padding: 25px;
  }
  .plugin-list-item {
    gap: 10px;
    padding: 14px 10px;
  }
  .plugin-mark {
    flex-basis: 36px;
    width: 36px;
    height: 36px;
  }
  .plugin-list-copy strong {
    font-size: 1rem;
  }
  .plugin-list-copy .plugin-list-environment {
    font-size: 0.875rem;
  }
  .plugin-name-line h2 {
    font-size: 1.375rem;
  }
}
@media (max-width: 760px) {
  .plugins-layout {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 24px;
  }
  .plugin-list-panel {
    position: static;
  }
  .plugin-list {
    flex-direction: row;
    overflow-x: auto;
    padding: 3px 3px 8px;
  }
  .plugin-list-item {
    min-width: 208px;
    flex: 1;
    min-height: 78px;
  }
  .plugin-list-note {
    display: none;
  }
  .list-heading {
    padding-bottom: 10px;
  }
  .plugin-detail {
    padding: 24px;
  }
  .plugin-name-line h2 {
    font-size: 1.375rem;
  }
  .plugin-title-row .large {
    flex-basis: 48px;
    width: 48px;
    height: 48px;
  }
  .plugin-manage-actions .actions {
    flex-wrap: wrap;
  }
}
@media (max-width: 480px) {
  .plugins-view > .page-head {
    align-items: flex-start;
    gap: 16px;
  }
  .plugin-detail {
    padding: 20px 17px;
    border-radius: 12px;
  }
  .plugin-title-row {
    gap: 12px;
  }
  .plugin-title-row .large {
    flex-basis: 42px;
    width: 42px;
    height: 42px;
    font-size: 1.1875rem;
  }
  .plugin-name-line {
    gap: 8px;
  }
  .plugin-name-line h2 {
    font-size: 1.3125rem;
  }
  .plugin-configure {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .plugin-metadata dl > div {
    grid-template-columns: 80px minmax(0, 1fr);
    gap: 12px;
  }
  .plugin-enable-row {
    margin: 20px 0;
  }
  .plugin-list-item {
    min-width: 196px;
  }
}
</style>
