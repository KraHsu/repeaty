import { ref } from 'vue'
export const serverEdition = __REPEATY_EDITION__ === 'server'
export const desktopEdition = __REPEATY_EDITION__ === 'desktop'
export const remoteWorkspace = ref(serverEdition)
