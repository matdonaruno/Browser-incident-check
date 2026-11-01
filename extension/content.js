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
  let enabled = true;
  let valueHosts = [];

  try {
    chrome.storage.local.get({ enabled: true, valueHosts: [] }, (v) => {
      enabled = v.enabled !== false;
      valueHosts = v.valueHosts || [];
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.enabled) enabled = changes.enabled.newValue !== false;
      if (changes.valueHosts) valueHosts = changes.valueHosts.newValue || [];
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
        field: { ...describe(el), context: rowContext(el) },
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
})();
