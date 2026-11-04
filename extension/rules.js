// L1 ルール検査 (設計書 §3): 正解を知らなくても分かる「異常の兆候」を検出する。
// 値の正しさは判定しない。疑わしきは警告に倒し、最終判断は人に委ねる。
// evaluate(rows, pastes) -> [{ code, fieldIndex, label, message }]
//   rows:   送信時スナップショット [{ field: {label,name,id,context,type}, value, checked }]
//   pastes: 直近の貼り付け記録 [{ fieldKey, text, prevValue }] (fieldKey は fieldKeyOf で作る)
(function (root) {
  const FULLWIDTH_RE = /[０-９Ａ-Ｚａ-ｚ]/;
  const UNITS = ["mg/dL", "g/dL", "U/L", "mEq/L", "mmol/L", "IU/L", "/μL", "%"];

  function fieldKeyOf(f) {
    if (!f) return "";
    return [f.name || "", f.id || "", f.label || "", f.context || ""].join("|");
  }
  function labelOf(row, i) {
    const f = (row && row.field) || {};
    return f.context || f.label || f.name || f.id || `欄 ${i + 1}`;
  }
  function halfwidth(s) {
    return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  }

  function evaluate(rows, pastes) {
    const warnings = [];
    const list = Array.isArray(rows) ? rows : [];
    const pasteList = Array.isArray(pastes) ? pastes : [];
    const pasteByField = new Map();
    for (const p of pasteList) {
      if (p && p.fieldKey) pasteByField.set(p.fieldKey, p); // 後勝ち = 最新の貼り付け
    }

    // 重複値のグループ (入れ違い・コピーの兆候)
    const byValue = new Map();
    list.forEach((row, i) => {
      const v = (row.value || "").trim();
      if (!v || row.checked !== undefined) return;
      if (row.field && row.field.tag === "select") return; // 選択肢の重複は通常の入力でも起こるので対象外
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v).push(i);
    });

    list.forEach((row, i) => {
      const value = typeof row.value === "string" ? row.value : "";
      const label = labelOf(row, i);
      const isCheckable = row.checked !== undefined;
      const push = (code, message) => warnings.push({ code, fieldIndex: i, label, message });

      if (!isCheckable && value === "") {
        push("empty", "未入力です");
        return;
      }
      if (FULLWIDTH_RE.test(value)) {
        push("fullwidth", "全角文字が含まれています。数値のつもりなら半角に直してください");
      }
      if (/^\s|\s$/.test(value) || /[\r\n\t]/.test(value)) {
        push("whitespace", "改行・タブ・前後の空白が含まれています");
      }
      // 単位の混入: 行の文脈に単位があり、値の末尾にも同じ単位が付いている
      const ctx = (row.field && row.field.context) || "";
      const trimmed = value.trim();
      for (const u of UNITS) {
        if (trimmed.length > u.length && trimmed.endsWith(u) && ctx.includes(u)) {
          push("unit", `単位「${u}」まで入力されています。数値だけにしてください`);
          break;
        }
      }
      // 貼り付け由来の異常
      const p = pasteByField.get(fieldKeyOf(row.field));
      if (p && typeof p.text === "string") {
        if (/[\r\n\t]/.test(p.text)) {
          push("paste-multiline", "複数行・複数セルの貼り付けです。別の項目の値が混ざっていないか確認してください");
        }
        if (p.prevValue && p.prevValue !== value) {
          push("paste-overwrite", `貼り付けで前の値「${p.prevValue}」が上書きされています`);
        }
        if (p.text !== value) {
          const stripped = p.text.replace(/^0+(?=\d)/, "");
          if (stripped === value && /^0\d/.test(p.text)) {
            push("paste-leading-zero", "貼り付けた内容の先頭の 0 が落ちています");
          } else if (halfwidth(p.text) === value) {
            push("paste-converted", "貼り付け時に全角→半角などの変換が起きています");
          } else if (p.text.length > value.length) {
            push("paste-truncated", `貼り付けた内容 (${p.text.length} 文字) が欄の値 (${value.length} 文字) と一致しません。切り捨てや書き換えの可能性があります`);
          }
        }
      }
    });

    for (const [v, idxs] of byValue) {
      if (idxs.length < 2) continue;
      const labels = idxs.map((i) => labelOf(list[i], i));
      warnings.push({
        code: "duplicate",
        fieldIndex: idxs[0],
        label: labels.join(" / "),
        message: `同じ値「${v}」が ${idxs.length} 欄にあります。入れ違いやコピーの疑いがないか確認してください`
      });
    }
    return warnings;
  }

  root.AuditRules = { evaluate, fieldKeyOf };
  if (typeof module !== "undefined") module.exports = root.AuditRules;
})(typeof self !== "undefined" ? self : globalThis);
