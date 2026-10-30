import {
  computed,
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowReactive,
  watch,
  type InjectionKey,
  type Ref,
} from 'vue'
import { persistSetting, readSetting } from '../settings-store'
import { shortcutBlocked } from '../shortcuts'
import { inputDefaults, type InputDefinition } from './defaults'
import { chordsOverlap, editorChordAllowed, matchesChord, normalizeChord } from './shortcuts'
import { defaultGestures, validGesture, type GestureSettings } from './gestures'
import { installMouseGestures } from './mouse'

export interface InputCommand extends InputDefinition {
  available?: () => boolean
  execute: () => void | Promise<unknown>
}
export interface InputPreferences {
  shortcuts: Record<string, string[]>
  gestures: GestureSettings
}
export const INPUT_SETTINGS_KEY = 'repeaty.input.v1'
function defaults(): InputPreferences {
  return {
    shortcuts: {},
    gestures: { ...defaultGestures, bindings: { ...defaultGestures.bindings } },
  }
}
export function normalizeInputPreferences(raw: unknown): InputPreferences {
  const result = defaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  const value = raw as Partial<InputPreferences>
  if (value.shortcuts && typeof value.shortcuts === 'object')
    for (const [id, chords] of Object.entries(value.shortcuts).slice(0, 1000))
      if (
        /^[a-zA-Z0-9:._-]{1,200}$/.test(id) &&
        !['__proto__', 'prototype', 'constructor'].includes(id) &&
        Array.isArray(chords) &&
        chords.length <= 3 &&
        chords.every((key) => typeof key === 'string' && normalizeChord(key))
      )
        result.shortcuts[id] = [...new Set(chords.map((key) => normalizeChord(key)!))]
  const gesture = value.gestures
  if (gesture && typeof gesture === 'object') {
    for (const key of ['enabled', 'trail', 'hint'] as const)
      if (typeof gesture[key] === 'boolean') result.gestures[key] = gesture[key]
    for (const [key, min, max] of [
      ['threshold', 8, 48],
      ['pointThreshold', 2, 24],
      ['width', 1, 12],
      ['opacity', 0.05, 1],
    ] as const)
      if (typeof gesture[key] === 'number' && Number.isFinite(gesture[key]))
        result.gestures[key] = Math.min(max, Math.max(min, gesture[key]))
    if (/^#[0-9a-f]{6}$/i.test(gesture.color)) result.gestures.color = gesture.color
    if (gesture.bindings && typeof gesture.bindings === 'object') {
      result.gestures.bindings = {}
      for (const [pattern, id] of Object.entries(gesture.bindings).slice(0, 100))
        if (validGesture(pattern) && typeof id === 'string' && /^[a-zA-Z0-9:._-]{1,200}$/.test(id))
          result.gestures.bindings[pattern] = id
    }
  }
  return result
}
/** Settings survive temporarily missing plugins. Executable handlers never do. */
export function createInputController(scope: Ref<string>) {
  const state = ref<InputPreferences>(defaults())
  const error = ref('')
  const handlers = shallowReactive(new Map<string, InputCommand[]>())
  const definitions = shallowReactive(new Map<string, InputDefinition>())
  let alive = true,
    revision = 0
  let queue = Promise.resolve()
  const commands = computed<readonly InputCommand[]>(() => {
    const result = new Map<string, InputCommand>(
      inputDefaults.map((entry) => [entry.id, { ...entry, available: () => false, execute() {} }]),
    )
    for (const [id, entry] of definitions)
      result.set(id, { ...entry, available: () => false, execute() {} })
    for (const [id, entries] of handlers) {
      const entry = entries.at(-1)
      if (entry)
        result.set(id, {
          ...entry,
          defaultShortcuts: entry.defaultShortcuts ?? result.get(id)?.defaultShortcuts,
        })
    }
    return [...result.values()]
  })
  function restore() {
    revision++
    try {
      state.value = normalizeInputPreferences(JSON.parse(readSetting(INPUT_SETTINGS_KEY) ?? '{}'))
    } catch {
      state.value = defaults()
    }
    error.value = ''
  }
  const stop = watch(scope, restore, { immediate: true, flush: 'sync' })
  function bindings(id: string) {
    return (
      (Object.hasOwn(state.value.shortcuts, id) ? state.value.shortcuts[id] : undefined) ??
      commands.value
        .find((entry) => entry.id === id)
        ?.defaultShortcuts?.map(normalizeChord)
        .filter((value): value is string => !!value) ??
      []
    )
  }
  function register(command: InputCommand) {
    if (!alive || !/^[a-zA-Z0-9:._-]{1,200}$/.test(command.id)) throw new Error('命令标识无效。')
    const entries = handlers.get(command.id) ?? []
    handlers.set(command.id, [...entries, command])
    let active = true
    return () => {
      if (!active) return
      active = false
      const remaining = (handlers.get(command.id) ?? []).filter((value) => value !== command)
      if (remaining.length) handlers.set(command.id, remaining)
      else handlers.delete(command.id)
    }
  }
  async function run(id: string): Promise<boolean> {
    const command = commands.value.find((entry) => entry.id === id)
    if (!alive || !command || command.available?.() === false) return false
    const expectedScope = scope.value,
      expectedRevision = revision
    try {
      await command.execute()
      return true
    } catch (issue) {
      if (alive && scope.value === expectedScope && revision === expectedRevision)
        error.value = issue instanceof Error ? issue.message : '操作未能完成，请重试。'
      return false
    }
  }
  function dispatch(event: KeyboardEvent) {
    if (!alive || shortcutBlocked(event)) return false
    const matching = commands.value.filter(
      (entry) =>
        entry.available?.() !== false && bindings(entry.id).some((key) => matchesChord(event, key)),
    )
    // A conflict never chooses an arbitrary destructive action.
    if (matching.length !== 1) return false
    const command = matching[0]!
    if (
      command.id === 'review.reveal' &&
      (event.target as HTMLElement)?.closest?.('button, summary')
    )
      return false
    event.preventDefault()
    void run(command.id)
    return true
  }
  function save(update: (previous: InputPreferences) => InputPreferences) {
    const expectedScope = scope.value,
      expectedRevision = revision
    const work = queue
      .catch(() => {})
      .then(async () => {
        if (!alive || expectedScope !== scope.value || expectedRevision !== revision)
          throw new Error('学习库已切换，请重新打开设置。')
        const value = normalizeInputPreferences(update(state.value))
        await persistSetting(INPUT_SETTINGS_KEY, JSON.stringify(value))
        if (!alive || expectedScope !== scope.value || expectedRevision !== revision) return
        state.value = value
        error.value = ''
      })
    queue = work
    return work.catch((issue: unknown) => {
      if (alive && expectedScope === scope.value && expectedRevision === revision)
        error.value = '设置未能保存，请重试。'
      throw issue
    })
  }
  function conflicts(id: string, chords: readonly string[]) {
    const command = commands.value.find((entry) => entry.id === id)
    return commands.value.filter((other) => {
      if (id === other.id || !command) return false
      if (command.context === 'editor' || other.context === 'editor') {
        if (command.context !== other.context) return false
      } else if (
        command.context !== 'global' &&
        other.context !== 'global' &&
        command.context !== other.context
      )
        return false
      // These two browsing commands intentionally share keys with their review equivalents.
      if ([id, other.id].includes('app.cards') && [id, other.id].includes('review.bury'))
        return false
      return chords.some((key) =>
        bindings(other.id).some((candidate) => chordsOverlap(key, candidate)),
      )
    })
  }
  return {
    state,
    error,
    commands,
    register,
    run,
    dispatch,
    bindings,
    conflicts,
    registerDefinition(definition: InputDefinition) {
      definitions.set(definition.id, definition)
      return () => {
        if (definitions.get(definition.id) === definition) definitions.delete(definition.id)
      }
    },
    matches: (id: string, event: KeyboardEvent) => {
      const command = commands.value.find((entry) => entry.id === id)
      if (
        !bindings(id).some(
          (key) =>
            (command?.context !== 'editor' || editorChordAllowed(key)) && matchesChord(event, key),
        )
      )
        return false
      return (
        command?.context !== 'editor' ||
        commands.value.filter(
          (entry) =>
            entry.context === 'editor' &&
            bindings(entry.id).some((key) => matchesChord(event, key)),
        ).length === 1
      )
    },
    saveShortcuts(id: string, values: string[]) {
      if (values.length > 3 || values.some((value) => !normalizeChord(value)))
        return Promise.reject(new Error('快捷键格式无效。'))
      if (
        commands.value.find((entry) => entry.id === id)?.context === 'editor' &&
        values.some((value) => !editorChordAllowed(value))
      )
        return Promise.reject(
          new Error('编辑命令需要组合键，不能占用原生撤销、选区或剪贴板快捷键。'),
        )
      if (conflicts(id, values).length)
        return Promise.reject(new Error('快捷键与其他命令冲突，请先修改冲突项。'))
      return save((previous) => ({
        ...previous,
        shortcuts: { ...previous.shortcuts, [id]: values },
      }))
    },
    resetShortcuts(id?: string) {
      return save((previous) => {
        const shortcuts = { ...previous.shortcuts }
        if (id) delete shortcuts[id]
        return { ...previous, shortcuts: id ? shortcuts : {} }
      })
    },
    saveGestures(gestures: GestureSettings) {
      return save((previous) => ({ ...previous, gestures }))
    },
    resetGestures() {
      return save((previous) => ({ ...previous, gestures: defaults().gestures }))
    },
    restore,
    dispose() {
      alive = false
      revision++
      stop()
      handlers.clear()
      definitions.clear()
    },
  }
}
export type InputController = ReturnType<typeof createInputController>
export const INPUT_COMMANDS: InjectionKey<InputController> = Symbol('input-commands')
export function useOptionalInputCommands() {
  return inject(INPUT_COMMANDS, undefined)
}
export function useInputCommands(scope: Ref<string>) {
  const controller = createInputController(scope)
  provide(INPUT_COMMANDS, controller)
  const disposeMouse = installMouseGestures(controller, scope)
  onScopeDispose(() => {
    disposeMouse()
    controller.dispose()
  })
  return controller
}
export function matchesInputShortcut(
  input: InputController | undefined,
  id: string,
  event: KeyboardEvent,
) {
  return input
    ? input.matches(id, event)
    : (inputDefaults
        .find((entry) => entry.id === id)
        ?.defaultShortcuts?.some((key) => matchesChord(event, key)) ?? false)
}
