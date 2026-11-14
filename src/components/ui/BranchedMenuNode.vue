<!-- Repeaty's settings tree; SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, inject } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UCollapsible from '@nuxt/ui/components/Collapsible.vue'
import type { SettingsCategoryNode } from '../../settings/types'
import { t } from '../../i18n'
import { branchedMenuKey } from './branched-menu'
const props = defineProps<{ node: SettingsCategoryNode }>()
const tree = inject(branchedMenuKey)!
const item = computed(() => tree.rows.value.find((row) => row.node.key === props.node.key)!)
const children = computed(() => tree.rows.value.filter((row) => row.parent === props.node.key))
const opened = computed(() => tree.expanded.value.has(props.node.key))
const selected = computed(() => tree.active.value === props.node.key)
const groupId = computed(() => `${tree.idPrefix}-branch-${props.node.key}`)
const disclosureLabel = computed(() =>
  t(opened.value ? '收起 {name}' : '展开 {name}', { name: props.node.title }),
)
</script>
<template>
  <div
    class="branched-menu__section"
    role="presentation"
    :data-open="opened ? '' : undefined"
    :data-path="tree.selectedPath.value.has(node.key) ? '' : undefined"
  >
    <div class="branched-menu__row" role="presentation">
      <span v-if="item.parent" class="branched-menu__branch" aria-hidden="true" />
      <UButton
        :ref="(value) => tree.registerRow(node.key, value)"
        :id="`${tree.idPrefix}-category-${node.key}`"
        class="branched-menu__select"
        type="button"
        role="treeitem"
        color="neutral"
        variant="ghost"
        :data-category-key="node.key"
        :data-active="selected ? '' : undefined"
        :aria-label="node.title"
        :title="node.title"
        :aria-level="item.depth"
        :aria-posinset="item.position"
        :aria-setsize="item.count"
        :aria-selected="selected"
        :aria-expanded="children.length ? opened : undefined"
        :aria-controls="tree.controls"
        :aria-owns="children.length ? groupId : undefined"
        :tabindex="tree.focused.value === node.key ? 0 : -1"
        @focus="tree.focused.value = node.key"
        @click="tree.select(node.key)"
      >
        <span class="branched-menu__label">{{ node.title }}</span>
      </UButton>
      <UButton
        v-if="children.length"
        class="branched-menu__toggle"
        type="button"
        color="neutral"
        variant="ghost"
        :tabindex="-1"
        :icon="opened ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :aria-label="disclosureLabel"
        :title="disclosureLabel"
        :aria-expanded="opened"
        :aria-controls="groupId"
        @click.stop="tree.toggle(node.key)"
      />
    </div>
    <UCollapsible
      v-if="children.length"
      :open="opened"
      :unmount-on-hide="false"
      :ui="{ root: 'branched-menu__folder', content: 'branched-menu__body' }"
      @update:open="
        (value) => {
          if (value !== opened) tree.toggle(node.key, false)
        }
      "
    >
      <template #content>
        <div
          :id="groupId"
          :ref="(value) => tree.registerGroup(node.key, value)"
          role="group"
          class="branched-menu__tree"
          :aria-hidden="opened ? undefined : true"
          :inert="!opened"
        >
          <BranchedMenuNode v-for="child in children" :key="child.node.key" :node="child.node" />
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
