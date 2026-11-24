// サイドパネル: 元データ (項目→値) の取り込みと、入力欄との対応づけの確認・保存。
// 保存先は chrome.storage.local のみ (sourceData / mappings)。外部送信はしない。
const $ = (id) => document.getElementById(id);
const msg = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

// 静的な UI 文言を _locales のメッセージで置き換える (言語はブラウザの UI 言語に追随)
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const m = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
    if (m) el.textContent = m;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const m = chrome.i18n.getMessage(el.getAttribute("data-i18n-placeholder"));
    if (m) el.placeholder = m;
  });
  try {
    document.documentElement.lang = chrome.i18n.getUILanguage();
  } catch (_) {}
}
applyI18n();

let host = "";
let sourceRows = []; // [{ key, value }]
let currentFields = []; // 入力欄の記述子 (コンテンツスクリプトから取得)
let mappingDraft = {}; // fieldKey -> sourceKey

// 対象タブの特定: "tabs" 権限は使わない。現在のウィンドウのタブ (表示中→最近使った順) に
// コンテンツスクリプトへ問い合わせ、最初に応答したタブを対象とする (ホスト名は応答に含まれる)。
async function discoverTarget() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const ordered = [...tabs].sort((a, b) =>
    a.active === b.active ? (b.lastAccessed || 0) - (a.lastAccessed || 0) : a.active ? -1 : 1
  );
  for (const t of ordered) {
    try {
      const resp = await chrome.tabs.sendMessage(t.id, { type: "ia-get-fields" });
      if (resp && resp.host) return { tabId: t.id, host: resp.host, fields: resp.fields || [] };
    } catch (_) {
      // コンテンツスクリプトのないタブは読み飛ばす
    }
  }
  return null;
}

async function loadAll() {
  const target = await discoverTarget();
  host = target ? target.host : "";
  $("sp-host").textContent = host ? msg("spTarget", [host]) : msg("spNoTarget");
  const v = await chrome.storage.local.get({ sourceData: {}, mappings: {} });
  const src = (v.sourceData || {})[host];
  sourceRows = src && Array.isArray(src.rows) ? src.rows.map((r) => ({ key: r.key, value: r.value })) : [];
  renderRows();
}

// 解析本体は collate.js の AuditCollate.parseSource が担う ({ rows, skipped, overwritten } を返す)

function setImportStatus(text) {
  $("sp-status").textContent = text || "";
}

function setMapStatus(text) {
  $("sp-map-status").textContent = text || "";
}

function renderSkipped(skipped) {
  const wrap = $("sp-skipped-wrap");
  wrap.textContent = "";
  if (!skipped || !skipped.length) return;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = msg("spSkippedLines", [String(skipped.length)]);
  const pre = document.createElement("pre");
  pre.textContent = skipped.join("\n");
  details.append(summary, pre);
  wrap.appendChild(details);
}

// 取り込み結果の内訳をステータス行に出す (件数・上書き・読めなかった行・未保存の注意)
function renderImportFeedback(count, skipped, overwritten) {
  const parts = [];
  parts.push(count > 0 ? msg("spImported", [String(count)]) : msg("spImportEmpty"));
  if (overwritten > 0) parts.push(msg("spImportOverwritten", [String(overwritten)]));
  if (skipped && skipped.length) parts.push(msg("spImportSkipped", [String(skipped.length)]));
  if (!host) parts.push(msg("spImportNoHost"));
  setImportStatus(parts.join(" · "));
}

// 取り込み成功後に、対象タブが特定できれば対応づけの自動提案まで一気に進める。
// 保存済みマッピングがあればそちらを優先する (renderMapping の saved 優先は従来どおり)。
async function tryAutoMatch() {
  const target = await discoverTarget();
  if (!target) {
    setMapStatus(msg("spAutoMatchNoTarget"));
    return;
  }
  host = target.host;
  $("sp-host").textContent = msg("spTarget", [host]);
  currentFields = target.fields;
  const v = await chrome.storage.local.get({ mappings: {} });
  const auto = AuditCollate.autoMatch(currentFields, sourceRows);
  renderMapping(auto, (v.mappings || {})[host] || {});
  setMapStatus(currentFields.length ? msg("spAutoMatchDone") : "");
}

// テキストからの取り込み一式: 解析 → 保存 → 描画 → フィードバック → 対応づけ自動提案。
// 1 行も読めなかった場合は既存の元データを壊さない。
let lastImportText = null;
async function importSourceText(text) {
  lastImportText = text;
  const { rows, skipped, overwritten } = AuditCollate.parseSource(text);
  renderSkipped(skipped);
  if (!rows.length) {
    renderImportFeedback(0, skipped, overwritten);
    return;
  }
  sourceRows = rows;
  if (!host) {
    const target = await discoverTarget();
    if (target) {
      host = target.host;
      $("sp-host").textContent = msg("spTarget", [host]);
    }
  }
  await saveSource();
  renderRows();
  renderImportFeedback(rows.length, skipped, overwritten);
  if (host) await tryAutoMatch();
}

