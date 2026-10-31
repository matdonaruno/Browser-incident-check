const $ = (id) => document.getElementById(id);
let logs = [];

function matches(entry, filter) {
  if (filter === "flagged") return (entry.detected && entry.detected.length > 0) || (entry.form && (entry.form.crossOrigin || entry.form.insecure));
  if (filter === "submit" || filter === "paste") return entry.kind === filter;
  return true;
}

function render() {
  const filter = $("filter").value;
  const rows = logs.filter((e) => matches(e, filter)).reverse();
  $("count").textContent = `${rows.length} / ${logs.length} 件`;
  const ul = $("list");
  ul.textContent = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "ログはありません";
    ul.appendChild(li);
    return;
  }
  for (const e of rows.slice(0, 300)) {
    const li = document.createElement("li");
    const flagged = e.detected && e.detected.length > 0;
    if (flagged) li.className = "flagged";

    const r1 = document.createElement("div");
    r1.className = "row1";
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = e.kind;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(e.ts).toLocaleString();
    r1.append(kind, time);
    if (flagged) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = e.detected.join(", ");
      r1.appendChild(tag);
    }

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = e.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    const f = e.field || {};
    const parts = [f.tag + (f.type ? `[${f.type}]` : ""), f.name || f.id, f.label].filter(Boolean);
    if (e.length != null) parts.push(`${e.length}文字`);
    if (e.form) {
      parts.push(`→ ${e.form.actionOrigin}`);
      if (e.form.crossOrigin) parts.push("別オリジン送信");
      if (e.form.insecure) parts.push("非HTTPS");
    }
    meta.textContent = parts.join(" · ");

    li.append(r1, url, meta);

    if (e.value !== undefined) {
      const v = document.createElement("div");
      if (e.prev != null && e.prev !== e.value) {
        const p = document.createElement("span");
        p.className = "val prev";
        p.textContent = e.prev;
        v.append(p, " → ");
      }
      const cur = document.createElement("span");
      cur.className = "val";
      cur.textContent = e.value === "" ? "(空)" : e.value;
      v.appendChild(cur);
      li.appendChild(v);
    }

    if (e.snapshot) {
      const d = document.createElement("details");
      d.className = "snap";
      const sm = document.createElement("summary");
      sm.textContent = `送信時の入力一式 (${e.snapshot.length}欄)`;
      const tbl = document.createElement("table");
      tbl.className = "snap";
      for (const r of e.snapshot) {
        const tr = document.createElement("tr");
        const f = r.field || {};
        const k = document.createElement("td");
        k.textContent = f.context || f.label || f.name || f.id || f.tag;
        const val = document.createElement("td");
        val.className = "val";
        val.textContent = r.checked === undefined ? r.value : r.checked ? `☑ ${r.value}` : "☐";
        tr.append(k, val);
        tbl.appendChild(tr);
      }
      d.append(sm, tbl);
      li.appendChild(d);
    }

    ul.appendChild(li);
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 表計算ソフトでの式実行を防ぐ
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const head = ["ts", "kind", "url", "tag", "type", "name", "id", "label", "context", "length", "value", "prev", "detected", "actionOrigin", "crossOrigin", "incognito"];
  const lines = [head.join(",")];
  const line = (ts, kind, url, f, e, value) =>
    [ts, kind, url, f.tag, f.type, f.name, f.id, f.label, f.context, e.length, value, e.prev, (e.detected || []).join("|"), e.form && e.form.actionOrigin, e.form && e.form.crossOrigin, e.incognito]
      .map(csvCell)
      .join(",");
  for (const e of rows) {
    lines.push(line(e.ts, e.kind, e.url, e.field || {}, e, e.value));
    // スナップショットは欄ごとに 1 行へ展開し、表計算で突き合わせやすくする
    for (const r of e.snapshot || []) lines.push(line(e.ts, `${e.kind}:snapshot`, e.url, r.field || {}, {}, r.checked === undefined ? r.value : r.checked ? r.value : ""));
  }
  return lines.join("\n");
}

let hosts = [];

function renderHosts() {
  $("host-count").textContent = `(${hosts.length})`;
  const ul = $("host-list");
  ul.textContent = "";
  for (const h of hosts) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = h;
    const rm = document.createElement("button");
    rm.textContent = "削除";
    rm.addEventListener("click", () => saveHosts(hosts.filter((x) => x !== h)));
    li.append(name, rm);
    ul.appendChild(li);
  }
}

function saveHosts(next) {
  hosts = next;
  chrome.storage.local.set({ valueHosts: next });
  renderHosts();
}

function addHost(raw) {
  const h = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && h !== "localhost") return alert("ホスト名の形式で入力してください (例: example.jp)");
  if (!hosts.includes(h)) saveHosts([...hosts, h]);
  $("host-input").value = "";
}

$("host-add").addEventListener("click", () => addHost($("host-input").value));
$("host-current").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) addHost(new URL(tab.url).hostname);
});

async function load() {
  const v = await chrome.storage.local.get({ logs: [], enabled: true, valueHosts: [] });
  logs = v.logs;
  hosts = v.valueHosts;
  $("enabled").checked = v.enabled !== false;
  renderHosts();
  render();
}

$("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$("filter").addEventListener("change", render);
$("export-json").addEventListener("click", () => download("input-audit.json", JSON.stringify(logs, null, 2), "application/json"));
$("export-csv").addEventListener("click", () => download("input-audit.csv", toCsv(logs), "text/csv"));
$("clear").addEventListener("click", () => {
  if (!confirm(`${logs.length} 件のログをすべて削除します。元に戻せません。`)) return;
  chrome.runtime.sendMessage({ type: "clear" }, () => load());
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.logs) {
    logs = c.logs.newValue || [];
    render();
  }
});

load();
