import { ref } from 'vue'

export function useStudyClock() {
  const now = ref(new Date())
  const coarseNow = ref(new Date())
  function refreshClock() {
    now.value = new Date()
    coarseNow.value = now.value
  }
  function tick() {
    const next = new Date()
    now.value = next
    if (Math.floor(next.getTime() / 60000) !== Math.floor(coarseNow.value.getTime() / 60000))
      coarseNow.value = next
  }

  return { now, coarseNow, refreshClock, tick }
}
