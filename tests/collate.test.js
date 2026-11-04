const test = require("node:test");
const assert = require("node:assert");
require("../extension/rules.js"); // AuditRules.fieldKeyOf を collate.js が使う
const Collate = require("../extension/collate.js");

test("正規化: 数値として解釈できれば数値を返す", () => {
  const n = Collate.normalizeValue("0.82");
  assert.equal(n.text, "0.82");
  assert.equal(n.number, 0.82);
  assert.equal(n.unit, null);
});

test("正規化: 全角・カンマ・空白を吸収する", () => {
  assert.equal(Collate.normalizeValue("１４１").number, 141);
  assert.equal(Collate.normalizeValue("０．８２").number, 0.82);
  assert.equal(Collate.normalizeValue("1,024").number, 1024);
  assert.equal(Collate.normalizeValue(" 92 ").number, 92);
});

test("正規化: 末尾の単位を分離する", () => {
  const n = Collate.normalizeValue("92mg/dL");
  assert.equal(n.unit, "mg/dL");
  assert.equal(n.number, 92);
  assert.equal(Collate.normalizeValue("37.5%").unit, "%");
});

test("valuesEqual: 表記が違っても数値が同じなら一致", () => {
  assert.ok(Collate.valuesEqual("0.82", ".82"));
  assert.ok(Collate.valuesEqual("0.82", "0.820"));
  assert.ok(Collate.valuesEqual("１４１", "141"));
  assert.ok(Collate.valuesEqual("92 mg/dL", "92"));
  assert.ok(!Collate.valuesEqual("92", "93"));
  assert.ok(Collate.valuesEqual("良好", "良好"));
  assert.ok(!Collate.valuesEqual("良好", "異常あり"));
});

test("isTransposition: 数字列の並び替えだけを検出する", () => {
  assert.ok(Collate.isTransposition("182", "128"));
  assert.ok(Collate.isTransposition("245", "254"));
  assert.ok(!Collate.isTransposition("182", "182")); // 一致は転置ではない
  assert.ok(!Collate.isTransposition("0.82", "82")); // 小数点落としは転置ではない
  assert.ok(!Collate.isTransposition("92", "148"));
});

// EQA モックの行を模した記述子 (行の文脈は項目名+単位、列見出しで試料を区別する)
const field = (name, item, col) => ({
  tag: "input",
  type: "text",
  name,
  id: name.replace(/_/g, "-"),
  label: "",
  context: `${item} mg/dL`,
  colContext: col
});
const row = (f, value) => ({ field: f, value, checked: undefined });

const GLU1 = field("b_glu_1", "グルコース", "試料1 (QC-261)");
const GLU2 = field("b_glu_2", "グルコース", "試料2 (QC-262)");
const CRE1 = field("b_cre_1", "クレアチニン", "試料1 (QC-261)");
const LD1 = field("b_ld_1", "LD", "試料1 (QC-261)");

test("autoMatch: colContext で試料1/試料2 を区別できる", () => {
  const sourceRows = [
    { key: "グルコース 試料1", value: "92" },
    { key: "グルコース 試料2", value: "148" }
  ];
  const m = Collate.autoMatch([GLU1, GLU2], sourceRows);
  assert.equal(m[AuditRules.fieldKeyOf(GLU1)], "グルコース 試料1");
  assert.equal(m[AuditRules.fieldKeyOf(GLU2)], "グルコース 試料2");
});

test("autoMatch: 最高スコアが一意でないものは対応付けない", () => {
  const sourceRows = [{ key: "グルコース", value: "92" }]; // 試料の区別が付かない
  const m = Collate.autoMatch([GLU1, GLU2], sourceRows);
  assert.deepEqual(m, {});
});

test("collate: 一致・小数点落としの不一致 (差分位置つき)", () => {
  const sourceMap = { "グルコース 試料1": "92", "クレアチニン 試料1": "0.82" };
  const mapping = {
    [AuditRules.fieldKeyOf(GLU1)]: "グルコース 試料1",
    [AuditRules.fieldKeyOf(CRE1)]: "クレアチニン 試料1"
  };
  const { results, summary } = Collate.collate([row(GLU1, "92"), row(CRE1, "82")], sourceMap, mapping);
  assert.equal(results[0].status, "match");
  assert.equal(results[1].status, "mismatch");
  assert.equal(results[1].firstDiffIndex, 0); // "82" と "0.82" は先頭から違う
  assert.equal(summary.matched, 1);
  assert.equal(summary.mismatched, 1);
});

test("collate: 表記ゆれは一致として扱う", () => {
  const sourceMap = { "クレアチニン 試料1": "0.82" };
  const mapping = { [AuditRules.fieldKeyOf(CRE1)]: "クレアチニン 試料1" };
  const { results } = Collate.collate([row(CRE1, ".82")], sourceMap, mapping);
  assert.equal(results[0].status, "match");
});

test("collate: 入れ違い (別の項目の元データ値と一致) を検出する", () => {
  const sourceMap = { "グルコース 試料1": "92", "グルコース 試料2": "148" };
  const mapping = {
    [AuditRules.fieldKeyOf(GLU1)]: "グルコース 試料1",
    [AuditRules.fieldKeyOf(GLU2)]: "グルコース 試料2"
  };
  // 試料2 の欄に試料1 の値 92 を入れてしまった
  const { results, summary } = Collate.collate([row(GLU1, "92"), row(GLU2, "92")], sourceMap, mapping);
  assert.equal(results[0].status, "match");
  assert.equal(results[1].status, "swap");
  assert.equal(results[1].swapKey, "グルコース 試料1");
  assert.equal(summary.swaps, 1);
});

test("collate: 桁の転置を専用ステータスにする", () => {
  const sourceMap = { "LD 試料1": "182" };
  const mapping = { [AuditRules.fieldKeyOf(LD1)]: "LD 試料1" };
  const { results, summary } = Collate.collate([row(LD1, "128")], sourceMap, mapping);
  assert.equal(results[0].status, "transposition");
  assert.equal(summary.mismatched, 1); // 転置も不一致の件数に含める
});

test("collate: 対応のない欄は noSource、カバー率を計算する", () => {
  const sourceMap = { "グルコース 試料1": "92" };
  const mapping = { [AuditRules.fieldKeyOf(GLU1)]: "グルコース 試料1" };
  const rows = [row(GLU1, "92"), row(GLU2, "148"), row(CRE1, "0.82"), row(LD1, "182")];
  const { results, summary } = Collate.collate(rows, sourceMap, mapping);
  assert.equal(results[0].status, "match");
  assert.equal(results[1].status, "noSource");
  assert.equal(summary.total, 4);
  assert.equal(summary.covered, 1);
  assert.equal(summary.coverage, 0.25);
});
