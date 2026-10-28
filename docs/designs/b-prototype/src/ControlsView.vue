<script setup>
import { computed, ref } from 'vue'
import { ArrowLeft, Check, Plus, Trash2, Info } from '@lucide/vue'
import { navigate } from './state.js'

const text = ref('主动回忆笔记')
const multiline = ref('用自己的话写下一个问题。\n下一次复习时，先回忆，再看答案。')
const selected = ref('fsrs')
const choices = [
  { label: 'FSRS 与 Repeaty', value: 'fsrs' },
  { label: '数据结构与算法', value: 'algorithms' },
  { label: '英语 · 常用表达', value: 'english' },
]
const radio = ref('compact')
const tags = ref(['阅读'])
const tagOptions = ['阅读', '概念', '实践', '待整理']
const slider = ref(40)
const enabled = ref(true)
const checked = ref(true)
const number = ref(12)
const invalidValue = ref('')
const invalidTouched = ref(true)
const invalid = computed(() => invalidTouched.value && !invalidValue.value.trim())
const feedback = ref('')

function showFeedback(message) {
  feedback.value = message
}
</script>

<template>
  <section class="controls-page">
    <PButton
      label="返回学习概览"
      severity="secondary"
      text
      class="back-button"
      @click="navigate('home')"
      ><template #icon><ArrowLeft :size="18" aria-hidden="true" /></template
    ></PButton>
    <header class="page-head">
      <div>
        <p class="eyebrow">界面规范 · B</p>
        <h1>统一控件</h1>
        <p class="muted">同一套尺寸、状态和交互，让每次操作都熟悉。</p>
      </div>
      <span class="spec-badge">绿色系 · PrimeVue</span>
    </header>
    <div class="spec-facts">
      <span><i class="color-dot" aria-hidden="true"></i>主色 #34674D</span
      ><span>正文 16 / 说明 14</span><span>控件高度 44</span><span>圆角 8</span>
    </div>

    <section class="surface control-section" aria-labelledby="entry-title">
      <div class="section-heading">
        <div>
          <h2 id="entry-title">输入</h2>
          <p class="meta muted">标签始终可见，说明紧跟字段。</p>
        </div>
        <span class="section-number">01</span>
      </div>
      <div class="control-grid">
        <div class="control-field">
          <label for="gallery-text">文本输入</label
          ><PInputText id="gallery-text" v-model="text" placeholder="输入名称" />
          <p class="meta muted">简短、明确的名称，更容易找到。</p>
        </div>
        <div class="control-field">
          <label for="gallery-number">数字输入</label
          ><PInputNumber
            input-id="gallery-number"
            v-model="number"
            :min="1"
            :max="100"
            show-buttons
            button-layout="horizontal"
            :step="1"
          />
          <p class="meta muted">使用键盘或两侧按钮调整，范围 1–100。</p>
        </div>
        <div class="control-field full-field">
          <label for="gallery-textarea">多行文本</label
          ><PTextarea
            id="gallery-textarea"
            v-model="multiline"
            rows="3"
            auto-resize
            placeholder="写下你的想法"
          />
          <p class="meta muted">保留自然换行和文本选择。</p>
        </div>
      </div>
    </section>

    <section class="surface control-section" aria-labelledby="choice-title">
      <div class="section-heading">
        <div>
          <h2 id="choice-title">选择</h2>
          <p class="meta muted">根据选项数量与任务，选用适合的控件。</p>
        </div>
        <span class="section-number">02</span>
      </div>
      <div class="control-grid">
        <div class="control-field">
          <label for="gallery-select">下拉单选</label
          ><PSelect
            input-id="gallery-select"
            v-model="selected"
            :options="choices"
            option-label="label"
            option-value="value"
            placeholder="选择卡组"
          />
        </div>
        <div class="control-field">
          <label for="gallery-multi">下拉多选</label
          ><PMultiSelect
            input-id="gallery-multi"
            v-model="tags"
            :options="tagOptions"
            placeholder="选择标签"
            display="chip"
            :max-selected-labels="2"
          />
        </div>
        <fieldset class="control-field radio-field">
          <legend>单选按钮</legend>
          <div class="radio-options">
            <label for="gallery-radio-compact"
              ><PRadioButton
                input-id="gallery-radio-compact"
                v-model="radio"
                value="compact"
                name="gallery-density"
              /><span>紧凑</span></label
            ><label for="gallery-radio-comfortable"
              ><PRadioButton
                input-id="gallery-radio-comfortable"
                v-model="radio"
                value="comfortable"
                name="gallery-density"
              /><span>舒展</span></label
            >
          </div>
        </fieldset>
        <div class="control-field slider-field">
          <div class="slider-label">
            <label id="gallery-slider-label">滑块</label><output>{{ slider }}</output>
          </div>
          <PSlider
            v-model="slider"
            :min="0"
            :max="100"
            :step="5"
            aria-labelledby="gallery-slider-label"
          />
          <div class="slider-limits meta muted"><span>0</span><span>100</span></div>
        </div>
      </div>
      <div class="toggle-examples">
        <div class="toggle-line">
          <div>
            <label for="gallery-switch">开关</label>
            <p class="meta muted">切换一个立即生效的状态。</p>
          </div>
          <PToggleSwitch input-id="gallery-switch" v-model="enabled" />
        </div>
        <div class="toggle-line">
          <div>
            <label for="gallery-checkbox">复选框</label>
            <p class="meta muted">独立选择，可以与其他选项组合。</p>
          </div>
          <PCheckbox input-id="gallery-checkbox" v-model="checked" binary />
        </div>
      </div>
    </section>

    <section class="surface control-section" aria-labelledby="state-title">
      <div class="section-heading">
        <div>
          <h2 id="state-title">状态与反馈</h2>
          <p class="meta muted">明确指出问题，也明确告诉用户下一步。</p>
        </div>
        <span class="section-number">03</span>
      </div>
      <div class="control-grid">
        <div class="control-field">
          <label for="gallery-validation">必填字段 <span class="required">*</span></label
          ><PInputText
            id="gallery-validation"
            v-model="invalidValue"
            :invalid="invalid"
            :aria-invalid="invalid"
            :aria-describedby="invalid ? 'gallery-validation-message' : undefined"
            placeholder="填写名称后，错误状态会消失"
            @blur="invalidTouched = true"
          />
          <p
            v-if="invalid"
            id="gallery-validation-message"
            class="validation-error meta"
            role="status"
          >
            请填写名称。
          </p>
          <p v-else class="validation-success meta">
            <Check :size="15" aria-hidden="true" />内容已填写。
          </p>
        </div>
        <div class="control-field">
          <label for="gallery-disabled">禁用字段</label
          ><PInputText id="gallery-disabled" model-value="当前不可编辑" disabled />
          <p class="meta muted">保留内容与标签，清楚表达不可操作。</p>
        </div>
      </div>
      <div class="status-messages">
        <PMessage severity="info" :closable="false"
          >说明文字应当简短，直接帮助用户完成当前操作。</PMessage
        ><PMessage severity="success" :closable="false">修改已保存，可以继续下一步。</PMessage>
      </div>
    </section>

    <section class="surface control-section" aria-labelledby="button-title">
      <div class="section-heading">
        <div>
          <h2 id="button-title">按钮</h2>
          <p class="meta muted">一个主要操作，配合清晰的次要动作。</p>
        </div>
        <span class="section-number">04</span>
      </div>
      <div class="button-examples">
        <PButton label="主要操作" @click="showFeedback('已触发主要按钮。')"
          ><template #icon><Plus :size="18" aria-hidden="true" /></template></PButton
        ><PButton
          label="次要操作"
          severity="secondary"
          @click="showFeedback('已触发次要按钮。')"
        /><PButton label="文字操作" text @click="showFeedback('已触发文字按钮。')" /><PButton
          label="禁用操作"
          disabled
        /><PButton label="处理中" loading disabled /><PButton
          label="删除"
          severity="danger"
          outlined
          @click="showFeedback('删除按钮状态已展示。')"
          ><template #icon><Trash2 :size="17" aria-hidden="true" /></template
        ></PButton>
      </div>
      <div v-if="feedback" class="button-feedback meta" role="status">
        <Check :size="16" aria-hidden="true" />{{ feedback }}
      </div>
    </section>
    <p class="gallery-footnote meta muted">
      <Info :size="16" aria-hidden="true" />此页用于检查控件外观与状态，调整不会修改应用设置。
    </p>
  </section>
