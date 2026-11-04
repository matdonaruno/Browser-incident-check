// 入力・貼り付け・送信を捕捉して background へ送る。
// 既定はメタデータのみ (文字数と機密種別ラベル)。
// 「値を記録するサイト」の許可リストに入れたホストでだけ、入力値・修正履歴・送信時スナップショットも残す。
// パスワード欄は許可リストに関係なく常に値を扱わない。
(function () {
  const DEBOUNCE_MS = 800;
  // ページ側が巨大な値を入れてもログを膨らませないための上限
  const VALUE_MAX = 2000;
  const SNAPSHOT_MAX_ROWS = 300;
  const timers = new WeakMap();
  const lastValue = new WeakMap();
  // L1 検査用に、このページでの直近の貼り付けを覚えておく (許可サイトでのみ値を持つ)
  const recentPastes = [];
  let enabled = true;
  let valueHosts = [];
  let gateEnabled = true;

  try {
    chrome.storage.local.get({ enabled: true, valueHosts: [], gateEnabled: true }, (v) => {
      enabled = v.enabled !== false;
      valueHosts = v.valueHosts || [];
      gateEnabled = v.gateEnabled !== false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.enabled) enabled = changes.enabled.newValue !== false;
      if (changes.valueHosts) valueHosts = changes.valueHosts.newValue || [];
      if (changes.gateEnabled) gateEnabled = changes.gateEnabled.newValue !== false;
    });
  } catch (_) {
    enabled = false;
  }

  // 許可リストに入れたサイトだけ、入力値そのものを記録する
  function recordValues() {
    const h = location.hostname;
    return valueHosts.some((d) => h === d || h.endsWith("." + d));
  }

  function pageUrl() {
    // クエリ・ハッシュにはトークンが載りうるので落とす
    return location.origin + location.pathname;
  }

  function isTextTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      return !["button", "submit", "reset", "image", "checkbox", "radio", "file", "range", "color", "hidden"].includes(t);
    }
    return el.isContentEditable === true;
  }

  function isPassword(el) {
    return el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
  }

  function readValue(el) {
    if (isPassword(el)) return null;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return el.value;
    return el.innerText || "";
  }

  function clip(s, n) {
    return typeof s === "string" ? s.trim().slice(0, n) : "";
  }

  function cap(s) {
    return typeof s === "string" ? s.slice(0, VALUE_MAX) : s;
  }

  function describe(el) {
    let label = "";
    try {
      label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
    } catch (_) {}
    return {
      tag: el.tagName.toLowerCase(),
      type: el.tagName === "INPUT" ? (el.type || "text").toLowerCase() : el.isContentEditable ? "contenteditable" : "",
      name: clip(el.getAttribute("name"), 60),
      id: clip(el.id, 60),
      autocomplete: clip(el.getAttribute("autocomplete"), 40),
      label: clip(label || el.getAttribute("aria-label") || el.getAttribute("placeholder"), 60)
    };
  }

  function send(entry) {
    if (!enabled) return;
    entry.ts = new Date().toISOString();
    entry.url = pageUrl();
    entry.topFrame = window === window.top;
    try {
      chrome.runtime.sendMessage({ type: "log", entry }, () => void chrome.runtime.lastError);
    } catch (_) {
      // 拡張が更新/無効化された直後のコンテキスト切れは無視
    }
  }

  function targetOf(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    return path[0] && path[0].nodeType === 1 ? path[0] : e.target;
  }

  // 表形式のフォームでは項目名が <td>/<th> にあることが多いので、同じ行の文字を補助情報にする
  function rowContext(el) {
    const row = el.closest && el.closest("tr");
    return row ? clip((row.innerText || "").replace(/\s+/g, " "), 80) : "";
  }

  // 表の中の欄は、その列の見出し (thead の th、なければ最初の th 行) も補助情報にする (L2 の対応づけ用)
  function colContext(el) {
    try {
      const cell = el.closest && el.closest("td,th");
      const table = el.closest && el.closest("table");
      if (!cell || !table || typeof cell.cellIndex !== "number" || cell.cellIndex < 0) return "";
      let headerRow = null;
      if (table.tHead && table.tHead.rows.length) headerRow = table.tHead.rows[0];
      if (!headerRow) {
        for (const tr of table.rows) {
          if (tr.querySelector("th")) {
            headerRow = tr;
            break;
          }
        }
      }
      if (!headerRow || !headerRow.cells[cell.cellIndex]) return "";
      return clip((headerRow.cells[cell.cellIndex].innerText || "").replace(/\s+/g, " "), 80);
    } catch (_) {
      return "";
    }
  }

  function storageGet(defaults) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(defaults, (v) => resolve(v || {}));
      } catch (_) {
        resolve({});
      }
    });
  }

  function logField(kind, el) {
    const value = readValue(el);
    const entry = {
      kind,
      field: describe(el),
      length: value === null ? null : value.length,
      detected: value === null ? [] : AuditDetect.detectKinds(value)
    };
    if (value !== null && recordValues()) {
      entry.value = cap(value);
      entry.prev = lastValue.has(el) ? cap(lastValue.get(el)) : null;
      entry.field.context = rowContext(el);
      lastValue.set(el, value);
    }
    send(entry);
  }

  // フォーム (または画面全体) の入力欄の値を一式取る。パスワード欄は常に除外
  function snapshotOf(root) {
    const els = root && root.elements ? Array.from(root.elements) : Array.from(document.querySelectorAll("input,textarea,select"));
    const rows = [];
    for (const el of els) {
      if (rows.length >= SNAPSHOT_MAX_ROWS) break;
      if (isPassword(el)) continue;
      const type = el.tagName === "INPUT" ? (el.type || "text").toLowerCase() : "";
      if (["button", "submit", "reset", "image", "file", "hidden"].includes(type)) continue;
      if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && el.tagName !== "SELECT") continue;
      const checkable = type === "checkbox" || type === "radio";
      rows.push({
        field: { ...describe(el), context: rowContext(el), colContext: colContext(el) },
        value: cap(checkable ? (el.checked ? el.value : "") : el.value),
        checked: checkable ? el.checked : undefined
      });
    }
    return rows;
  }

  document.addEventListener(
    "input",
    (e) => {
      if (!e.isTrusted || !enabled) return;
      const el = targetOf(e);
      if (!isTextTarget(el)) return;
      clearTimeout(timers.get(el));
      timers.set(
        el,
        setTimeout(() => logField("input", el), DEBOUNCE_MS)
      );
    },
    true
  );

  document.addEventListener(
    "paste",
    (e) => {
      if (!e.isTrusted || !enabled) return;
      const el = targetOf(e);
      if (!isTextTarget(el)) return;
      const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      const entry = {
        kind: "paste",
        field: describe(el),
        length: isPassword(el) ? null : text.length,
        detected: isPassword(el) ? [] : AuditDetect.detectKinds(text)
      };
      if (!isPassword(el) && recordValues()) {
        entry.value = cap(text);
        entry.field.context = rowContext(el);
        entry.prev = cap(readValue(el) || "");
        recentPastes.push({
          fieldKey: AuditRules.fieldKeyOf(entry.field),
          text: cap(text),
          prevValue: cap(readValue(el) || "")
        });
        if (recentPastes.length > 100) recentPastes.shift();
      }
      send(entry);
    },
    true
  );

  // select / checkbox / radio は input イベントが来ない・来ても debounce 対象外なので change で拾う
  document.addEventListener(
    "change",
    (e) => {
      if (!e.isTrusted || !enabled || !recordValues()) return;
      const el = targetOf(e);
      if (!el || el.nodeType !== 1 || isPassword(el)) return;
      const type = el.tagName === "INPUT" ? (el.type || "text").toLowerCase() : "";
      if (el.tagName === "SELECT") return logField("change", el);
      if (type !== "checkbox" && type !== "radio") return;
      send({
        kind: "change",
        field: { ...describe(el), context: rowContext(el) },
        length: null,
        detected: [],
        value: cap(el.checked ? el.value : ""),
        checked: el.checked
      });
    },
    true
  );

  // JS で送信するサイトは submit イベントが出ないので、送信ボタンのクリック時点でも一式を取る
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted || !enabled || !recordValues()) return;
      const el = targetOf(e);
      const btn = el && el.closest ? el.closest("button, input[type=submit], input[type=button]") : null;
      if (!btn) return;
      if (btn.closest && btn.closest("#ia-gate-root")) return; // ゲート自身のボタンは記録しない
      send({
        kind: "click",
        field: { tag: btn.tagName.toLowerCase(), type: (btn.type || "").toLowerCase(), name: clip(btn.getAttribute("name"), 60), id: clip(btn.id, 60), autocomplete: "", label: clip(btn.value || btn.innerText, 60) },
        length: null,
        detected: [],
        snapshot: snapshotOf(btn.form)
      });
    },
    true
  );

  document.addEventListener(
    "submit",
    (e) => {
      if (!e.isTrusted || !enabled) return;
      const form = e.target;
      if (!form || form.tagName !== "FORM") return;
      let actionOrigin = "";
      try {
        actionOrigin = new URL(form.action || location.href, location.href).origin;
      } catch (_) {}
      const kinds = new Set();
      let fieldCount = 0;
      let hasPassword = false;
      for (const el of form.elements) {
        if (!isTextTarget(el)) continue;
        fieldCount++;
        if (isPassword(el)) {
          hasPassword = true;
          continue;
        }
        for (const k of AuditDetect.detectKinds(readValue(el))) kinds.add(k);
      }
      const entry = {
        kind: "submit",
        field: { tag: "form", type: "", name: clip(form.getAttribute("name"), 60), id: clip(form.id, 60), autocomplete: "", label: "" },
        length: null,
        detected: Array.from(kinds),
        form: {
          actionOrigin,
          crossOrigin: actionOrigin !== location.origin,
          insecure: actionOrigin.startsWith("http:"),
          fieldCount,
          hasPassword
        }
      };
      if (recordValues()) entry.snapshot = snapshotOf(form);
      send(entry);
    },
    true
  );

  // サイドパネルからの問い合わせ: 現在の入力欄の記述子だけを返す (値は含めない)
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "ia-get-fields") {
        sendResponse({ host: location.hostname, fields: snapshotOf(document).map((r) => r.field) });
      }
      return false;
    });
  } catch (_) {}

  // ===== 送信前ゲート (設計書 §5 / ロードマップ step 2-3) =====
  // 値を記録するサイトでだけ、送信の直前に入力一式を並べて表示し、人が確認するまで送信させない。
  // L1 ルール検査 (rules.js) の警告もここに表示し、警告がある場合は全件確認のチェックが入るまで送信させない。
  // 警告は異常の兆候の提示であり、値の正しさは判定しない。表示・確認・キャンセルの事実を kind:"gate" でログに残す。
  let gateOpen = false;
  let bypassUntil = 0;
  const SEND_RE = /(送信|確定|登録する|注文|購入手続き|申し込む|send|submit)/i;
  const NOT_SEND_RE = /(確認へ|確認画面|一時保存|下書き|戻る|キャンセル|閉じる|修正)/;

  function inGate(el) {
    return !!(el && el.closest && el.closest("#ia-gate-root"));
  }

  function gateApplies() {
    return enabled && gateEnabled && recordValues() && !gateOpen && Date.now() > bypassUntil;
  }

  function gateLog(phase, trigger, rows, warnings, collation) {
    const gate = {
      phase,
      trigger,
      fieldCount: rows.length,
      emptyCount: rows.filter((r) => r.value === "").length,
      warningCount: warnings ? warnings.length : 0,
      warningCodes: warnings ? warnings.map((w) => w.code) : []
    };
    if (collation && collation.summary) {
      const s = collation.summary;
      gate.collation = { covered: s.covered, matched: s.matched, mismatched: s.mismatched, swaps: s.swaps };
    }
    send({
      kind: "gate",
      field: { tag: "gate", type: "", name: "", id: "", autocomplete: "", label: "" },
      length: null,
      detected: [],
      gate
    });
  }

  // L2: 保存済みの元データがあれば、スナップショットと照合する (許可サイトのみ)
  async function loadCollation(rows) {
    if (!recordValues() || typeof AuditCollate === "undefined") return null;
    try {
      const host = location.hostname;
      const v = await storageGet({ sourceData: {}, mappings: {} });
      const src = (v.sourceData || {})[host];
      if (!src || !Array.isArray(src.rows) || !src.rows.length) return null;
      const sourceMap = {};
      for (const r of src.rows) sourceMap[r.key] = r.value;
      const fields = rows.map((r) => r.field);
      const saved = (v.mappings || {})[host];
      let result = null;
      if (saved && Object.keys(saved).length) result = AuditCollate.collate(rows, sourceMap, saved);
      if (!result || result.summary.covered === 0) {
        // 保存済み対応づけで1欄も対応できない場合は、自動提案に切り替える
        const auto = AuditCollate.collate(rows, sourceMap, AuditCollate.autoMatch(fields, src.rows));
        if (!result || auto.summary.covered > result.summary.covered) result = auto;
      }
      return result;
    } catch (_) {
      return null;
    }
  }

  // 不一致の表示: 最初に違う位置から後ろを太字+色でハイライトする (DOM ノードで組み立てる)
  function diffSpan(doc, text, diffIndex) {
    const span = doc.createElement("span");
    if (diffIndex == null || diffIndex < 0 || diffIndex >= text.length) {
      span.textContent = text;
      return span;
    }
    span.append(doc.createTextNode(text.slice(0, diffIndex)));
    const strong = doc.createElement("strong");
    strong.className = "ia-diff";
    strong.textContent = text.slice(diffIndex);
    strong.style.cssText = "color:#b3261e;background:#ffe1de;";
    span.appendChild(strong);
    return span;
  }

  function showGate({ rows, trigger, resume, collation }) {
    gateOpen = true;
    const warnings = AuditRules.evaluate(rows, recentPastes);
    gateLog("shown", trigger, rows, warnings, collation);
    const doc = document;
    const root = doc.createElement("div");
    root.id = "ia-gate-root";
    root.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(15,25,35,.58);overflow:auto;padding:28px 16px;font-family:sans-serif;";
    const panel = doc.createElement("div");
    panel.style.cssText =
      "background:#fff;color:#1c2733;max-width:880px;margin:0 auto;border-radius:10px;padding:20px 24px;font-size:14px;line-height:1.5;box-shadow:0 8px 40px rgba(0,0,0,.4);";
    const title = doc.createElement("h2");
    title.textContent = "送信前確認 ― 入力監査ログ";
    title.style.cssText = "font-size:19px;margin:0 0 6px;";
    const note = doc.createElement("p");
    note.textContent = "送信される入力内容の一覧です。中身を確認してから送信してください。（警告は異常の兆候の提示で、値の正しさの判定ではありません。最終判断は人です）";
    note.style.cssText = "margin:0 0 4px;color:#45525e;";
    const stats = doc.createElement("p");
    const empty = rows.filter((r) => r.value === "").length;
    stats.textContent = `${rows.length} 欄の入力があります（未入力 ${empty} 欄）。`;
    stats.style.cssText = "margin:0 0 12px;font-weight:bold;";
    const warnedRows = new Set(warnings.map((w) => w.fieldIndex));
    let warnBox = null;
    if (warnings.length) {
      const wbox = doc.createElement("div");
      wbox.style.cssText = "background:#fff7e0;border:1px solid #d9a514;border-radius:6px;padding:10px 14px;margin:0 0 12px;";
      const wh = doc.createElement("p");
      wh.textContent = `⚠ 警告 ${warnings.length} 件（L1 ルール検査）`;
      wh.style.cssText = "margin:0 0 6px;font-weight:bold;color:#7a5b00;";
      wbox.appendChild(wh);
      const ul = doc.createElement("ul");
      ul.style.cssText = "margin:0;padding-left:20px;";
      for (const w of warnings) {
        const li = doc.createElement("li");
        li.textContent = `${w.label} ― ${w.message}`;
        ul.appendChild(li);
      }
      wbox.appendChild(ul);
      warnBox = wbox;
    }
    // L2 照合セクション
    const collIssues = collation ? collation.results.filter((r) => r.status === "mismatch" || r.status === "transposition" || r.status === "swap") : [];
    let collBox = null;
    if (collation && collation.summary) {
      const s = collation.summary;
      const cbox = doc.createElement("div");
      cbox.id = "ia-collation";
      cbox.style.cssText = "background:#eef6fd;border:1px solid #5b8db8;border-radius:6px;padding:10px 14px;margin:0 0 12px;";
      const ch = doc.createElement("p");
      ch.textContent = "元データ照合（L2）";
      ch.style.cssText = "margin:0 0 6px;font-weight:bold;color:#14507e;";
      const cs = doc.createElement("p");
      cs.textContent = `対応 ${s.covered}/${s.total} 欄（カバー率 ${Math.round(s.coverage * 100)}%）・一致 ${s.matched}・不一致 ${s.mismatched}・入れ違い疑い ${s.swaps}`;
      cs.style.cssText = "margin:0 0 6px;";
      cbox.append(ch, cs);
      if (collIssues.length) {
        const ul = doc.createElement("ul");
        ul.style.cssText = "margin:0;padding-left:20px;";
        for (const r of collIssues) {
          const li = doc.createElement("li");
          const statusWord = r.status === "swap" ? "入れ違い疑い" : r.status === "transposition" ? "桁の転置疑い" : "不一致";
          li.append(doc.createTextNode(`${r.label} ― ${statusWord}：入力 `));
          li.appendChild(diffSpan(doc, r.enteredText || "", r.firstDiffIndex));
          li.append(doc.createTextNode(` ／ 元データ ${r.sourceText || ""}`));
          if (r.status === "swap" && r.swapKey) li.append(doc.createTextNode(`（「${r.swapKey}」の元データ値と一致）`));
          ul.appendChild(li);
        }
        cbox.appendChild(ul);
      }
      collBox = cbox;
    }
    // 警告 or 照合の不一致類があれば、全件確認チェックを済ませるまで送信させない
    const needAck = warnings.length > 0 || collIssues.length > 0;
    let ack = null;
    let ackBox = null;
    if (needAck) {
      ackBox = doc.createElement("div");
      ackBox.style.cssText = "margin:0 0 12px;font-weight:bold;";
      const ackLabel = doc.createElement("label");
      ack = doc.createElement("input");
      ack.type = "checkbox";
      ack.id = "ia-gate-ack";
      ackLabel.append(ack, doc.createTextNode(" 警告・照合結果をすべて確認しました"));
      ackBox.appendChild(ackLabel);
    }
    const table = doc.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%;margin-bottom:16px;";
    for (const r of rows) {
      const tr = doc.createElement("tr");
      const k = doc.createElement("td");
      const f = r.field || {};
      k.textContent = f.context || f.label || f.name || f.id || f.tag;
      k.style.cssText = "border:1px solid #c3ced8;padding:5px 9px;background:#eef4fa;width:46%;word-break:break-all;";
      const v = doc.createElement("td");
      v.textContent = r.checked === undefined ? (r.value === "" ? "（未入力）" : r.value) : r.checked ? `☑ ${r.value}` : "☐";
      v.style.cssText = "border:1px solid #c3ced8;padding:5px 9px;word-break:break-all;";
      if (warnedRows.has(rows.indexOf(r))) tr.style.cssText = "background:#fff7e0;";
      if (collIssues.some((x) => x.fieldIndex === rows.indexOf(r))) tr.style.cssText = "background:#fdecea;";
      tr.append(k, v);
      table.appendChild(tr);
    }
    const bar = doc.createElement("div");
    bar.style.cssText = "display:flex;gap:12px;justify-content:flex-end;";
    const cancelBtn = doc.createElement("button");
    cancelBtn.textContent = "戻って修正する";
    cancelBtn.style.cssText = "padding:10px 18px;font-size:14px;border:1px solid #8a99a8;border-radius:6px;background:#fff;cursor:pointer;";
    const confirmBtn = doc.createElement("button");
    confirmBtn.textContent = "確認して送信する";
    confirmBtn.style.cssText = "padding:10px 18px;font-size:14px;border:0;border-radius:6px;background:#14507e;color:#fff;font-weight:bold;cursor:pointer;";
    bar.append(cancelBtn, confirmBtn);
    if (needAck) {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = ".45";
      confirmBtn.style.cursor = "not-allowed";
      ack.addEventListener("change", () => {
        confirmBtn.disabled = !ack.checked;
        confirmBtn.style.opacity = ack.checked ? "1" : ".45";
        confirmBtn.style.cursor = ack.checked ? "pointer" : "not-allowed";
      });
    }
    panel.append(title, note, stats);
    if (warnBox) panel.appendChild(warnBox);
    if (collBox) panel.appendChild(collBox);
    if (ackBox) panel.appendChild(ackBox);
    panel.append(table, bar);
    root.appendChild(panel);

    function close(phase) {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      gateOpen = false;
      gateLog(phase, trigger, rows, warnings, collation);
      if (phase === "confirmed") {
        bypassUntil = Date.now() + 3000;
        resume();
      }
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close("cancelled");
      }
    }
    document.addEventListener("keydown", onKey, true);
    cancelBtn.addEventListener("click", () => close("cancelled"));
    confirmBtn.addEventListener("click", () => close("confirmed"));
    (document.body || document.documentElement).appendChild(root);
    confirmBtn.focus();
  }

  // 照合データの読み込みを待ってからゲートを開く
  function openGate(args) {
    loadCollation(args.rows)
      .then((collation) => showGate({ ...args, collation }))
      .catch(() => showGate({ ...args, collation: null }));
  }

  // フォーム送信は submit イベントでゲートする
  document.addEventListener(
    "submit",
    (e) => {
      if (!e.isTrusted || !gateApplies()) return;
      const form = e.target;
      if (!form || form.tagName !== "FORM") return;
      e.preventDefault();
      e.stopPropagation();
      const submitter = e.submitter || null;
      openGate({
        rows: snapshotOf(form),
        trigger: "submit",
        resume: () => {
          try {
            if (submitter) form.requestSubmit(submitter);
            else form.requestSubmit();
          } catch (_) {}
        }
      });
    },
    true
  );

  // JS 送信 (submit イベントが出ない送信ボタン) は click でゲートする。
  // フォームに属する submit ボタンは submit イベント側に任せて二重ゲートを避ける。
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted || !gateApplies()) return;
      const el = targetOf(e);
      if (!el || inGate(el)) return;
      const btn = el.closest ? el.closest("button, input[type=submit], input[type=button]") : null;
      if (!btn || inGate(btn)) return;
      const btype = (btn.type || (btn.tagName === "BUTTON" ? "submit" : "")).toLowerCase();
      const isSubmitControl = btype === "submit";
      if (isSubmitControl && btn.form) return;
      const label = clip(btn.value || btn.innerText || "", 60);
      if (!SEND_RE.test(label) || NOT_SEND_RE.test(label)) return;
      e.preventDefault();
      e.stopPropagation();
      openGate({ rows: snapshotOf(btn.form), trigger: "click", resume: () => btn.click() });
    },
    true
  );

  // ===== 復元アシスト =====
  // 許可サイトで、前回の入力がログに残っていれば、空欄への復元を提案する (セッション切れ対策)。
  // 値は端末内のログから読むだけで、自動では入れない。復元は人の操作があった場合のみ。
  function sendRestore(phase, count) {
    send({
      kind: "restore",
      field: { tag: "restore", type: "", name: "", id: "", autocomplete: "", label: "" },
      length: null,
      detected: [],
      restore: { phase, count }
    });
  }

  async function initRestore() {
    if (window !== window.top || !enabled || !recordValues()) return;
    const v = await storageGet({ logs: [] });
    const logs = Array.isArray(v.logs) ? v.logs : [];
    const mine = logs.filter((e) => e && e.url === pageUrl());
    if (!mine.length) return;
    // 候補: 最新の送信スナップショットを優先し、なければ入力ログから欄ごとの最新値を集める
    const cand = new Map();
    let snapEntry = null;
    for (const e of mine) {
      if ((e.kind === "submit" || e.kind === "click") && Array.isArray(e.snapshot)) snapEntry = e;
    }
    if (snapEntry) {
      for (const r of snapEntry.snapshot) {
        if (!r || r.checked !== undefined || !r.value) continue;
        cand.set(AuditRules.fieldKeyOf(r.field), { field: r.field, value: r.value });
      }
    } else {
      for (const e of mine) {
        if ((e.kind === "input" || e.kind === "change") && e.value) {
          cand.set(AuditRules.fieldKeyOf(e.field), { field: e.field, value: e.value });
        }
      }
    }
    if (!cand.size) return;
    // 現在空欄のテキスト系の欄と突き合わせる
    const matches = [];
    for (const el of document.querySelectorAll("input,textarea")) {
      if (isPassword(el)) continue;
      const type = el.tagName === "INPUT" ? (el.type || "text").toLowerCase() : "textarea";
      if (el.tagName === "INPUT" && ["button", "submit", "reset", "image", "checkbox", "radio", "file", "range", "color", "hidden"].includes(type)) continue;
      if ((el.value || "") !== "") continue;
      const f = { ...describe(el), context: rowContext(el) };
      const c = cand.get(AuditRules.fieldKeyOf(f));
      if (c) matches.push({ el, field: f, value: c.value });
    }
    if (matches.length < 3) return;
    showRestoreBanner(matches);
  }

  function showRestoreBanner(matches) {
    if (document.getElementById("ia-restore-banner")) return;
    const doc = document;
    const banner = doc.createElement("div");
    banner.id = "ia-restore-banner";
    banner.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#fff;color:#1c2733;border:1px solid #14507e;border-radius:8px;box-shadow:0 6px 28px rgba(0,0,0,.35);padding:12px 14px;font-family:sans-serif;font-size:13px;line-height:1.5;max-width:340px;";
    const text = doc.createElement("div");
    text.textContent = `前回の入力が ${matches.length} 件残っています`;
    text.style.cssText = "font-weight:bold;margin-bottom:8px;";
    const bar = doc.createElement("div");
    bar.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const mkBtn = (label, primary) => {
      const b = doc.createElement("button");
      b.textContent = label;
      b.style.cssText = primary
        ? "padding:6px 12px;font-size:13px;border:0;border-radius:5px;background:#14507e;color:#fff;font-weight:bold;cursor:pointer;"
        : "padding:6px 12px;font-size:13px;border:1px solid #8a99a8;border-radius:5px;background:#fff;cursor:pointer;";
      return b;
    };
    const listBtn = mkBtn("一覧", false);
    listBtn.id = "ia-restore-list";
    const doBtn = mkBtn("復元する", true);
    doBtn.id = "ia-restore-do";
    const closeBtn = mkBtn("閉じる", false);
    closeBtn.id = "ia-restore-close";
    bar.append(listBtn, doBtn, closeBtn);
    banner.append(text, bar);
    (doc.body || doc.documentElement).appendChild(banner);
    sendRestore("shown", matches.length);

    let overlay = null;
    listBtn.addEventListener("click", () => {
      if (overlay) return;
      overlay = doc.createElement("div");
      overlay.id = "ia-restore-overlay";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483001;background:rgba(15,25,35,.58);overflow:auto;padding:28px 16px;font-family:sans-serif;";
      const panel = doc.createElement("div");
      panel.style.cssText = "background:#fff;color:#1c2733;max-width:720px;margin:0 auto;border-radius:10px;padding:18px 22px;font-size:14px;line-height:1.5;";
      const h = doc.createElement("h3");
      h.textContent = "前回の入力（復元候補）";
      h.style.cssText = "margin:0 0 10px;font-size:16px;";
      const table = doc.createElement("table");
      table.style.cssText = "border-collapse:collapse;width:100%;margin-bottom:14px;";
      for (const m of matches) {
        const tr = doc.createElement("tr");
        const k = doc.createElement("td");
        k.textContent = m.field.context || m.field.label || m.field.name || m.field.id || m.field.tag;
        k.style.cssText = "border:1px solid #c3ced8;padding:5px 9px;background:#eef4fa;width:55%;word-break:break-all;";
        const val = doc.createElement("td");
        val.textContent = m.value;
        val.style.cssText = "border:1px solid #c3ced8;padding:5px 9px;word-break:break-all;";
        tr.append(k, val);
        table.appendChild(tr);
      }
      const closeList = mkBtn("閉じる", false);
      closeList.id = "ia-restore-overlay-close";
      closeList.addEventListener("click", () => {
        overlay.remove();
        overlay = null;
      });
      panel.append(h, table, closeList);
      overlay.appendChild(panel);
      (doc.body || doc.documentElement).appendChild(overlay);
    });
    doBtn.addEventListener("click", () => {
      let done = 0;
      for (const m of matches) {
        if ((m.el.value || "") !== "") continue;
        m.el.value = m.value;
        // 値はプログラムから入れる。自拡張のロガーは isTrusted でないイベントを無視するのでログは汚れない
        m.el.dispatchEvent(new Event("input", { bubbles: true }));
        m.el.dispatchEvent(new Event("change", { bubbles: true }));
        done++;
      }
      sendRestore("restored", done);
      if (overlay) overlay.remove();
      banner.remove();
    });
    closeBtn.addEventListener("click", () => {
      sendRestore("dismissed", matches.length);
      if (overlay) overlay.remove();
      banner.remove();
    });
  }

  try {
    const startRestore = () => setTimeout(() => initRestore().catch(() => {}), 600);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRestore);
    else startRestore();
  } catch (_) {}
})();
