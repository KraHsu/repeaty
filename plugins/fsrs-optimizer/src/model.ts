import { study, readSetting, writeSetting } from '@repeaty/plugin-api'
import { createOptimizer } from './controller'
import { runTraining } from './runner'

// The plugin loader gives each activation its own bundled module instance.
export const optimizer = createOptimizer(study, runTraining, {
  read: readSetting,
  write: writeSetting,
})
