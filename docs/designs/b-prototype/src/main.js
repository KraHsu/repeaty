import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'
import RadioButton from 'primevue/radiobutton'
import Slider from 'primevue/slider'
import MultiSelect from 'primevue/multiselect'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import App from './App.vue'
import './style.css'

const preset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#f3f7ef',
      100: '#e5eddf',
      200: '#cbdcc1',
      300: '#aac49d',
      400: '#76986c',
      500: '#527c50',
      600: '#34674d',
      700: '#29563f',
      800: '#244637',
      900: '#203b30',
      950: '#14271f',
    },
    focusRing: { width: '2px', style: 'solid', color: '#527c50', offset: '3px' },
    formField: { paddingX: '0.875rem', paddingY: '0.6875rem', borderRadius: '8px' },
    colorScheme: {
      light: {
        primary: {
          color: '#34674d',
          inverseColor: '#ffffff',
          hoverColor: '#29563f',
          activeColor: '#244637',
        },
        highlight: {
          background: '#e5eddf',
          focusBackground: '#d8e7cf',
          color: '#29563f',
          focusColor: '#244637',
        },
        text: {
          color: '#243c31',
          hoverColor: '#203b30',
          mutedColor: '#52665a',
          hoverMutedColor: '#385143',
        },
        formField: {
          background: '#ffffff',
          borderColor: '#c3d0c0',
          hoverBorderColor: '#8ea78a',
          focusBorderColor: '#34674d',
        },
      },
    },
  },
  components: {
    button: {
      root: { borderRadius: '8px', paddingY: '0.6875rem', paddingX: '1rem' },
      colorScheme: {
        light: {
          text: { secondary: { color: '#52665a' }, danger: { color: '#a12f33' } },
          outlined: { secondary: { color: '#52665a' }, danger: { color: '#a12f33' } },
          root: {
            danger: {
              background: '#a12f33',
              borderColor: '#a12f33',
              hoverBackground: '#88272b',
              hoverBorderColor: '#88272b',
            },
          },
        },
      },
    },
    message: {
      colorScheme: {
        light: {
          success: { background: '#edf4e9', color: '#29563f', borderColor: '#cbdcc1' },
          warn: { color: '#855318', background: '#fff5e3', borderColor: '#e4ce9e' },
          error: { color: '#a12f33', background: '#fff0f0', borderColor: '#e7c4c6' },
          info: { color: '#305c8a', background: '#eff5fc', borderColor: '#c8d8eb' },
        },
      },
    },
    dialog: { root: { borderRadius: '16px' } },
  },
})
const app = createApp(App)
app.use(PrimeVue, {
  theme: { preset, options: { darkModeSelector: false, cssLayer: false } },
  ripple: false,
})
for (const [name, component] of Object.entries({
  PButton: Button,
  PInputText: InputText,
  PTextarea: Textarea,
  PSelect: Select,
  PToggleSwitch: ToggleSwitch,
  PInputNumber: InputNumber,
  PCheckbox: Checkbox,
  PRadioButton: RadioButton,
  PSlider: Slider,
  PMultiSelect: MultiSelect,
  PDialog: Dialog,
  PMessage: Message,
}))
  app.component(name, component)
app.mount('#app')
