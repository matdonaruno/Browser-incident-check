// 機密らしさの検出。値は返さず、種別ラベルだけを返す。
(function (root) {
  function luhn(digits) {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function hasCardNumber(text) {
    const re = /\b\d(?:[ -]?\d){12,18}\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const digits = m[0].replace(/[ -]/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
    }
    return false;
  }

  const RULES = [
    ["apiKey", /(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})/],
    ["privateKey", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["jwt", /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/],
    ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ["phoneJP", /(?<!\d)0\d{1,4}-\d{1,4}-\d{4}(?!\d)|(?<!\d)0[789]0\d{8}(?!\d)/],
    ["digits12", /(?<![\d-])\d{12}(?![\d-])/]
  ];

  function detectKinds(text) {
    if (!text || typeof text !== "string") return [];
    const kinds = [];
    if (hasCardNumber(text)) kinds.push("creditCard");
    for (const [kind, re] of RULES) {
      if (re.test(text)) kinds.push(kind);
    }
    return kinds;
  }

  root.AuditDetect = { detectKinds, luhn };
  if (typeof module !== "undefined") module.exports = root.AuditDetect;
})(typeof self !== "undefined" ? self : globalThis);
