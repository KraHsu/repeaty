import { createApp } from 'vue'
import App from './App.vue'
import { initI18n } from './i18n'
import 'katex/dist/katex.min.css'
import './style.css'

initI18n()

createApp(App).mount('#app')
