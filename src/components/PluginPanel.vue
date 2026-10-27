<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { desktopEdition } from '../edition'
import { workspaceAvailable } from '@repeaty-platform'
import { usePlugins } from '../plugins'
import { readPluginFile, pluginIssueMessage, type PluginManifest } from '../plugins/package'
import { usePluginManager, officialPluginBundles } from '../plugins/manager'
import { SettingGroup, SettingField, UiButton } from './ui'
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
const picker = ref<HTMLInputElement>()
const error = ref('')
const locked = computed(
  () => pluginManagerBusy.value || activePluginViews.value > 0 || !workspaceAvailable.value,
)
const entries = computed(() =>
  pluginPackages.map((entry) => ({
    ...entry,
    plugin: installedPlugins.find(({ plugin }) => plugin.id === entry.id)?.plugin,
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
    <header class="page-heading">
      <div>
        <h2 v-if="embedded">{{ t('插件') }}</h2>
        <h1 v-else>{{ t('插件') }}</h1>
        <p>{{ t('插件独立安装和更新，无需重新编译 Repeaty。') }}</p>
      </div>
    </header>
    <p class="plugin-management-note">
      {{
        t(
          desktopEdition
            ? '插件代码保存在当前学习目录中，随目录移动。新设备首次启用时需确认，登录凭据留在设备上。'
            : '前端插件保存在此浏览器的独立副本中，不写入只读打开的原目录。',
        )
      }}
    </p>
    <div class="plugin-actions">
      <input
        ref="picker"
        type="file"
        accept=".repeaty-plugin,application/json"
        hidden
        @change="choose"
      />
      <UiButton :disabled="locked" @click="picker?.click()">
        {{ t('安装插件包') }}
      </UiButton>
      <UiButton :disabled="locked" @click="installOfficial">
        {{ t('安装或更新官方插件') }}
      </UiButton>
      <UiButton :disabled="locked" @click="run(reloadPlugins)">
        {{ t('重新扫描插件') }}
      </UiButton>
    </div>
    <p v-if="activePluginViews" class="form-note">
      {{ t('请先结束复习或关闭编辑器，再修改插件。') }}
    </p>
    <p
      v-if="error || pluginManagerError || pluginPreferenceError"
      class="import-warning"
      role="alert"
    >
      {{ t(error || pluginManagerError || pluginPreferenceError) }}
    </p>
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
        <span class="pill">{{ entry.bundle?.manifest.version }}</span>
        <UiButton variant="ghost" :disabled="locked" @click="uninstall(entry.id)">
          {{ t('卸载插件') }}
        </UiButton>
      </template>
      <p class="form-note">
        {{ t(entry.bundle?.manifest.kind === 'local' ? '本地插件 · 桌面版' : '纯前端插件') }}
        · {{ capabilities(entry.bundle?.manifest) }}
      </p>
      <SettingField
        type="switch"
        :label="
          t('启用 {name}', {
            name: t(entry.plugin?.label ?? entry.bundle?.manifest.name ?? entry.id),
          })
        "
        :description="t(pluginEnabled(entry.id) ? '已开启' : '已关闭')"
        :disabled="
          locked || !entry.bundle || (entry.bundle.manifest.kind === 'local' && !desktopEdition)
        "
        :model-value="pluginEnabled(entry.id)"
        @update:model-value="
          toggle(entry.id, $event === true, entry.trusted, entry.bundle?.manifest.name ?? entry.id)
        "
      />
      <p v-if="!entry.trusted" class="form-note">
        {{ t('此设备尚未信任此插件包。启用前请确认代码来源。') }}
      </p>
      <p v-if="entry.error" class="import-warning" role="alert">{{ t(entry.error) }}</p>
      <component
        v-if="pluginEnabled(entry.id) && entry.plugin?.settings"
        :is="entry.plugin.settings"
      />
    </SettingGroup>
    <p v-if="!entries.length" class="form-note">
      {{ t('当前学习库尚未安装插件。普通卡片可正常使用。') }}
    </p>
  </div>
</template>
<style scoped>
.plugin-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}
</style>
