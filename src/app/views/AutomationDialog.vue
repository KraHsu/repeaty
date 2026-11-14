<script setup lang="ts">
import { computed } from 'vue'
import AppModal from '../../components/AppModal.vue'
import { UiButton, UiNotice } from '../../components/ui'
import { useApplication } from '../context'
import { locale } from '../../i18n'
const { automationConsent, library } = useApplication()
const { prompt, resolve } = automationConsent
const en = computed(() => locale.value === 'en')
const scopeNames = computed(() => {
  const value = prompt.value
  if (!value || value.kind !== 'grant') return []
  const scope = value.scope
  if (scope.kind === 'all') return [en.value ? 'Entire current library' : '当前学习库的全部内容']
  if (scope.kind === 'sources')
    return scope.sourceIds.map((id) => library.value.sources.find((v) => v.id === id)?.title ?? id)
  return scope.folderIds.map(
    (id) => library.value.materialFolders.find((v) => v.id === id)?.name ?? id,
  )
})
const changes = computed(() => {
  const value = prompt.value
  if (value?.kind !== 'apply') return []
  const names: Record<string, [string, string]> = {
    'source.create': ['新建材料', 'Create material'],
    'source.patch': ['编辑材料', 'Edit material'],
    'source.archive': ['归档材料', 'Archive material'],
    'source.restore': ['恢复材料', 'Restore material'],
    'source.move': ['移动材料', 'Move material'],
    'folder.create': ['新建目录', 'Create folder'],
    'folder.patch': ['重命名目录', 'Rename folder'],
    'folder.remove': ['移除目录，保留内容', 'Unwrap folder'],
    'folder.move': ['移动目录', 'Move folder'],
    'collection.create': ['新建引用集合', 'Create reference collection'],
    'collection.patch': ['重命名引用集合', 'Rename reference collection'],
    'collection.members': ['调整集合成员', 'Edit collection members'],
    'collection.reorder': ['调整集合顺序', 'Reorder collection'],
    'collection.archive': ['删除引用集合，保留成员', 'Archive reference collection'],
    'collection.restore': ['恢复引用集合', 'Restore reference collection'],
    'note.create': ['新建笔记', 'Create note'],
    'note.patch': ['编辑笔记', 'Edit note'],
    'note.move': ['移动笔记', 'Move notes'],
    'note.tags': ['修改标签', 'Edit tags'],
    'note.remove': ['删除笔记', 'Delete notes'],
    'deck.create': ['新建卡组', 'Create deck'],
    'deck.patch': ['编辑卡组', 'Edit deck'],
    'history.undo': ['撤销上一步', 'Undo last operation'],
    'history.redo': ['重做上一步', 'Redo last operation'],
    'retired.restore': ['恢复退役笔记', 'Restore retired note'],
    'checkpoint.restore': ['恢复学习库快照', 'Restore library snapshot'],
  }
  const labels: Record<string, [string, string]> = {
    title: ['标题', 'Title'],
    body: ['正文', 'Content'],
    front: ['问题', 'Question'],
    back: ['答案', 'Answer'],
    name: ['名称', 'Name'],
    description: ['说明', 'Description'],
    tags: ['标签', 'Tags'],
    add: ['添加标签', 'Add tags'],
    remove: ['移除标签', 'Remove tags'],
    deckId: ['卡组', 'Deck'],
    url: ['来源链接', 'Source URL'],
    format: ['内容格式', 'Format'],
    type: ['笔记类型', 'Note type'],
    newLimit: ['每日新卡上限', 'Daily new cards'],
    reviewLimit: ['每日复习上限', 'Daily reviews'],
    burySiblings: ['暂缓关联卡片', 'Bury siblings'],
    leechThreshold: ['难记卡阈值', 'Leech threshold'],
    desiredRetention: ['目标保留率', 'Desired retention'],
    studyPriority: ['学习优先级', 'Study priority'],
    color: ['卡组颜色', 'Deck color'],
    frontMedia: ['问题附件', 'Question attachments'],
    backMedia: ['答案附件', 'Answer attachments'],
    sourceIds: ['材料顺序', 'Material order'],
  }
  const sourceName = (id: string) => library.value.sources.find((v) => v.id === id)?.title ?? id
  const folderName = (id: string) =>
    library.value.materialFolders.find((v) => v.id === id)?.name ?? id
  const deckName = (id: string) => library.value.decks.find((v) => v.id === id)?.name ?? id
  const noteName = (id: string) => library.value.notes.find((v) => v.id === id)?.front ?? id
  return value.preview.request.commands.map((command) => {
    const fields: [string, string][] = []
    const payload =
      'input' in command ? command.input : 'patch' in command ? command.patch : command
    for (const [key, item] of Object.entries(payload)) {
      if (!labels[key] || item === undefined) continue
      const text =
        key === 'deckId'
          ? deckName(String(item))
          : typeof item === 'boolean'
            ? item
              ? en.value
                ? 'Yes'
                : '是'
              : en.value
                ? 'No'
                : '否'
            : Array.isArray(item)
              ? item.join('、')
              : String(item)
      const collection =
        command.kind.startsWith('collection.') && ['add', 'remove', 'sourceIds'].includes(key)
      fields.push([
        collection && key !== 'sourceIds'
          ? key === 'add'
            ? en.value
              ? 'Add materials'
              : '添加材料'
            : en.value
              ? 'Remove materials'
              : '移除材料'
          : labels[key]![en.value ? 1 : 0],
        collection && Array.isArray(item)
          ? item.map((id) => sourceName(String(id))).join('、')
          : text,
      ])
    }
    if ('destination' in command && command.destination) {
      const dest = command.destination
      fields.push([
        en.value ? 'Destination' : '移动到',
        dest.folderId
          ? folderName(dest.folderId)
          : 'parentSourceId' in dest && dest.parentSourceId
            ? sourceName(dest.parentSourceId)
            : en.value
              ? 'Library root'
              : '学习库根目录',
      ])
    }
    if ('beforeId' in command && command.beforeId)
      fields.push([en.value ? 'Place before' : '放在此项之前', sourceName(command.beforeId)])
    const target =
      'collectionId' in command
        ? (library.value.materialCollections.find((v) => v.id === command.collectionId)?.name ??
          command.collectionId)
        : 'sourceId' in command
          ? sourceName(command.sourceId)
          : 'folderId' in command
            ? folderName(command.folderId)
            : 'noteId' in command
              ? noteName(command.noteId)
              : 'noteIds' in command
                ? command.noteIds.map(noteName).join('、')
                : 'deckId' in command
                  ? deckName(command.deckId)
                  : 'checkpointId' in command
                    ? command.checkpointId
                    : ''
    return { title: names[command.kind]![en.value ? 1 : 0], target, fields }
  })
})
</script>
<template>
  <AppModal
    v-if="prompt"
    :title="
      prompt.kind === 'grant'
        ? en
          ? 'Share library access'
          : '授权学习库访问'
        : en
          ? 'Review proposed changes'
          : '审查拟执行的修改'
    "
    wide
    @close="resolve(false)"
  >
    <div class="automation-consent app-section-stack">
      <p>{{ prompt.owner.label }}</p>
      <template v-if="prompt.kind === 'grant'">
        <p>
          {{
            en
              ? 'Access is limited to this library and the selected scope, until revoked, disabled, or the library changes.'
              : '授权仅对当前学习库和所选范围有效。撤销授权、停用插件或切换学习库后失效。'
          }}
        </p>
        <ul>
          <li v-for="name in scopeNames" :key="name">{{ name }}</li>
        </ul>
        <UiNotice>{{
          prompt.write
            ? en
              ? 'May read content and propose edits. Each batch is shown for your approval before saving.'
              : '可读取内容并提出修改。每批修改在保存前都会展示给你确认。'
            : en
              ? 'Read-only access. No changes may be saved.'
              : '仅允许读取内容，不能保存修改。'
        }}</UiNotice>
        <p class="form-note">
          {{
            en
              ? 'Content you send in a conversation is sent to the model provider you select.'
              : '对话中使用的内容会发送给你选择的模型服务。'
          }}
        </p>
      </template>
      <template v-else>
        <UiNotice>{{
          en
            ? 'The batch is saved as one transaction with a recovery point. Changes to the library invalidate this preview.'
            : '本批修改会作为一次事务保存，并保留恢复点。学习库发生变化后，此预览自动失效。'
        }}</UiNotice>
        <p>{{ en ? 'Affected records' : '涉及记录' }}: {{ prompt.preview.changes.length }}</p>
        <div class="automation-preview">
          <section
            v-for="(change, index) in changes"
            :key="index"
            :class="{ 'app-section-divider': index > 0 }"
          >
            <h3>{{ index + 1 }}. {{ change.title }}</h3>
            <p v-if="change.target" class="form-note">{{ change.target }}</p>
            <dl>
              <template v-for="[label, value] in change.fields" :key="label"
                ><dt>{{ label }}</dt>
                <dd>{{ value }}</dd></template
              >
            </dl>
          </section>
        </div>
      </template>
      <div class="form-actions">
        <UiButton @click="resolve(false)">{{ en ? 'Cancel' : '取消' }}</UiButton>
        <UiButton variant="primary" @click="resolve(true)">{{
          prompt.kind === 'grant'
            ? en
              ? 'Allow this scope'
              : '允许此范围'
            : en
              ? 'Apply changes'
              : '确认应用修改'
        }}</UiButton>
      </div>
    </div>
  </AppModal>
</template>
<style scoped>
.automation-consent {
  --app-content-gap: 1rem;
  min-width: 0;
}
.automation-consent p {
  margin-block-end: 0;
}
.automation-consent ul {
  max-height: 25vh;
  overflow: auto;
  padding-inline-start: 24px;
}
.automation-preview {
  max-height: 45vh;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: var(--text-sm);
  background: var(--surface-muted);
}
.automation-preview h3 {
  font-size: var(--text-base);
  margin: 0 0 8px;
}
.automation-preview dl {
  display: grid;
  grid-template-columns: 7em minmax(0, 1fr);
  gap: 8px 16px;
  margin: 12px 0 0;
}
.automation-preview dt {
  color: var(--text-muted);
}
.automation-preview dd {
  margin: 0;
  white-space: pre-wrap;
}
@media (max-width: 540px) {
  .automation-preview dl {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .automation-preview dd {
    margin-bottom: 12px;
  }
}
</style>
