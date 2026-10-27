<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { t } from '../i18n'
import { remoteWorkspace } from '../edition'
import { SettingGroup, SettingField, UiButton } from '../components/ui'
import {
  mcpStatus,
  mcpBridgeError,
  refreshMcpStatus,
  startMcp,
  stopMcp,
  mcpClientConfiguration,
  type McpClient,
} from './mcp'

const client = ref<McpClient>('codex')
const configuring = ref(false)
const target = computed(
  () =>
    ({
      codex: '~/.codex/config.toml',
      'claude-code': '.mcp.json',
      'claude-desktop': 'claude_desktop_config.json',
      http: '',
    })[client.value],
)
let alive = true
onUnmounted(() => {
  alive = false
})
const working = ref(false),
  configuration = ref(''),
  error = ref(''),
  copied = ref(false)
watch([() => mcpStatus.value.enabled, client], () => {
  configuration.value = ''
  copied.value = false
})
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
  if (working.value || configuring.value || remoteWorkspace.value) return
  error.value = ''
  configuring.value = true
  const chosen = client.value,
    url = mcpStatus.value.url
  try {
    const value = await mcpClientConfiguration(chosen)
    if (
      alive &&
      !remoteWorkspace.value &&
      client.value === chosen &&
      (chosen !== 'http' || (mcpStatus.value.enabled && mcpStatus.value.url === url))
    )
      configuration.value = value
  } catch {
    if (alive) error.value = '无法生成客户端配置，请重试。'
  } finally {
    configuring.value = false
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
  <SettingGroup class="mcp-settings" :title="t('MCP 连接')">
    <template #actions>
      <span class="mcp-state" role="status">{{ t(mcpStatus.enabled ? '已开启' : '已关闭') }}</span>
    </template>
    <p class="form-note">
      {{ t('可查询待复习题目、学习统计和练习摘要。在材料中分享摘录后，还可接收制卡草稿。') }}
    </p>
    <p class="form-note">
      {{ t('仅支持本地学习库。每次打开应用后需开启 MCP；切换学习库会关闭连接。') }}
    </p>
    <p v-if="mcpStatus.enabled && !mcpStatus.available" class="form-note" role="status">
      {{ t('学习库正在处理数据，查询暂不可用。') }}
    </p>
    <p v-if="error || mcpBridgeError" class="import-warning" role="alert">
      {{ t(error || mcpBridgeError) }}
    </p>
    <SettingField
      id="mcp-client"
      type="select"
      :label="t('MCP 客户端')"
      :model-value="client"
      :disabled="working || configuring || remoteWorkspace"
      :options="[
        { value: 'codex', label: 'Codex' },
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'claude-desktop', label: 'Claude Desktop' },
        { value: 'http', label: t('通用 HTTP 客户端') },
      ]"
      @update:model-value="client = $event as McpClient"
    />
    <p v-if="client !== 'http'" class="form-note">
      {{ t('配置只需添加一次。关闭再开启 MCP 或重启 Repeaty 后，可沿用原配置。') }}
    </p>
    <div class="connection-actions">
      <UiButton
        type="button"
        :disabled="working || configuring || (!mcpStatus.enabled && !mcpStatus.available)"
        @click="toggle"
      >
        {{ t(mcpStatus.enabled ? '关闭 MCP' : '开启 MCP') }}
      </UiButton>
      <UiButton
        v-if="!configuration && (client !== 'http' || mcpStatus.enabled)"
        variant="ghost"
        type="button"
        :disabled="working || configuring || remoteWorkspace"
        @click="showConfiguration"
      >
        {{ t('显示连接配置') }}
      </UiButton>
    </div>
    <template v-if="configuration">
      <p v-if="target" class="form-note mcp-config-target">
        {{ t('将配置合并到 {file}，保留已有条目。', { file: target }) }}
      </p>
      <SettingField
        id="mcp-configuration"
        type="textarea"
        layout="stack"
        :label="t('客户端连接配置')"
        :model-value="configuration"
        :rows="10"
        readonly
        monospace
        :spellcheck="false"
      />
      <p class="form-note">
        {{
          t(
            client === 'http'
              ? '配置包含本次连接的访问密钥。只交给你信任的客户端；关闭连接后密钥失效。'
              : '配置不包含访问密钥。客户端仅连接本机运行中的 Repeaty，不会自动启动应用或开启 MCP。',
          )
        }}
      </p>
      <div class="connection-actions">
        <UiButton @click="copy">
          {{ t(copied ? '已复制' : '复制配置') }}
        </UiButton>
        <UiButton variant="ghost" @click="configuration = ''">
          {{ t('隐藏连接配置') }}
        </UiButton>
      </div>
    </template>
  </SettingGroup>
</template>

<style scoped>
.mcp-settings {
  margin-top: 1.5rem;
}
.mcp-state {
  font-size: var(--font-size-meta);
  color: var(--muted);
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  background: var(--sage);
}
.mcp-config-target {
  overflow-wrap: anywhere;
}
.form-field {
  margin-top: 1.25rem;
}
</style>
