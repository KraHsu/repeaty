<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { desktopEdition } from '../edition'
import { workspaceAvailable } from '@repeaty-platform'
import { usePlugins } from '../plugins'
import { readPluginFile, pluginIssueMessage, type PluginManifest } from '../plugins/package'
import { usePluginManager, officialPluginBundles } from '../plugins/manager'
import { SettingGroup, SettingField, UiButton, UiNotice, UiStatus } from './ui'
const { installedPlugins, pluginEnabled, pluginPreferenceError } = usePlugins()
const {
  pluginPackages,
  pluginManagerBusy,
  pluginManagerError,
  activePluginViews,
  installPlugin,
  enablePlugin,
  removePlugin,
  reloadPlugins,
} = usePluginManager()
defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{ configure: [id: string] }>()
const picker = ref<HTMLInputElement>()
const error = ref('')
const locked = computed(
  () => pluginManagerBusy.value || activePluginViews.value > 0 || !workspaceAvailable.value,
)
const entries = computed(() =>
  pluginPackages.map((entry) => ({
    ...entry,
    plugin: installedPlugins.find(({ plugin }) => plugin.id === entry.id)?.plugin,
    settings: installedPlugins.find(({ plugin }) => plugin.id === entry.id)?.settings ?? [],
  })),
)
function capabilities(manifest?: PluginManifest) {
  const values: string[] = []
  if (manifest?.permissions?.origins?.length)
    values.push(`${t('联网域名')}: ${manifest.permissions.origins.join(', ')}`)
  if (manifest?.permissions?.secrets) values.push(t('设备凭据'))
  if (manifest?.permissions?.files) values.push(t('插件文件'))
  return values.length ? values.join(' · ') : t('无原生能力')
}
async function run(action: () => Promise<unknown>) {
  error.value = ''
  try {
    await action()
  } catch (issue) {
    error.value = pluginIssueMessage(issue)
  }
}
async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await run(async () => {
    const bundle = await readPluginFile(file)
    if (
      !confirm(
        t('插件将在应用中执行代码。确认安装并启用 {name}？', { name: bundle.manifest.name }) +
          '\n\n' +
          capabilities(bundle.manifest),
      )
    )
      return
    await installPlugin(bundle)
  })
}
function toggle(id: string, enabled: boolean, trusted: boolean, name: string) {
  if (
    enabled &&
    !trusted &&
    !confirm(
      t('插件将在应用中执行代码。确认启用 {name}？', { name }) +
        '\n\n' +
        capabilities(pluginPackages.find((entry) => entry.id === id)?.bundle?.manifest),
    )
  )
    return
  void run(() => enablePlugin(id, enabled))
}
function uninstall(id: string) {
  if (!confirm(t('卸载插件代码？题目、历史、设置和插件数据会保留。'))) return
  void run(() => removePlugin(id))
}
async function installOfficial() {
  await run(async () => {
    for (const bundle of await officialPluginBundles()) await installPlugin(bundle)
  })
}
</script>
<template>
  <div :class="embedded ? 'settings-plugins' : 'page plugins-page'">
    <header v-if="!embedded" class="page-heading">
      <div>
        <h1>{{ t('插件') }}</h1>
        <p>{{ t('插件独立安装和更新，无需重新编译 Repeaty。') }}</p>
      </div>
    </header>
    <SettingGroup
      :title="t('插件管理')"
      :description="t('安装、更新与管理当前学习库的插件。')"
      class="plugin-manager"
    >
      <div class="plugin-actions ui-setting-actions">
        <input
          ref="picker"
          type="file"
          accept=".repeaty-plugin,application/json"
          hidden
          @change="choose"
        />
        <UiButton variant="primary" :disabled="locked" @click="picker?.click()">
          {{ t('安装插件包') }}
        </UiButton>
        <UiButton :disabled="locked" @click="installOfficial">
          {{ t('安装或更新官方插件') }}
        </UiButton>
        <UiButton :disabled="locked" @click="run(reloadPlugins)">
          {{ t('重新扫描插件') }}
        </UiButton>
      </div>
      <UiNotice v-if="activePluginViews" tone="warning">
        {{ t('请先结束复习或关闭编辑器，再修改插件。') }}
      </UiNotice>
      <UiNotice v-if="error || pluginManagerError || pluginPreferenceError" tone="error">
        {{ t(error || pluginManagerError || pluginPreferenceError) }}
      </UiNotice>
      <details class="ui-setting-help">
        <summary>{{ t('插件安装与存储') }}</summary>
        <p>
          {{
            t(
              desktopEdition
                ? '插件代码保存在当前学习目录中，随目录移动。新设备首次启用时需确认，登录凭据留在设备上。'
                : '前端插件保存在此浏览器的独立副本中，不写入只读打开的原目录。',
            )
          }}
        </p>
        <p>{{ t('插件独立安装和更新，无需重新编译 Repeaty。') }}</p>
      </details>
    </SettingGroup>
    <SettingGroup
      v-for="entry in entries"
      :key="entry.id"
      class="plugin-settings"
      :title="t(entry.plugin?.label ?? entry.bundle?.manifest.name ?? entry.id)"
      :description="
        entry.plugin?.description || entry.bundle?.manifest.description
          ? t(entry.plugin?.description ?? entry.bundle!.manifest.description!)
          : undefined
      "
    >
      <template #actions>
        <UiStatus v-if="entry.bundle">v{{ entry.bundle.manifest.version }}</UiStatus>
        <UiButton
          v-if="entry.settings.length"
          :disabled="locked"
          @click="emit('configure', entry.id)"
          >{{ t('配置插件') }}</UiButton
        >
        <UiButton variant="ghost" :disabled="locked" @click="uninstall(entry.id)">
          {{ t('卸载插件') }}
        </UiButton>
      </template>
      <dl class="ui-setting-meta plugin-summary">
        <dt>{{ t('插件标识') }}</dt>
        <dd>{{ entry.id }}</dd>
        <dt>{{ t('安装位置') }}</dt>
        <dd>{{ desktopEdition ? `.repeaty/plugins/${entry.id}/` : t('浏览器副本') }}</dd>
        <dt>{{ t('运行环境') }}</dt>
        <dd>{{ t(entry.bundle?.manifest.kind === 'local' ? '桌面应用' : '桌面与网页') }}</dd>
        <dt>{{ t('访问权限') }}</dt>
        <dd class="plugin-permissions">
          <template v-if="entry.bundle?.manifest.permissions">
            <span v-for="origin in entry.bundle.manifest.permissions.origins" :key="origin">{{
              origin
            }}</span>
            <span v-if="entry.bundle.manifest.permissions.secrets">{{ t('设备凭据') }}</span>
            <span v-if="entry.bundle.manifest.permissions.files">{{ t('插件文件') }}</span>
          </template>
          <span
            v-if="
              !entry.bundle?.manifest.permissions?.origins?.length &&
              !entry.bundle?.manifest.permissions?.secrets &&
              !entry.bundle?.manifest.permissions?.files
            "
            >{{ t('无原生能力') }}</span
          >
        </dd>
      </dl>
      <SettingField
        type="switch"
        :label="
          t('启用 {name}', {
            name: t(entry.plugin?.label ?? entry.bundle?.manifest.name ?? entry.id),
          })
        "
        :description="t('关闭插件会保留题目、历史和设置。')"
        :disabled="
          locked || !entry.bundle || (entry.bundle.manifest.kind === 'local' && !desktopEdition)
        "
        :model-value="pluginEnabled(entry.id)"
        @update:model-value="
          toggle(entry.id, $event === true, entry.trusted, entry.bundle?.manifest.name ?? entry.id)
        "
      />
      <UiNotice v-if="!entry.trusted" tone="warning">
        {{ t('此设备尚未信任此插件包。启用前请确认代码来源。') }}
      </UiNotice>
      <UiNotice v-if="entry.error" tone="error">{{ t(entry.error) }}</UiNotice>
    </SettingGroup>
    <UiNotice v-if="!entries.length">
      {{ t('当前学习库尚未安装插件。普通卡片可正常使用。') }}
    </UiNotice>
  </div>
</template>
<style scoped>
.plugin-actions {
  margin: 0 0 1rem;
}
.plugin-summary {
  padding: 0.25rem 0 1.25rem;
}
.plugin-permissions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
}
</style>
