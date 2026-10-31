const assert = require("node:assert/strict");
const { test } = require("node:test");
const { detectKinds, luhn } = require("../extension/detect.js");

test("luhn", () => {
  assert.equal(luhn("4242424242424242"), true);
  assert.equal(luhn("4242424242424241"), false);
});

test("クレジットカード: Luhn が通るものだけ", () => {
  assert.deepEqual(detectKinds("card 4242 4242 4242 4242"), ["creditCard"]);
  assert.deepEqual(detectKinds("4242-4242-4242-4241"), []);
});

test("APIキー系", () => {
  assert.ok(detectKinds("AKIAABCDEFGHIJKLMNOP").includes("apiKey"));
  assert.ok(detectKinds("ghp_" + "a".repeat(36)).includes("apiKey"));
  assert.ok(detectKinds("-----BEGIN RSA PRIVATE KEY-----").includes("privateKey"));
});

test("email / 電話 / JWT", () => {
  assert.ok(detectKinds("me@example.com").includes("email"));
  assert.ok(detectKinds("03-1234-5678").includes("phoneJP"));
  assert.ok(detectKinds("090 1234 5678".replace(/ /g, "")).includes("phoneJP"));
  assert.ok(detectKinds("eyJhbGciOi.eyJzdWIiOiIx.abcdefghij").includes("jwt"));
});

test("普通の文章は検出しない", () => {
  assert.deepEqual(detectKinds("今日は晴れです。会議は15時から。"), []);
  assert.deepEqual(detectKinds(""), []);
  assert.deepEqual(detectKinds(null), []);
});
