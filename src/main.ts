import { initializePlatform } from '@repeaty-platform'
import { createApp } from 'vue'
import App from './App.vue'
import { initI18n } from './i18n'
import 'katex/dist/katex.min.css'
import './style.css'

const initializing = initializePlatform()
initI18n()

createApp(App).mount('#app')
void initializing.catch(() => {})
