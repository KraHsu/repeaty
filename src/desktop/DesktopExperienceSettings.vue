<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { SettingField, SettingGroup, UiButton, UiNotice } from '../components/ui'
import { t } from '../i18n'
import { createExportFile } from './exports'
import {
  experienceStatus,
  configureExperience,
  setAutostart,
  checkUpdate,
  downloadUpdate,
  cancelUpdate,
  requestUpdateInstall,
  diagnosticReport,
  desktopError,
  type DesktopExperienceStatus,
  type DesktopRelease,
} from './experience'

const status = shallowRef<DesktopExperienceStatus>()
const release = shallowRef<DesktopRelease | null>()
const busy = ref(''),
  error = ref(''),
  feedback = ref(''),
  report = ref(''),
  progress = ref(0)
let alive = true,
  unlisten: UnlistenFn | undefined
onUnmounted(() => {
  alive = false
  unlisten?.()
  if (busy.value === 'download') void cancelUpdate().catch(() => {})
})
async function run(action: string, work: () => Promise<void>) {
  if (busy.value) return
  busy.value = action
  error.value = ''
  feedback.value = ''
  try {
    await work()
  } catch (reason) {
    if (alive) error.value = desktopError(reason)
  } finally {
    if (alive) busy.value = ''
  }
}
async function save(key: 'startHidden' | 'closeToTray', value: unknown) {
  if (!status.value) return
  const configuration = { ...status.value.configuration, [key]: Boolean(value) }
  await run('settings', async () => {
    const next = await configureExperience(configuration)
    if (alive) status.value = next
  })
}
const startup = (enabled: unknown) =>
  run('settings', async () => {
    const next = await setAutostart(Boolean(enabled))
    if (alive) status.value = next
  })
const check = () =>
  run('check', async () => {
    const next = await checkUpdate()
    if (alive) release.value = next
  })
const download = () =>
  run('download', async () => {
    progress.value = 0
    await downloadUpdate()
    if (alive && release.value) release.value = { ...release.value, downloaded: true }
  })
const install = () => run('install', () => requestUpdateInstall())
async function cancel() {
  try {
    await cancelUpdate()
  } catch (reason) {
    if (alive) error.value = desktopError(reason)
  }
}
const inspect = () =>
  run('diagnostics', async () => {
    const next = await diagnosticReport()
    if (alive) report.value = JSON.stringify(next, null, 2)
  })
const copy = () =>
  run('copy', async () => {
    try {
      await navigator.clipboard.writeText(report.value)
    } catch {
      throw new Error('clipboard-unavailable')
    }
    if (alive) feedback.value = '诊断信息已复制。'
  })
const exportReport = () =>
  run('export', async () => {
    const content = report.value
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined
    try {
      writer = (await createExportFile('repeaty-diagnostics.json')).getWriter()
      await writer.write(new TextEncoder().encode(content))
      await writer.close()
      if (alive) feedback.value = '诊断信息已导出。'
    } catch (reason) {
      await writer?.abort().catch(() => {})
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) throw reason
    } finally {
      writer?.releaseLock()
    }
  })
onMounted(async () => {
  await run('load', async () => {
    const next = await experienceStatus()
    if (alive) status.value = next
  })
  try {
    const stop = await listen<{ downloaded: number; total: number | null }>(
      'repeaty-update-progress',
      ({ payload }) => {
        if (alive && busy.value === 'download')
          progress.value = Math.round(payload.downloaded / 1024 / 1024)
      },
    )
    if (alive) unlisten = stop
    else stop()
  } catch {
    /* A progress listener failure does not bypass download verification. */
  }
})
</script>

