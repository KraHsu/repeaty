<script setup lang="ts">
import { t } from '../i18n'
import {
  installedPlugins,
  pluginEnabled,
  setPluginEnabled,
  pluginPreferenceError,
  pluginAvailable,
} from '../plugins'
</script>

<template>
  <div class="page plugins-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('插件') }}</h1>
        <p>{{ t('开启或关闭此部署已安装的题目插件。') }}</p>
      </div>
    </header>
    <p class="plugin-management-note">
      {{ t('关闭插件后，相关题目暂停出现在复习队列中，内容和进度保留。开关仅影响当前浏览器。') }}
    </p>
    <p v-if="pluginPreferenceError" class="import-warning" role="alert">
      {{ t(pluginPreferenceError) }}
    </p>
    <article
      v-for="{ plugin, builtin } in installedPlugins"
      :key="plugin.id"
      class="plugin-settings"
    >
      <div class="plugin-heading">
        <h2>{{ t(plugin.label) }}</h2>
        <span class="pill">{{ t(plugin.kind === 'frontend' ? '纯前端插件' : '需要后端') }}</span>
        <span class="pill">{{ t(builtin ? '内置' : '已安装') }}</span>
        <label class="plugin-toggle">
          <input
            type="checkbox"
            role="switch"
            :disabled="!pluginAvailable(plugin.id)"
            :aria-label="t('启用 {name}', { name: t(plugin.label) })"
            :checked="pluginEnabled(plugin.id)"
            @change="setPluginEnabled(plugin.id, ($event.target as HTMLInputElement).checked)"
          />
          <span aria-hidden="true" class="toggle-track" />
          <span>{{ t(pluginEnabled(plugin.id) ? '已开启' : '已关闭') }}</span>
        </label>
      </div>
      <p v-if="!pluginAvailable(plugin.id)" class="form-note">
        {{ t('后端未安装或未开启此插件。') }}
      </p>
      <p v-if="plugin.description">{{ t(plugin.description) }}</p>
      <component v-if="pluginEnabled(plugin.id) && plugin.settings" :is="plugin.settings" />
    </article>
    <p v-if="!installedPlugins.length" class="form-note">
      {{ t('此部署尚未安装题目插件。普通卡片可正常使用。') }}
    </p>
  </div>
</template>
