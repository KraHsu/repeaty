<script setup lang="ts">
import { UiSelect, UiButton, UiCheckbox } from './ui'
import { computed, ref, watch } from 'vue'
import { t, type MessageKey } from '../i18n'
import type { AnkiImportPlan, AnkiChange, AnkiDifference } from '../core/anki/changes'
import CardContent from './CardContent.vue'
import MediaList from './MediaList.vue'

const props = defineProps<{
  plan: AnkiImportPlan
  selected: string[]
  disabled: boolean
  getMedia: (id: string) => Promise<Blob | undefined>
}>()
const emit = defineEmits<{ select: [ids: string[]] }>()
const filter = ref<'all' | AnkiChange['status']>(
  props.plan.changes.some((entry) => entry.status === 'changed') ? 'changed' : 'all',
)
const page = ref(0),
  open = ref('')
const pageSize = 20
const filtered = computed(() =>
  props.plan.changes.filter((entry) => filter.value === 'all' || entry.status === filter.value),
)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() =>
  filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
)
const selectedSet = computed(() => new Set(props.selected))
watch(filter, () => {
  page.value = 0
})
watch(page, () => {
  open.value = ''
})
const incomingMedia = computed(() => props.plan.data.assets.map((asset) => asset.meta))
const incomingBlobs = computed(
  () => new Map(props.plan.data.assets.map((asset) => [asset.meta.id, asset.blob])),
)
const getIncomingMedia = async (id: string) => incomingBlobs.value.get(id)
const statusLabels: Record<AnkiChange['status'], MessageKey> = {
  new: '新笔记',
  same: '内容相同',
  changed: '内容不同',
  unavailable: '无法比较',
}
const fields: Record<AnkiDifference, MessageKey> = {
  type: '笔记类型',
  format: '内容格式',
  front: '正面 · 问题',
  back: '背面 · 答案',
  tags: '标签',
  frontMedia: '正面图片 / 音频',
  backMedia: '背面图片 / 音频',
}
function choose(id: string, checked: boolean) {
  const next = new Set(props.selected)
  if (checked) next.add(id)
  else next.delete(id)
  emit('select', [...next])
}
function chooseChanged() {
  emit('select', [
    ...new Set([
      ...props.selected,
      ...props.plan.changes
        .filter((entry) => entry.status === 'changed')
        .map((entry) => entry.incoming.id),
    ]),
  ])
}
function keepExisting() {
  const newIds = new Set(
    props.plan.changes.filter((entry) => entry.status === 'new').map((entry) => entry.incoming.id),
  )
  emit(
    'select',
    props.selected.filter((id) => newIds.has(id)),
  )
}
function sides(change: AnkiChange) {
  const source = {
    key: 'file',
    label: t('Anki 文件中的内容'),
    note: change.incoming.input,
    media: incomingMedia.value,
    load: getIncomingMedia,
  }
  return change.current
    ? [
        {
          key: 'current',
          label: t('Repeaty 中的内容'),
          note: change.current,
          media: props.plan.base.media,
          load: props.getMedia,
        },
        source,
      ]
    : [source]
}
function variant(key: string) {
  return key === 'forward'
    ? t('正面 → 背面')
    : key === 'reverse'
      ? t('背面 → 正面')
      : t('挖空 {number}', { number: key.split(':')[1] })
}
</script>

