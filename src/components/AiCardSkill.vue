<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { t } from '../i18n'
import { notify } from '../notifications'
import { createExportFile } from '@repeaty-platform'
const url = `${import.meta.env.BASE_URL}skills/repeaty-cards/SKILL.md`
const text = ref(''),
  loading = ref(true),
  error = ref(false)
const controller = new AbortController()
onMounted(async () => {
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('skill unavailable')
    text.value = await response.text()
  } catch {
    if (!controller.signal.aborted) error.value = true
  } finally {
    loading.value = false
  }
})
onUnmounted(() => controller.abort())
async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    notify('制卡说明已复制')
  } catch {
    notify('未能复制，请在下方选中说明并手动复制。', 'warning')
  }
}
async function download() {
  try {
    const bytes = new TextEncoder().encode(text.value)
    if (createExportFile) {
      const stream = await createExportFile('SKILL.md'),
        writer = stream.getWriter()
      try {
        await writer.write(bytes)
        await writer.close()
      } catch (error) {
        await writer.abort(error).catch(() => {})
        throw error
      }
    } else {
      const blobUrl = URL.createObjectURL(
        new Blob([bytes], { type: 'text/markdown;charset=utf-8' }),
      )
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = 'SKILL.md'
      link.click()
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError'))
      notify('制卡说明未能下载，请复制下方内容。', 'error')
  }
}
</script>
<template>
  <section class="ai-skill">
    <h2>{{ t('不用 MCP，也可以让 AI 帮忙制卡') }}</h2>
    <ol>
      <li>{{ t('复制制卡说明，连同学习材料发给 GPT 网页或其他 AI 聊天工具。') }}</li>
      <li>{{ t('将生成的 CSV 复制或保存为文件，在卡组中选择「批量导入」。') }}</li>
      <li>{{ t('检查预览和答案，再确认导入。') }}</li>
    </ol>
    <p class="form-note">
      {{ t('只分享本次制卡需要的材料。无需提供账户、Cookie、完整备份或学习进度。') }}
    </p>
    <p v-if="loading" role="status">{{ t('正在加载说明…') }}</p>
    <p v-if="error" class="import-warning" role="alert">
      {{ t('未能加载制卡说明，请重新打开此页面。') }}
    </p>
    <div class="skill-actions">
      <button class="button primary" :disabled="!text" @click="copy">{{ t('复制制卡说明') }}</button
      ><button class="button secondary" :disabled="!text" @click="download">
        {{ t('下载 SKILL.md') }}
      </button>
    </div>
    <label for="ai-card-skill">{{ t('制卡说明（可直接粘贴到 AI 聊天中）') }}</label
    ><textarea id="ai-card-skill" readonly :value="text" rows="16" />
    <p class="form-note">
      {{
        t(
          '使用支持 skill 的工具时，将 SKILL.md 放入 repeaty-cards 文件夹，再安装到工具的技能目录。',
        )
      }}
    </p>
  </section>
</template>
<style scoped>
.ai-skill {
  padding: 1.5rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
}
h2 {
  margin-top: 0;
  font-size: 1.2rem;
}
li {
  margin: 0.65rem 0;
  line-height: 1.8;
}
.skill-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin: 1.5rem 0;
}
textarea {
  width: 100%;
  padding: 1rem;
  margin-top: 0.75rem;
  font:
    1rem/1.65 ui-monospace,
    monospace;
  border: 1px solid var(--line);
  border-radius: 8px;
  resize: vertical;
  min-height: 250px;
}
</style>
