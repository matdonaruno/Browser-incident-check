const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// content.js のハンドラを取り出し、isTrusted と長さ上限を確かめる
function load() {
  const handlers = {};
  const sent = [];
  const input = {
    nodeType: 1, tagName: "INPUT", type: "text", value: "x".repeat(5000), id: "a",
    getAttribute: () => "", isContentEditable: false, closest: () => null
  };
  const ctx = {
    AuditDetect: { detectKinds: () => [] },
    chrome: {
      storage: {
        local: { get: (d, cb) => cb({ enabled: true, valueHosts: ["example.test"] }) },
        onChanged: { addListener() {} }
      },
      runtime: { sendMessage: (m) => sent.push(m.entry), lastError: null }
    },
    document: { addEventListener: (t, f) => (handlers[t] = f), querySelectorAll: () => [] },
    location: { hostname: "example.test", origin: "https://example.test", pathname: "/", href: "https://example.test/" },
    URL, WeakMap, Set, Array, Date, setTimeout: (f) => f(), clearTimeout() {}
  };
  ctx.window = { top: null };
  ctx.window.top = ctx.window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../extension/content.js"), "utf8"), ctx);
  const ev = (trusted, extra = {}) => ({ isTrusted: trusted, target: input, composedPath: () => [input], ...extra });
  return { handlers, sent, ev };
}

test("isTrusted でないイベントは記録しない", () => {
  const { handlers, sent, ev } = load();
  handlers.input(ev(false));
  handlers.paste(ev(false, { clipboardData: { getData: () => "forged" } }));
  assert.equal(sent.length, 0);
});

test("本物のイベントは記録され、値は上限で切られる", () => {
  const { handlers, sent, ev } = load();
  handlers.input(ev(true));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].value.length, 2000);
  assert.equal(sent[0].length, 5000);
});
