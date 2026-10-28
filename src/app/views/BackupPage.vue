<script setup lang="ts">
import '../../styles/content-pages.css'
import { UiProgress, UiButton } from '../../components/ui'
import { version } from '../../../package.json'
import { t, locale } from '../../i18n'
import { ArrowDownToLine, ArrowUpFromLine, BookOpen, Repeat2, ShieldCheck } from '@lucide/vue'
import { remoteWorkspace, desktopEdition } from '../../edition'
import { useApplication } from '../context'
const {
  workspace,
  library,
  busy,
  backups,
  backupError,
  offline,
  run,
  upload,
  transfer,
  filePicker,
  cancelTransfer,
  exportData,
  openSnapshot,
  importData,
} = useApplication()
function bindUpload(instance: unknown) {
  upload.value = instance as typeof upload.value
}
</script>
<template>
  <div class="page data-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('数据与备份') }}</h1>
        <p>
          {{
            t(
              remoteWorkspace
                ? '导出、恢复备份，管理服务中的数据。'
                : '导出、恢复备份，管理本地数据。',
            )
          }}
        </p>
      </div>
    </header>
    <section class="storage-banner data-overview">
      <ShieldCheck :size="29" />
      <div>
        <h2>
          {{
            t(
              remoteWorkspace
                ? '保存在服务的 SQLite 数据库中'
                : desktopEdition
                  ? '保存在工作目录中'
                  : '保存在当前浏览器',
            )
          }}
        </h2>
        <p>
          {{
            t(
              remoteWorkspace
                ? '卡组、卡片、复习记录和附件保存在部署的服务中。定期导出备份，或备份服务器上的 SQLite 数据库。'
                : desktopEdition
                  ? '本地学习库保存在此设备。更换设备或卸载前，请先导出备份。'
                  : '数据仅保存在当前浏览器，不会自动同步。清除网站数据会删除卡片和复习记录。更换浏览器或网址前，请先导出备份。',
            )
          }}
        </p>
      </div>
      <dl class="data-overview-counts">
        <div>
          <dt>{{ t('卡组') }}</dt>
          <dd>{{ library.decks.length }}</dd>
        </div>
        <div>
          <dt>{{ t('卡片') }}</dt>
          <dd>{{ library.cards.length }}</dd>
        </div>
      </dl>
    </section>
    <div v-if="transfer" class="transfer-status" role="status">
      <span>{{ t(transfer.label) }} {{ Math.floor(transfer.percent) }}%</span>
      <UiProgress :model-value="transfer.percent" :max="100" :aria-label="t(transfer.label)" />
      <UiButton variant="secondary" type="submit" @click="cancelTransfer">
        {{ t('取消传输') }}
      </UiButton>
    </div>
    <div class="backup-grid">
      <section class="backup-card">
        <span class="stat-icon sage"><ArrowDownToLine :size="22" /></span>
        <h2>{{ t('导出备份') }}</h2>
        <p>{{ t('导出全部学习数据，包含卡组、卡片、复习记录、图片和音频。') }}</p>
        <p v-if="library.sources.length" class="form-note">
          {{ t('学习材料和原文快照也包含在完整备份中。') }}
        </p>
        <div class="backup-meta">
          {{
            t('{p0} 个卡组 · {p1} 张卡片 · {p2} 次复习', {
              p0: library.decks.length,
              p1: library.cards.length,
              p2: library.reviews.length,
            })
          }}
        </div>
        <div class="backup-actions">
          <UiButton
            variant="primary"
            type="submit"
            :disabled="busy || !!transfer"
            @click="exportData()"
          >
            <ArrowDownToLine :size="16" />{{ t('导出 .repeaty') }}
          </UiButton>
          <UiButton
            variant="secondary"
            type="submit"
            v-if="filePicker"
            :disabled="busy || !!transfer"
            @click="exportData('file')"
          >
            {{ t('直接保存到文件') }}
          </UiButton>
          <UiButton
            variant="ghost"
            type="submit"
            :disabled="busy || !!transfer"
            @click="exportData('json')"
          >
            {{ t('导出旧版 JSON') }}
          </UiButton>
        </div>
        <p v-if="filePicker" class="form-note">
          {{ t('大备份可直接写入文件，减少内存占用。') }}
        </p>
      </section>
      <section class="backup-card">
        <span class="stat-icon lavender"><ArrowUpFromLine :size="22" /></span>
        <h2>{{ t('恢复备份') }}</h2>
        <p>{{ t('支持 .repeaty 备份包和旧版 JSON。检查完成并确认后才会替换当前数据。') }}</p>
        <div class="backup-meta">{{ t('.repeaty 最大 2 GB · 旧版 JSON 最大 100 MB') }}</div>
        <input
          :ref="bindUpload"
          class="sr-only"
          type="file"
          accept=".repeaty,.zip,.json,application/zip,application/json"
          :aria-label="t('导入备份文件')"
          @change="importData"
        /><UiButton
          variant="secondary"
          type="submit"
          :disabled="busy || !!transfer"
          @click="upload?.click()"
        >
          <ArrowUpFromLine :size="16" />{{ t('选择备份文件') }}
        </UiButton>
      </section>
    </div>
    <section class="storage-banner">
      <BookOpen :size="24" />
      <div>
        <h2>{{ t('FSRS 与 Repeaty 入门') }}</h2>
        <p>
          {{
            t('通过 24 条笔记学习评分、复习和制卡。按当前界面语言添加一份，已有卡片和进度会保留。')
          }}
        </p>
        <UiButton
          variant="secondary"
          type="submit"
          :disabled="busy || !!transfer"
          @click="run(workspace.addSample, '入门卡组已添加')"
        >
          {{ t('添加入门卡组') }}
        </UiButton>
      </div>
    </section>
    <section class="snapshot-section">
      <div class="section-heading">
        <h2>{{ t('自动快照') }}</h2>
        <UiButton
          variant="secondary"
          type="submit"
          :disabled="busy || !library.notes.length"
          @click="run(() => workspace.backupNow(true), '快照已保存；未变化的数据不会重复备份')"
        >
          {{ t('立即创建快照') }}
        </UiButton>
      </div>
      <p class="form-note">
        {{
          t(
            remoteWorkspace
              ? '有数据变化时每 30 分钟保存快照；编辑、删除和恢复前也会保存。服务保留最近 10 份快照及其附件。'
              : '有数据变化时，在打开应用及使用期间每 30 分钟保存快照；编辑、删除、批量操作和恢复前也会保存。保留最近 10 份及其图片和音频。清除网站数据也会删除快照。',
          )
        }}
      </p>
      <p v-if="backupError" role="alert" class="import-warning">{{ t(backupError) }}</p>
      <ul v-if="backups.length" class="snapshot-list">
        <li v-for="backup in backups" :key="backup.id">
          <div>
            <strong>{{ t(backup.reason) }}</strong
            ><span>{{
              t('{p0} · {p1} 条笔记 · {p2} 张卡片', {
                p0: new Date(backup.createdAt).toLocaleString(locale),
                p1: backup.notes,
                p2: backup.cards,
              })
            }}</span>
          </div>
          <UiButton
            variant="secondary"
            type="submit"
            :disabled="busy"
            @click="openSnapshot(backup.id)"
          >
            {{ t('恢复此快照') }}
          </UiButton>
        </li>
      </ul>
      <p v-else class="form-note">
        {{ t('暂无快照。添加卡片后可手动创建，也会自动保存。') }}
      </p>
    </section>
    <section class="storage-banner">
      <ShieldCheck :size="24" />
      <div>
        <h2>{{ t(offline.status.value) }}</h2>
        <p>
          {{
            t(
              remoteWorkspace
                ? '此版本需要连接服务才能读取和保存学习数据。需要离线使用时，可导出备份并导入静态版。'
                : '首次联网加载完成后，可离线打开、制卡和复习。已保存的图片和音频也可离线使用。',
            )
          }}
        </p>
        <UiButton
          variant="secondary"
          type="submit"
          v-if="offline.updateReady.value"
          :disabled="busy"
          @click="offline.applyUpdate"
        >
          {{ t('刷新以更新版本') }}
        </UiButton>
      </div>
    </section>
    <div class="about-core">
      <Repeat2 :size="21" />
      <div>
        <h3>Repeaty</h3>
        <p>
          {{
            t(
              remoteWorkspace
                ? '使用 FSRS 安排复习，数据保存在服务中。'
                : '使用 FSRS 安排复习，数据保存在当前浏览器。',
            )
          }}
        </p>
      </div>
      <span class="pill">v{{ version }}</span>
    </div>
  </div>
</template>
