export type Direction = 'L' | 'R' | 'U' | 'D'
export interface GesturePoint {
  x: number
  y: number
}
export interface GestureSettings {
  enabled: boolean
  bindings: Record<string, string>
  threshold: number
  pointThreshold: number
  trail: boolean
  hint: boolean
  color: string
  width: number
  opacity: number
}
export const defaultGestures: GestureSettings = {
  enabled: false,
  bindings: { L: 'app.back', R: 'app.forward', LU: 'document.top', LD: 'document.bottom' },
  threshold: 18,
  pointThreshold: 6,
  trail: true,
  hint: true,
  color: '#6fa880',
  width: 3,
  opacity: 0.65,
}
export function validGesture(value: string): boolean {
  return /^[LRUD]{1,8}$/.test(value) && !/(.)\1/.test(value)
}
export function gestureLabel(value: string): string {
  return [...value]
    .map((letter) => ({ L: '←', R: '→', U: '↑', D: '↓' })[letter as Direction] ?? '')
    .join(' ')
}
export function createGestureTracker(start: GesturePoint, threshold: number) {
  let anchor = start
  let path = ''
  return {
    move(point: GesturePoint) {
      const dx = point.x - anchor.x,
        dy = point.y - anchor.y
      if (Math.hypot(dx, dy) < threshold) return path
      const direction: Direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'
      if (path.at(-1) !== direction && path.length < 8) path += direction
      anchor = point
      return path
    },
    get path() {
      return path
    },
  }
}
