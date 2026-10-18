import { allowedPage, validRequest } from './protocol.js'
import { requestOnLeetCode } from './request.js'

const submitting = new Set<number>()
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !sender.url ||
    !allowedPage(sender.url) ||
    !validRequest(message)
  )
    return false
  if (message.action === 'ping') {
    respond({ ok: true, data: { version: 1 } })
    return false
  }
  const request = message
  void (async () => {
    const tabs = await chrome.tabs.query({ url: `https://${request.site}/*` })
    const tab = tabs.find((tab) => tab.id !== undefined && tab.status === 'complete')
    if (!tab?.id) return { ok: false, error: 'open-leetcode' }
    if (submitting.has(tab.id)) return { ok: false, error: 'submission-busy' }
    if (request.action === 'submit') submitting.add(tab.id)
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: requestOnLeetCode,
        args: [request],
      })
      return result[0]?.result ?? { ok: false, error: 'request-failed' }
    } finally {
      submitting.delete(tab.id)
    }
  })().then(respond, () => respond({ ok: false, error: 'request-failed' }))
  return true
})
