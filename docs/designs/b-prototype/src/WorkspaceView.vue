<script setup>
import {
  Folder,
  FolderOpen,
  FileText,
  BookOpen,
  Image,
  RefreshCw,
  CheckCircle2,
  Monitor,
  ChevronRight,
} from '@lucide/vue'
const folders = [
  { name: 'notes/', icon: FileText, title: '笔记与卡片', description: '以文件保存的学习笔记。' },
  { name: 'sources/', icon: BookOpen, title: '学习材料', description: '阅读材料与它们的内容。' },
  { name: 'assets/', icon: Image, title: '附件资源', description: '笔记和材料引用的图片、文件。' },
]
</script>

<template>
  <section class="workspace-page">
    <header class="page-head">
      <div>
        <h1>工作目录</h1>
        <p class="muted">笔记、学习材料和附件，一起保存在学习目录中。</p>
      </div>
    </header>
    <section class="surface directory-card" aria-labelledby="directory-heading">
      <div class="directory-top">
        <span class="folder-icon"
          ><FolderOpen :size="29" :stroke-width="1.6" aria-hidden="true"
        /></span>
        <div class="directory-info">
          <h2 id="directory-heading">学习目录</h2>
          <code>D:\学习\Repeaty</code>
        </div>
        <PButton
          label="打开目录"
          severity="secondary"
          disabled
          aria-describedby="native-directory-note"
          ><template #icon><Folder :size="17" aria-hidden="true" /></template
        ></PButton>
      </div>
      <div class="directory-tree">
        <div v-for="folder in folders" :key="folder.name" class="folder-row">
          <ChevronRight :size="16" class="branch-mark" aria-hidden="true" /><component
            :is="folder.icon"
            :size="21"
            :stroke-width="1.7"
            class="folder-type"
            aria-hidden="true"
          />
          <div class="folder-copy">
            <div class="folder-name">
              <code>{{ folder.name }}</code
              ><span>{{ folder.title }}</span>
            </div>
            <p class="meta muted">{{ folder.description }}</p>
          </div>
        </div>
      </div>
    </section>
    <section class="surface changes-card" aria-labelledby="changes-heading">
      <div class="changes-heading">
        <div>
          <h2 id="changes-heading">外部修改</h2>
          <p class="meta muted">目录中的修改需要确认后才会应用到学习库。</p>
        </div>
        <span class="pending-count">0 待处理</span>
      </div>
      <div class="changes-empty">
        <span class="check-icon"
          ><CheckCircle2 :size="26" :stroke-width="1.6" aria-hidden="true"
        /></span>
        <div>
          <h3>没有待处理的修改</h3>
          <p class="muted">当前复习内容会保持不变。</p>
        </div>
      </div>
      <div class="changes-bottom">
        <span id="native-directory-note" class="meta muted"
          ><Monitor :size="17" aria-hidden="true" />目录打开与检查需在桌面客户端执行。</span
        ><PButton
          label="检查修改"
          severity="secondary"
          disabled
          aria-describedby="native-directory-note"
          ><template #icon><RefreshCw :size="17" aria-hidden="true" /></template
        ></PButton>
      </div>
    </section>
  </section>
</template>

<style scoped>
.workspace-page {
  margin: 0 auto;
}
.directory-card {
  margin-top: 30px;
  overflow: hidden;
}
.directory-top {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 28px 30px;
}
.folder-icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  background: #e5eddf;
  border-radius: 12px;
  color: #34674d;
  flex-shrink: 0;
}
.directory-info {
  min-width: 0;
  flex: 1;
}
.directory-info h2 {
  font-size: 1.125rem;
  margin: 0 0 7px;
}
.directory-info code {
  font-size: 1rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.directory-tree {
  margin: 0 30px 14px;
  border-top: 1px solid #d8e1d4;
}
.folder-row {
  display: flex;
  align-items: center;
  gap: 15px;
  min-height: 99px;
  padding: 20px 4px;
}
.folder-row + .folder-row {
  border-top: 1px solid #edf0e8;
}
.branch-mark {
  color: #91a28f;
  flex-shrink: 0;
}
.folder-type {
  color: #526e59;
  flex-shrink: 0;
}
.folder-copy {
  flex: 1;
  min-width: 0;
}
.folder-name {
  display: flex;
  align-items: baseline;
  gap: 20px;
}
.folder-name code {
  font-size: 1rem;
  width: 92px;
  flex-shrink: 0;
}
.folder-name > span {
  font-size: 1rem;
}
.folder-copy p {
  margin: 6px 0 0;
  line-height: 1.7;
}
.changes-card {
  margin-top: 24px;
  overflow: hidden;
}
.changes-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 26px 30px 0;
}
.changes-heading h2 {
  font-size: 1.25rem;
  margin: 0 0 9px;
}
.changes-heading p {
  line-height: 1.7;
  margin: 0;
}
.pending-count {
  font-size: 0.875rem;
  background: #edf1e9;
  color: #52665a;
  padding: 6px 10px;
  border-radius: 7px;
  white-space: nowrap;
}
.changes-empty {
  display: flex;
  align-items: center;
  gap: 17px;
  padding: 38px 30px;
}
.check-icon {
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  background: #f0f4ec;
  border-radius: 50%;
  color: #64876b;
  flex-shrink: 0;
}
.changes-empty h3 {
  font-size: 1.125rem;
  margin: 0 0 8px;
  font-weight: 600;
}
.changes-empty p {
  margin: 0;
  line-height: 1.7;
}
.changes-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 30px;
  border-top: 1px solid #d8e1d4;
  background: #fafbf8;
}
.changes-bottom > .meta {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  line-height: 1.6;
}
.changes-bottom > .meta svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.changes-bottom :deep(.p-button) {
  flex-shrink: 0;
}
@media (max-width: 760px) {
  .directory-top {
    padding: 22px;
    gap: 14px;
    flex-wrap: wrap;
  }
  .directory-info {
    flex-basis: calc(100% - 80px);
  }
  .directory-top :deep(.p-button) {
    margin-left: 74px;
  }
  .directory-tree {
    margin: 0 22px 12px;
  }
  .folder-row {
    gap: 12px;
  }
  .changes-heading {
    padding: 22px 22px 0;
  }
  .changes-empty {
    padding: 30px 22px;
  }
  .changes-bottom {
    padding: 18px 22px;
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }
  .changes-bottom :deep(.p-button) {
    align-self: flex-end;
  }
  .folder-name {
    gap: 12px;
  }
  .folder-name code {
    width: 80px;
  }
}
@media (max-width: 440px) {
  .folder-name {
    display: grid;
    gap: 4px;
  }
  .folder-name code {
    width: auto;
  }
  .folder-type {
    align-self: flex-start;
    margin-top: 4px;
  }
  .branch-mark {
    display: none;
  }
  .changes-heading {
    gap: 12px;
  }
  .changes-empty {
    align-items: flex-start;
  }
  .changes-empty h3 {
    line-height: 1.5;
  }
  .check-icon {
    width: 40px;
    height: 40px;
  }
}
</style>
