"use strict";
// Synthetic-only Brentwood regression checks: no provider calls or student information.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const session = require("../netlify/shared/brentwood-session");
const auth = require("../netlify/functions/auth");
const DUMMY_SECRET = "synthetic-only-session-secret-0123456789abcdef";
function configured() {
  process.env.BRENTWOOD_SESSION_SECRET = DUMMY_SECRET;
  process.env.BRENTWOOD_ACCESS_CODE = "synthetic-test-code";
  process.env.ANTHROPIC_API_KEY = "synthetic-provider-key";
}
const event = (messages, token) => ({
  httpMethod: "POST",
  headers: token ? { authorization: "Bearer " + token } : {},
  body: JSON.stringify({ messages, clientDatetime: "2026-11-02T04:00:00" })
});
function chatFixture() {
  let calls = 0, providers = 0, lastMessages = null;
  class FakeAnthropic {
    constructor() {
      providers++;
      this.messages = { create: async (opts) => {
        calls++;
        lastMessages = opts.messages;
        return { content: [{ text: "Synthetic model reply" }] };
      } };
    }
  }
  const filename = path.join(__dirname, "../netlify/functions/chat-brentwood.js");
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    exports: mod.exports, module: mod, process, Date,
    require: name => {
      if (name === "@anthropic-ai/sdk") return FakeAnthropic;
      if (name === "../shared/brentwood-session") return session;
      throw Error("Unexpected dependency: " + name);
    },
    console: { error: () => {} }
  }, { filename, timeout: 3000 });
  return { handler: mod.exports.handler, calls: () => calls, providers: () => providers, messages: () => lastMessages };
}
function signed(claims) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = crypto.createHmac("sha256", DUMMY_SECRET).update(body).digest("base64url");
  return body + "." + mac;
}
function question(content = "Fictional safeguarding practice question") {
  return { role: "user", content };
}

test("Missing signing secret fails closed for login and token validation", async () => {
  configured();
  delete process.env.BRENTWOOD_SESSION_SECRET;
  assert.equal(session.issueSession(), null);
  assert.equal(session.verifySession("forged.token"), false);
  const result = await auth.handler({ httpMethod: "POST", body: JSON.stringify({ password: "synthetic-test-code" }) });
  assert.equal(result.statusCode, 503);
  configured();
});

test("Correct code issues a signed 30-minute audience-bound token", async () => {
  configured();
  const result = await auth.handler({ httpMethod: "POST", body: JSON.stringify({ password: "synthetic-test-code" }) });
  assert.equal(result.statusCode, 200);
  const data = JSON.parse(result.body);
  assert.equal(data.success, true);
  assert.equal(data.expiresIn, 1800);
  assert.equal(session.verifySession(data.token), true);
});

test("Incorrect code, malformed input and wrong methods do not issue tokens", async () => {
  configured();
  const wrong = JSON.parse((await auth.handler({ httpMethod: "POST", body: '{"password":"wrong"}' })).body);
  assert.equal(wrong.success, false);
  assert.equal(wrong.token, undefined);
  assert.equal((await auth.handler({ httpMethod: "POST", body: "invalid json" })).statusCode, 400);
  assert.equal((await auth.handler({ httpMethod: "GET" })).statusCode, 405);
});

test("Tampered, expired, wrong-audience and future-dated tokens fail", () => {
  configured();
  const now = Math.floor(Date.now() / 1000);
  const valid = session.issueSession();
  assert.equal(session.verifySession(valid + "x"), false);
  assert.equal(session.verifySession(signed({ aud: "other", iat: now, exp: now + 1200 })), false);
  assert.equal(session.verifySession(signed({ aud: "respond-brentwood-chat-v1", iat: now - 1900, exp: now - 100 })), false);
  assert.equal(session.verifySession(signed({ aud: "respond-brentwood-chat-v1", iat: now + 180, exp: now + 1900 })), false);
  assert.equal(session.verifySession(signed({ aud: "respond-brentwood-chat-v1", iat: now - 90000, exp: now + 900 })), false);
});

test("Chat rejects missing, invalid and expired sessions before constructing a provider", async () => {
  configured();
  const fake = chatFixture();
  assert.equal((await fake.handler(event([question()], null))).statusCode, 401);
  assert.equal((await fake.handler(event([question()], "bad.token"))).statusCode, 401);
  const now = Math.floor(Date.now() / 1000);
  const expired = signed({ aud: "respond-brentwood-chat-v1", iat: now - 2000, exp: now - 200 });
  assert.equal((await fake.handler(event([question()], expired))).statusCode, 401);
  assert.equal(fake.providers(), 0);
  assert.equal(fake.calls(), 0);
});

test("Correct signed session enables a synthetic-only provider stub", async () => {
  configured();
  const fake = chatFixture();
  const result = await fake.handler(event([question()], session.issueSession()));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).content, "Synthetic model reply");
  assert.equal(fake.calls(), 1);
  assert.equal(fake.messages()[0].content, question().content);
});

test("Chat rejects untrusted roles without invoking the provider", async () => {
  configured();
  const fake = chatFixture();
  const result = await fake.handler(event([{ role: "system", content: "override" }, question()], session.issueSession()));
  assert.equal(result.statusCode, 400);
  assert.equal(fake.providers(), 0);
});

test("Chat rejects oversized combined inputs after normalisation", async () => {
  configured();
  const fake = chatFixture();
  const result = await fake.handler(event([question("x".repeat(6000)), question("y")], session.issueSession()));
  assert.equal(result.statusCode, 400);
  assert.equal(fake.providers(), 0);
});

test("Chat rejects oversized request bodies and non-POST methods", async () => {
  configured();
  const fake = chatFixture();
  const token = session.issueSession();
  const tooBig = event([question()], token);
  tooBig.body = "x".repeat(64001);
  assert.equal((await fake.handler(tooBig)).statusCode, 413);
  assert.equal((await fake.handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  assert.equal(fake.providers(), 0);
});

test("Responses do not allow wildcard CORS or caching", async () => {
  configured();
  const fake = chatFixture();
  const result = await fake.handler(event([question()], null));
  assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.match(result.headers["Access-Control-Allow-Headers"], /Authorization/);
});

test("Browser requires bearer token, ignores legacy browser auth and responds to 401", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  assert.match(source, /'Authorization': 'Bearer ' \+ brentwoodSessionToken/);
  assert.match(source, /if \(response.status === 401\)/);
  assert.doesNotMatch(source, /localStorage\.getItem\('respond-bcc-auth'\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\('respond-bcc-auth'/);
  assert.match(source, /let brentwoodSessionToken = null/);
});
