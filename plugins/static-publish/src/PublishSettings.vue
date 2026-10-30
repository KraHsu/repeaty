<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  SettingField,
  SettingSection,
  UiButton,
  UiInput,
  UiNotice,
  UiSelect,
  UiTextarea,
  nativePlugin,
  pluginData,
  publishing,
  network,
} from '@repeaty/plugin-api'
import { checkTargetChange, defaults, loadConfig, saveConfig, validateConfig } from './settings'
import { defaultTheme } from './theme'
import {
  createProject,
  inspectProject,
  removeProject,
  targetKey,
  type DeploymentState,
  type CloudflareTarget,
} from './cloudflare/client'
import { message, t } from './text'

const config = ref(defaults())
const fields = ref('')
const template = ref<'page' | 'archive' | 'css' | 'script'>('page')
const token = ref('')
const credential = ref(false)
const error = ref('')
const notice = ref('')
const loading = ref(true)
const busy = ref('')
const createConfirmation = ref(false)
const deleteConfirmation = ref(false)
const deleteName = ref('')
const resetConfirmation = ref(false)
const savedTarget = ref(defaults().target)
const confirmedTarget = ref<CloudflareTarget>()
const connectionSaved = computed(
  () => JSON.stringify(config.value.target) === JSON.stringify(savedTarget.value),
)
watch(
  () => JSON.stringify(config.value.target),
  () => {
    createConfirmation.value = false
    deleteConfirmation.value = false
    confirmedTarget.value = undefined
    deleteName.value = ''
  },
)
function confirmTarget(kind: 'create' | 'delete') {
  if (!connectionSaved.value) return
  confirmedTarget.value = JSON.parse(JSON.stringify(savedTarget.value))
  createConfirmation.value = kind === 'create'
  deleteConfirmation.value = kind === 'delete'
}
async function validatedTarget() {
  const saved = await loadConfig()
  if (
    !connectionSaved.value ||
    !confirmedTarget.value ||
    JSON.stringify(saved.target) !== JSON.stringify(confirmedTarget.value)
  )
    throw new Error(
      t('连接目标已变化，请重新确认。', 'The connection target changed. Confirm it again.'),
    )
  return confirmedTarget.value
}
const files = computed(() => [
  { value: 'page', label: 'page.html' },
  { value: 'archive', label: 'archive.html' },
  { value: 'css', label: 'style.css' },
  { value: 'script', label: 'site.js' },
])
let controller: AbortController | undefined
let alive = true
const scope = publishing.list().workspaceScope
const ports = {
  request: network.request,
  save: async (state: DeploymentState) => {
    await pluginData.set('deployment-v1', state, scope)
  },
}
function resetTheme() {
  config.value.theme = defaultTheme()
  resetConfirmation.value = false
}
function cancelDelete() {
  deleteConfirmation.value = false
  deleteName.value = ''
}
async function credentialState() {
  const response = (await nativePlugin('secrets', { action: 'state' })) as {
    slots?: { slot: string; revision: number }[]
  }
  const found = response.slots?.find((item) => item.slot === config.value.target.credentialSlot)
  credential.value = !!found
  config.value.target.credentialRevision = found?.revision
}
async function operation(name: string, task: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return
  busy.value = name
  error.value = ''
  notice.value = ''
  controller = new AbortController()
  try {
    await task(controller.signal)
  } catch (cause) {
    if (alive) error.value = message(cause)
  } finally {
    if (alive) busy.value = ''
    controller = undefined
  }
}
async function save() {
  await operation('save', async () => {
    config.value.publicFields = [
      ...new Set(
        fields.value
          .split(/[,，\n]/u)
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    ]
    await saveConfig({ ...config.value, target: savedTarget.value })
    if (alive)
      notice.value = t(
        '站点与主题设置已保存。请重新生成预览以应用更改。',
        'Site and theme settings saved. Regenerate the preview to apply changes.',
      )
  })
}
async function saveConnection() {
  await operation('connect', async () => {
    targetKey(config.value.target)
    validateConfig(config.value)
    await checkTargetChange(config.value.target)
    if (token.value.trim()) {
      await nativePlugin('secrets', {
        action: 'set',
        slot: config.value.target.credentialSlot,
        origin: 'https://api.cloudflare.com',
        values: { token: token.value.trim() },
      })
      token.value = ''
    }
    await credentialState()
    if (!credential.value)
      throw new Error(t('请先保存此设备的 API token。', 'Save an API token on this device first.'))
    await saveConfig(config.value)
    savedTarget.value = JSON.parse(JSON.stringify(config.value.target))
    if (alive)
      notice.value = t(
        '连接已保存。凭据只保存在此设备。',
        'Connection saved. The credential remains on this device.',
      )
  })
}
async function inspect() {
  await operation('inspect', async (signal) => {
    const saved = await loadConfig()
    const result = await inspectProject(saved.target, ports, signal)
    if (alive)
      notice.value = result.exists
        ? t(
            '项目存在，可在静态发布页更新站点。',
            'The project exists. Update the site from Static publishing.',
          )
        : t(
            '项目不存在。核对名称后，可创建新的 Pages 项目。',
            'The project is missing. Verify the name before creating it.',
          )
  })
}
async function create() {
  createConfirmation.value = false
  await operation('create', async (signal) => {
    const target = await validatedTarget()
    await createProject(target, ports, signal)
    if (alive)
      notice.value = t(
        'Pages 项目已就绪，尚未上传学习内容。',
        'The Pages project is ready. No learning content has been uploaded.',
      )
  })
}
async function remove() {
  if (!confirmedTarget.value || deleteName.value !== confirmedTarget.value.projectName) return
  deleteConfirmation.value = false
  await operation('remove', async (signal) => {
    const target = await validatedTarget()
    const state = (await pluginData.get('deployment-v1', scope)) as DeploymentState | undefined
    if (!state)
      throw new Error(
        t(
          '没有本插件记录的部署，请在 Cloudflare 控制台管理该项目。',
          'This plugin has no deployment record. Manage this project in the Cloudflare dashboard.',
        ),
      )
    await removeProject(target, state, ports, signal)
    if (alive)
      notice.value = t(
        '删除请求已处理，请在发布页核对远端状态。本地站点仍保留。',
        'Deletion request handled. Check the remote status on the publishing page. The local site is kept.',
      )
  })
}
onMounted(async () => {
  try {
    const saved = await loadConfig()
    if (!alive) return
    config.value = saved
    fields.value = saved.publicFields.join(', ')
    try {
      await credentialState()
    } catch {
      /* The static generation path also works in a browser. */
    }
    savedTarget.value = JSON.parse(JSON.stringify(config.value.target))
  } catch (cause) {
    if (alive) error.value = message(cause)
  } finally {
    if (alive) loading.value = false
  }
})
onBeforeUnmount(() => {
  alive = false
  controller?.abort()
  token.value = ''
})
</script>

<template>
  <div class="publish-settings" :aria-busy="!!busy || loading">
    <UiNotice v-if="error" tone="error" role="alert">{{ error }}</UiNotice>
    <UiNotice v-if="notice" tone="success" role="status">{{ notice }}</UiNotice>
    <SettingField
      v-model="config.options.title"
      :label="t('站点标题', 'Site title')"
      :disabled="!!busy || loading"
    />
    <SettingField
      v-model="config.options.description"
      :label="t('站点说明', 'Site description')"
      :disabled="!!busy || loading"
    />
    <SettingField
      v-model="config.options.url"
      :label="t('公开地址', 'Public URL')"
      placeholder="https://notes.example.com/"
      :description="
        t(
          '用于 RSS 和站点地图。尚未托管时可留空，正式发布前请填写真实地址。',
          'Used in RSS and the sitemap. Leave blank for local work; enter the real address before publishing.',
        )
      "
      :disabled="!!busy || loading"
    />
    <SettingField
      v-model="config.options.pageSize"
      type="number"
      :label="t('每页文章数', 'Articles per page')"
      :min="1"
      :max="50"
      :disabled="!!busy || loading"
    />
    <SettingField
      v-model="fields"
      :label="t('公开属性', 'Public properties')"
      placeholder="tags, category"
      :description="
        t(
          '只输出这里明确填写的材料属性，用逗号分隔；默认不输出任何属性。',
          'Only the explicitly named material properties are included. Separate names with commas; none are public by default.',
        )
      "
      :disabled="!!busy || loading"
    />
    <SettingSection :title="t('主题', 'Theme')">
      <div class="publish-theme-toolbar">
        <UiSelect
          v-model="template"
          :items="files"
          :aria-label="t('主题文件', 'Theme file')"
        /><UiButton
          variant="ghost"
          :disabled="!!busy || loading"
          @click="resetConfirmation = true"
          >{{ t('恢复默认主题', 'Reset theme') }}</UiButton
        >
      </div>
      <UiTextarea
        v-model="config.theme[template]"
        class="publish-theme-source"
        :rows="12"
        :aria-label="files.find((file) => file.value === template)?.label"
        :spellcheck="false"
        :disabled="!!busy || loading"
      />
      <p class="publish-settings-note">
        {{
          t(
            'Liquid 模板仅能读取公开的 site 和 page。正文使用 page.content | raw；不能读取文件或执行模板代码。',
            'Liquid templates can only read public site and page data. Use page.content | raw for content; templates cannot access files or execute code.',
          )
        }}
      </p>
      <div v-if="resetConfirmation" class="publish-settings-confirm">
        <p>
          {{
            t(
              '将替换四份主题文件；学习材料和上次生成的站点仍保留。',
              'Replace all four theme files. Materials and the previous site remain intact.',
            )
          }}
        </p>
        <UiButton variant="secondary" @click="resetTheme">{{
          t('恢复主题', 'Reset theme')
        }}</UiButton
        ><UiButton variant="ghost" @click="resetConfirmation = false">{{
          t('取消', 'Cancel')
        }}</UiButton>
      </div>
    </SettingSection>
    <div class="publish-settings-actions">
      <UiButton
        variant="primary"
        :busy="busy === 'save'"
        :disabled="!!busy || loading"
        @click="save"
        >{{ t('保存站点与主题', 'Save site and theme') }}</UiButton
      >
    </div>
    <SettingSection
      title="Cloudflare Pages"
      :description="
        t(
          '联网发布使用桌面版。站点与连接信息随学习库保存，API token 只在设备上保存。',
          'Online publishing uses the desktop app. Site and connection settings travel with the library; API tokens stay on the device.',
        )
      "
    >
      <SettingField
        v-model="config.target.accountId"
        label="Account ID"
        :disabled="!!busy || loading"
        :spellcheck="false"
      />
      <SettingField
        v-model="config.target.projectName"
        :label="t('项目名称', 'Project name')"
        placeholder="learning-notes"
        :disabled="!!busy || loading"
        :spellcheck="false"
      />
      <SettingField
        v-model="config.target.branch"
        :label="t('部署分支', 'Deployment branch')"
        :disabled="!!busy || loading"
        :spellcheck="false"
      />
      <SettingField
        v-model="token"
        type="password"
        label="API token"
        :placeholder="
          credential
            ? t('留空保留此设备已保存的凭据', 'Leave blank to keep the saved device credential')
            : t(
                '具有此账号 Pages 编辑权限的 token',
                'Token with Pages edit permission for this account',
              )
        "
        :disabled="!!busy || loading"
        autocomplete="off"
        :spellcheck="false"
      />
      <div class="publish-settings-actions">
        <UiButton
          variant="secondary"
          :disabled="!!busy || loading"
          :busy="busy === 'connect'"
          @click="saveConnection"
          >{{ t('保存连接', 'Save connection') }}</UiButton
        ><UiButton
          variant="secondary"
          :disabled="!!busy || loading || !credential || !connectionSaved"
          @click="inspect"
          >{{ t('检查项目', 'Check project') }}</UiButton
        ><UiButton
          variant="ghost"
          :disabled="!!busy || loading || !credential || !connectionSaved"
          @click="confirmTarget('create')"
          >{{ t('创建项目', 'Create project') }}</UiButton
        >
      </div>
      <div v-if="createConfirmation" class="publish-settings-confirm">
        <p>
          {{
            t(
              '确认在已保存的账号下创建 Pages 项目？现有同名项目会先核对，不重复创建。',
              'Create the Pages project in the saved account? An existing project with this name is checked first.',
            )
          }}
          <strong v-if="confirmedTarget"
            >{{ confirmedTarget.accountId }} / {{ confirmedTarget.projectName }} /
            {{ confirmedTarget.branch }}</strong
          >
        </p>
        <UiButton variant="secondary" :disabled="!!busy || !connectionSaved" @click="create">{{
          t('确认创建', 'Confirm creation')
        }}</UiButton
        ><UiButton variant="ghost" @click="createConfirmation = false">{{
          t('取消', 'Cancel')
        }}</UiButton>
      </div>
      <div class="publish-remove">
        <UiButton
          variant="ghost"
          :disabled="!!busy || loading || !credential || !connectionSaved"
          @click="confirmTarget('delete')"
          >{{ t('删除远端项目…', 'Delete remote project…') }}</UiButton
        >
      </div>
      <div v-if="deleteConfirmation" class="publish-settings-confirm">
        <p v-if="confirmedTarget">
          {{ confirmedTarget.accountId }} / {{ confirmedTarget.projectName }} /
          {{ confirmedTarget.branch }}
        </p>
        <UiNotice tone="warning">{{
          t(
            '这会删除远端项目及其全部部署，不只是当前页面。本地材料和站点不受影响。输入项目名称后确认。',
            'This deletes the remote project and all its deployments, not only the current page. Local materials and the site are kept. Type the project name to confirm.',
          )
        }}</UiNotice
        ><UiInput
          v-model="deleteName"
          :placeholder="config.target.projectName"
          :aria-label="t('确认项目名称', 'Confirm project name')"
        /><UiButton
          variant="danger"
          :disabled="!!busy || !connectionSaved || deleteName !== confirmedTarget?.projectName"
          @click="remove"
          >{{ t('确认删除远端项目', 'Delete remote project') }}</UiButton
        ><UiButton variant="ghost" @click="cancelDelete">{{ t('取消', 'Cancel') }}</UiButton>
      </div>
    </SettingSection>
  </div>
</template>

<style scoped>
.publish-settings {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.publish-theme-toolbar,
.publish-settings-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.publish-theme-toolbar {
  margin-bottom: 14px;
}
.publish-theme-toolbar :first-child {
  flex: 1;
  min-width: 140px;
}
.publish-theme-source {
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-code);
}
.publish-settings-note {
  font-size: var(--font-size-meta);
  line-height: var(--line-height-ui);
  color: var(--muted);
  margin: 12px 0 0;
}
.publish-settings-confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.publish-settings-confirm p,
.publish-settings-confirm > div {
  flex-basis: 100%;
  margin: 0;
}
.publish-settings-confirm input {
  flex: 1;
}
.publish-remove {
  margin-top: 20px;
}
.publish-settings :deep(.setting-section-content) {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
