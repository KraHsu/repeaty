import { invoke } from '@tauri-apps/api/core'
export function handleExternalLinks() {
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (!link || !/^https?:/.test(link.href)) return
      event.preventDefault()
      void invoke('open_external', { url: link.href }).catch(() => {
        /* Native opener reports failure without navigating the app. */
      })
    },
    true,
  )
}
