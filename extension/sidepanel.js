// サイドパネル: 元データ (項目→値) の取り込みと、入力欄との対応づけの確認・保存。
// 保存先は chrome.storage.local のみ (sourceData / mappings)。外部送信はしない。
const $ = (id) => document.getElementById(id);
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
  $("sp-host").textContent = host ? `対象: ${host}` : "対象タブがありません";
  const v = await chrome.storage.local.get({ sourceData: {}, mappings: {} });
  const src = (v.sourceData || {})[host];
  sourceRows = src && Array.isArray(src.rows) ? src.rows.map((r) => ({ key: r.key, value: r.value })) : [];
  renderRows();
}

// 「項目名… 値」のテキストを {key, value} の列にする。各行の最後のトークンを値、それ以外をキーとする
function parseSource(text) {
  const out = [];
  const pos = new Map();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = (line.includes("\t") ? line.split("\t") : line.includes(",") ? line.split(",") : line.split(/\s+/))
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;
    const value = parts[parts.length - 1];
    const key = parts.slice(0, -1).join(" ");
    if (pos.has(key)) out[pos.get(key)] = { key, value };
    else {
      pos.set(key, out.length);
      out.push({ key, value });
    }
  }
  return out;
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
    p.textContent = "元データはまだ取り込まれていません。";
    wrap.appendChild(p);
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const label of ["項目キー", "値", ""]) {
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
    del.textContent = "削除";
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
    p.textContent = "入力欄を取得できませんでした。対象タブで入力画面を開いてから押してください。";
    wrap.appendChild(p);
    return;
  }
  const table = document.createElement("table");
  for (const f of currentFields) {
    const fk = AuditRules.fieldKeyOf(f);
    const sel = document.createElement("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "（対応なし）";
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

$("sp-load").addEventListener("click", async () => {
  sourceRows = parseSource($("sp-input").value);
  await saveSource();
  renderRows();
});

$("sp-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  $("sp-input").value = await file.text();
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
});

$("sp-match").addEventListener("click", async () => {
  const target = await discoverTarget();
  if (!target) {
    currentFields = [];
    renderMapping({}, {});
    return;
  }
  host = target.host;
  $("sp-host").textContent = `対象: ${host}`;
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
