<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import UCard from '@nuxt/ui/components/Card.vue'
import { t } from '../i18n'
import { desktopEdition } from '../edition'
import { workspaceAvailable } from '@repeaty-platform'
import { usePlugins } from '../plugins'
import { readPluginFile, pluginIssueMessage, type PluginManifest } from '../plugins/package'
import { usePluginManager, officialPluginBundles, type PackageEntry } from '../plugins/manager'
import { SettingField, UiButton, UiCollapsible, UiNotice } from './ui'
import CardContent from './CardContent.vue'
import AppModal from './AppModal.vue'
import AppPage from './AppPage.vue'
import { Puzzle, Download, RefreshCw } from '@lucide/vue'
import '../styles/settings-plugins.css'
const { installedPlugins, pluginEnabled, pluginPreferenceError } = usePlugins()
const {
  pluginPackages,
  pluginManagerBusy,
  pluginManagerError,
  activePluginViews,
  pluginScope,
  installPlugin,
  enablePlugin,
  removePlugin,
  reloadPlugins,
} = usePluginManager()
const props = defineProps<{ embedded?: boolean; focusPlugin?: string }>()
const emit = defineEmits<{ configure: [id: string] }>()
const picker = ref<HTMLInputElement>()
const panel = ref<HTMLElement>()
const panelId = `plugin-detail-${useId()}`
const openReadmes = ref(new Set<string>())
const selectedPlugin = ref<string>()
const error = ref('')
const pending = ref(false)
type Confirmation = {
  id: number
  title: () => string
  message: () => string
  permissions?: () => string
  isCurrent: () => boolean
  resolve: (accepted: boolean) => void
}
const confirmation = shallowRef<Confirmation>()
const locked = computed(
  () =>
    pending.value ||
    pluginManagerBusy.value ||
    activePluginViews.value > 0 ||
    !workspaceAvailable.value,
)
const entries = computed(() =>
  pluginPackages.map((entry) => ({
    ...entry,
    plugin: installedPlugins.find(({ plugin }) => plugin.id === entry.id)?.plugin,
    settings: installedPlugins.find(({ plugin }) => plugin.id === entry.id)?.settings ?? [],
  })),
)
const selectedEntries = computed(() =>
  entries.value.filter((entry) => entry.id === selectedPlugin.value),
)
function selectPlugin(id: string) {
  if (!entries.value.some((entry) => entry.id === id)) return
  selectedPlugin.value = id
  openReadmes.value.add(id)
}
watch(
  [entries, pluginScope],
  ([current]) => {
    if (!current.some((entry) => entry.id === selectedPlugin.value)) {
      selectedPlugin.value = current[0]?.id
      if (selectedPlugin.value) openReadmes.value.add(selectedPlugin.value)
    }
  },
  { immediate: true },
)
let alive = true
watch(
  [() => props.focusPlugin, () => pluginPackages.slice()],
  async () => {
    const requested = props.focusPlugin
    if (!requested) return
    selectPlugin(requested)
    await nextTick()
    if (!alive || props.focusPlugin !== requested) return
    const target = [...(panel.value?.querySelectorAll<HTMLElement>('[data-plugin-id]') ?? [])].find(
      (entry) => entry.dataset.pluginId === requested,
    )
    if (target) openReadmes.value.add(requested)
    await nextTick()
    if (!alive || props.focusPlugin !== requested || !target?.isConnected) return
    const focus = target?.querySelector<HTMLElement>('.plugin-readme-trigger') ?? target
    focus?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'start' })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  alive = false
  answerConfirmation(false)
})
function toggleReadme(id: string, open: boolean) {
  if (open) openReadmes.value.add(id)
  else openReadmes.value.delete(id)
}
function capabilities(manifest?: PluginManifest) {
  const values: string[] = []
  if (manifest?.permissions?.origins?.length)
    values.push(`${t('联网域名')}: ${manifest.permissions.origins.join(', ')}`)
  if (manifest?.permissions?.secrets) values.push(t('设备凭据'))
  if (manifest?.permissions?.files) values.push(t('插件文件'))
  return values.length ? values.join(' · ') : t('无原生能力')
}
let generation = 0,
  operation = 0
