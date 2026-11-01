// ログの保存。ローカル (chrome.storage.local) のみ。外部送信はしない。
const KEY = "logs";
const MAX_ENTRIES = 5000;
// chrome.storage.local の既定上限は約 10MB。余裕を残して、超えたら古い順に捨てる
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 200 * 1024;

// 書き込みを直列化して、同時発火による read-modify-write の取りこぼしを防ぐ
let queue = Promise.resolve();

function size(x) {
  return JSON.stringify(x).length;
}

function trimToBudget(logs) {
  if (logs.length > MAX_ENTRIES) logs.splice(0, logs.length - MAX_ENTRIES);
  let total = size(logs);
  let drop = 0;
  while (total > MAX_BYTES && drop < logs.length - 1) {
    total -= size(logs[drop]) + 1;
    drop++;
  }
  if (drop) logs.splice(0, drop);
}

async function append(entry, sender) {
  // id / incognito は拡張側が決める。entry に同名キーがあっても上書きさせない
  const rec = {
    ...entry,
    id: crypto.randomUUID(),
    incognito: sender && sender.tab ? sender.tab.incognito === true : false
  };
  if (size(rec) > MAX_ENTRY_BYTES) {
    delete rec.snapshot;
    delete rec.value;
    delete rec.prev;
    rec.truncated = true;
  }
  const { [KEY]: stored = [] } = await chrome.storage.local.get(KEY);
  const logs = Array.isArray(stored) ? stored : [];
  logs.push(rec);
  trimToBudget(logs);
  // 容量超過などで失敗したら、古い半分を捨てて再試行する (黙って記録が止まるのを防ぐ)
  for (let attempt = 0; ; attempt++) {
    try {
      await chrome.storage.local.set({ [KEY]: logs });
      return;
    } catch (e) {
      if (attempt >= 3 || logs.length <= 1) throw e;
      logs.splice(0, Math.ceil(logs.length / 2));
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "log" && msg.entry && typeof msg.entry === "object" && !Array.isArray(msg.entry)) {
    queue = queue.then(() => append(msg.entry, sender)).catch((e) => console.error("audit append failed", e));
    return false;
  }
  // 全削除は拡張自身のページ (ポップアップ) からだけ。コンテンツスクリプト (sender.tab あり) は受け付けない
  if (msg.type === "clear" && !sender.tab) {
    queue = queue
      .then(() => chrome.storage.local.set({ [KEY]: [] }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
