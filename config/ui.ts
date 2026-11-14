/** Shared by every edition; Nuxt UI owns control, focus and interaction styling. */
export const ui = {
  colors: { primary: 'sage', neutral: 'stone' },
  button: { slots: { base: 'min-h-11 cursor-pointer' } },
  input: { slots: { root: 'w-full', base: 'min-h-11' } },
  formField: {
    slots: { label: 'text-base', description: 'text-xs', help: 'text-xs', error: 'text-xs' },
  },
  alert: { slots: { description: 'text-xs' } },
  textarea: { slots: { root: 'w-full', base: 'leading-relaxed' } },
  select: { slots: { base: 'min-h-11 w-full cursor-pointer', content: 'z-[1200]' } },
  selectMenu: { slots: { base: 'min-h-11 w-full', content: 'z-[1200]' } },
  dropdownMenu: { slots: { content: 'z-[1200]' } },
  tooltip: { slots: { content: 'z-[1300]' } },
  popover: { slots: { content: 'z-[1200]' } },
} as const
