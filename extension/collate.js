// L2 元データ照合 (設計書 §3): 入力値を元データ (項目→値) と突き合わせる。
// 比較は文字列そのままではなく、数値として正規化してから行う (0.82 = .82 = 0.820、全角・単位・カンマを吸収)。
// 値の正しさは判定しない。不一致・転置・入れ違いの「疑い」を提示し、最終判断は人に委ねる。
// collate(rows, sourceMap, mapping) -> { results: [{fieldIndex, fieldKey, label, status, ...}], summary }
//   rows:      送信時スナップショット [{ field: {label,name,id,context,colContext}, value, checked }]
//   sourceMap: { sourceKey: value }  (元データ)
//   mapping:   { fieldKey: sourceKey } (fieldKey は rules.js の AuditRules.fieldKeyOf)
(function (root) {
  const UNITS = ["mg/dL", "g/dL", "U/L", "mEq/L", "mmol/L", "IU/L", "/μL", "%"];

  function halfwidth(s) {
    return String(s)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/．/g, ".")
      .replace(/，/g, ",");
  }

  // 値を比較可能な形に正規化する。末尾の単位は分離し、数値として読めれば数値も返す
  function normalizeValue(v) {
    let s = v == null ? "" : String(v);
    s = halfwidth(s).replace(/[\s　]/g, "").replace(/,/g, "");
    let unit = null;
    for (const u of UNITS) {
      if (s.length > u.length && s.endsWith(u)) {
        unit = u;
        s = s.slice(0, s.length - u.length);
        break;
      }
    }
    let number = null;
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
      const n = parseFloat(s);
      if (Number.isFinite(n)) number = n;
    }
    return { text: s, unit, number };
  }

  function valuesEqual(a, b) {
    const na = normalizeValue(a);
    const nb = normalizeValue(b);
    if (na.number !== null && nb.number !== null) return Math.abs(na.number - nb.number) < 1e-9;
    return na.text === nb.text;
  }

  // 数字列が並び替え関係にあるか (桁の転置・入れ違い)。等しい場合と小数点落とし (数字の個数が違う) は含めない
  function isTransposition(a, b) {
    if (valuesEqual(a, b)) return false;
    const da = normalizeValue(a).text.replace(/\D/g, "");
    const db = normalizeValue(b).text.replace(/\D/g, "");
    if (da.length < 2 || da.length !== db.length || da === db) return false;
    return [...da].sort().join("") === [...db].sort().join("");
  }

  function fieldKeyOf(f) {
    if (root.AuditRules && root.AuditRules.fieldKeyOf) return root.AuditRules.fieldKeyOf(f);
    if (!f) return "";
    return [f.name || "", f.id || "", f.label || "", f.context || ""].join("|");
  }

  function tokenize(key) {
    return String(key || "")
      .split(/[\s、,，・/／|]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function fieldText(f) {
    if (!f) return "";
    return [f.context || "", f.colContext || "", f.label || "", f.name || "", f.id || ""].join(" ");
  }

  // 元データのキーと入力欄の対応づけを提案する。
  // キーの各トークンが欄の文脈 (行・列・ラベル・name・id) に含まれる数でスコア付けし、
  // 最高スコアが一意に決まる場合だけ採用する (曖昧なものは人に委ねる)。
  function autoMatch(fields, sourceRows) {
    const list = Array.isArray(fields) ? fields : [];
    const best = new Map(); // sourceKey -> { fieldKey, score }
    for (const sr of Array.isArray(sourceRows) ? sourceRows : []) {
      const tokens = tokenize(sr && sr.key);
      if (!tokens.length) continue;
      let max = 0;
      let winners = [];
      for (const f of list) {
        const text = fieldText(f);
        let score = 0;
        for (const t of tokens) if (text.includes(t)) score++;
        if (score > max) {
          max = score;
          winners = [f];
        } else if (score === max && score > 0) {
          winners.push(f);
        }
      }
      if (max >= 1 && winners.length === 1) best.set(sr.key, { fieldKey: fieldKeyOf(winners[0]), score: max });
    }
    // 同じ欄を複数のキーが取り合う場合は、スコアが高い方だけを残す (同点なら両方落とす)
    const byField = new Map();
    for (const [sk, v] of best) {
      if (!byField.has(v.fieldKey)) byField.set(v.fieldKey, []);
      byField.get(v.fieldKey).push([sk, v.score]);
    }
    const mapping = {};
    for (const [fk, cands] of byField) {
      cands.sort((a, b) => b[1] - a[1]);
      if (cands.length === 1 || cands[0][1] > cands[1][1]) mapping[fk] = cands[0][0];
    }
    return mapping;
  }

  function firstDiffIndex(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : n;
  }

  function labelOf(row, i) {
    const f = (row && row.field) || {};
    return f.context || f.label || f.name || f.id || `欄 ${i + 1}`;
  }

  function collate(rows, sourceMap, mapping) {
    const list = Array.isArray(rows) ? rows : [];
    const src = sourceMap || {};
    const map = mapping || {};
    const results = [];
    let covered = 0;
    let matched = 0;
    let mismatched = 0;
    let swaps = 0;
    list.forEach((row, i) => {
      const fk = fieldKeyOf(row.field);
      const sk = map[fk];
      const label = labelOf(row, i);
      if (!sk || !(sk in src)) {
        results.push({ fieldIndex: i, fieldKey: fk, label, status: "noSource", sourceKey: sk || null });
        return;
      }
      covered++;
      const sourceValue = src[sk];
      const entered = row.value == null ? "" : String(row.value);
      const ne = normalizeValue(entered);
      const ns = normalizeValue(sourceValue);
      const base = { fieldIndex: i, fieldKey: fk, label, sourceKey: sk, sourceValue, enteredText: ne.text, sourceText: ns.text };
      if (valuesEqual(entered, sourceValue)) {
        matched++;
        results.push({ ...base, status: "match" });
        return;
      }
      // 入れ違い: 入力値が「別の対応済み項目」の元データ値と一致する
      let swapKey = null;
      for (const [otherFk, otherSk] of Object.entries(map)) {
        if (otherFk === fk || !(otherSk in src)) continue;
        if (valuesEqual(entered, src[otherSk])) {
          swapKey = otherSk;
          break;
        }
      }
      if (swapKey) {
        swaps++;
        results.push({ ...base, status: "swap", swapKey });
        return;
      }
      if (isTransposition(entered, sourceValue)) {
        mismatched++;
        results.push({ ...base, status: "transposition", firstDiffIndex: firstDiffIndex(ne.text, ns.text) });
        return;
      }
      mismatched++;
      results.push({ ...base, status: "mismatch", firstDiffIndex: firstDiffIndex(ne.text, ns.text) });
    });
    const total = list.length;
    return {
      results,
      summary: { total, covered, matched, mismatched, swaps, coverage: total ? covered / total : 0 }
    };
  }

  root.AuditCollate = { normalizeValue, valuesEqual, isTransposition, autoMatch, collate, tokenize, firstDiffIndex };
  if (typeof module !== "undefined") module.exports = root.AuditCollate;
})(typeof self !== "undefined" ? self : globalThis);
