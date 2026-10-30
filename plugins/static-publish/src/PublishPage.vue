<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  AppPage,
  UiButton,
  UiCheckbox,
  UiInput,
  UiNotice,
  UiProgress,
  UiSelect,
  UiStatus,
  publishing,
  pluginData,
  network,
} from '@repeaty/plugin-api'
import type { PublishingSnapshot } from '@repeaty/plugin-api'
import { loadConfig } from './settings'
import { SiteStore } from './store'
import {
  emptyIndex,
  hash,
  limits,
  type PublishSource,
  type SiteBuild,
  type SiteIndex,
} from './model'
import { buildSite, exportZip } from './worker'
import { createPreview } from './preview'
import {
  deploy,
  reconcile,
  targetKey,
  type DeploymentState,
  type CloudflareTarget,
} from './cloudflare/client'
import { message, t } from './text'

const props = defineProps<{ workspaceScope: string }>()
const store = new SiteStore({
  get: (id) => pluginData.get(id, props.workspaceScope),
  set: (id, value) => pluginData.set(id, value, props.workspaceScope),
})
const choices = ref<{ id: string; title: string; versionId: string }[]>([])
const selected = ref<string[]>([])
const query = ref('')
const busy = ref('')
const error = ref('')
const notice = ref('')
const loading = ref(true)
const progress = ref(0)
const build = shallowRef<SiteBuild>()
const index = shallowRef<SiteIndex>(emptyIndex())
const previewPath = ref('index.html')
const previewHtml = ref('')
const previewFrame = ref<HTMLIFrameElement>()
const remote = ref<DeploymentState>()
const targetLabel = ref('')
let confirmedTarget: CloudflareTarget | undefined
const confirmRemote = ref(false)
const removedFromPreview = ref(0)
const scope = ref<PublishingSnapshot>()
let controller: AbortController | undefined
const viewController = new AbortController()
let preview: Awaited<ReturnType<typeof createPreview>> | undefined
let alive = true
const visible = computed(() =>
  choices.value.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()),
  ),
)
const pageOptions = computed(
  () =>
    build.value?.pages.map((item) => ({
      value: item.path,
      label: item.title + ' · ' + item.path,
    })) ?? [],
)
const unresolved = computed(
  () =>
    remote.value && ['submitting', 'unknown', 'deploying', 'deleting'].includes(remote.value.phase),
)
const fresh = computed(
  () =>
    !!scope.value &&
    selected.value.length === scope.value.sources.length &&
    selected.value.every((id) => scope.value!.sources.some((source) => source.id === id)),
)
const remoteLabel = computed(
  () =>
    ({
      prepared: t('准备部署', 'Prepared'),
      uploading: t('上传资源中', 'Uploading'),
      submitting: t('核对部署结果', 'Checking deployment'),
      unknown: t('结果待核对', 'Needs reconciliation'),
      deploying: t('Cloudflare 正在部署', 'Cloudflare is deploying'),
      published: t('已发布', 'Published'),
      failed: t('部署未完成', 'Deployment failed'),
      deleting: t('删除结果待核对', 'Checking deletion'),
      deleted: t('远端项目已删除', 'Remote project deleted'),
    })[remote.value?.phase ?? 'prepared'],
)
function check() {
  controller?.signal.throwIfAborted()
  if (!alive || publishing.list().workspaceScope !== props.workspaceScope)
    throw new Error('publication-stale')
}
function refresh() {
  const list = publishing.list()
  if (list.workspaceScope !== props.workspaceScope) throw new Error('publication-stale')
  choices.value = [...list.sources]
  selected.value = selected.value.filter((id) => choices.value.some((item) => item.id === id))
}
function toggle(id: string, checked: boolean | 'indeterminate') {
  selected.value =
    checked === true
      ? [...new Set([...selected.value, id])]
      : selected.value.filter((value) => value !== id)
  confirmRemote.value = false
}
function show(path: string, fragment = '') {
  previewPath.value = path
  previewHtml.value = preview?.render(path, fragment) ?? ''
}
function adoptPreview(next: SiteBuild, prepared: Awaited<ReturnType<typeof createPreview>>) {
  const path = next.pages.some((item) => item.path === previewPath.value)
    ? previewPath.value
    : 'index.html'
  const html = prepared.render(path)
  if (!alive) {
    prepared.dispose()
    return
  }
  preview?.dispose()
  preview = prepared
  build.value = next
  previewPath.value = path
  previewHtml.value = html
}
async function installPreview(next: SiteBuild) {
  adoptPreview(next, await createPreview(next, viewController.signal))
}
function navigation(event: MessageEvent) {
  if (
    event.source !== previewFrame.value?.contentWindow ||
    event.data?.type !== 'repeaty-site-preview'
  )
    return
  const path = event.data.page
  if (typeof path === 'string' && build.value?.pages.some((item) => item.path === path))
    show(path, typeof event.data.fragment === 'string' ? event.data.fragment.slice(0, 300) : '')
}
async function operation(label: string, task: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return
  busy.value = label
  error.value = ''
  notice.value = ''
  confirmRemote.value = false
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
async function generate() {
  await operation('generate', async (signal) => {
    if (selected.value.length > limits.sources) throw new Error('单个站点最多发布 500 篇材料。')
    const config = await loadConfig()
    check()
    if (scope.value) publishing.release(scope.value.id)
    scope.value = undefined
    const snapshot = await publishing.prepare(
      {
        sourceIds: [...selected.value],
        expectedRevision: publishing.list().revision,
        publicFields: config.publicFields,
      },
      signal,
    )
    let committed = false
    let nextPreview: Awaited<ReturnType<typeof createPreview>> | undefined
    try {
      let assetBytes = 0
      const sources: PublishSource[] = []
      const cache = new Map<string, { path: string; type: string; bytes: Uint8Array }>()
      for (const source of snapshot.sources) {
        check()
        const resources = []
        for (const asset of source.assets) {
          let file = cache.get(asset.id)
          if (!file) {
            const blob = await publishing.asset(snapshot.id, asset.id, signal)
            assetBytes += blob.size
            if (blob.size > limits.fileBytes || assetBytes > limits.totalBytes)
              throw new Error('附件超过站点限制，请减少材料或压缩附件。')
            const bytes = new Uint8Array(await blob.arrayBuffer())
            const extension =
              (
                {
                  'image/png': 'png',
                  'image/jpeg': 'jpg',
                  'image/gif': 'gif',
                  'image/webp': 'webp',
                  'image/avif': 'avif',
                  'audio/mpeg': 'mp3',
                  'audio/wav': 'wav',
                  'audio/x-wav': 'wav',
                  'audio/ogg': 'ogg',
                  'audio/webm': 'webm',
                  'audio/mp4': 'm4a',
                  'audio/flac': 'flac',
                  'audio/aac': 'aac',
                  'video/mp4': 'mp4',
                  'video/webm': 'webm',
                  'application/pdf': 'pdf',
                } as Record<string, string>
              )[blob.type] ?? 'bin'
            file = {
              path: 'assets/' + (await hash(bytes)) + '.' + extension,
              type: blob.type,
              bytes,
            }
            cache.set(asset.id, file)
          }
          resources.push({ reference: asset.reference, file })
        }
        sources.push({
          id: source.id,
          versionId: source.versionId,
          title: source.title,
          text: source.body,
          format: source.format,
          fields: Object.entries(source.fields).map(([key, value]) => ({
            key,
            values: Array.isArray(value) ? value : [String(value)],
          })),
          resources,
          links: source.links,
        })
      }
      progress.value = 0
      const next = await buildSite(
        { sources, index: index.value, options: config.options, theme: config.theme },
        signal,
        (done, total) => {
          if (alive) progress.value = Math.min(100, Math.round((done / total) * 100))
        },
      )
      check()
      publishing.validate(snapshot.id)
      nextPreview = await createPreview(next, signal)
      nextPreview.render('index.html')
      check()
      publishing.validate(snapshot.id)
      const removed = index.value.bindings.filter(
        (entry) => entry.active && !snapshot.sources.some((source) => source.id === entry.sourceId),
      ).length
      await store.save(
        next,
        snapshot.sources.map((item) => item.id),
        () => {
          check()
          publishing.validate(snapshot.id)
        },
      )
      check()
      scope.value = snapshot
      committed = true
      index.value = next.index
      removedFromPreview.value = removed
      adoptPreview(next, nextPreview)
      notice.value = t(
        '预览已更新。仅包含选定材料和明确公开的字段。',
        'Preview updated with only the selected materials and explicitly public fields.',
      )
    } finally {
      if (!committed) {
        nextPreview?.dispose()
        publishing.release(snapshot.id)
      }
    }
  })
}
function validateFresh() {
  if (!scope.value || !fresh.value) throw new Error('publication-stale')
  publishing.validate(scope.value.id)
}
async function download() {
  await operation('export', async (signal) => {
    validateFresh()
    if (!build.value) return
    const blob = await exportZip(build.value.files, signal)
    check()
    validateFresh()
    const url = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = url
    link.download = 'repeaty-site.zip'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    notice.value = t('站点压缩包已导出。', 'Site archive exported.')
  })
}
function ports() {
  return {
    request: network.request,
    save: async (state: DeploymentState) => {
      await pluginData.set('deployment-v1', state, props.workspaceScope)
      if (alive) remote.value = state
    },
  }
}
async function target(): Promise<CloudflareTarget> {
  const config = await loadConfig()
  targetKey(config.target)
  return config.target
}
async function requestPublish() {
  error.value = ''
  try {
    validateFresh()
    const config = await loadConfig()
    if (!config.options.url.trim())
      throw new Error(
        t(
          '请先在设置中填写站点公开地址，用于 RSS 和文章永久链接。',
          'Set the public site URL in Settings for RSS and permanent links first.',
        ),
      )
    const next = await target()
    confirmedTarget = { ...next }
    targetLabel.value = next.projectName + ' · ' + next.branch
    confirmRemote.value = true
  } catch (cause) {
    error.value = message(cause)
  }
}
async function publish() {
  await operation('deploy', async (signal) => {
    validateFresh()
    const current = await target()
    if (!confirmedTarget || JSON.stringify(current) !== JSON.stringify(confirmedTarget))
      throw new Error(
        t('发布目标已变化，请重新确认。', 'The publication target changed. Confirm it again.'),
      )
    check()
    validateFresh()
    await deploy(
      build.value!,
      current,
      remote.value,
      {
        ...ports(),
        validate: () => {
          check()
          validateFresh()
        },
      },
      signal,
    )
  })
}
async function inspect() {
  await operation('check', async (signal) => {
    if (remote.value) await reconcile(await target(), remote.value, ports(), signal)
  })
}
onMounted(async () => {
  window.addEventListener('message', navigation)
  try {
    const saved = await store.read()
    if (!alive) return
    selected.value = saved.state.selected
    index.value = saved.state.index
    refresh()
    if (saved.build) await installPreview(saved.build)
    remote.value = (await pluginData.get('deployment-v1', props.workspaceScope)) as
      DeploymentState | undefined
  } catch (cause) {
    if (alive) error.value = message(cause)
  } finally {
    if (alive) loading.value = false
  }
})
onBeforeUnmount(() => {
  alive = false
  controller?.abort()
  viewController.abort()
  preview?.dispose()
  if (scope.value) publishing.release(scope.value.id)
  window.removeEventListener('message', navigation)
})
</script>

<template>
  <AppPage
    :title="t('静态发布', 'Static publishing')"
    :description="
      t(
        '选择公开内容，检查站点，再导出或发布。',
        'Choose public content, review the site, then export or publish.',
      )
    "
  >
    <template #actions>
      <UiButton v-if="busy" variant="secondary" @click="controller?.abort()">{{
        t('停止', 'Stop')
      }}</UiButton>
      <UiButton
        variant="primary"
        :disabled="!!busy || loading"
        :busy="busy === 'generate'"
        @click="generate"
        >{{ build ? t('更新预览', 'Update preview') : t('生成预览', 'Generate preview') }}</UiButton
      >
    </template>
    <UiNotice v-if="error" tone="error" role="alert">{{ error }}</UiNotice>
    <UiNotice v-if="notice" tone="success" role="status">{{ notice }}</UiNotice>
    <UiProgress v-if="busy === 'generate'" :model-value="progress" :max="100" />
    <div class="publish-workbench" :aria-busy="!!busy">
      <section class="publish-selection" :aria-label="t('公开材料', 'Public materials')">
        <div class="publish-section-heading">
          <h2>{{ t('公开材料', 'Public materials') }}</h2>
          <span>{{ selected.length }} / {{ choices.length }}</span>
        </div>
        <UiInput
          v-model="query"
          type="search"
          :placeholder="t('搜索材料', 'Search materials')"
          :aria-label="t('搜索材料', 'Search materials')"
        />
        <div class="publish-selection-actions">
          <UiButton
            variant="ghost"
            :disabled="!!busy"
            @click="selected = visible.map((item) => item.id)"
            >{{ t('选择搜索结果', 'Select results') }}</UiButton
          ><UiButton variant="ghost" :disabled="!!busy" @click="selected = []">{{
            t('清空', 'Clear')
          }}</UiButton>
        </div>
        <div class="publish-source-list">
          <UiCheckbox
            v-for="source in visible"
            :key="source.id"
            :model-value="selected.includes(source.id)"
            :label="source.title"
            :disabled="!!busy"
            @update:model-value="(value) => toggle(source.id, value)"
          />
          <p v-if="!visible.length" class="publish-muted">
            {{
              loading ? t('正在读取…', 'Loading…') : t('没有匹配的材料', 'No matching materials')
            }}
          </p>
        </div>
        <p class="publish-selection-note">
          {{
            t(
              '只公开勾选的材料。未勾选材料的内部链接显示为普通文字。站点与主题在设置页调整。',
              'Only checked materials are public. Links to other materials become plain text. Configure the site and theme in Settings.',
            )
          }}
        </p>
      </section>
      <section class="publish-preview" :aria-label="t('站点预览', 'Site preview')">
        <template v-if="build">
          <div class="publish-preview-toolbar">
            <UiSelect
              :model-value="previewPath"
              :items="pageOptions"
              :aria-label="t('预览页面', 'Preview page')"
              @update:model-value="(value) => show(String(value))"
            /><span class="publish-muted">{{ build.files.length }} {{ t('个文件', 'files') }}</span>
          </div>
          <iframe
            ref="previewFrame"
            :srcdoc="previewHtml"
            sandbox="allow-scripts"
            :title="t('公开站点预览', 'Public site preview')"
          />
          <div class="publish-output-bar">
            <p>
              {{
                !fresh
                  ? t(
                      '这是上次保存的站点。请更新预览后导出或发布。',
                      'This is the last saved site. Update the preview before export or publication.',
                    )
                  : t(
                      '预览中的内容将进入导出包或远端站点。',
                      'The previewed content will be included in the archive or remote site.',
                    )
              }}
            </p>
            <UiButton
              variant="secondary"
              :disabled="!!busy || !fresh"
              :busy="busy === 'export'"
              @click="download"
              >{{ t('导出 ZIP', 'Export ZIP') }}</UiButton
            ><UiButton
              variant="secondary"
              :disabled="!!busy || !fresh || !!unresolved"
              @click="requestPublish"
              >{{ t('发布到 Cloudflare', 'Publish to Cloudflare') }}</UiButton
            >
          </div>
        </template>
        <div v-else class="publish-empty">
          <div class="publish-empty-lines" aria-hidden="true"><i /><i /><i /></div>
          <h2>{{ t('把值得分享的内容放在一起', 'Bring shareable ideas together') }}</h2>
          <p>
            {{
              t(
                '勾选左侧材料后生成预览。生成不会上传内容，也不会修改学习进度。',
                'Select materials on the left and generate a preview. Generation does not upload content or change study progress.',
              )
            }}
          </p>
        </div>
      </section>
    </div>
    <Transition name="publish-confirm"
      ><section
        v-if="confirmRemote"
        class="publish-confirm"
        role="region"
        :aria-label="t('确认公开发布', 'Confirm public deployment')"
      >
        <div>
          <h2>{{ t('确认公开到', 'Publish publicly to') }} {{ targetLabel }}</h2>
          <p>
            {{ t('本次公开', 'Public in this build:') }} {{ scope?.sources.length ?? 0 }}
            {{
              t(
                '篇材料；比更新前的本地站点移除',
                'materials; removed from the previous local build:',
              )
            }}
            {{ removedFromPreview }}
            {{
              t(
                '篇。远端此分支将完整替换为当前预览。',
                'articles. This branch on the remote will be replaced by the preview.',
              )
            }}
          </p>
          <p>
            {{
              t(
                '将上传当前预览的全部文件，并更新此项目对应分支的站点。',
                'Upload all files in this preview and update the site on the selected project branch.',
              )
            }}
          </p>
        </div>
        <UiButton variant="primary" @click="publish">{{
          t('确认发布', 'Confirm publication')
        }}</UiButton
        ><UiButton variant="ghost" @click="confirmRemote = false">{{
          t('取消', 'Cancel')
        }}</UiButton>
      </section></Transition
    >
    <section v-if="remote" class="publish-remote" :aria-label="t('发布状态', 'Deployment status')">
      <div>
        <h2>{{ t('最近部署', 'Latest deployment') }}</h2>
        <p>{{ remote.targetKey }}</p>
        <UiStatus :tone="remote.phase === 'published' ? 'success' : 'neutral'">{{
          remoteLabel
        }}</UiStatus>
        <p v-if="remote.url">
          <a :href="remote.url" target="_blank" rel="noopener noreferrer">{{ remote.url }}</a>
        </p>
        <p v-if="remote.error">{{ message(new Error(remote.error)) }}</p>
      </div>
      <UiButton variant="secondary" :disabled="!!busy" :busy="busy === 'check'" @click="inspect">{{
        t('核对远端状态', 'Check remote status')
      }}</UiButton>
    </section>
    <p v-if="build" class="publish-footnote">
      {{
        t(
          '预览支持站内导航和默认搜索，禁用自定义主题脚本及外部链接。导出包保留主题脚本。',
          'Preview supports navigation and default search, but disables custom theme scripts and external links. Exports include theme scripts.',
        )
      }}
    </p>
  </AppPage>
</template>

<style scoped>
.publish-workbench {
  display: grid;
  grid-template-columns: minmax(240px, 0.3fr) minmax(0, 1fr);
  gap: 28px;
  margin-top: 24px;
  min-height: 560px;
}
.publish-selection {
  min-width: 0;
  padding-right: 26px;
  border-right: 1px solid var(--line);
}
.publish-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.publish-section-heading h2,
.publish-confirm h2,
.publish-remote h2 {
  font-size: var(--font-size-section);
  font-weight: 600;
  margin: 0;
}
.publish-section-heading span,
.publish-muted {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.publish-selection-actions {
  display: flex;
  gap: 8px;
  margin: 10px -8px 12px;
  flex-wrap: wrap;
}
.publish-source-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 440px;
  overflow: auto;
  padding: 4px 4px 12px;
}
.publish-selection-note,
.publish-footnote {
  font-size: var(--font-size-meta);
  color: var(--muted);
  line-height: 1.65;
}
.publish-selection-note {
  border-top: 1px solid var(--line);
  padding-top: 18px;
  margin-top: 18px;
}
.publish-preview {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.publish-preview-toolbar {
  display: flex;
  gap: 18px;
  align-items: center;
  margin-bottom: 14px;
}
.publish-preview-toolbar :first-child {
  flex: 1;
  min-width: 0;
}
.publish-preview-toolbar span {
  flex: none;
  white-space: nowrap;
}
.publish-preview iframe {
  width: 100%;
  height: 560px;
  min-height: 360px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.publish-output-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 18px;
}
.publish-output-bar p {
  flex: 1;
  min-width: 170px;
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: 1.6;
  margin: 0;
}
.publish-empty {
  margin: auto;
  max-width: 390px;
  text-align: center;
  padding: 45px 20px;
}
.publish-empty h2 {
  font-size: var(--font-size-section);
  line-height: 1.4;
  margin: 24px 0 12px;
}
.publish-empty p {
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: 1.75;
}
.publish-empty-lines {
  width: 110px;
  display: grid;
  gap: 12px;
  margin: auto;
  padding: 22px 0;
}
.publish-empty-lines i {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--line);
}
.publish-empty-lines i:first-child {
  width: 65%;
  background: var(--green);
}
.publish-empty-lines i:last-child {
  width: 82%;
}
.publish-confirm,
.publish-remote {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 24px 0;
  border-top: 1px solid var(--line);
  margin-top: 26px;
}
.publish-confirm > div,
.publish-remote > div {
  flex: 1;
  min-width: 230px;
}
.publish-confirm p,
.publish-remote p {
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: 1.6;
  margin: 8px 0 0;
}
.publish-remote h2 {
  margin-bottom: 10px;
}
.publish-confirm-enter-active,
.publish-confirm-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.publish-confirm-enter-from,
.publish-confirm-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.publish-footnote {
  margin-top: 22px;
}
@media (max-width: 1000px) {
  .publish-workbench {
    grid-template-columns: 230px minmax(0, 1fr);
    gap: 20px;
  }
  .publish-selection {
    padding-right: 18px;
  }
  .publish-preview iframe {
    height: 510px;
  }
}
@media (max-width: 720px) {
  .publish-workbench {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .publish-selection {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 0 0 20px;
  }
  .publish-source-list {
    max-height: 240px;
  }
  .publish-selection-note {
    border-top: 0;
    padding-top: 0;
    margin-bottom: 0;
  }
  .publish-preview iframe {
    height: 510px;
  }
  .publish-empty {
    margin: 20px auto;
  }
  .publish-output-bar {
    justify-content: flex-start;
  }
  .publish-output-bar p {
    flex-basis: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .publish-confirm-enter-active,
  .publish-confirm-leave-active {
    transition: none;
  }
}
</style>
