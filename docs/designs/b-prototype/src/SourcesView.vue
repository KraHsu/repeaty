<script setup>
import { computed, ref } from 'vue'
import { ArrowLeft, ArrowUpRight, BookOpen, Clock3, Search, Quote, Check } from '@lucide/vue'
import { demo, commit } from './state.js'

const query = ref('')
const selectedId = ref(null)
const excerptOpen = ref(false)
const question = ref('')
const answer = ref('')
const deckId = ref('fsrs')
const validation = ref('')
const articles = [
  {
    id: 'active-recall',
    title: '主动回忆：让知识真正留下来',
    category: '学习方法',
    time: 5,
    intro: '把“我看懂了”变成“我能说出来”，从一次小小的回忆开始。',
    sections: [
      {
        title: '从提取开始学习',
        text: '主动回忆，是在不看答案的情况下，尝试从记忆中提取信息。读完一小段内容后合上材料，用自己的话回答：它讲了什么？最关键的观点是什么？这个过程会让你发现哪些内容已经理解，哪些地方还需要回到原文确认。',
      },
      {
        title: '一次只问一个问题',
        text: '好的学习卡片会让你知道自己究竟在回答什么。把“解释主动回忆”拆成更明确的问题，例如“主动回忆与重新阅读的主要区别是什么？”问题越聚焦，回答和判断就越清楚，也更容易在之后的复习中发现变化。',
      },
      {
        title: '先尝试，再看答案',
        text: '看到问题后，先给自己一点时间组织答案，再翻看卡片。即使只能回忆出一部分，也可以把已知内容说完整，再核对缺失的部分。直接展示答案容易产生熟悉感，而熟悉感并不总是意味着你能独立想起。',
      },
      {
        title: '让反馈指导下一次复习',
        text: '核对答案时，留意自己遗漏了什么，而不只是判断整张卡片是否正确。如果反复卡在同一个地方，可以缩小问题范围、补充必要的背景，或把复杂答案拆成几张卡片。卡片应当帮助你理解，而不是增加猜测题意的负担。',
      },
    ],
  },
  {
    id: 'fsrs-intro',
    title: 'FSRS 入门：理解间隔复习',
    category: '间隔复习',
    time: 6,
    intro: '用诚实的回忆反馈，为下一次复习提供更有用的信息。',
    sections: [
      {
        title: '为什么要间隔复习',
        text: '间隔复习把学习分散在不同时间，而不是在一次学习中不断重复同一内容。每次重新提取记忆，都会提供新的反馈：这条信息现在是否还能想起，想起它需要多大努力。调度器根据这些记录安排后续复习。',
      },
      {
        title: '记忆状态不是一个固定间隔',
        text: 'FSRS 使用记忆状态来估计一张卡片之后的复习时机。不同卡片的难度、记忆稳定性与复习经历可能不同，因此复习间隔也会不同。一个固定的“三天后再看”无法表达这些差异，历史反馈则能让安排逐渐适应实际表现。',
      },
      {
        title: '评分反映刚才的回忆',
        text: '评分时，请根据翻开答案前的实际表现作答。没有想起就如实选择忘记；已经想起但费力，与轻松、完整地回答，也应区分开来。不要为了获得更长的间隔而提高评分，因为调度需要的是刚才发生的回忆情况。',
      },
      {
        title: '调度之外，仍然需要好问题',
        text: '复习算法负责安排时机，但无法替代清晰的提问与理解。如果一张卡片包含太多知识点，或者必须依赖没有写出的上下文，先改进卡片通常更有帮助。持续维护内容质量，再让复习记录指导后续安排。',
      },
    ],
  },
]
const visibleArticles = computed(() =>
  articles.filter((article) =>
    `${article.title}${article.category}${article.intro}`.includes(query.value.trim()),
  ),
)
const selected = computed(() => articles.find((article) => article.id === selectedId.value))
const deckOptions = computed(() =>
  demo.data.decks.map((deck) => ({ label: deck.name, value: deck.id })),
)

function excerpt(section) {
  question.value = section.title
  answer.value = section.text
  deckId.value = demo.data.decks.some((deck) => deck.id === 'fsrs')
    ? 'fsrs'
    : demo.data.decks[0]?.id
  validation.value = ''
  excerptOpen.value = true
}