async function saveSource() {
  if (!host) return;
  const v = await chrome.storage.local.get({ sourceData: {} });
  const all = v.sourceData || {};
  all[host] = { rows: sourceRows, savedAt: new Date().toISOString() };
  await chrome.storage.local.set({ sourceData: all });
}

function renderRows() {
  const wrap = $("sp-rows-wrap");
  wrap.textContent = "";
  if (!sourceRows.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = msg("spNoSource");
    wrap.appendChild(p);
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const label of [msg("spColKey"), msg("spColValue"), ""]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.appendChild(th);
  }
  table.appendChild(head);
  sourceRows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const tdKey = document.createElement("td");
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.value = r.key;
    keyInput.addEventListener("change", () => {
      r.key = keyInput.value;
      saveSource();
    });
    tdKey.appendChild(keyInput);
    const tdVal = document.createElement("td");
    const valInput = document.createElement("input");
    valInput.type = "text";
    valInput.value = r.value;
    valInput.addEventListener("change", () => {
      r.value = valInput.value;
      saveSource();
    });
    tdVal.appendChild(valInput);
    const tdDel = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = msg("btnDelete");
    del.addEventListener("click", () => {
      sourceRows.splice(i, 1);
      saveSource();
      renderRows();
    });
    tdDel.appendChild(del);
    tr.append(tdKey, tdVal, tdDel);
    table.appendChild(tr);
  });
  wrap.appendChild(table);
}

function renderMapping(auto, saved) {
  const wrap = $("sp-map-wrap");
  wrap.textContent = "";
  mappingDraft = {};
  if (!currentFields.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = msg("spNoFields");
    wrap.appendChild(p);
    return;
  }
  const table = document.createElement("table");
  for (const f of currentFields) {
    const fk = AuditRules.fieldKeyOf(f);
    const sel = document.createElement("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = msg("spNoMapping");
    sel.appendChild(none);
    for (const r of sourceRows) {
      const o = document.createElement("option");
      o.value = r.key;
      o.textContent = r.key;
      sel.appendChild(o);
    }
    sel.value = saved[fk] || auto[fk] || "";
    mappingDraft[fk] = sel.value;
    sel.addEventListener("change", () => {
      mappingDraft[fk] = sel.value;
    });
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.className = "fname";
    td1.textContent = [f.context, f.colContext, f.label, f.name, f.id].filter(Boolean).join(" / ") || f.tag;
    const td2 = document.createElement("td");
    td2.appendChild(sel);
    tr.append(td1, td2);
    table.appendChild(tr);
  }
  wrap.appendChild(table);
}

$("sp-load").addEventListener("click", () => importSourceText($("sp-input").value));

// 貼ったら即取り込み: paste は値の反映を待ってすぐ、手入力は短いデバウンスで自動解析する
let importTimer = null;
function scheduleImport(delay) {
  clearTimeout(importTimer);
  importTimer = setTimeout(() => {
    const text = $("sp-input").value;
    if (!text.trim() || text === lastImportText) return;
    importSourceText(text);
  }, delay);
}
$("sp-input").addEventListener("paste", () => scheduleImport(50));
$("sp-input").addEventListener("input", () => scheduleImport(500));

$("sp-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  $("sp-input").value = text;
  await importSourceText(text);
  e.target.value = ""; // 同じファイルを選び直しても change が発火するように
});

$("sp-clipboard").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error("empty clipboard");
    $("sp-input").value = text;
    await importSourceText(text);
  } catch (_) {
    // 読めない環境 (権限・フォーカス等) では、手で貼ってもらう導線に倒す
    $("sp-input").focus();
    setImportStatus(msg("spClipboardFail"));
  }
});

$("sp-clear").addEventListener("click", async () => {
  const v = await chrome.storage.local.get({ sourceData: {}, mappings: {} });
  const sd = v.sourceData || {};
  const mp = v.mappings || {};
  delete sd[host];
  delete mp[host];
  await chrome.storage.local.set({ sourceData: sd, mappings: mp });
  sourceRows = [];
  renderRows();
  $("sp-map-wrap").textContent = "";
  setImportStatus("");
  renderSkipped([]);
  setMapStatus("");
});

$("sp-match").addEventListener("click", async () => {
  const target = await discoverTarget();
  if (!target) {
    currentFields = [];
    renderMapping({}, {});
    return;
  }
  host = target.host;
  $("sp-host").textContent = msg("spTarget", [host]);
  const v = await chrome.storage.local.get({ sourceData: {}, mappings: {} });
  const src = (v.sourceData || {})[host];
  sourceRows = src && Array.isArray(src.rows) ? src.rows.map((r) => ({ key: r.key, value: r.value })) : [];
  renderRows();
  currentFields = target.fields;
  const auto = AuditCollate.autoMatch(currentFields, sourceRows);
  renderMapping(auto, (v.mappings || {})[host] || {});
});

$("sp-save-mapping").addEventListener("click", async () => {
  if (!host) return;
  const v = await chrome.storage.local.get({ mappings: {} });
  const all = v.mappings || {};
  const m = {};
  for (const [k, val] of Object.entries(mappingDraft)) if (val) m[k] = val;
  all[host] = m;
  await chrome.storage.local.set({ mappings: all });
});

loadAll();
