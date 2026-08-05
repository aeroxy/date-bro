import { sendQwenChat } from '@/lib/qwen/qwen-service'

console.log(`[Date Bro] service worker init — v${__VERSION__}, built ${__BUILD_TIME__}`)

const APP_PATH = 'app.html'

/** In-flight Qwen calls, so the app page can cancel one it started. */
const qwenInFlight = new Map<string, AbortController>()

/**
 * Qwen's API only accepts requests that look like they came from its own web
 * app, so rewrite Origin/Referer on our calls to it. Session rules, so nothing
 * persists past the browser session.
 */
function registerQwenRules() {
  if (!chrome.declarativeNetRequest) {
    console.error('[Date Bro] declarativeNetRequest unavailable — the Qwen backend will fail')
    return
  }
  chrome.declarativeNetRequest
    .updateSessionRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: 'origin',
                operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
                value: 'https://chat.qwen.ai',
              },
              {
                header: 'referer',
                operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
                value: 'https://chat.qwen.ai/',
              },
            ],
          },
          condition: {
            urlFilter: 'https://chat.qwen.ai/api/*',
            resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
            initiatorDomains: [chrome.runtime.id],
          },
        },
      ],
    })
    .catch((e) => console.error('[Date Bro] Failed to register Qwen header rules:', e))
}

/** One app tab, reused. Date Bro is a full-page app, not a popup. */
async function openApp() {
  const url = chrome.runtime.getURL(APP_PATH)
  const existing = await chrome.tabs.query({ url })
  const tab = existing[0]
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url })
}

export default defineBackground(() => {
  registerQwenRules()

  chrome.action.onClicked.addListener(() => {
    openApp().catch((e) => console.error('[Date Bro] Failed to open the app tab:', e))
  })

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      openApp().catch(() => {})
    }
  })

  chrome.runtime.onMessage.addListener((message: { type?: string } & Record<string, unknown>, _sender, sendResponse) => {
    switch (message?.type) {
      // The app page delegates Qwen calls here: the worker is the one context
      // with a keep-alive during a long stream, and it owns the cookie jar.
      case 'QWEN_CHAT_REQUEST': {
        const requestId = message.requestId as string | undefined
        const controller = new AbortController()
        if (requestId) qwenInFlight.set(requestId, controller)
        sendQwenChat(
          message.messages as Parameters<typeof sendQwenChat>[0],
          controller.signal,
          message.qwenModel as Parameters<typeof sendQwenChat>[2],
          // sendResponse fires once, at the end — reasoning has to reach the
          // app page as its own broadcast. No receiver (tab closed) is fine.
          requestId
            ? (thinking) => {
                chrome.runtime
                  .sendMessage({ type: 'QWEN_CHAT_THINKING', requestId, thinking })
                  .catch(() => {})
              }
            : undefined,
        )
          .then((result) => {
            if (requestId) qwenInFlight.delete(requestId)
            sendResponse({ ok: true, result })
          })
          .catch((e: Error) => {
            if (requestId) qwenInFlight.delete(requestId)
            sendResponse({ ok: false, error: e.message, isAbort: e.name === 'AbortError' })
          })
        return true
      }

      case 'QWEN_CHAT_CANCEL': {
        const requestId = message.requestId as string | undefined
        if (requestId) {
          qwenInFlight.get(requestId)?.abort()
          qwenInFlight.delete(requestId)
        }
        sendResponse({ ok: true })
        return false
      }

      default:
        return false
    }
  })
})