function saveExcerpt() {
  if (!question.value.trim() || !answer.value.trim()) {
    validation.value = '请填写问题和答案。'
    return
  }
  if (!demo.data.decks.some((deck) => deck.id === deckId.value)) {
    validation.value = '请选择一个可用卡组。'
    return
  }
  const success = commit((data) => {
    data.cards.push({
      id: `excerpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deckId: deckId.value,
      question: question.value.trim(),
      answer: answer.value.trim(),
      tags: ['阅读摘录'],
      status: 'new',
    })
    const deck = data.decks.find((item) => item.id === deckId.value)
    deck.count += 1
    deck.fresh += 1
  }, '已将摘录保存为卡片')
  if (success) excerptOpen.value = false
}
</script>

<template>
  <section v-if="!selected" class="sources-page">
    <header class="page-head">
      <div>
        <h1>学习材料</h1>
        <p class="muted">读一段，想一想，把值得记住的内容变成卡片。</p>
      </div>
      <span class="material-total meta">{{ articles.length }} 篇材料</span>
    </header>
    <div class="source-search">
      <Search :size="18" aria-hidden="true" />
      <PInputText
        id="source-search"
        v-model="query"
        aria-label="搜索学习材料"
        placeholder="搜索学习材料"
      />
    </div>
    <div v-if="visibleArticles.length" class="article-list">
      <button
        v-for="article in visibleArticles"
        :key="article.id"
        class="surface article-card"
        @click="selectedId = article.id"
      >
        <span class="article-mark" aria-hidden="true"
          ><BookOpen :size="25" :stroke-width="1.65"
        /></span>
        <span class="article-summary"
          ><span class="article-category meta">{{ article.category }}</span
          ><strong>{{ article.title }}</strong
          ><span class="muted">{{ article.intro }}</span
          ><span class="article-time meta"
            ><Clock3 :size="15" aria-hidden="true" />约 {{ article.time }} 分钟</span
          ></span
        >
        <ArrowUpRight class="article-arrow" :size="21" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="surface empty-state">
      <Search :size="28" aria-hidden="true" />
      <h2>没有找到相关材料</h2>
      <p class="muted">换一个关键词试试。</p>
      <PButton label="清除搜索" severity="secondary" @click="query = ''" />
    </div>
    <div class="reading-note">
      <Quote :size="20" aria-hidden="true" />
      <p>不必一次记住所有内容。先理解，再留下一个清晰的问题。</p>
    </div>
  </section>

  <section v-else class="reading-page">
    <div class="reading-toolbar">
      <PButton label="学习材料" severity="secondary" text @click="selectedId = null"
        ><template #icon><ArrowLeft :size="18" aria-hidden="true" /></template></PButton
      ><span class="meta muted"
        ><Clock3 :size="15" aria-hidden="true" />约 {{ selected.time }} 分钟</span
      >
    </div>
    <article class="surface reading-sheet">
      <header class="reading-header">
        <span class="eyebrow">{{ selected.category }}</span>
        <h1>{{ selected.title }}</h1>
        <p class="reading-intro muted">{{ selected.intro }}</p>
      </header>
      <section v-for="section in selected.sections" :key="section.title" class="reading-section">
        <h2>{{ section.title }}</h2>
        <p>{{ section.text }}</p>
        <PButton label="摘录制卡" severity="secondary" text size="small" @click="excerpt(section)"
          ><template #icon><Quote :size="16" aria-hidden="true" /></template
        ></PButton>
      </section>
      <footer class="reading-end">
        <Check :size="18" aria-hidden="true" /><span>已到文末，试着回忆最想留下的一点。</span>
      </footer>
    </article>
  </section>

  <PDialog
    v-model:visible="excerptOpen"
    modal
    header="把摘录变成卡片"
    :style="{ width: '640px', maxWidth: 'calc(100vw - 32px)' }"
  >
    <form class="excerpt-form" @submit.prevent="saveExcerpt">
      <div class="form-field">
        <label for="excerpt-deck">保存到卡组</label
        ><PSelect
          input-id="excerpt-deck"
          v-model="deckId"
          :options="deckOptions"
          option-label="label"
          option-value="value"
          placeholder="选择卡组"
        />
      </div>
      <div class="form-field">
        <label for="excerpt-question">问题</label
        ><PTextarea
          id="excerpt-question"
          v-model="question"
          rows="2"
          auto-resize
          :invalid="!!validation && !question.trim()"
          placeholder="你想在下次复习时回答什么？"
        />
      </div>
      <div class="form-field">
        <label for="excerpt-answer">答案</label
        ><PTextarea
          id="excerpt-answer"
          v-model="answer"
          rows="6"
          :invalid="!!validation && !answer.trim()"
        />
      </div>
      <p class="meta muted">可以把摘录改写成自己的话，让问题更具体。</p>
      <PMessage v-if="validation" severity="error" :closable="false">{{ validation }}</PMessage>
      <div class="actions dialog-actions">
        <PButton label="取消" severity="secondary" @click="excerptOpen = false" /><PButton
          type="submit"
          label="保存卡片"
        />
      </div>
    </form>
  </PDialog>
</template>

<style scoped>
.sources-page,
.reading-page {
  margin: 0 auto;
}
.eyebrow {
  font-size: 0.875rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  color: var(--p-primary-color, #34674d);
  margin: 0 0 10px;
}
.material-total {
  white-space: nowrap;
  background: #e5eddf;
  color: #34674d;
  padding: 7px 12px;
  border-radius: 7px;
}
.source-search {
  position: relative;
  max-width: 460px;
  margin: 28px 0 22px;
}
.source-search > svg {
  position: absolute;
  left: 14px;
  top: 14px;
  z-index: 1;
  color: #52665a;
}
.source-search :deep(input) {
  width: 100%;
  padding-left: 42px;
}
.article-list {
  display: grid;
  gap: 16px;
}
.article-card {
  display: flex;
  text-align: left;
  align-items: flex-start;
  gap: 22px;
  padding: 28px;
  width: 100%;
  color: inherit;
  cursor: pointer;
  transition:
    border-color 0.16s,
    background 0.16s;
  font: inherit;
}
.article-card:hover {
  border-color: #97b29c;
  background: #fcfdfb;
}
.article-card:focus-visible {
  outline: 3px solid #8aaf93;
  outline-offset: 3px;
}
.article-mark {
  display: grid;
  place-items: center;
  width: 58px;
  height: 66px;
  flex: 0 0 auto;
  background: #eaf0e5;
  border: 1px solid #dae4d4;
  border-radius: 7px;
  color: #34674d;
}
.article-summary {
  display: grid;
  gap: 9px;
  flex: 1;
}
.article-summary strong {
  font-size: 1.3125rem;
  font-weight: 650;
  line-height: 1.5;
}
.article-summary > .muted {
  line-height: 1.7;
}
.article-category {
  color: #52665a;
}
.article-time {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #52665a;
  margin-top: 8px;
}
.article-arrow {
  color: #64816d;
  margin-top: 4px;
  flex-shrink: 0;
}
.reading-note {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 28px 4px;
  color: #52665a;
  max-width: 720px;
}
.reading-note svg {
  flex-shrink: 0;
  margin-top: 3px;
}
.reading-note p {
  margin: 0;
  line-height: 1.7;
}
.reading-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 0 20px;
  gap: 16px;
}
.reading-toolbar > .meta {
  display: flex;
  align-items: center;
  gap: 7px;
}
.reading-sheet {
  max-width: 850px;
  margin: 0 auto;
  padding: 48px 56px;
}
.reading-header {
  padding-bottom: 28px;
  border-bottom: 1px solid #d8e1d4;
  margin-bottom: 36px;
}
.reading-header h1 {
  font-size: 1.875rem;
  line-height: 1.45;
  margin: 13px 0 18px;
  letter-spacing: -0.025em;
}
.reading-intro {
  font-size: 1.125rem;
  line-height: 1.8;
  margin: 0;
}
.reading-section {
  margin: 0 0 32px;
}
.reading-section h2 {
  font-size: 1.3125rem;
  line-height: 1.6;
  margin: 0 0 12px;
}
.reading-section > p {
  font-size: 1.25rem;
  line-height: 1.9;
  letter-spacing: 0.01em;
  margin: 0 0 9px;
  overflow-wrap: anywhere;
}
.reading-section :deep(.p-button) {
  min-height: 44px;
  font-size: 0.875rem;
}
.reading-end {
  border-top: 1px solid #d8e1d4;
  padding-top: 24px;
  display: flex;
  gap: 9px;
  align-items: flex-start;
  font-size: 0.875rem;
  color: #52665a;
  line-height: 1.6;
}
.reading-end svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.excerpt-form {
  display: grid;
  gap: 20px;
}
.form-field {
  display: grid;
  gap: 9px;
}
.form-field label {
  font-weight: 600;
}
.form-field :deep(textarea) {
  width: 100%;
  line-height: 1.65;
}
.excerpt-form > .meta {
  margin: 0;
}
.dialog-actions {
  justify-content: flex-end;
  margin-top: 4px;
}
.empty-state {
  padding: 52px 24px;
  text-align: center;
}
.empty-state > svg {
  color: #52665a;
}
.empty-state h2 {
  font-size: 1.25rem;
}
.empty-state p {
  margin-bottom: 22px;
}
@media (max-width: 760px) {
  .page-head {
    align-items: flex-start;
    gap: 14px;
  }
  .material-total {
    margin-top: 4px;
  }
  .article-card {
    padding: 22px 18px;
    gap: 14px;
  }
  .article-mark {
    width: 44px;
    height: 52px;
  }
  .article-summary strong {
    font-size: 1.1875rem;
  }
  .article-summary > .muted {
    font-size: 1rem;
  }
  .article-arrow {
    display: none;
  }
  .reading-sheet {
    padding: 28px 22px;
  }
  .reading-header h1 {
    font-size: 1.625rem;
  }
  .reading-section > p {
    font-size: 1.1875rem;
  }
  .reading-toolbar {
    gap: 8px;
  }
  .source-search {
    max-width: none;
    margin-top: 22px;
  }
}
@media (max-width: 440px) {
  .material-total {
    display: none;
  }
  .article-mark {
    display: none;
  }
  .reading-sheet {
    padding: 24px 18px;
  }
  .reading-toolbar > .meta {
    font-size: 0.875rem;
  }
  .reading-header h1 {
    font-size: 1.5rem;
  }
}
</style>
