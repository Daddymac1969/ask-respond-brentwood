"use strict";
// Ask RESPOND Brentwood: server-side access-code verification.
// A successful login issues a short-lived signed token. No auth state is trusted from the browser.
const crypto = require("node:crypto");
const { issueSession, getSecret, TTL_SECONDS } = require("../shared/brentwood-session");
const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Method not allowed" });
  if (!getSecret() || !process.env.BRENTWOOD_ACCESS_CODE) {
    return reply(503, { success: false, configError: true, error: "Guidance service is not configured. Contact your administrator." });
  }
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (_) { return reply(400, { success: false, error: "Invalid request" }); }
  if (!body || typeof body.password !== "string" || !body.password.trim() || body.password.length > 512) {
    return reply(400, { success: false, error: "Access code required" });
  }
  try {
    const actual = crypto.createHash("sha256").update(body.password.trim()).digest();
    const expected = crypto.createHash("sha256").update(process.env.BRENTWOOD_ACCESS_CODE.trim()).digest();
    if (!crypto.timingSafeEqual(actual, expected)) return reply(200, { success: false });
    const token = issueSession();
    if (!token) return reply(503, { success: false, error: "Guidance service unavailable" });
    return reply(200, { success: true, token, expiresIn: TTL_SECONDS });
  } catch (_) {
    return reply(503, { success: false, error: "Guidance service unavailable" });
  }
};
