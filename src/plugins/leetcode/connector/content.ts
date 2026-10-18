// Bundled separately as a classic content script. The worker validates every request again.
const pendingRequests = new Set<string>()
window.addEventListener('message', (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== 'repeaty-leetcode-request'
  )
    return
  const { id, request } = event.data
  if (
    typeof id !== 'string' ||
    id.length > 80 ||
    pendingRequests.has(id) ||
    pendingRequests.size >= 4
  )
    return
  pendingRequests.add(id)
  void chrome.runtime
    .sendMessage(request)
    .then(
      (response) =>
        window.postMessage({ channel: 'repeaty-leetcode-response', id, response }, location.origin),
      () =>
        window.postMessage(
          {
            channel: 'repeaty-leetcode-response',
            id,
            response: { ok: false, error: 'extension-unavailable' },
          },
          location.origin,
        ),
    )
    .finally(() => pendingRequests.delete(id))
})
