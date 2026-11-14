<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import UCard from '@nuxt/ui/components/Card.vue'
import UTabs from '@nuxt/ui/components/Tabs.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import { t } from '../i18n'
import { desktopEdition } from '../edition'
import { workspaceAvailable } from '@repeaty-platform'
import { usePlugins } from '../plugins'
import {
  readPluginFile,
  pluginIssueMessage,
  type PluginManifest,
  type PluginBundle,
} from '../plugins/package'
import {
  usePluginManager,
  officialPluginCatalog,
  loadOfficialPlugin,
  type OfficialPluginEntry,
  type PackageEntry,
} from '../plugins/manager'
import { comparePluginVersions } from '../plugins/versions'
import { UiButton, UiCollapsible, UiNotice, UiInput } from './ui'
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
const query = ref('')
const filter = ref('all')
const officialLoading = ref(false)
const officialError = ref('')
const catalog = shallowRef<OfficialPluginEntry[]>([])
const previews = shallowRef(new Map<string, PluginBundle>())
const previewRequests = new Map<string, Promise<PluginBundle>>()
const previewLoading = ref(false),
  previewError = ref('')
const installingId = ref<string>()
const storageDescription = computed(() =>
  t(
    desktopEdition
      ? '插件代码保存在当前学习目录中，随目录移动。新设备首次启用时需确认，登录凭据留在设备上。'
      : '前端插件保存在此浏览器的独立副本中，不写入只读打开的原目录。',
  ),
)
let officialRequest = 0
let previewRequest = 0
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
const entries = computed(() => {
  const ids = [
    ...new Set([
      ...pluginPackages.map((entry) => entry.id),
      ...catalog.value.map((entry) => entry.id),
    ]),
  ]
  return ids.map((id) => {
    const installed = pluginPackages.find((entry) => entry.id === id)
    const official = catalog.value.find((entry) => entry.id === id)
    const active = installedPlugins.find(({ plugin }) => plugin.id === id)
    const bundle = installed?.bundle ?? previews.value.get(id)
    return {
      id,
      installed,
      official,
      bundle,
      manifest: bundle?.manifest ?? official,
      trusted: installed?.trusted ?? false,
      error: installed?.error,
      plugin: active?.plugin,
      settings: active?.settings ?? [],
    }
  })
})
const filters = computed(() => [
  { value: 'all', label: t('全部插件') },
  { value: 'installed', label: t('已安装') },
  { value: 'updates', label: t('可更新') },
])
const visibleEntries = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return entries.value.filter((entry) => {
    if (filter.value === 'installed' && !entry.installed) return false
    if (
      filter.value === 'updates' &&
      (!entry.official || officialAction(entry.official) !== '更新')
    )
      return false
    return (
      !text ||
      [
        entry.id,
        entry.manifest?.name,
        entry.plugin?.label,
        entry.manifest?.description,
        authorLabel(entry.manifest, !!entry.official),
      ].some((value) => value && `${value} ${t(value)}`.toLocaleLowerCase().includes(text))
    )
  })
})
const selectedEntries = computed(() =>
  visibleEntries.value.filter((entry) => entry.id === selectedPlugin.value),
)
function selectPlugin(id: string, reveal = false, scroll = false) {
  if (!entries.value.some((entry) => entry.id === id)) return
  if (reveal) {
    query.value = ''
    filter.value = 'all'
  }
  selectedPlugin.value = id
  openReadmes.value.add(id)
  if (scroll)
    void nextTick(() => {
      if (panel.value && panel.value.clientWidth > 0 && panel.value.clientWidth < 800)
        panel.value.querySelector('.plugin-settings')?.scrollIntoView({ block: 'start' })
    })
}
watch(
  [visibleEntries, pluginScope],
  ([current]) => {
    if (!current.some((entry) => entry.id === selectedPlugin.value)) {
      selectedPlugin.value = current.find((entry) => entry.installed)?.id
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
    selectPlugin(requested, true)
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
  resetCatalog()
  answerConfirmation(false)
})
onMounted(() => void browseOfficial())
watch(
  () => [
    selectedEntries.value[0]?.id,
    selectedEntries.value[0]?.bundle,
    selectedEntries.value[0]?.official,
  ],
  () => {
    previewRequest++
    previewError.value = ''
    previewLoading.value = false
    const entry = selectedEntries.value[0]
    if (entry?.official && !entry.bundle) void previewOfficial(entry.official)
  },
)
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
  if (manifest?.permissions?.models) values.push(t('设备模型连接'))
  if (manifest?.permissions?.network) values.push(t('经确认的自定义网站'))
  return values.length ? values.join(' · ') : t('无原生能力')
}
function authorLabel(manifest?: PluginManifest, official = false) {
  const author = official ? 'repeaty' : manifest?.author
  return author ? `@${author.replace(/^@+/, '')}` : t('未声明作者')
}
let generation = 0,
  operation = 0
