import { initializePlatform } from '@repeaty-platform'
import { createApp } from 'vue'
import App from './App.vue'
import { initI18n } from './i18n'
import 'katex/dist/katex.min.css'
import './style.css'

initI18n()
await initializePlatform()

createApp(App).mount('#app')
