const test = require("node:test");
const assert = require("node:assert");
const Rules = require("../extension/rules.js");

const row = (value, extra = {}) => ({
  field: { tag: "input", type: "text", name: extra.name || "", id: extra.id || "", label: extra.label || "", context: extra.context || "" },
  value,
  checked: extra.checked
});
const codes = (rows, pastes) => Rules.evaluate(rows, pastes || []).map((w) => w.code);

test("未入力を警告する (チェックボックスの未選択は対象外)", () => {
  assert.deepEqual(codes([row("")]), ["empty"]);
  assert.deepEqual(codes([row("", { checked: false })]), []);
});

test("全角文字を警告する", () => {
  assert.deepEqual(codes([row("１４１")]), ["fullwidth"]);
  assert.deepEqual(codes([row("141")]), []);
});

test("改行・タブ・前後空白を警告する", () => {
  assert.ok(codes([row(" 92")]).includes("whitespace"));
  assert.ok(codes([row("9\n2")]).includes("whitespace"));
});

test("単位の混入を警告する (文脈に単位がある場合のみ)", () => {
  assert.deepEqual(codes([row("92mg/dL", { context: "グルコース mg/dL 92" })]), ["unit"]);
  assert.deepEqual(codes([row("92mg/dL", { context: "グルコース" })]), []);
});

test("複数行の貼り付けを警告する", () => {
  const r = row("24588", { name: "ld2" });
  const pastes = [{ fieldKey: Rules.fieldKeyOf(r.field), text: "245\n88", prevValue: "" }];
  assert.ok(codes([r], pastes).includes("paste-multiline"));
});

test("貼り付けの切り捨てを警告する", () => {
  const r = row("13045612", { name: "barcode" });
  const pastes = [{ fieldKey: Rules.fieldKeyOf(r.field), text: "1304561234", prevValue: "" }];
  assert.ok(codes([r], pastes).includes("paste-truncated"));
});

test("先頭 0 の欠落は専用の警告にする", () => {
  const r = row("82", { name: "cre" });
  const pastes = [{ fieldKey: Rules.fieldKeyOf(r.field), text: "082", prevValue: "" }];
  const got = codes([r], pastes);
  assert.ok(got.includes("paste-leading-zero"));
  assert.ok(!got.includes("paste-truncated"));
});

test("全角→半角の変換を警告する", () => {
  const r = row("141", { name: "na1" });
  const pastes = [{ fieldKey: Rules.fieldKeyOf(r.field), text: "１４１", prevValue: "" }];
  assert.ok(codes([r], pastes).includes("paste-converted"));
});

test("貼り付けによる上書きを警告する", () => {
  const r = row("67", { name: "ast1" });
  const pastes = [{ fieldKey: Rules.fieldKeyOf(r.field), text: "67", prevValue: "28" }];
  assert.ok(codes([r], pastes).includes("paste-overwrite"));
});

test("同じ値の重複を警告する", () => {
  const got = codes([row("92", { name: "a" }), row("92", { name: "b" }), row("148", { name: "c" })]);
  assert.deepEqual(got, ["duplicate"]);
});

test("正常な入力では警告しない", () => {
  const rows = [row("92", { name: "a", context: "グルコース mg/dL" }), row("148", { name: "b", context: "グルコース mg/dL" })];
  assert.deepEqual(codes(rows), []);
});
