<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { demo, navigate, saveSettings, notice, setNavigationGuard } from './state.js'
import { aiSkillText } from './settingsContent.js'

const categories = [
  {
    key: 'general',
    label: '通用',
    children: [
      { key: 'general.appearance', label: '界面' },
      { key: 'general.notifications', label: '通知' },
    ],
  },
  { key: 'study', label: '学习', children: [{ key: 'study.review', label: '复习' }] },
  {
    key: 'connections',
    label: '连接',
    children: [
      { key: 'connections.mcp', label: 'MCP 连接' },
      { key: 'connections.leetcode', label: 'LeetCode' },
    ],
  },
  { key: 'workspace', label: '工作目录' },
  { key: 'tools', label: '工具', children: [{ key: 'tools.ai', label: 'AI 制卡' }] },
]
const aliases = {
  appearance: 'general.appearance',
  notifications: 'general.notifications',
  review: 'study.review',
  history: 'study.review',
  leetcode: 'connections.leetcode',
  mcp: 'connections.mcp',
  ai: 'tools.ai',
}
const flatCategories = categories.flatMap((category) => [category, ...(category.children ?? [])])
const category = computed(() => {
  const candidate = aliases[demo.settingsCategory] ?? demo.settingsCategory
  return flatCategories.some((item) => item.key === candidate) ? candidate : 'general'
})
const mobileCategories = categories.flatMap((item) => [
  { label: item.label, value: item.key },
  ...(item.children ?? []).map((child) => ({
    label: `${item.label} / ${child.label}`,
    value: child.key,
  })),
])
const title = computed(() => flatCategories.find((item) => item.key === category.value)?.label)
const shows = (key) => key === category.value || key.startsWith(`${category.value}.`)
const draft = reactive({ ...demo.data.settings })
const saved = computed(() => demo.data.settings)
const dirty = computed(() => Object.keys(draft).some((key) => draft[key] !== saved.value[key]))
const pendingNavigation = ref(null)
const leaveDialogVisible = computed({
  get: () => !!pendingNavigation.value,
  set: (visible) => {
    if (!visible) pendingNavigation.value = null
  },
})
const unregisterNavigationGuard = setNavigationGuard((view, options) => {
  if (view === 'settings' || !dirty.value) return true
  pendingNavigation.value = { view, options: { ...options } }
  return false
})
onBeforeUnmount(unregisterNavigationGuard)
function discardAndLeave() {
  const destination = pendingNavigation.value
  if (!destination) return
  unregisterNavigationGuard()
  pendingNavigation.value = null
  navigate(destination.view, destination.options)
}
const invalidHistory = computed(
  () => !Number.isInteger(draft.historyLimit) || draft.historyLimit < 1 || draft.historyLimit > 50,
)
const hasEditableFields = computed(
  () =>
    shows('general.appearance') ||
    shows('general.notifications') ||
    (shows('study.review') && demo.data.enabledPlugins.history),
)
const client = ref('codex')
const sites = [
  { id: 'cn', name: '中国站', host: 'leetcode.cn' },
  { id: 'com', name: '国际站', host: 'leetcode.com' },
]
const credentials = reactive({ cn: { session: '', csrf: '' }, com: { session: '', csrf: '' } })
watch(saved, (value, previous) => {
  for (const key of Object.keys(value)) if (draft[key] === previous?.[key]) draft[key] = value[key]
})
function selectCategory(key) {
  navigate('settings', { settingsCategory: key })
}
function save() {
  if (invalidHistory.value) return
  if (saveSettings({ ...draft })) Object.assign(draft, demo.data.settings)
}
function reset() {
  Object.assign(draft, demo.data.settings)
}
function details(id) {
  navigate('plugins', { selectedPlugin: id })
}
async function copyInstructions() {
  try {
    await navigator.clipboard.writeText(aiSkillText)
    notice('制卡说明已复制')
  } catch {
    notice('复制未完成，请在下方选中说明并手动复制。', 'warn')
  }
}
function downloadInstructions() {
  const url = URL.createObjectURL(new Blob([aiSkillText], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'SKILL.md'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="settings-view">
    <header class="page-head">
      <div><h1>设置</h1></div>
    </header>
    <div class="settings-layout">
      <nav class="settings-navigation" aria-label="设置分类">
        <div v-for="group in categories" :key="group.key" class="category-group">
          <button
            type="button"
            class="category-button category-parent"
            :class="{ active: category === group.key }"
            :aria-current="category === group.key ? 'page' : undefined"
            @click="selectCategory(group.key)"
          >
            {{ group.label }}
          </button>
          <div v-if="group.children" class="category-children">
            <button
              v-for="child in group.children"
              :key="child.key"
              type="button"
              class="category-button"
              :class="{ active: category === child.key }"
              :aria-current="category === child.key ? 'page' : undefined"
              @click="selectCategory(child.key)"
            >
              {{ child.label }}
            </button>
          </div>
        </div>
      </nav>
      <div class="mobile-category">
        <label for="settings-category">设置分类</label>
        <PSelect
          input-id="settings-category"
          :model-value="category"
          :options="mobileCategories"
          option-label="label"
          option-value="value"
          @update:model-value="selectCategory"
        />
      </div>
      <div class="settings-body">
        <div class="settings-body-heading">
          <h2 id="settings-category-heading">{{ title }}</h2>
          <span v-if="dirty" class="draft-indicator" role="status">有未保存的更改</span>
        </div>

        <section
          v-if="shows('general.appearance')"
          class="setting-section"
          :aria-labelledby="title === '界面' ? 'settings-category-heading' : 'appearance-heading'"
        >
          <div v-if="title !== '界面'" class="setting-title">
            <h3 id="appearance-heading">界面</h3>
            <span class="source-label">Repeaty</span>
          </div>
          <div class="field-row">
            <div class="field-copy"><label for="interface-language">界面语言</label></div>
            <PSelect
              input-id="interface-language"
              v-model="draft.language"
              class="field-control"
              :options="[
                { label: '中文（简体）', value: 'zh-CN' },
                { label: 'English', value: 'en' },
              ]"
              option-label="label"
              option-value="value"
            />
          </div>
        </section>

        <section
          v-if="shows('general.notifications')"
          class="setting-section"
          aria-labelledby="notification-heading"
        >
          <div class="setting-title">
            <h3 id="notification-heading">弹出通知</h3>
            <span class="source-label">Repeaty</span>
          </div>
          <p class="muted section-description">关闭弹出后，通知改为在页面内显示。</p>
          <div
            v-for="item in [
              {
                key: 'information',
                label: '信息通知',
                help: '保存成功和一般提示，5 秒后自动关闭。',
              },
              { key: 'warning', label: '警告通知', help: '需要留意的情况，手动关闭。' },
              { key: 'error', label: '错误通知', help: '操作失败和保存错误，手动关闭。' },
            ]"
            :key="item.key"
            class="field-row"
          >
            <div class="field-copy">
              <label :for="`notification-${item.key}`">{{ item.label }}</label>
              <p :id="`notification-${item.key}-help`" class="muted meta">{{ item.help }}</p>
            </div>
            <PToggleSwitch
              :input-id="`notification-${item.key}`"
              v-model="draft[item.key]"
              :aria-describedby="`notification-${item.key}-help`"
            />
          </div>
        </section>

        <section
          v-if="shows('study.review')"
          class="setting-section"
          aria-labelledby="history-settings-heading"
        >
          <div class="setting-title">
            <div class="heading-with-source">
              <h3 id="history-settings-heading">答题历史</h3>
              <span class="source-label">插件 · 答题历史</span>
            </div>
            <PButton label="插件说明" text @click="details('history')" />
          </div>
          <template v-if="demo.data.enabledPlugins.history">
            <p class="muted section-description">调整当前卡片历史评分的显示方式。</p>
            <div class="field-row">
              <div class="field-copy">
                <label for="history-limit">显示条数</label>
                <p id="history-limit-help" class="muted meta">显示当前卡片最近 1–50 次评分。</p>
              </div>
              <div class="field-control number-control">
                <PInputNumber
                  input-id="history-limit"
                  v-model="draft.historyLimit"
                  :min="1"
                  :max="50"
                  :step="1"
                  :use-grouping="false"
                  show-buttons
                  :invalid="invalidHistory"
                  aria-describedby="history-limit-help history-limit-error"
                /><span>条</span>
              </div>
            </div>
            <p v-if="invalidHistory" id="history-limit-error" class="validation-error" role="alert">
              请输入 1–50 之间的整数。
            </p>
            <div class="field-row">
              <div class="field-copy">
                <label for="history-after-answer">翻面后才显示历史</label>
                <p id="history-reveal-help" class="muted meta">
                  开启后，显示答案时再展示历史记录。
                </p>
              </div>
              <PToggleSwitch
                input-id="history-after-answer"
                v-model="draft.historyAfterAnswer"
                aria-describedby="history-reveal-help"
              />
            </div>
          </template>
          <div v-else class="inactive-plugin">
            <p class="muted">答题历史已停用。已有历史与设置仍保留。</p>
            <PButton label="前往插件管理" outlined @click="details('history')" />
          </div>
        </section>

        <section
          v-if="shows('connections.mcp')"
          class="setting-section"
          :aria-labelledby="title === 'MCP 连接' ? 'settings-category-heading' : 'mcp-heading'"
        >
          <div class="setting-title">
            <h3 v-if="title !== 'MCP 连接'" id="mcp-heading">MCP 连接</h3>
            <span class="connection-status">未开启</span>
          </div>
          <p class="muted section-description">
            让本机 AI 客户端查询待复习题目、学习统计和练习摘要。
          </p>
          <div class="field-row">
            <div class="field-copy">
              <label for="mcp-client">MCP 客户端</label>
              <p class="muted meta">选择需要连接的客户端。</p>
            </div>
            <PSelect
              input-id="mcp-client"
              v-model="client"
              class="field-control"
              :options="[
                { value: 'codex', label: 'Codex' },
                { value: 'claude-code', label: 'Claude Code' },
                { value: 'claude-desktop', label: 'Claude Desktop' },
                { value: 'http', label: '通用 HTTP 客户端' },
              ]"
              option-label="label"
              option-value="value"
            />
          </div>
          <PMessage severity="info" :closable="false">MCP 连接需在桌面客户端开启。</PMessage>
          <div class="actions native-actions">
            <PButton label="开启 MCP" disabled /><PButton label="显示连接配置" outlined disabled />
          </div>
        </section>

        <section
          v-if="shows('connections.leetcode')"
          class="setting-section"
          :aria-labelledby="
            title === 'LeetCode' ? 'settings-category-heading' : 'leetcode-settings-heading'
          "
        >
          <div class="setting-title">
            <div class="heading-with-source">
              <h3 v-if="title !== 'LeetCode'" id="leetcode-settings-heading">LeetCode</h3>
              <span class="source-label">插件 · LeetCode</span>
            </div>
            <PButton label="插件说明" text @click="details('leetcode')" />
          </div>
          <template v-if="demo.data.enabledPlugins.leetcode">
            <p class="muted section-description">中国站和国际站分别管理登录信息。</p>
            <PMessage severity="info" :closable="false"
              >登录连接需在桌面客户端完成。此页面不会将登录信息写入磁盘。</PMessage
            >
            <div v-for="site in sites" :key="site.id" class="connection-site">
              <div class="site-heading">
                <div>
                  <h4>{{ site.name }}</h4>
                  <span class="muted meta">{{ site.host }}</span>
                </div>
                <span class="connection-status">未连接</span>
              </div>
              <div class="credentials-layout">
                <div class="stacked-field">
                  <label :for="`${site.id}-session`">LEETCODE_SESSION</label
                  ><PInputText
                    :id="`${site.id}-session`"
                    v-model="credentials[site.id].session"
                    type="password"
                    autocomplete="off"
                    :spellcheck="false"
                    placeholder="Cookie 值"
                  />
                </div>
                <div class="stacked-field">
                  <label :for="`${site.id}-csrf`">csrftoken</label
                  ><PInputText
                    :id="`${site.id}-csrf`"
                    v-model="credentials[site.id].csrf"
                    type="password"
                    autocomplete="off"
                    :spellcheck="false"
                    placeholder="Cookie 值"
                  />
                </div>
              </div>
              <div class="actions native-actions">
                <PButton label="保存登录信息" disabled /><PButton
                  label="刷新状态"
                  outlined
                  disabled
                />
              </div>
            </div>
          </template>
          <div v-else class="inactive-plugin">
            <p class="muted">LeetCode 已停用，登录与学习数据仍保留。</p>
            <PButton label="前往插件管理" outlined @click="details('leetcode')" />
          </div>
        </section>

        <section
          v-if="shows('workspace')"
          class="setting-section"
          :aria-labelledby="
            title === '工作目录' ? 'settings-category-heading' : 'workspace-settings-heading'
          "
        >
          <div v-if="title !== '工作目录'" class="setting-title">
            <h3 id="workspace-settings-heading">工作目录</h3>
            <span class="source-label">Repeaty</span>
          </div>
          <p class="muted section-description">卡片、材料、附件和学习进度保存在同一个文件夹中。</p>
          <div class="directory-display">
            <span class="meta muted">当前目录</span><code>D:\学习\Repeaty</code>
          </div>
          <p class="muted meta">在侧栏“工作目录”中创建、打开或关闭学习库。</p>
          <PButton label="查看工作目录" outlined @click="navigate('workspace')" />
        </section>

        <section
          v-if="shows('tools.ai')"
          class="setting-section"
          :aria-labelledby="title === 'AI 制卡' ? 'settings-category-heading' : 'ai-heading'"
        >
          <div v-if="title !== 'AI 制卡'" class="setting-title">
            <h3 id="ai-heading">AI 制卡</h3>
            <span class="source-label">Repeaty</span>
          </div>
          <p class="muted section-description">不用 MCP，也可以让 AI 帮忙制卡。</p>
          <ol class="instruction-list">
            <li>复制制卡说明，连同学习材料发给 AI 聊天工具。</li>
            <li>将生成的 CSV 复制或保存为文件，在卡组中选择“批量导入”。</li>
            <li>检查预览和答案，再确认导入。</li>
          </ol>
          <p class="muted meta">只分享本次制卡需要的材料，无需账户、Cookie 或完整备份。</p>
          <div class="actions instruction-actions">
            <PButton label="复制制卡说明" @click="copyInstructions" /><PButton
              label="下载 SKILL.md"
              outlined
              @click="downloadInstructions"
            />
          </div>
          <div class="stacked-field">
            <label for="ai-card-instructions">制卡说明（可直接粘贴到 AI 聊天中）</label
            ><PTextarea
              id="ai-card-instructions"
              :model-value="aiSkillText"
              :rows="12"
              readonly
              :spellcheck="false"
              class="skill-content"
            />
          </div>
        </section>

        <div v-if="hasEditableFields || dirty" class="save-bar">
          <PMessage v-if="demo.saveError" severity="error" :closable="false"
            >{{ demo.saveError }} 输入内容已保留，可再次保存。</PMessage
          >
          <div class="save-bar-content">
            <span class="muted meta">更改将在保存后应用。</span>
            <div class="actions">
              <PButton label="还原更改" text :disabled="!dirty" @click="reset" /><PButton
                label="保存设置"
                :disabled="!dirty || invalidHistory"
                @click="save"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <PDialog
      v-model:visible="leaveDialogVisible"
      modal
      header="离开设置？"
      :style="{ width: '440px' }"
      :breakpoints="{ '600px': '92vw' }"
      :draggable="false"
    >
      <p class="leave-dialog-copy">有尚未保存的更改。离开后，这些更改将被放弃。</p>
      <template #footer
        ><PButton label="继续编辑" text @click="pendingNavigation = null" /><PButton
          label="放弃更改并离开"
          @click="discardAndLeave"
      /></template>
    </PDialog>
  </div>
