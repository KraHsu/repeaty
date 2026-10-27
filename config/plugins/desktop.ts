import type { PluginInstallation } from '../../src/plugins/types'
import frontendPlugins from './static'
import leetcode from '../../src/plugins/leetcode'

/** Add trusted local or npm plugin modules here, then rebuild and deploy Repeaty. */
export default [
  ...frontendPlugins,
  { plugin: leetcode, builtin: true, enabledByDefault: true },
] satisfies PluginInstallation[]
