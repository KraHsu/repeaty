import { initializePlatform } from '@repeaty-platform'
import { createApp } from 'vue'
import App from './App.vue'
import { installApplicationState } from './stores'
import { initI18n } from './i18n'
import 'katex/dist/katex.min.css'
import './styles/nuxt-ui.css'
import './style.css'
import './styles/controls.css'

const initializing = initializePlatform()
initI18n()

const app = createApp(App)
installApplicationState(app)
app.mount('#app')
void initializing.catch(() => {})
