<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { z } from 'zod'
import { t } from '../../i18n'
import type { QuestionProps } from '../types'
import {
  automaticGrade,
  parseJudgeResult,
  parseSubmissionInput,
  problemSchema,
  problemUrl,
  targetMinutes,
} from './model'
import { bridgeRequest, BridgeError } from './bridge'
import { readDraft, writeDraft, type Draft } from './drafts'
import {
  hasAttemptBody,
  type Practice,
  type Attempt,
  type AttemptRecord,
} from '../../core/practice-data'
import { practiceContentRevision } from '../../core/practice'
import History from './History.vue'
import RecoverSubmission from './RecoverSubmission.vue'
import Connection from './Connection.vue'
import Statement from './Statement.vue'

const props = defineProps<QuestionProps>()
const parsed = problemSchema.safeParse(props.card.plugin?.data)
const problem = parsed.success ? parsed.data : undefined
const error = ref<Error | string>(problem ? '' : '题目数据不完整，请编辑卡片并重新读取题目。')
const storageError = ref(false)
const working = ref(false)
const ready = ref(false)
const paused = ref(false)
const codeInput = ref<HTMLTextAreaElement>()
const abort = new AbortController()
const scope = props.workspaceScope ?? 'local:repeaty'
let revision = ''
let activePractice: Practice | undefined
let activeAttempt: Attempt | undefined
const initialLang =
  problem?.snippets.find((snippet) => snippet.langSlug === 'python3')?.langSlug ??
  problem?.snippets[0]?.langSlug ??
  ''