</template>

<style scoped>
.settings-body {
  container-type: inline-size;
}
.settings-body .source-label {
  line-height: 1.3;
}
.settings-body .field-control {
  max-width: 100%;
  width: min(100%, 15rem);
}
.settings-body .field-control :deep(.p-select) {
  width: 100%;
}
.settings-body .field-control :deep(.p-select-label) {
  white-space: normal;
  overflow: visible;
}
@container (max-width: 36rem) {
  .field-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .field-control {
    justify-self: start;
  }
  .save-bar-content {
    flex-direction: column;
    align-items: flex-start;
  }
  .setting-title,
  .save-bar-content > .actions {
    flex-wrap: wrap;
  }
}
.settings-view {
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
.settings-layout {
  max-width: 1184px;
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  gap: 44px;
  margin-top: 32px;
}
.settings-navigation {
  position: sticky;
  top: 24px;
  align-self: start;
}
.category-group {
  margin-bottom: 10px;
}
.category-button {
  display: block;
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  text-align: left;
  background: transparent;
  color: #52665a;
  font: inherit;
  font-size: 1rem;
  padding: 10px 16px;
  cursor: pointer;
}
.category-button:hover {
  background: #eaf0e6;
}
.category-button.active {
  color: #24583e;
  background: #e5eddf;
  font-weight: 650;
}
.category-parent {
  font-weight: 650;
  color: #243c31;
}
.category-children {
  margin: 2px 0 0 15px;
  border-left: 1px solid #d8e1d4;
  padding-left: 8px;
}
.category-children .category-button {
  font-size: 0.875rem;
}
.category-button:focus-visible {
  outline: 3px solid #6c9275;
  outline-offset: 2px;
}
.settings-body {
  min-width: 0;
  background: #fff;
  border: 1px solid #d8e1d4;
  border-radius: 14px;
  padding: 30px 36px;
}
.settings-body-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 23px;
  border-bottom: 1px solid #e5ebe1;
}
.settings-body-heading h2 {
  font-size: 1.375rem;
  line-height: 1.4;
  margin: 0;
  font-weight: 650;
}
.draft-indicator {
  font-size: 0.875rem;
  color: #6a673f;
}
.setting-section {
  padding: 27px 0;
}
.setting-section + .setting-section {
  border-top: 1px solid #e5ebe1;
}
.setting-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  min-height: 36px;
}
.setting-title h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 650;
}
.source-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #52665a;
  border: 1px solid #dce5d6;
  border-radius: 5px;
  padding: 3px 7px;
  line-height: 18px;
  white-space: nowrap;
}
.heading-with-source {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.section-description {
  font-size: 0.875rem;
  line-height: 1.65;
  margin: 0 0 12px;
}
.field-row {
  min-height: 86px;
  gap: 24px;
}
.field-copy label {
  font-size: 1rem;
  font-weight: 550;
}
.field-copy p {
  margin: 5px 0 0;
  font-size: 0.875rem;
  line-height: 1.55;
}
.field-control {
  max-width: 234px;
  width: 100%;
}
.number-control {
  max-width: 168px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #52665a;
}
.number-control :deep(.p-inputnumber) {
  min-width: 0;
  width: 126px;
}
.number-control :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}
.validation-error {
  font-size: 0.875rem;
  color: #a14537;
  margin: 0 0 12px;
}
.connection-status {
  font-size: 0.875rem;
  color: #52665a;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.connection-status:before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #91a18d;
}
.native-actions {
  margin-top: 18px;
}
.connection-site {
  padding: 24px 0;
}
.connection-site + .connection-site {
  border-top: 1px solid #e5ebe1;
}
.site-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}
.site-heading h4 {
  font-size: 1rem;
  margin: 0 0 3px;
}
.credentials-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.stacked-field {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.stacked-field label {
  font-size: 0.875rem;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.stacked-field :deep(input) {
  width: 100%;
  min-width: 0;
}
.directory-display {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f3f5f0;
  padding: 18px 20px;
  border-radius: 8px;
  margin: 20px 0;
}
.directory-display code {
  font-family: Consolas, monospace;
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.instruction-list {
  padding-left: 23px;
  font-size: 1rem;
  line-height: 1.8;
  margin: 18px 0;
}
.instruction-list li + li {
  margin-top: 9px;
}
.instruction-actions {
  margin: 22px 0;
}
.skill-content {
  font-family: Consolas, monospace;
  font-size: 0.875rem;
  line-height: 1.65;
  width: 100%;
  resize: vertical;
}
.save-bar {
  border-top: 1px solid #d8e1d4;
  padding-top: 22px;
  margin-top: 8px;
}
.save-bar-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.save-bar :deep(.p-message) {
  margin-bottom: 18px;
}
.save-bar .actions {
  flex-shrink: 0;
}
.inactive-plugin {
  padding: 14px 0;
}
.mobile-category {
  display: none;
}
.settings-view :deep(.p-button) {
  min-height: 44px;
}
.settings-view :deep(.p-inputtext),
.settings-view :deep(.p-select) {
  min-height: 44px;
}
.settings-view :deep(.p-message-text) {
  font-size: 0.875rem;
  line-height: 1.6;
}
@media (max-width: 1000px) {
  .settings-layout {
    grid-template-columns: 152px minmax(0, 1fr);
    gap: 24px;
  }
  .settings-body {
    padding: 24px;
  }
  .save-bar-content {
    align-items: flex-start;
    flex-direction: column;
  }
  .credentials-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .settings-layout {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 24px;
  }
  .settings-navigation {
    display: none;
  }
  .mobile-category {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mobile-category label {
    font-size: 0.875rem;
    color: #52665a;
  }
  .settings-body {
    padding: 22px 20px;
    border-radius: 12px;
  }
  .field-row {
    gap: 18px;
  }
  .field-control {
    max-width: 190px;
  }
  .settings-body-heading h2 {
    font-size: 1.25rem;
  }
  .setting-title {
    align-items: flex-start;
  }
  .heading-with-source {
    gap: 7px;
  }
  .save-bar-content > .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
@media (max-width: 480px) {
  .field-row {
    flex-wrap: wrap;
  }
  .field-control {
    max-width: none;
  }
  .field-copy {
    flex: 1;
    min-width: 170px;
  }
  .field-row:has(.field-control) {
    align-items: flex-start;
    flex-direction: column;
  }
  .number-control {
    max-width: 168px;
  }
  .setting-title > .source-label {
    display: none;
  }
  .settings-body {
    padding: 20px 16px;
  }
  .draft-indicator {
    font-size: 0.875rem;
  }
  .settings-body-heading {
    gap: 10px;
  }
  .save-bar-content > .actions {
    flex-wrap: wrap;
  }
}
.leave-dialog-copy {
  font-size: 1rem;
  line-height: 1.75;
  margin: 0 0 16px;
}
</style>
