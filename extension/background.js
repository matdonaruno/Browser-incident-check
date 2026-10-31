// ログの保存。ローカル (chrome.storage.local) のみ。外部送信はしない。
const KEY = "logs";
const MAX_ENTRIES = 5000;

// 書き込みを直列化して、同時発火による read-modify-write の取りこぼしを防ぐ
let queue = Promise.resolve();

async function append(entry, sender) {
  const { [KEY]: logs = [] } = await chrome.storage.local.get(KEY);
  logs.push({
    id: crypto.randomUUID(),
    incognito: sender && sender.tab ? sender.tab.incognito === true : false,
    ...entry
  });
  if (logs.length > MAX_ENTRIES) logs.splice(0, logs.length - MAX_ENTRIES);
  await chrome.storage.local.set({ [KEY]: logs });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "log" && msg.entry && typeof msg.entry === "object") {
    queue = queue.then(() => append(msg.entry, sender)).catch((e) => console.error("audit append failed", e));
    return false;
  }
  if (msg.type === "clear") {
    queue = queue
      .then(() => chrome.storage.local.set({ [KEY]: [] }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
