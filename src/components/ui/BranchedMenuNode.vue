<!-- Adapted from official Vue Bits BranchedMenu.vue. Copyright (c) 2025–2026 David Haz.
     Application-specific adaptation under public/licenses/branched-menu.txt. -->
<script setup lang="ts">
import { computed, inject } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UCollapsible from '@nuxt/ui/components/Collapsible.vue'
import { t } from '../../i18n'
import type { SettingsCategoryNode } from '../../settings/types'
import { branchedMenuKey, branchLength, branchPath, fallbackBranchGeometry } from './branched-menu'

const props = defineProps<{ node: SettingsCategoryNode }>()
const menu = inject(branchedMenuKey)!
const row = computed(
  () =>
    menu.rows.value.find((entry) => entry.node.key === props.node.key) ?? {
      node: props.node,
      root: props.node.key,
      depth: 1,
      position: 1,
      count: 1,
    },
)
const children = computed(() =>
  menu.rows.value.filter((entry) => entry.parent === props.node.key).map((entry) => entry.node),
)
const hasChildren = computed(() => children.value.length > 0)
const open = computed(() => menu.expanded.value.has(props.node.key))
const groupId = computed(() => `${menu.idPrefix}-branch-${props.node.key}`)
const geometry = computed(
  () => menu.geometry.value.get(props.node.key) ?? fallbackBranchGeometry(children.value.length),
)
const selected = computed(() => menu.active.value === props.node.key)
function rowRef(element: unknown) {
  menu.registerRow(props.node.key, element)
}
function groupRef(element: unknown) {
  menu.registerGroup(props.node.key, element)
}
function updateOpen(next: boolean) {
  if (next !== open.value) menu.toggle(props.node.key, false)
}
</script>

<template>
  <div class="branched-menu__section" :data-open="open ? '' : undefined" role="presentation">
    <div class="branched-menu__row" role="presentation">
      <UButton
        :id="`${menu.idPrefix}-category-${node.key}`"
        :ref="rowRef"
        type="button"
        role="treeitem"
        class="branched-menu__select"
        color="neutral"
        variant="ghost"
        :data-category-key="node.key"
        :data-active="selected ? '' : undefined"
        :aria-label="node.title"
        :aria-level="row.depth"
        :aria-posinset="row.position"
        :aria-setsize="row.count"
        :aria-selected="selected"
        :aria-expanded="hasChildren ? open : undefined"
        :aria-controls="menu.controls"
        :aria-owns="hasChildren ? groupId : undefined"
        :tabindex="menu.focused.value === node.key ? 0 : -1"
        :title="node.title"
        @focus="menu.focused.value = node.key"
        @click="menu.select(node.key)"
      >
        <span class="branched-menu__label">{{ node.title }}</span>
      </UButton>
      <UButton
        v-if="hasChildren"
        type="button"
        class="branched-menu__toggle"
        color="neutral"
        variant="ghost"
        icon="i-lucide-chevron-right"
        :aria-label="t(open ? '收起 {name}' : '展开 {name}', { name: node.title })"
        :aria-expanded="open"
        :aria-controls="groupId"
        :title="t(open ? '收起 {name}' : '展开 {name}', { name: node.title })"
        :tabindex="-1"
        @click.stop="menu.toggle(node.key)"
      />
    </div>
    <UCollapsible
      v-if="hasChildren"
      :open="open"
      :unmount-on-hide="false"
      :ui="{ root: 'branched-menu__folder', content: 'branched-menu__body' }"
      @update:open="updateOpen"
    >
      <template #content>
        <div
          :id="groupId"
          :ref="groupRef"
          role="group"
          class="branched-menu__tree"
          :aria-hidden="open ? undefined : true"
          :inert="!open"
        >
          <svg class="branched-menu__lines" :height="geometry.height" aria-hidden="true">
            <path
              class="branched-menu__base"
              :d="`M ${geometry.trunk} 0 V ${(geometry.centers.at(-1) ?? 0) - geometry.radius}`"
            />
            <path
              v-for="(child, index) in children"
              :key="`base-${child.key}`"
              class="branched-menu__base"
              :d="branchPath(geometry, index)"
            />
            <path
              v-for="(child, index) in children"
              :key="`reach-${child.key}`"
              class="branched-menu__reach"
              :d="branchPath(geometry, index, true)"
              :style="{
                strokeDasharray: branchLength(geometry, index),
                strokeDashoffset: menu.selectedPath.value.has(child.key)
                  ? 0
                  : branchLength(geometry, index),
              }"
            />
          </svg>
          <BranchedMenuNode v-for="child in children" :key="child.key" :node="child" />
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