const draft = ref<Draft>({
  revision,
  lang: initialLang,
  code: {},
  attempts: 0,
  elapsedMs: 0,
  answerSeen: false,
  awaitingSubmit: false,
  uncertain: false,
  mode: 'manual',
})
const code = computed({
  get: () =>
    draft.value.code[draft.value.lang] ??
    problem?.snippets.find((snippet) => snippet.langSlug === draft.value.lang)?.code ??
    '',
  set: (value: string) => {
    draft.value.code[draft.value.lang] = value
  },
})
const accepted = computed(() => draft.value.result?.outcome === 'accepted')
const practiceAttempts = computed(() =>
  (props.attempts ?? []).filter((entry) => entry.practiceId === draft.value.practiceId),
)
const unknownAttempts = computed(() =>
  practiceAttempts.value.filter((entry) => entry.status === 'unknown'),
)
const pendingAttempts = computed(() =>
  practiceAttempts.value.filter((entry) => entry.status === 'pending'),
)
watch(practiceAttempts, (entries) => {
  if (!activePractice) return
  draft.value.attempts = entries.filter((entry) => entry.submissionId).length
  draft.value.uncertain = entries.some((entry) => entry.status === 'unknown')
  if (draft.value.uncertain) draft.value.mode = 'manual'
})
const suggestion = computed(() =>
  problem && draft.value.result && !draft.value.uncertain
    ? automaticGrade(
        draft.value.result.outcome,
        draft.value.attempts,
        draft.value.elapsedMs,
        problem.difficulty,
        draft.value.answerSeen,
      )
    : undefined,
)
const elapsed = computed(() => {
  const seconds = Math.floor(draft.value.elapsedMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const gradeNames = { 1: '重来', 2: '困难', 3: '良好', 4: '简单' } as const
let disposed = false
let finished = false
let lastTick = performance.now()
let timer: ReturnType<typeof setInterval> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saves = Promise.resolve()
function persist() {
  clearTimeout(saveTimer)
  if (!ready.value || finished) return saves
  const value = JSON.parse(JSON.stringify(draft.value)) as Draft
  saves = saves
    .then(() => writeDraft(props.card.id, value, scope))
    .then(
      () => {
        storageError.value = false
      },
      () => {
        storageError.value = true
      },
    )
  return saves
}
watch(
  draft,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void persist()
    }, 250)
  },
  { deep: true },
)
watch(
  () => props.revealed,
  (revealed) => {
    if (revealed && !accepted.value) draft.value.answerSeen = true
  },
)
watch(
  () => draft.value.answerSeen,
  async (seen) => {
    if (
      !seen ||
      !ready.value ||
      working.value ||
      !activeAttempt ||
      activePractice?.answerSeen ||
      disposed
    )
      return
    working.value = true
    try {
      await saveAttempt(activeAttempt)
    } catch (issue) {
      error.value = issue as Error
    } finally {
      working.value = false
    }
  },
)
watchEffect(() => {
  props.state.busy = working.value || !ready.value
  props.state.allowedGrades =
    problem && ready.value && !draft.value.pending && !pendingAttempts.value.length
      ? accepted.value && !draft.value.answerSeen
        ? [1, 2, 3, 4]
        : [1]
      : []
  props.state.suggestedGrade = suggestion.value
  props.state.practiceId = draft.value.practiceId
  props.state.assessment = {
    pluginId: 'leetcode',
    mode: draft.value.mode,
    attempts: draft.value.attempts,
    elapsedMs: draft.value.elapsedMs,
    outcome: draft.value.result?.outcome ?? 'unanswered',
    submissionId: draft.value.submissionId,
    suggestedGrade: suggestion.value,
    answerSeen: draft.value.answerSeen,
    ruleVersion: 1,
  }
})
async function complete() {
  finished = true
  clearTimeout(saveTimer)
  await saves
  await writeDraft(props.card.id, undefined, scope).catch(() => {})
}
async function saveAttempt(attempt: Attempt, activate = true) {
  if (disposed || !props.saveAttempt || !activePractice)
    throw new Error('无法保存提交记录，请重试。')
  const practice = {
    ...activePractice,
    answerSeen: activePractice.answerSeen || draft.value.answerSeen,
  }
  await props.saveAttempt(practice, attempt, scope)
  activePractice = practice
  if (activate) activeAttempt = attempt
}
function tick() {
  const now = performance.now()
  if (
    ready.value &&
    !paused.value &&
    !working.value &&
    !draft.value.pending &&
    !pendingAttempts.value.length &&
    !accepted.value &&
    !props.revealed &&
    document.visibilityState === 'visible'
  )
    draft.value.elapsedMs += Math.max(0, now - lastTick)
  lastTick = now
}
function togglePause() {
  tick()
  paused.value = !paused.value
}
function visibilityChanged() {
  lastTick = performance.now()
  void persist()
}
async function fullAttempt(entry: AttemptRecord): Promise<Attempt> {
  if (hasAttemptBody(entry)) return entry
  const value = await props.getAttempt?.(entry.id, abort.signal)
  if (!value) throw new Error('无法读取这次提交，请重试。')
  return value
}
async function check(entry: AttemptRecord | undefined = activeAttempt) {
  const submissionId = entry?.submissionId ?? draft.value.pending
  if (!problem || !submissionId || working.value || disposed) return
  const current = !entry || entry.id === activeAttempt?.id
  working.value = true
  error.value = ''
  try {
    let target = entry ? await fullAttempt(entry) : undefined
    if (target?.status === 'submitting') {
      target = {
        ...target,
        status: 'pending',
        submissionId,
        updatedAt: new Date().toISOString(),
      }
      await saveAttempt(
        {
          ...target,
        },
        current,
      )
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      const raw = await bridgeRequest(
        { action: 'check', site: problem.site, submissionId },
        abort.signal,
      )
      const result = parseJudgeResult(raw)
      if (result) {
        if (target)
          await saveAttempt(
            {
              ...target,
              status: 'completed',
              result,
              updatedAt: new Date().toISOString(),
            },
            current,
          )
        if (current) {
          draft.value.result = result
          draft.value.pending = undefined
        }
        await persist()
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      abort.signal.throwIfAborted()
    }
    error.value = '判题尚未结束，可稍后继续查询，无需重新提交。'
  } catch (issue) {
    if (!disposed) error.value = issue as Error
  } finally {
    working.value = false
  }
}
async function recover(entry: AttemptRecord, input: string) {
  if (!problem || working.value || !ready.value || disposed || !activePractice) return false
  working.value = true
  error.value = ''
  let pending: Attempt
  try {
    const attempt = await fullAttempt(entry)
    const submissionId = parseSubmissionInput(input, problem)
    const response = z.object({ submissionId: z.string() }).parse(
      await bridgeRequest(
        {
          action: 'recover',
          site: problem.site,
          slug: problem.slug,
          questionId: problem.questionId,
          submissionId,
          lang: attempt.language,
          code: attempt.code,
          submittedAt: Math.floor(Date.parse(attempt.submittedAt) / 1000),
        },
        abort.signal,
      ),
    )
    if (response.submissionId !== submissionId)
      throw new Error('无法读取该提交，请检查编号和当前 LeetCode 登录信息。')
    pending = { ...attempt, status: 'pending', submissionId, updatedAt: new Date().toISOString() }
    const current = attempt.id === activeAttempt?.id
    await saveAttempt(pending, current)
    if (current) {
      draft.value.pending = submissionId
      draft.value.submissionId = submissionId
      draft.value.result = undefined
      draft.value.lang = attempt.language
      draft.value.code[attempt.language] = attempt.code
    }
    await persist()
  } catch (issue) {
    if (!disposed) error.value = issue as Error
    return false
  } finally {
    working.value = false
  }
  await check(pending)
  return true
}
async function submitCode() {
  if (
    !problem ||
    working.value ||
    !ready.value ||
    draft.value.pending ||
    pendingAttempts.value.length ||
    !code.value.trim() ||
    accepted.value
  )
    return
  tick()
  working.value = true
  error.value = ''
  try {
    await bridgeRequest({ action: 'ping' }, abort.signal)
    if (!activePractice) {
      activePractice = {
        id: crypto.randomUUID(),
        cardId: props.card.id,
        contentRevision: revision,
        question: {
          front: props.card.front,
          back: props.card.back,
          format: props.card.format,
          plugin: { id: 'leetcode', version: props.card.plugin!.version, data: { ...problem } },
        },
        startedAt: new Date().toISOString(),
        answerSeen: draft.value.answerSeen,
      }
    }
    const attempt: Attempt = {
      id: crypto.randomUUID(),
      practiceId: activePractice.id,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      language: draft.value.lang,
      code: code.value,
      elapsedMs: draft.value.elapsedMs,
      status: 'submitting',
    }
    await saveAttempt(attempt)
    draft.value.practiceId = activePractice.id
    draft.value.attemptId = attempt.id
    draft.value.awaitingSubmit = true
    await persist()
    const raw = await bridgeRequest(
      {
        action: 'submit',
        site: problem.site,
        slug: problem.slug,
        questionId: problem.questionId,
        lang: draft.value.lang,
        code: code.value,
      },
      abort.signal,
    )
    const result = z
      .object({
        submission_id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,30}$/)]),
      })
      .parse(raw)
    draft.value.attempts++
    draft.value.awaitingSubmit = false
    draft.value.pending = String(result.submission_id)
    draft.value.submissionId = draft.value.pending
    draft.value.result = undefined
    await persist()
    await saveAttempt({
      ...activeAttempt!,
      status: 'pending',
      submissionId: draft.value.pending,
      updatedAt: new Date().toISOString(),
    })
  } catch (issue) {
    if (draft.value.awaitingSubmit) {
      const certainFailure =
        issue instanceof BridgeError &&
        [
          'leetcode-not-configured',
          'login-required',
          'verification-required',
          'credentials-changed',
          'rate-limit',
          'open-leetcode',
          'submission-busy',
        ].includes(issue.code)
      if (!certainFailure) {
        draft.value.uncertain = true
        draft.value.mode = 'manual'
      }
      if (activeAttempt?.status === 'submitting') {
        await saveAttempt({
          ...activeAttempt,
          status: certainFailure ? 'failed' : 'unknown',
          updatedAt: new Date().toISOString(),
        }).catch(() => {
          storageError.value = true
        })
      }
      draft.value.awaitingSubmit = false
      await persist()
    }
    if (!disposed)
      error.value =
        issue instanceof z.ZodError
          ? '未取得提交编号，请先在 LeetCode 检查提交记录，避免重复提交。'
          : (issue as Error)
  } finally {
    working.value = false
  }
  if (draft.value.pending && !disposed) await check()
}
function indent(event: KeyboardEvent) {
  const element = codeInput.value
  if (event.key !== 'Tab' || !element) return
  event.preventDefault()
  const cursor = element.selectionStart
  code.value = code.value.slice(0, cursor) + '    ' + code.value.slice(element.selectionEnd)
  requestAnimationFrame(() => {
    element.selectionStart = element.selectionEnd = cursor + 4
  })
}
onMounted(async () => {
  try {
    revision = await practiceContentRevision(props.card)
    draft.value.revision = revision
    draft.value =
      (await readDraft(
        props.card.id,
        revision,
        scope,
        `${props.card.updatedAt}:${problem?.site}:${problem?.slug}`,
      )) ?? draft.value
    activePractice = props.practices?.find(
      (entry) =>
        entry.id === draft.value.practiceId &&
        !entry.completedAt &&
        entry.contentRevision === revision,
    )
    if (!draft.value.practiceId) {
      activePractice = [...(props.practices ?? [])]
        .reverse()
        .find((entry) => !entry.completedAt && entry.contentRevision === revision)
      if (activePractice) {
        const latestHeader = [...(props.attempts ?? [])]
          .reverse()
          .find((entry) => entry.practiceId === activePractice!.id)
        const latest = latestHeader ? await fullAttempt(latestHeader) : undefined
        draft.value.practiceId = activePractice.id
        draft.value.attemptId = latest?.id
        if (latest) {
          draft.value.lang = latest.language
          draft.value.code[latest.language] = latest.code
          draft.value.elapsedMs = latest.elapsedMs
        }
      }
    }
    if (draft.value.practiceId && !activePractice) {
      draft.value = {
        revision,
        lang: initialLang,
        code: {},
        attempts: 0,
        elapsedMs: 0,
        answerSeen: false,
        awaitingSubmit: false,
        uncertain: false,
        mode: 'manual',
      }
    }
    const stored = props.attempts?.find(
      (entry) => entry.id === draft.value.attemptId && entry.practiceId === activePractice?.id,
    )
    activeAttempt = stored ? await fullAttempt(stored) : undefined
    if (activeAttempt?.status === 'pending' || activeAttempt?.status === 'completed') {
      draft.value.awaitingSubmit = false
      draft.value.pending =
        activeAttempt.status === 'pending' ? activeAttempt.submissionId : undefined
      draft.value.submissionId = activeAttempt.submissionId
      draft.value.result = activeAttempt.result
      draft.value.attempts = props.attempts!.filter(
        (entry) => entry.practiceId === activePractice!.id && entry.submissionId,
      ).length
    } else if (activeAttempt?.status === 'submitting') {
      await saveAttempt({
        ...activeAttempt,
        status: 'unknown',
        updatedAt: new Date().toISOString(),
      })
      draft.value.awaitingSubmit = true
    }
    if (activeAttempt?.status === 'unknown') {
      draft.value.uncertain = true
      draft.value.mode = 'manual'
    }
    if (activePractice) {
      draft.value.answerSeen ||= activePractice.answerSeen ?? false
      draft.value.uncertain ||=
        props.attempts?.some(
          (entry) => entry.practiceId === activePractice!.id && entry.status === 'unknown',
        ) ?? false
      if (draft.value.uncertain) draft.value.mode = 'manual'
    }
  } catch {
    storageError.value = true
  }
  if (disposed) return
  if (draft.value.awaitingSubmit) {
    draft.value.awaitingSubmit = false
    draft.value.uncertain = true
    draft.value.mode = 'manual'
    error.value = '未取得提交编号，请先在 LeetCode 检查提交记录，避免重复提交。'
  }
  ready.value = true
  props.state.complete = complete
  lastTick = performance.now()
  timer = setInterval(tick, 1000)
  document.addEventListener('visibilitychange', visibilityChanged)
  if (pendingAttempts.value.length) {
    for (const attempt of pendingAttempts.value) {
      if (disposed) break
      await check(attempt)
    }
  } else if (draft.value.pending) void check()
})
onUnmounted(() => {
  tick()
  disposed = true
  abort.abort()
  clearInterval(timer)
  document.removeEventListener('visibilitychange', visibilityChanged)
  void persist()
})
</script>
<template>
  <div class="leetcode-question">
    <template v-if="problem">
      <h1 class="card-question long-content">{{ card.front }}</h1>
      <div class="leetcode-meta">
        <span class="pill">{{ t(problem.difficulty) }}</span
        ><a :href="problemUrl(problem)" target="_blank" rel="noopener noreferrer">{{
          t('在 LeetCode 打开')
        }}</a>
      </div>
      <Statement :content="problem.content" />
      <History
        :practices="practices ?? []"
        :attempts="attempts ?? []"
        :get-attempt="getAttempt"
        :active-id="draft.practiceId"
        @reveal="
          (id) => {
            if (id !== draft.practiceId && !accepted) draft.answerSeen = true
          }
        "
      />
      <div class="leetcode-workspace">
        <div class="leetcode-toolbar">
          <label for="code-language"
            >{{ t('编程语言')
            }}<select
              id="code-language"
              v-model="draft.lang"
              :disabled="
                working || !ready || accepted || !!draft.pending || !!pendingAttempts.length
              "
            >
              <option
                v-for="snippet in problem.snippets"
                :key="snippet.langSlug"
                :value="snippet.langSlug"
              >
                {{ snippet.lang }}
              </option>
            </select></label
          >
          <span>{{
            t('尝试 {count} 次 · 用时 {time}', { count: draft.attempts, time: elapsed })
          }}</span>
          <button
            v-if="!accepted && !revealed"
            type="button"
            class="text-button"
            @click="togglePause"
          >
            {{ paused ? t('继续计时') : t('暂停计时') }}
          </button>
        </div>
        <p v-if="!problem.snippets.length" class="import-warning">
          {{ t('该题没有可用的代码模板，请在 LeetCode 作答。') }}
        </p>
        <label for="leetcode-code">{{ t('代码') }}</label>
        <textarea
          id="leetcode-code"
          ref="codeInput"
          v-model="code"
          class="code-editor"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          rows="16"
          maxlength="50000"
          :disabled="
            working ||
            !ready ||
            accepted ||
            !problem.snippets.length ||
            !!draft.pending ||
            !!pendingAttempts.length
          "
          @keydown="indent"
        />
        <div class="leetcode-toolbar">
          <button
            class="button primary"
            :disabled="
              working ||
              !ready ||
              !code.trim() ||
              !draft.lang ||
              accepted ||
              !!draft.pending ||
              !!pendingAttempts.length
            "
            @click="submitCode"
          >
            {{ working ? t('判题中…') : t('提交到 LeetCode') }}
          </button>
          <button
            v-if="draft.pending"
            class="button secondary"
            :disabled="working"
            @click="check()"
          >
            {{ t('继续查询结果') }}
          </button>
        </div>
        <p v-if="draft.pending" class="form-note">
          {{ t('提交编号：{id}', { id: draft.pending }) }}
        </p>
        <div
          v-for="attempt in pendingAttempts.filter((entry) => entry.id !== draft.attemptId)"
          :key="attempt.id"
          class="leetcode-toolbar"
        >
          <span>{{ t('提交编号：{id}', { id: attempt.submissionId }) }}</span>
          <button class="button secondary" :disabled="working" @click="check(attempt)">
            {{ t('继续查询结果') }}
          </button>
        </div>
        <RecoverSubmission
          v-for="attempt in unknownAttempts"
          :key="attempt.id"
          :attempt="attempt"
          :disabled="working || !ready"
          :recover="recover"
          :get-attempt="getAttempt"
        />
        <div v-if="draft.result" class="judge-result" :class="{ accepted }" role="status">
          <strong>{{ t(draft.result.status) }}</strong>
          <span v-if="draft.result.runtime">{{
            t('运行时间：{value}', { value: draft.result.runtime })
          }}</span>
          <span v-if="draft.result.memory">{{
            t('内存：{value}', { value: draft.result.memory })
          }}</span>
          <pre v-if="draft.result.detail">{{ draft.result.detail }}</pre>
          <a
            v-if="draft.submissionId"
            :href="`https://${problem.site}/submissions/detail/${draft.submissionId}/`"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t('查看提交记录') }}</a
          >
        </div>
        <label for="leetcode-rating">{{ t('复习评分') }}</label>
        <select id="leetcode-rating" v-model="draft.mode">
          <option value="manual">{{ t('手动评分') }}</option>
          <option value="automatic" :disabled="draft.uncertain">{{ t('自动评分') }}</option>
        </select>
        <p v-if="suggestion" class="form-note">
          {{ t('自动评分：{grade}', { grade: t(gradeNames[suggestion]) }) }}
        </p>
        <p v-if="draft.uncertain" class="import-warning">
          {{ t('有一次提交未取得编号，自动评分暂不可用。请先核对并关联 LeetCode 提交记录。') }}
        </p>
        <details class="form-note">
          <summary>{{ t('评分规则') }}</summary>
          <p>
            {{
              t(
                '通过且一次完成、用时不超过 {minutes} 分钟：简单；通过且不超过两次、用时不超过 {double} 分钟：良好；其余通过：困难。未通过或提前查看答案：重来。',
                {
                  minutes: targetMinutes[problem.difficulty],
                  double: targetMinutes[problem.difficulty] * 2,
                },
              )
            }}
          </p>
          <p>{{ t('只统计取得提交编号的正式提交。计时可暂停，切换到其他标签页时自动暂停。') }}</p>
        </details>
        <Connection :site="problem.site" />
      </div>
    </template>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <p v-if="storageError" class="import-warning" role="alert">
      {{ t('草稿未能保存，请复制代码后再离开页面。') }}
    </p>
  </div>
</template>