<template>
  <div class="desktop-experience" :aria-busy="!!busy">
    <UiNotice v-if="error" tone="error">{{ t(error) }}</UiNotice>
    <p v-if="feedback" role="status">{{ t(feedback) }}</p>
    <SettingGroup :title="t('启动与后台')" :description="t('这些设置仅保存在当前设备。')">
      <UiNotice v-if="status?.configurationError" tone="warning">{{
        t('桌面设置读取失败，已使用安全默认值；保存新设置前不会覆盖原文件。')
      }}</UiNotice>
      <SettingField
        type="switch"
        :label="t('登录系统时启动 Repeaty')"
        :model-value="status?.autostart === true"
        :disabled="!!busy || !status?.autostartSupported"
        :description="
          t(
            status?.autostartSupported
              ? '系统仍可能禁用登录项，请在系统启动设置中核对。'
              : '请在安装后的桌面版中设置登录启动。',
          )
        "
        @update:model-value="startup"
      />
      <UiNotice v-if="status?.autostartSupported && status.autostart === null" tone="warning">{{
        t('无法读取登录启动状态，请检查系统权限。')
      }}</UiNotice>
      <SettingField
        type="switch"
        :label="t('登录启动时隐藏窗口')"
        :model-value="status?.configuration.startHidden ?? false"
        :disabled="!!busy || !status?.trayAvailable"
        :description="t('仅系统登录启动时隐藏到托盘；手动打开仍显示窗口。')"
        @update:model-value="save('startHidden', $event)"
      />
      <SettingField
        type="switch"
        :label="t('关闭窗口后留在后台')"
        :model-value="status?.configuration.closeToTray ?? false"
        :disabled="!!busy || !status?.trayAvailable"
        :description="t('保存完成后隐藏到托盘。使用托盘菜单退出 Repeaty。')"
        @update:model-value="save('closeToTray', $event)"
      />
      <UiNotice v-if="status && !status.trayAvailable" tone="info">{{
        t('系统托盘不可用，窗口将继续正常显示和关闭。')
      }}</UiNotice>
    </SettingGroup>
    <SettingGroup :title="t('应用更新')">
      <p v-if="status" class="desktop-version">
        Repeaty {{ status.version }} <span>{{ status.platform }} · {{ status.architecture }}</span>
      </p>
      <p class="desktop-description">
        {{
          t(
            status?.signedUpdates
              ? '更新包通过签名与版本校验后，才可以保存并安装。'
              : '当前构建未配置签名更新渠道。可以检查稳定版本，并从官方发布页下载安装。',
          )
        }}
      </p>
      <div class="desktop-actions">
        <UiButton :disabled="!!busy" @click="check">{{
          t(busy === 'check' ? '正在检查…' : '检查更新')
        }}</UiButton>
        <a
          href="https://github.com/KraHsu/repeaty/releases"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t('官方发布页') }}</a
        >
      </div>
      <p v-if="release === null" role="status">{{ t('当前渠道没有可用更新。') }}</p>
      <template v-if="release">
        <p role="status">
          {{ t(release.newer ? '发现新版本' : '当前版本已是最新或更新') }} · {{ release.version }}
        </p>
        <details v-if="release.notes">
          <summary>{{ t('版本说明') }}</summary>
          <pre class="desktop-release-notes">{{ release.notes }}</pre>
        </details>
        <div v-if="release.newer" class="desktop-actions">
          <template v-if="release.signed">
            <UiButton v-if="!release.downloaded" :disabled="!!busy" @click="download">{{
              t('下载并验证更新')
            }}</UiButton>
            <UiButton v-else variant="primary" :disabled="!!busy" @click="install">{{
              t('保存并安装更新')
            }}</UiButton>
            <template v-if="busy === 'download'"
              ><span role="status">{{ progress }} MB</span
              ><UiButton variant="ghost" @click="cancel">{{ t('取消下载') }}</UiButton></template
            >
          </template>
          <a v-else :href="release.pageUrl" target="_blank" rel="noopener noreferrer">{{
            t('查看并下载此版本')
          }}</a>
        </div>
      </template>
    </SettingGroup>
    <SettingGroup
      :title="t('诊断与反馈')"
      :description="
        t(
          '报告仅包含版本、平台和运行能力，不包含学习正文、目录路径、凭据或个人标识。先预览，再决定是否分享。',
        )
      "
    >
      <div class="desktop-actions">
        <UiButton :disabled="!!busy" @click="inspect">{{ t('预览诊断信息') }}</UiButton
        ><a
          href="https://github.com/KraHsu/repeaty/issues"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t('反馈问题') }}</a
        >
      </div>
      <template v-if="report"
        ><SettingField
          type="textarea"
          :label="t('诊断信息')"
          :model-value="report"
          :readonly="true"
          :monospace="true"
          :rows="10"
        />
        <div class="desktop-actions">
          <UiButton :disabled="!!busy" @click="copy">{{ t('复制') }}</UiButton
          ><UiButton :disabled="!!busy" @click="exportReport">{{ t('导出诊断信息') }}</UiButton>
        </div></template
      >
    </SettingGroup>
  </div>
</template>
<style scoped>
.desktop-experience {
  display: grid;
  gap: var(--space-6, 1.5rem);
  min-width: 0;
}
.desktop-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.desktop-version {
  font-weight: 600;
}
.desktop-version span,
.desktop-description {
  color: var(--text-muted);
}
.desktop-version span {
  margin-inline-start: 0.75rem;
  font-weight: 400;
}
.desktop-release-notes {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 20rem;
  overflow: auto;
  font-family: var(--font-body);
  font-size: var(--font-size-body);
}
summary {
  cursor: pointer;
  padding-block: 0.5rem;
}
a {
  color: var(--accent);
  text-underline-offset: 0.2em;
}
a:hover {
  text-decoration: underline;
}
</style>