watch(
  pluginScope,
  () => {
    generation++
    operation++
    pending.value = false
    answerConfirmation(false)
    error.value = ''
    openReadmes.value = new Set()
    selectedPlugin.value = undefined
  },
  { flush: 'sync' },
)
watch(
  () => [workspaceAvailable.value, activePluginViews.value, ...pluginPackages],
  () => {
    if (confirmation.value && !confirmation.value.isCurrent()) answerConfirmation(false)
  },
  { flush: 'sync' },
)
function currentOperation(entry?: PackageEntry) {
  const scope = pluginScope.value,
    epoch = generation
  return () =>
    alive &&
    generation === epoch &&
    scope === pluginScope.value &&
    workspaceAvailable.value &&
    activePluginViews.value === 0 &&
    (!entry || pluginPackages.includes(entry))
}
let confirmationId = 0
function answerConfirmation(accepted: boolean, expected?: Confirmation) {
  const request = confirmation.value
  if (expected && request !== expected) return
  confirmation.value = undefined
  request?.resolve(accepted && request.isCurrent())
}
function ask(request: Omit<Confirmation, 'resolve' | 'id'>) {
  answerConfirmation(false)
  if (!request.isCurrent()) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    confirmation.value = { ...request, id: ++confirmationId, resolve }
  })
}
async function run(action: (isCurrent: () => boolean) => Promise<unknown>, entry?: PackageEntry) {
  if (locked.value) return
  const owned = ++operation
  const isCurrent = currentOperation(entry)
  error.value = ''
  pending.value = true
  try {
    await action(isCurrent)
  } catch (issue) {
    if (isCurrent()) error.value = pluginIssueMessage(issue)
  } finally {
    if (owned === operation) pending.value = false
  }
}
async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await run(async (isCurrent) => {
    const bundle = await readPluginFile(file)
    if (
      !isCurrent() ||
      !(await ask({
        title: () => t('安装插件包'),
        message: () =>
          t('插件将在应用中执行代码。确认安装并启用 {name}？', { name: bundle.manifest.name }),
        permissions: () => capabilities(bundle.manifest),
        isCurrent,
      }))
    )
      return
    if (!isCurrent()) return
    await installPlugin(bundle)
  })
}
function toggle(id: string, enabled: boolean, trusted: boolean, name: string) {
  const entry = pluginPackages.find((entry) => entry.id === id)
  if (!entry) return
  void run(async (isCurrent) => {
    if (
      enabled &&
      !trusted &&
      !(await ask({
        title: () => t('启用 {name}', { name }),
        message: () => t('插件将在应用中执行代码。确认启用 {name}？', { name }),
        permissions: () => capabilities(entry.bundle?.manifest),
        isCurrent,
      }))
    )
      return
    if (isCurrent()) await enablePlugin(id, enabled)
  }, entry)
}
function uninstall(id: string) {
  const entry = pluginPackages.find((entry) => entry.id === id)
  if (!entry) return
  void run(async (isCurrent) => {
    if (
      (await ask({
        title: () => t('卸载插件'),
        message: () => t('卸载插件代码？题目、历史、设置和插件数据会保留。'),
        isCurrent,
      })) &&
      isCurrent()
    )
      await removePlugin(id)
  }, entry)
}
async function installOfficial() {
  await run(async (isCurrent) => {
    for (const bundle of await officialPluginBundles()) {
      if (!isCurrent()) return
      await installPlugin(bundle)
    }
  })
}
</script>
<template>
  <component
    :is="embedded ? 'div' : AppPage"
    :class="embedded ? 'settings-plugins' : 'plugins-page'"
    v-bind="
      embedded
        ? {}
        : { title: t('插件'), description: t('查看插件详情、使用说明，管理安装与权限。') }
    "
  >
    <template v-if="!embedded" #actions>
      <UiButton variant="secondary" :disabled="locked" @click="picker?.click()">
        <Download :size="18" />{{ t('安装插件包') }}
      </UiButton>
    </template>
    <UiNotice v-if="activePluginViews" tone="warning">{{
      t('请先结束复习或关闭编辑器，再修改插件。')
    }}</UiNotice>
    <UiNotice v-if="error || pluginManagerError || pluginPreferenceError" tone="error">{{
      t(error || pluginManagerError || pluginPreferenceError)
    }}</UiNotice>
    <div v-if="entries.length" ref="panel" class="plugin-workbench">
      <aside class="plugin-directory">
        <div class="plugin-directory-heading">
          <h2>{{ t('插件管理') }}</h2>
          <span>{{ entries.length }}</span>
        </div>
        <nav class="plugin-directory-list" :aria-label="t('插件')">
          <UiButton
            v-for="entry in entries"
            :key="entry.id"
            variant="ghost"
            class="plugin-directory-item"
            :class="{ selected: selectedPlugin === entry.id }"
            :data-plugin-select="entry.id"
            :aria-pressed="selectedPlugin === entry.id"
            @click="selectPlugin(entry.id)"
          >
            <span class="plugin-directory-mark" aria-hidden="true"><Puzzle :size="22" /></span>
            <span class="plugin-directory-copy"
              ><strong>{{
                t(entry.plugin?.label ?? entry.bundle?.manifest.name ?? entry.id)
              }}</strong
              ><span>{{
                t(entry.bundle?.manifest.kind === 'local' ? '桌面应用' : '桌面与网页')
              }}</span></span
            >
            <span
              class="plugin-directory-state"
              :class="{ enabled: pluginEnabled(entry.id), issue: entry.error || !entry.trusted }"
              :title="t(entry.error ? entry.error : pluginEnabled(entry.id) ? '已启用' : '未启用')"
            />
          </UiButton>
        </nav>
      </aside>
      <div class="plugin-detail-pane">
        <UCard
          v-for="entry in selectedEntries"
          :key="entry.id"
          as="article"
          class="plugin-settings"
          :data-plugin-id="entry.id"
          tabindex="-1"
          :aria-labelledby="`${panelId}-${entry.id}`"
        >
          <template #header>
            <div class="plugin-detail-heading">
              <span class="plugin-detail-mark" aria-hidden="true"><Puzzle :size="28" /></span>
              <div class="plugin-detail-copy">
                <div class="plugin-detail-title">
                  <h2 :id="`${panelId}-${entry.id}`">
                    {{ t(entry.plugin?.label ?? entry.bundle?.manifest.name ?? entry.id) }}
                  </h2>
                  <span v-if="entry.bundle" class="plugin-detail-version"
                    >v{{ entry.bundle.manifest.version }}</span
                  >
                </div>
                <p v-if="entry.plugin?.description || entry.bundle?.manifest.description">
                  {{ t(entry.plugin?.description ?? entry.bundle!.manifest.description!) }}
                </p>
              </div>
            </div>
          </template>
          <SettingField
            class="plugin-enabled-field"
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
              toggle(
                entry.id,
                $event === true,
                entry.trusted,
                entry.bundle?.manifest.name ?? entry.id,
              )
            "
          />
          <UiNotice v-if="!entry.trusted" tone="warning">{{
            t('此设备尚未信任此插件包。启用前请确认代码来源。')
          }}</UiNotice>
          <UiNotice v-if="entry.error" tone="error">{{ t(entry.error) }}</UiNotice>
          <div v-if="entry.settings.length" class="plugin-configure-row">
            <span>{{ t('设置') }}</span
            ><UiButton variant="primary" :disabled="locked" @click="emit('configure', entry.id)">{{
              t('配置插件')
            }}</UiButton>
          </div>
          <UiCollapsible
            class="plugin-readme ui-setting-help"
            :open="openReadmes.has(entry.id)"
            @update:open="toggleReadme(entry.id, $event)"
          >
            <UiButton variant="ghost" class="plugin-readme-trigger">{{ t('介绍与使用') }}</UiButton>
            <template #content>
              <CardContent
                v-if="openReadmes.has(entry.id) && entry.bundle?.readme"
                :text="entry.bundle.readme"
                format="markdown"
              />
              <p v-else-if="!entry.bundle?.readme">{{ t('此插件包尚未提供使用说明。') }}</p>
            </template>
          </UiCollapsible>
          <section class="plugin-metadata" :aria-label="t('插件信息')">
            <h3>{{ t('插件信息') }}</h3>
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
          </section>
          <div class="plugin-detail-actions">
            <UiButton variant="ghost" :disabled="locked" @click="uninstall(entry.id)">{{
              t('卸载插件')
            }}</UiButton>
          </div>
        </UCard>
      </div>
    </div>
    <UiNotice v-else>{{ t('当前学习库尚未安装插件。普通卡片可正常使用。') }}</UiNotice>
    <section class="plugin-manager" :aria-label="t('插件管理')">
      <div class="plugin-actions ui-setting-actions">
        <input
          ref="picker"
          type="file"
          accept=".repeaty-plugin,application/json"
          hidden
          @change="choose"
        />
        <UiButton v-if="embedded" variant="primary" :disabled="locked" @click="picker?.click()">{{
          t('安装插件包')
        }}</UiButton>
        <UiButton :disabled="locked" @click="installOfficial">{{
          t('安装或更新官方插件')
        }}</UiButton>
        <UiButton variant="ghost" :disabled="locked" @click="run(reloadPlugins)"
          ><RefreshCw :size="17" />{{ t('重新扫描插件') }}</UiButton
        >
        <UiCollapsible class="plugin-storage-help">
          <UiButton variant="ghost">{{ t('插件安装与存储') }}</UiButton>
          <template #content>
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
          </template>
        </UiCollapsible>
      </div>
    </section>
    <AppModal
      v-for="request in confirmation ? [confirmation] : []"
      :key="request.id"
      :title="request.title()"
      @close="answerConfirmation(false, request)"
    >
      <p>{{ request.message() }}</p>
      <UiNotice v-if="request.permissions">{{ request.permissions() }}</UiNotice>
      <div class="plugin-confirm-actions">
        <UiButton @click="answerConfirmation(false, request)">{{ t('取消') }}</UiButton
        ><UiButton
          variant="primary"
          data-plugin-confirm
          @click="answerConfirmation(true, request)"
          >{{ request.title() }}</UiButton
        >
      </div>
    </AppModal>
  </component>
</template>