<template>
  <div class="anki-changes">
    <div class="anki-change-tools">
      <label for="anki-change-filter">{{ t('筛选笔记') }}</label>
      <UiSelect
        :items="[
          { label: t('所有笔记'), value: 'all' },
          ...Object.entries(statusLabels).map(([status, label]) => ({
            label: t(label),
            value: status,
          })),
        ]"
        id="anki-change-filter"
        v-model="filter"
        :disabled="disabled"
      ></UiSelect>
      <UiButton variant="ghost" type="button" :disabled="disabled" @click="chooseChanged">
        {{ t('选择所有内容不同的笔记') }}
      </UiButton>
      <UiButton variant="ghost" type="button" :disabled="disabled" @click="keepExisting">
        {{ t('保留所有已有笔记') }}
      </UiButton>
    </div>
    <p v-if="!filtered.length" class="form-note">{{ t('没有符合筛选条件的笔记。') }}</p>
    <ol class="anki-change-list">
      <li
        v-for="change in visible"
        :key="change.incoming.id"
        class="anki-change"
        :data-note-id="change.incoming.id"
      >
        <div class="anki-change-heading">
          <span class="anki-change-status" :class="change.status">{{
            t(statusLabels[change.status])
          }}</span>
          <label v-if="change.status === 'new' || change.status === 'changed'" class="check-line">
            <UiCheckbox
              :model-value="selectedSet.has(change.incoming.id)"
              :disabled="disabled"
              @update:model-value="choose(change.incoming.id, $event === true)"
            />
            {{ t(change.status === 'new' ? '添加此笔记' : '采用文件内容') }}
          </label>
        </div>
        <p class="anki-change-title">
          {{ change.incoming.input.front.slice(0, 240)
          }}{{ change.incoming.input.front.length > 240 ? '…' : '' }}
        </p>
        <p v-if="change.differences.length" class="form-note">
          {{
            t('不同之处：{fields}', {
              fields: change.differences.map((field) => t(fields[field])).join(' · '),
            })
          }}
        </p>
        <p v-if="change.status === 'changed'" class="form-note">
          {{ t('保留 {count} 张卡片及其进度。', { count: change.retained }) }}
        </p>
        <p v-if="change.added.length">
          {{ t('新增卡片：{variants}', { variants: change.added.map(variant).join(' · ') }) }}
        </p>
        <p v-if="change.removed.length" class="import-warning">
          {{
            t('移除卡片：{variants}', {
              variants: change.removed.map((card) => variant(card.variant)).join(' · '),
            })
          }}
        </p>
        <p v-if="change.status === 'unavailable'" class="import-warning">
          {{ t('无法读取已有附件，此笔记不能更新。请检查附件后重新比较。') }}
        </p>
        <UiButton
          variant="ghost"
          type="button"
          class="anki-detail-toggle"
          :aria-expanded="open === change.incoming.id"
          @click="open = open === change.incoming.id ? '' : change.incoming.id"
        >
          {{ t(open === change.incoming.id ? '收起比较' : '查看内容比较') }}
        </UiButton>
        <div v-if="open === change.incoming.id" class="anki-compare">
          <section v-for="side in sides(change)" :key="side.key" class="anki-compare-side">
            <h4>{{ side.label }}</h4>
            <p class="form-note">
              {{
                t(
                  side.note.type === 'cloze'
                    ? '挖空卡'
                    : side.note.type === 'reversed'
                      ? '双向卡'
                      : side.note.type === 'plugin'
                        ? '插件题目'
                        : '正反面',
                )
              }}
              · {{ t(side.note.format === 'markdown' ? 'Markdown / 数学公式' : '纯文本') }}
            </p>
            <p class="anki-face-label">{{ t('正面 · 问题') }}</p>
            <CardContent :text="side.note.front" :format="side.note.format ?? 'plain'" />
            <MediaList :ids="side.note.frontMedia" :media="side.media" :get-media="side.load" />
            <p class="anki-face-label">{{ t('背面 · 答案') }}</p>
            <CardContent :text="side.note.back" :format="side.note.format ?? 'plain'" />
            <MediaList :ids="side.note.backMedia" :media="side.media" :get-media="side.load" />
            <p class="form-note">{{ t('标签') }}: {{ side.note.tags.join(' · ') || '—' }}</p>
            <p v-if="side.key === 'current' && change.current" class="form-note">
              {{ t('所属卡组') }}:
              {{ plan.base.decks.find((deck) => deck.id === change.current!.deckId)?.name }}
            </p>
          </section>
        </div>
      </li>
    </ol>
    <nav v-if="pages > 1" class="anki-change-pages" :aria-label="t('笔记比较分页')">
      <UiButton variant="secondary" type="button" :disabled="page === 0" @click="page--">
        {{ t('上一页') }}
      </UiButton>
      <span>{{ t('第 {page} / {pages} 页', { page: page + 1, pages }) }}</span>
      <UiButton variant="secondary" type="button" :disabled="page + 1 >= pages" @click="page++">
        {{ t('下一页') }}
      </UiButton>
    </nav>
  </div>
</template>

<style scoped>
.anki-changes,
.anki-change-list {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.anki-change-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.anki-change-tools select {
  width: auto;
  max-width: 100%;
}
.anki-change-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.anki-change {
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  display: grid;
  gap: 0.65rem;
  overflow-wrap: anywhere;
}
.anki-change p {
  margin: 0;
}
.anki-change-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
  justify-content: space-between;
}
.anki-change-status {
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-semibold);
  color: var(--muted);
}
.anki-change-status.changed {
  color: #836327;
}
.anki-change-status.new {
  color: #35694e;
}
.anki-change-status.unavailable {
  color: #99513b;
}
.anki-change-title {
  white-space: pre-wrap;
}
.anki-detail-toggle {
  justify-self: start;
}
.anki-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}
.anki-compare-side {
  min-width: 0;
  max-height: 38rem;
  overflow: auto;
  padding: 1rem;
  background: #f6f8f4;
  border-radius: 8px;
}
.anki-compare-side h4 {
  margin: 0 0 0.8rem;
}
.anki-compare-side :deep(.card-content) {
  font-size: var(--font-size-body);
}
.anki-compare-side :deep(audio) {
  max-width: 100%;
}
.anki-compare-side :deep(.media-list) {
  margin-block: 1rem;
}
.anki-face-label {
  font-weight: var(--font-weight-semibold);
  margin-top: 1rem !important;
}
.anki-change-pages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  justify-content: space-between;
}
@media (max-width: 720px) {
  .anki-compare {
    grid-template-columns: minmax(0, 1fr);
  }
  .anki-change {
    padding: 0.8rem;
  }
}
</style>
