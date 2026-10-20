<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { t } from '../i18n'
import {
  mcpStatus,
  mcpBridgeError,
  refreshMcpStatus,
  startMcp,
  stopMcp,
  mcpConfiguration,
} from './mcp'

const working = ref(false),
  configuration = ref(''),
  error = ref(''),
  copied = ref(false)
watch(
  () => mcpStatus.value.enabled,
  () => {
    configuration.value = ''
    copied.value = false
  },
)
onMounted(() => {
  void refreshMcpStatus().catch(() => {
    error.value = '无法读取 MCP 状态，请重新打开设置。'
  })
})
async function toggle() {
  working.value = true
  error.value = ''
  configuration.value = ''
  try {
    await (mcpStatus.value.enabled ? stopMcp() : startMcp())
  } catch {
    error.value = '无法更新 MCP 连接，请重试。'
  } finally {
    working.value = false
  }
}
async function showConfiguration() {
  error.value = ''
  const url = mcpStatus.value.url
  try {
    const value = await mcpConfiguration()
    if (mcpStatus.value.enabled && mcpStatus.value.url === url) configuration.value = value
  } catch {
    error.value = 'MCP 连接已关闭，请重新开启。'
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(configuration.value)
    copied.value = true
  } catch {
    error.value = '未能复制，请选中配置后手动复制。'
  }
}
</script>

<template>
  <section class="mcp-settings" aria-labelledby="mcp-heading">
    <div class="mcp-heading">
      <h3 id="mcp-heading">{{ t('MCP 连接') }}</h3>
      <span class="mcp-state" role="status">{{ t(mcpStatus.enabled ? '已开启' : '已关闭') }}</span>
    </div>
    <p class="form-note">
      {{ t('可查询待复习题目、学习统计和练习摘要。在材料中分享摘录后，还可接收制卡草稿。') }}
    </p>
    <p class="form-note">
      {{ t('仅支持本地学习库。退出应用或切换学习库后连接关闭，需要重新开启并更新客户端配置。') }}
    </p>
    <p v-if="mcpStatus.enabled && !mcpStatus.available" class="form-note" role="status">
      {{ t('学习库正在处理数据，查询暂不可用。') }}
    </p>
    <p v-if="error || mcpBridgeError" class="import-warning" role="alert">
      {{ t(error || mcpBridgeError) }}
    </p>
    <div class="connection-actions">
      <button
        class="button secondary"
        type="button"
        :disabled="working || (!mcpStatus.enabled && !mcpStatus.available)"
        @click="toggle"
      >
        {{ t(mcpStatus.enabled ? '关闭 MCP' : '开启 MCP') }}
      </button>
      <button
        v-if="mcpStatus.enabled && !configuration"
        class="text-button"
        type="button"
        @click="showConfiguration"
      >
        {{ t('显示连接配置') }}
      </button>
    </div>
    <template v-if="configuration">
      <label class="form-field" for="mcp-configuration">
        {{ t('客户端连接配置') }}
        <textarea
          id="mcp-configuration"
          :value="configuration"
          rows="10"
          readonly
          spellcheck="false"
        />
      </label>
      <p class="form-note">
        {{ t('配置包含本次连接的访问密钥。只交给你信任的客户端；关闭连接后密钥失效。') }}
      </p>
      <div class="connection-actions">
        <button class="button secondary" type="button" @click="copy">
          {{ t(copied ? '已复制' : '复制配置') }}
        </button>
        <button class="text-button" type="button" @click="configuration = ''">
          {{ t('隐藏连接配置') }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mcp-settings {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--line);
}
.mcp-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
h3 {
  margin: 0;
  font-size: 1.125rem;
}
.mcp-state {
  font-size: 0.875rem;
  color: var(--muted);
}
textarea {
  width: 100%;
  min-width: 0;
  margin-top: 0.5rem;
  padding: 0.875rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f8f9f6;
  color: inherit;
  font:
    0.875rem/1.6 ui-monospace,
    monospace;
  resize: vertical;
}
.form-field {
  margin-top: 1.25rem;
}
</style>
