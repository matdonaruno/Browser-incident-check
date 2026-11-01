const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// background.js を擬似 chrome API 上で動かす
function load(opts = {}) {
  const db = {};
  let listener;
  let failSets = opts.failSets || 0;
  const chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: db[k] }),
        set: async (o) => {
          if (failSets > 0) { failSets--; throw new Error("QUOTA_BYTES quota exceeded"); }
          Object.assign(db, JSON.parse(JSON.stringify(o)));
        }
      }
    },
    runtime: { onMessage: { addListener: (f) => (listener = f) } }
  };
  const ctx = { chrome, crypto: { randomUUID: () => "real-id" }, console, JSON, Promise, Array };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8"), ctx);
  const send = (msg, sender = { tab: { incognito: false } }) =>
    new Promise((res) => {
      const r = listener(msg, sender, res);
      if (r !== true) setTimeout(res, 20);
    });
  return { db, send };
}
const tick = () => new Promise((r) => setTimeout(r, 50));

test("entry は id / incognito を上書きできない", async () => {
  const { db, send } = load();
  await send({ type: "log", entry: { id: "forged", incognito: true, kind: "input" } });
  await tick();
  assert.equal(db.logs[0].id, "real-id");
  assert.equal(db.logs[0].incognito, false);
});

test("巨大なエントリは値を落として truncated になる", async () => {
  const { db, send } = load();
  await send({ type: "log", entry: { kind: "submit", snapshot: [{ value: "x".repeat(300 * 1024) }] } });
  await tick();
  assert.equal(db.logs[0].truncated, true);
  assert.equal(db.logs[0].snapshot, undefined);
});

test("容量超過で set が失敗しても削って再試行し、記録が止まらない", async () => {
  const { db, send } = load({ failSets: 2 });
  for (let i = 0; i < 6; i++) await send({ type: "log", entry: { kind: "input", n: i } });
  await tick();
  assert.ok(db.logs.length >= 1, "失敗後も書き込まれる");
  assert.equal(db.logs[db.logs.length - 1].n, 5);
});

test("バイト予算を超えたら古い順に捨てる", async () => {
  const { db, send } = load();
  const big = "y".repeat(150 * 1024);
  for (let i = 0; i < 70; i++) await send({ type: "log", entry: { kind: "input", n: i, value: big } });
  await tick();
  const bytes = JSON.stringify(db.logs).length;
  assert.ok(bytes <= 8 * 1024 * 1024, `bytes=${bytes}`);
  assert.equal(db.logs[db.logs.length - 1].n, 69);
});

test("clear は content script (sender.tab あり) から受けない", async () => {
  const { db, send } = load();
  await send({ type: "log", entry: { kind: "input" } });
  await tick();
  await send({ type: "clear" }, { tab: { id: 1 } });
  assert.equal(db.logs.length, 1);
  const r = await send({ type: "clear" }, {});
  assert.deepEqual(r, { ok: true });
  assert.equal(db.logs.length, 0);
});
