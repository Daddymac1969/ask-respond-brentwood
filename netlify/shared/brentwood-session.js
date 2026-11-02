"use strict";
// Review candidate only: install BRENTWOOD_SESSION_SECRET in the authorised Netlify environment.
// Tokens convey short-lived access to the Brentwood chat endpoint, not safeguarding authority.
const crypto = require("node:crypto");
const AUDIENCE = "respond-brentwood-chat-v1";
const TTL_SECONDS = 1800;
function getSecret() {
  const value = process.env.BRENTWOOD_SESSION_SECRET;
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32 ? value : null;
}
function sign(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}
function issueSession() {
  const secret = getSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ aud: AUDIENCE, iat: now, exp: now + TTL_SECONDS }), "utf8").toString("base64url");
  return body + "." + sign(body, secret);
}
function verifySession(token) {
  const secret = getSecret();
  if (!secret || typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  try {
    const [body, provided] = token.split(".");
    const expected = Buffer.from(sign(body, secret), "base64url");
    const received = Buffer.from(provided, "base64url");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    return claims && claims.aud === AUDIENCE &&
      Number.isInteger(claims.iat) && Number.isInteger(claims.exp) &&
      claims.iat <= now + 30 && claims.exp > now &&
      claims.exp > claims.iat && claims.exp - claims.iat <= TTL_SECONDS;
  } catch (_) { return false; }
}
function bearer(headers) {
  const authorization = headers?.authorization || headers?.Authorization;
  const match = typeof authorization === "string" ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization) : null;
  return match ? match[1] : null;
}
module.exports = { issueSession, verifySession, bearer, getSecret, TTL_SECONDS };
