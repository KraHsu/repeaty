/** Friendly text only. Keep the original path for native requests and identity checks. */
export function displayFilesystemPath(path: string): string {
  if (!path.startsWith('\\\\?\\')) return path
  const extended = path.slice(4)
  if (/^[a-z]:\\/i.test(extended)) return extended
  if (/^UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(extended)) return '\\\\' + extended.slice(4)
  // Volume GUIDs and device namespaces do not have an equivalent ordinary path.
  return path
}