</template>

<style scoped>
.controls-page {
  margin: 0 auto;
}
.back-button {
  margin: 0 0 18px -10px;
}
.eyebrow {
  font-size: 0.875rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  color: #34674d;
  margin: 0 0 10px;
}
.spec-badge {
  font-size: 0.875rem;
  padding: 8px 11px;
  border: 1px solid #d8e1d4;
  background: #edf1e8;
  border-radius: 7px;
  color: #52665a;
  white-space: nowrap;
}
.spec-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 28px;
  margin: 28px 0 24px;
  font-size: 0.875rem;
  color: #52665a;
}
.spec-facts > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-dot {
  height: 14px;
  width: 14px;
  border-radius: 50%;
  background: #34674d;
  display: inline-block;
}
.control-section {
  padding: 28px 32px;
  margin: 0 0 24px;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  border-bottom: 1px solid #d8e1d4;
  padding-bottom: 21px;
  margin-bottom: 26px;
}
.section-heading h2 {
  font-size: 1.3125rem;
  margin: 0 0 8px;
}
.section-heading p {
  line-height: 1.7;
  margin: 0;
}
.section-number {
  font-size: 0.875rem;
  color: #52665a;
  padding-top: 4px;
  font-variant-numeric: tabular-nums;
}
.control-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 26px 32px;
}
.control-field {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.control-field > label,
.control-field legend,
.slider-label > label {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.6;
}
.control-field p {
  margin: 0;
  line-height: 1.6;
}
.control-field :deep(input),
.control-field :deep(textarea) {
  width: 100%;
}
.control-field :deep(textarea) {
  line-height: 1.65;
}
.control-field :deep(.p-inputnumber) {
  width: 100%;
}
.full-field {
  grid-column: 1/-1;
}
.radio-field {
  padding: 0;
  margin: 0;
  border: none;
}
.radio-field legend {
  padding: 0;
  margin-bottom: 8px;
}
.radio-options {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  min-height: 44px;
  align-items: center;
}
.radio-options > label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  cursor: pointer;
}
.slider-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.slider-label output {
  font-size: 0.875rem;
  background: #edf2e8;
  color: #34674d;
  padding: 3px 9px;
  border-radius: 5px;
  min-width: 36px;
  text-align: center;
}
.slider-field :deep(.p-slider) {
  margin: 17px 9px 8px;
}
.slider-limits {
  display: flex;
  justify-content: space-between;
}
.toggle-examples {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 32px;
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid #e4eade;
}
.toggle-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.toggle-line label {
  font-weight: 600;
  cursor: pointer;
}
.toggle-line p {
  margin: 8px 0 0;
  line-height: 1.7;
}
.toggle-line :deep(.p-toggleswitch),
.toggle-line :deep(.p-checkbox) {
  flex-shrink: 0;
}
.required,
.validation-error {
  color: #b74439;
}
.validation-success {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #34674d;
}
.status-messages {
  display: grid;
  gap: 14px;
  margin-top: 27px;
}
.button-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.button-feedback {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 22px;
  color: #34674d;
}
.gallery-footnote {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  line-height: 1.7;
  margin: 26px 0;
}
.gallery-footnote svg {
  flex-shrink: 0;
  margin-top: 3px;
}
@media (max-width: 760px) {
  .control-section {
    padding: 24px;
  }
  .control-grid {
    gap: 24px;
    grid-template-columns: 1fr;
  }
  .full-field {
    grid-column: auto;
  }
  .toggle-examples {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .spec-badge {
    display: none;
  }
  .spec-facts {
    gap: 12px 22px;
  }
  .button-examples {
    gap: 12px;
  }
  .button-examples :deep(.p-button) {
    flex: 0 1 auto;
  }
  .section-heading {
    margin-bottom: 24px;
  }
  .slider-field {
    padding-bottom: 5px;
  }
}
@media (max-width: 440px) {
  .control-section {
    padding: 22px 18px;
  }
  .button-examples :deep(.p-button) {
    flex: 1 1 calc(50% - 12px);
  }
  .spec-facts {
    font-size: 0.875rem;
  }
}
</style>
