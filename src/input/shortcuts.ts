export interface KeyChord {
  key: string
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}
const aliases: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  del: 'Delete',
  delete: 'Delete',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: '+',
}
export function parseChord(value: string): KeyChord | undefined {
  if (!value || value.length > 100) return
  const parts = value
    .trim()
    .split('+')
    .map((part) => part.trim())
  const chord: KeyChord = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  }
  for (const part of parts) {
    const lower = part.toLowerCase()
    const modifier = (
      {
        mod: 'mod',
        control: 'ctrl',
        ctrl: 'ctrl',
        meta: 'meta',
        cmd: 'meta',
        alt: 'alt',
        shift: 'shift',
      } as const
    )[lower as 'mod']
    if (modifier) {
      if (chord[modifier]) return
      chord[modifier] = true
    } else {
      if (chord.key || !part) return
      chord.key =
        aliases[lower] ??
        (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part)
          ? part.toUpperCase()
          : part.length === 1
            ? part.toLowerCase()
            : '')
    }
  }
  if (!chord.key || (chord.mod && (chord.ctrl || chord.meta))) return
  // Navigation and native input editing keys must stay available even inside settings.
  if (
    !chord.mod &&
    !chord.ctrl &&
    !chord.meta &&
    !chord.alt &&
    ['Tab', 'Backspace', 'Delete'].includes(chord.key)
  )
    return
  return chord
}
export function formatChord(chord: KeyChord): string {
  return [
    chord.mod && 'Mod',
    chord.ctrl && 'Control',
    chord.meta && 'Meta',
    chord.alt && 'Alt',
    chord.shift && 'Shift',
    chord.key === '+' ? 'Plus' : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key,
  ]
    .filter(Boolean)
    .join('+')
}
export function normalizeChord(value: string): string | undefined {
  const chord = parseChord(value)
  return chord && formatChord(chord)
}
export function editorChordAllowed(value: string): boolean {
  const chord = parseChord(value)
  return (
    !!chord &&
    (chord.mod || chord.ctrl || chord.meta || chord.alt) &&
    ![
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Backspace',
      'Delete',
      'Escape',
      'Tab',
    ].includes(chord.key) &&
    !(
      !chord.alt &&
      (['z', 'y', 'v', 'x'].includes(chord.key.toLowerCase()) ||
        (!chord.shift && ['a', 'c'].includes(chord.key.toLowerCase())))
    )
  )
}
export function chordFromEvent(event: KeyboardEvent): string | undefined {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.getModifierState('AltGraph') ||
    ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)
  )
    return
  const key = aliases[event.key.toLowerCase()] ?? (event.code === 'Space' ? 'Space' : event.key)
  return normalizeChord(
    [
      event.ctrlKey && 'Control',
      event.metaKey && 'Meta',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      key === '+' ? 'Plus' : key,
    ]
      .filter(Boolean)
      .join('+'),
  )
}
export function matchesChord(
  event: KeyboardEvent,
  value: string,
  mac = /Mac|iPhone|iPad/.test(navigator.platform),
): boolean {
  const chord = parseChord(value)
  if (
    !chord ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.getModifierState('AltGraph')
  )
    return false
  const key = aliases[event.key.toLowerCase()] ?? event.key.toLowerCase()
  const match =
    chord.key.toLowerCase() === key.toLowerCase() ||
    (chord.key === 'Space' && event.code === 'Space')
  return (
    match &&
    event.ctrlKey === (chord.ctrl || (chord.mod && !mac)) &&
    event.metaKey === (chord.meta || (chord.mod && mac)) &&
    event.altKey === chord.alt &&
    event.shiftKey === chord.shift
  )
}
/** Compare both platforms so a saved binding does not become ambiguous after moving the library. */
export function chordsOverlap(a: string, b: string): boolean {
  const first = parseChord(a),
    second = parseChord(b)
  if (!first || !second) return false
  return [false, true].some((mac) => {
    const signature = (c: KeyChord) =>
      [
        c.key.toLowerCase(),
        c.ctrl || (c.mod && !mac),
        c.meta || (c.mod && mac),
        c.alt,
        c.shift,
      ].join(':')
    return signature(first) === signature(second)
  })
}
