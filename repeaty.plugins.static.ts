import type { FrontendPluginInstallation } from './src/plugins/types'
import reviewHistory from './src/plugins/review-history'

/** Import frontend plugins here. This manifest is used by GitHub Pages. */
export default [
  { plugin: reviewHistory, builtin: true, enabledByDefault: true },
] satisfies FrontendPluginInstallation[]
