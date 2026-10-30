const retiredPublishingPlugins = new Set([
  'static-publish',
  'wordpress-publish',
  'discourse-publish',
])

/** Stop old installed packages before evaluation; their saved data remains owned by the library. */
export function assertPluginSupported(id: string): void {
  if (retiredPublishingPlugins.has(id))
    throw new Error('网站发布功能已移除。已有插件数据会保留，可在插件页卸载。')
}