watch(
  pluginScope,
  () => {
    generation++
    operation++
    pending.value = false
    resetCatalog()
    answerConfirmation(false)
    error.value = ''
    openReadmes.value = new Set()
    selectedPlugin.value = undefined
    query.value = ''
    filter.value = 'all'
    void browseOfficial()
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
          t('确认安装 {name}？新插件默认关闭，更新保留原启停状态。', {
            name: bundle.manifest.name,
          }),
        permissions: () => capabilities(bundle.manifest),
        isCurrent,
      }))
    )
      return
    if (!isCurrent()) return
    await installPlugin(bundle)
    if (isCurrent()) selectPlugin(bundle.manifest.id, true)
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
function resetCatalog() {
  officialRequest++
  previewRequest++
  officialLoading.value = false
  officialError.value = ''
  catalog.value = []
  previews.value = new Map()
  previewRequests.clear()
  previewLoading.value = false
  previewError.value = ''
  installingId.value = undefined
}
async function browseOfficial() {
  const request = ++officialRequest,
    scope = pluginScope.value
  officialLoading.value = true
  officialError.value = ''
  const ownsRequest = () => alive && request === officialRequest && scope === pluginScope.value
  try {
    const values = await officialPluginCatalog()
    if (ownsRequest()) {
      previews.value = new Map()
      previewRequests.clear()
      catalog.value = values
    }
  } catch (issue) {
    if (ownsRequest()) officialError.value = pluginIssueMessage(issue)
  } finally {
    if (ownsRequest()) officialLoading.value = false
  }
}
async function readOfficial(entry: OfficialPluginEntry): Promise<PluginBundle> {
  const cached = previews.value.get(entry.id)
  if (cached && cached.manifest.version === entry.version) return cached
  const key = `${entry.id}@${entry.version}`
  const existing = previewRequests.get(key)
  if (existing) return existing
  const request = officialRequest,
    scope = pluginScope.value
  const result = loadOfficialPlugin(entry)
    .then((bundle) => {
      if (
        alive &&
        scope === pluginScope.value &&
        request === officialRequest &&
        catalog.value.includes(entry)
      ) {
        previews.value = new Map(previews.value).set(entry.id, bundle)
      }
      return bundle
    })
    .finally(() => {
      if (previewRequests.get(key) === result) previewRequests.delete(key)
    })
  previewRequests.set(key, result)
  return result
}
async function previewOfficial(entry: OfficialPluginEntry) {
  const request = ++previewRequest,
    scope = pluginScope.value
  previewLoading.value = true
  previewError.value = ''
  const current = () =>
    alive &&
    request === previewRequest &&
    scope === pluginScope.value &&
    selectedPlugin.value === entry.id
  try {
    await readOfficial(entry)
  } catch (issue) {
    if (current()) previewError.value = pluginIssueMessage(issue)
  } finally {
    if (current()) previewLoading.value = false
  }
}
function officialAction(entry: OfficialPluginEntry) {
  if (entry.kind === 'local' && !desktopEdition) return '此插件仅在桌面版可用。'
  const installed = pluginPackages.find((value) => value.id === entry.id)?.bundle
  if (!installed) return '安装'
  const order = comparePluginVersions(installed.manifest.version, entry.version)
  return order > 0 ? '已安装较新版本' : order === 0 ? '已安装' : '更新'
}
function canInstallOfficial(entry: OfficialPluginEntry) {
  const action = officialAction(entry)
  return action === '安装' || action === '更新'
}
async function installOfficial(entry: OfficialPluginEntry) {
  if (locked.value || !catalog.value.includes(entry) || !canInstallOfficial(entry)) return
  const request = officialRequest
  installingId.value = entry.id
  await run(async (isCurrent) => {
    const bundle = await readOfficial(entry)
    if (
      !isCurrent() ||
      request !== officialRequest ||
      !catalog.value.includes(entry) ||
      !canInstallOfficial(entry)
    )
      return
    await installPlugin(bundle)
    if (!isCurrent() || request !== officialRequest) return
    selectPlugin(entry.id, true)
  })
  if (request === officialRequest) installingId.value = undefined
}
async function refreshPlugins() {
  await run(reloadPlugins)
  if (alive) await browseOfficial()
}
</script>
<template>
  <component
    :is="embedded ? 'div' : AppPage"
    :class="embedded ? 'settings-plugins' : 'plugins-page'"
    v-bind="embedded ? {} : { title: t('插件'), description: storageDescription }"
  >
    <template v-if="!embedded" #actions>
      <UiButton variant="secondary" :disabled="locked" @click="picker?.click()">
        <Download :size="18" />{{ t('安装插件包') }}
      </UiButton>
      <UiButton variant="ghost" :disabled="locked || officialLoading" @click="refreshPlugins">
        <RefreshCw :size="18" />{{ t('重新扫描插件') }}
      </UiButton>
    </template>
    <UiNotice v-if="activePluginViews" tone="warning">{{
      t('请先结束复习或关闭编辑器，再修改插件。')
    }}</UiNotice>
    <UiNotice v-if="error || pluginManagerError || pluginPreferenceError" tone="error">{{
      t(error || pluginManagerError || pluginPreferenceError)
    }}</UiNotice>
    <div v-if="embedded" class="plugin-embedded-actions">
      <UiButton :disabled="locked" @click="picker?.click()"
        ><Download :size="18" />{{ t('安装插件包') }}</UiButton
      >
      <UiButton variant="ghost" :disabled="locked || officialLoading" @click="refreshPlugins"
        ><RefreshCw :size="18" />{{ t('重新扫描插件') }}</UiButton
      >
    </div>
    <p v-if="embedded" class="plugin-storage-description">{{ storageDescription }}</p>
    <div ref="panel" class="plugin-workbench">
      <aside class="plugin-directory" :aria-label="t('插件目录')">
        <UiInput
          v-model="query"
          icon="i-lucide-search"
          :aria-label="t('搜索插件')"
          :placeholder="t('搜索插件名称或功能')"
          class="plugin-search"
        />
        <UTabs
          v-model="filter"
          :items="filters"
          :content="false"
          class="plugin-filters"
          :ui="{ list: 'w-full', trigger: 'flex-1 justify-center' }"
        />
        <div class="plugin-directory-heading">
          <span>{{ t('插件') }}</span
          ><span aria-live="polite">{{ visibleEntries.length }}</span>
        </div>
        <UiNotice v-if="officialLoading" role="status">{{ t('正在加载插件目录…') }}</UiNotice>
        <UiNotice v-if="officialError" tone="error">
          {{ t(officialError)
          }}<UiButton variant="ghost" :disabled="pending" @click="browseOfficial">{{
            t('重试')
          }}</UiButton>
        </UiNotice>
        <nav class="plugin-directory-list" :aria-label="t('插件')">
          <article
            v-for="entry in visibleEntries"
            :key="entry.id"
            class="plugin-directory-row"
            :class="{ selected: selectedPlugin === entry.id }"
            :data-official-plugin="entry.official ? entry.id : undefined"
          >
            <UiButton
              variant="ghost"
              class="plugin-directory-item"
              :data-plugin-select="entry.id"
              :aria-pressed="selectedPlugin === entry.id"
              @click="selectPlugin(entry.id, false, true)"
            >
              <span class="plugin-directory-mark" aria-hidden="true"><Puzzle :size="22" /></span>
              <span class="plugin-directory-copy"
                ><span class="plugin-directory-name">
                  <strong>{{ t(entry.plugin?.label ?? entry.manifest?.name ?? entry.id) }}</strong>
                  <span class="plugin-author">{{
                    authorLabel(entry.manifest, !!entry.official)
                  }}</span>
                </span>
                <span>{{
                  t(
                    entry.plugin?.description ??
                      entry.manifest?.description ??
                      (entry.manifest?.kind === 'local' ? '桌面应用' : '桌面与网页'),
                  )
                }}</span>
              </span>
            </UiButton>
            <div class="plugin-directory-actions">
              <span v-if="entry.installed" class="plugin-install-state">
                <span
                  class="plugin-directory-state"
                  :class="{
                    enabled: pluginEnabled(entry.id),
                    issue: entry.error || !entry.trusted,
                  }"
                  aria-hidden="true"
                />
                {{
                  t(
                    entry.error
                      ? '加载失败'
                      : !entry.trusted
                        ? '尚未信任'
                        : pluginEnabled(entry.id)
                          ? '已启用'
                          : '未启用',
                  )
                }}
              </span>
              <UiButton
                v-if="entry.official && canInstallOfficial(entry.official)"
                variant="primary"
                class="plugin-install-button"
                :disabled="locked"
                :busy="installingId === entry.id"
                @click="installOfficial(entry.official)"
                >{{ t(officialAction(entry.official)) }}</UiButton
              >
              <span v-else-if="entry.official" class="plugin-version-state">{{
                t(officialAction(entry.official))
              }}</span>
            </div>
          </article>
        </nav>
        <p
          v-if="!visibleEntries.length && !officialLoading && !officialError"
          class="plugin-empty-message"
          role="status"
        >
          {{
            t(
              query
                ? '没有找到匹配的插件。'
                : filter === 'updates'
                  ? '所有插件均已是目录中的最新版本。'
                  : filter === 'installed'
                    ? '当前学习库尚未安装插件。普通卡片可正常使用。'
                    : '暂无可安装的官方插件。',
            )
          }}
        </p>
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
                    {{ t(entry.plugin?.label ?? entry.manifest?.name ?? entry.id) }}
                  </h2>
                  <span class="plugin-author">{{
                    authorLabel(entry.manifest, !!entry.official)
                  }}</span>
                  <span v-if="entry.manifest" class="plugin-detail-version"
                    >v{{ entry.manifest.version }}</span
                  >
                  <span
                    v-if="
                      entry.official &&
                      entry.installed &&
                      entry.official.version !== entry.manifest?.version
                    "
                    class="plugin-update-version"
                    >{{ t('目录版本 {version}', { version: entry.official.version }) }}</span
                  >
                </div>
                <p v-if="entry.plugin?.description || entry.manifest?.description">
                  {{ t(entry.plugin?.description ?? entry.manifest!.description!) }}
                </p>
              </div>
              <div class="plugin-primary-actions">
                <UiButton
                  v-if="entry.official && canInstallOfficial(entry.official)"
                  variant="primary"
                  :disabled="locked"
                  :busy="installingId === entry.id"
                  @click="installOfficial(entry.official)"
                  >{{ t(officialAction(entry.official)) }}</UiButton
                >
                <UiButton
                  v-if="entry.settings.length"
                  variant="secondary"
                  :disabled="locked"
                  @click="emit('configure', entry.id)"
                  >{{ t('配置插件') }}</UiButton
                >
                <UiButton
                  v-if="entry.installed"
                  variant="ghost"
                  :disabled="locked"
                  @click="uninstall(entry.id)"
                  >{{ t('卸载插件') }}</UiButton
                >
                <USwitch
                  v-if="entry.installed"
                  class="plugin-enabled-toggle"
                  :label="t('启用')"
                  :aria-label="
                    t('启用 {name}', {
                      name: t(entry.plugin?.label ?? entry.manifest?.name ?? entry.id),
                    })
                  "
                  :title="t(pluginEnabled(entry.id) ? '已启用' : '未启用')"
                  :disabled="
                    locked || !entry.bundle || (entry.manifest!.kind === 'local' && !desktopEdition)
                  "
                  :model-value="pluginEnabled(entry.id)"
                  @update:model-value="
                    toggle(
                      entry.id,
                      $event === true,
                      entry.trusted,
                      entry.manifest?.name ?? entry.id,
                    )
                  "
                />
              </div>
            </div>
          </template>
          <UiNotice v-if="entry.installed && !entry.trusted" tone="warning">{{
            t('此设备尚未信任此插件包。启用前请确认代码来源。')
          }}</UiNotice>
          <UiNotice v-if="entry.error" tone="error">{{ t(entry.error) }}</UiNotice>
          <UiNotice v-if="previewLoading" role="status">{{ t('正在加载插件详情…') }}</UiNotice>
          <UiNotice v-if="previewError" tone="error"
            >{{ t(previewError) }}
            <UiButton
              v-if="entry.official"
              variant="ghost"
              @click="previewOfficial(entry.official)"
              >{{ t('重试') }}</UiButton
            >
          </UiNotice>
          <section class="plugin-metadata app-section-divider" :aria-label="t('插件信息')">
            <h3>{{ t('插件信息') }}</h3>
            <dl class="ui-setting-meta plugin-summary">
              <dt>{{ t('插件标识') }}</dt>
              <dd>{{ entry.id }}</dd>
              <dt>{{ t('作者') }}</dt>
              <dd>{{ authorLabel(entry.manifest, !!entry.official) }}</dd>
              <dt>{{ t('安装位置') }}</dt>
              <dd>
                {{
                  !entry.installed
                    ? t('尚未安装')
                    : desktopEdition
                      ? `.repeaty/plugins/${entry.id}/`
                      : t('浏览器副本')
                }}
              </dd>
              <dt>{{ t('运行环境') }}</dt>
              <dd>{{ t(entry.manifest?.kind === 'local' ? '桌面应用' : '桌面与网页') }}</dd>
              <dt>{{ t('访问权限') }}</dt>
              <dd class="plugin-permissions">
                <template v-if="entry.manifest?.permissions">
                  <span v-for="origin in entry.manifest.permissions.origins" :key="origin">{{
                    origin
                  }}</span>
                  <span v-if="entry.manifest.permissions.secrets">{{ t('设备凭据') }}</span>
                  <span v-if="entry.manifest.permissions.files">{{ t('插件文件') }}</span>
                  <span v-if="entry.manifest.permissions.models">{{ t('设备模型连接') }}</span>
                  <span v-if="entry.manifest.permissions.network">{{
                    t('经确认的自定义网站')
                  }}</span>
                </template>
                <span
                  v-if="
                    !entry.manifest?.permissions?.origins?.length &&
                    !entry.manifest?.permissions?.secrets &&
                    !entry.manifest?.permissions?.files &&
                    !entry.manifest?.permissions?.models &&
                    !entry.manifest?.permissions?.network
                  "
                  >{{ t('无原生能力') }}</span
                >
              </dd>
            </dl>
          </section>
          <UiCollapsible
            v-if="!previewLoading && !previewError"
            class="plugin-readme app-section-divider ui-setting-help"
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
        </UCard>
        <div v-if="!selectedEntries.length" class="plugin-detail-empty">
          <Puzzle :size="36" aria-hidden="true" />
          <h2>{{ t('选择一个插件') }}</h2>
          <p>{{ t('查看介绍与权限，安装后可单独启用。') }}</p>
        </div>
      </div>
    </div>
    <input
      ref="picker"
      type="file"
      accept=".repeaty-plugin,application/json"
      hidden
      @change="choose"
    />
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
