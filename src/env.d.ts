declare const __REPEATY_EDITION__: 'static' | 'server' | 'desktop'
declare module 'virtual:nuxt-ui-icons' {
  export function init(
    register: (name: string, data: import('@iconify/vue').IconifyIcon) => unknown,
  ): void
}
