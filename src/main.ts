import { initializePlatform } from '@repeaty-platform'
import { createApp } from 'vue'
import './styles/nuxt-ui.css'
import App from './App.vue'
import { installApplicationState } from './stores'
import { initI18n } from './i18n'
import { restorePreferences } from './preferences'
import 'katex/dist/katex.min.css'
import './style.css'
import './styles/controls.css'
import './styles/shell.css'

const initializing = initializePlatform()
initI18n()
restorePreferences()

const app = createApp(App)
installApplicationState(app)
app.mount('#app')
void initializing.catch(() => {})
