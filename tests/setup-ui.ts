import { addIcon, type IconifyIcon } from '@iconify/vue'
import { init } from 'virtual:nuxt-ui-icons'

// Standalone component mounts use the same bundled icons as app.use(ui),
// including tests that intentionally do not create the application stores.
init((name: string, data: IconifyIcon) => addIcon(name, data))
