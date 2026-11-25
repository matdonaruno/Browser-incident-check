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

test("parseSource: タブ区切り (最後の列が値、残りがキー)", () => {
  const { rows, skipped, overwritten } = Collate.parseSource("グルコース 試料1\t92\nグルコース 試料2\t148");
  assert.deepEqual(rows, [
    { key: "グルコース 試料1", value: "92" },
    { key: "グルコース 試料2", value: "148" }
  ]);
  assert.deepEqual(skipped, []);
  assert.equal(overwritten, 0);
});

test("parseSource: カンマ区切り (3 列以上は末尾以外をキーとして空白でつなぐ)", () => {
  const { rows } = Collate.parseSource("グルコース 試料1,92\n項目A,サブ,10");
  assert.deepEqual(rows, [
    { key: "グルコース 試料1", value: "92" },
    { key: "項目A サブ", value: "10" }
  ]);
});

test("parseSource: 空白区切り", () => {
  const { rows } = Collate.parseSource("グルコース 試料1 92");
  assert.deepEqual(rows, [{ key: "グルコース 試料1", value: "92" }]);
});

test("parseSource: トークン前後の引用符を剥がす", () => {
  const { rows } = Collate.parseSource('"グルコース 試料1"\t"92"\n\'項目B\',\'10\'');
  assert.deepEqual(rows, [
    { key: "グルコース 試料1", value: "92" },
    { key: "項目B", value: "10" }
  ]);
});

test("parseSource: 桁区切りカンマ (1,200) を区切りとして扱わず値に保持する", () => {
  // カンマ区切り・空白区切り・タブ区切りのどの行でも壊さない
  assert.deepEqual(Collate.parseSource("金額,1,200").rows, [{ key: "金額", value: "1,200" }]);
  assert.deepEqual(Collate.parseSource("金額 1,200").rows, [{ key: "金額", value: "1,200" }]);
  assert.deepEqual(Collate.parseSource("金額\t1,200").rows, [{ key: "金額", value: "1,200" }]);
  assert.deepEqual(Collate.parseSource("総額,1,234,567").rows, [{ key: "総額", value: "1,234,567" }]);
  // 挙動明示: カンマ区切りで末尾 2 トークンが桁区切り数値を成す場合は、値として結合する
  // (例 "グルコース,92,148" は キー「グルコース」値「92,148」と読む。従来は キー「グルコース 92」値「148」だった)
  assert.deepEqual(Collate.parseSource("グルコース,92,148").rows, [{ key: "グルコース", value: "92,148" }]);
});

test("parseSource: 読み取れない行は skipped に集め、空行は無視する", () => {
  const { rows, skipped } = Collate.parseSource("WBC 5.6\n\n項目だけの行\nRBC,4.2\n");
  assert.deepEqual(rows, [
    { key: "WBC", value: "5.6" },
    { key: "RBC", value: "4.2" }
  ]);
  assert.deepEqual(skipped, ["項目だけの行"]);
});

test("parseSource: 重複キーは新しい値で上書きし、件数を数える", () => {
  const { rows, overwritten } = Collate.parseSource("A 1\nB 3\nA 2");
  assert.deepEqual(rows, [
    { key: "A", value: "2" },
    { key: "B", value: "3" }
  ]);
  assert.equal(overwritten, 1);
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

test("collate: ラベルに元データの行キーを併記し、同名の欄 (試料1/試料2) を区別できる", () => {
  const sourceMap = { "グルコース 試料1": "92", "グルコース 試料2": "148" };
  const mapping = {
    [AuditRules.fieldKeyOf(GLU1)]: "グルコース 試料1",
    [AuditRules.fieldKeyOf(GLU2)]: "グルコース 試料2"
  };
  const { results } = Collate.collate([row(GLU1, "92"), row(GLU2, "999")], sourceMap, mapping);
  assert.equal(results[0].label, "グルコース mg/dL（グルコース 試料1）");
  assert.equal(results[1].label, "グルコース mg/dL（グルコース 試料2）");
  assert.notEqual(results[0].label, results[1].label);
});

test("collate: 対応づけのない欄のラベルはフォーム側のまま", () => {
  const { results } = Collate.collate([row(GLU1, "92")], {}, {});
  assert.equal(results[0].status, "noSource");
  assert.equal(results[0].label, "グルコース mg/dL");
});
