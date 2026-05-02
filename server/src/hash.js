/**
 * Misma derivación que el cliente (`js/auth.js`): SHA-256 de `g-neex-v1|salt|password`.
 */
const crypto = require("crypto");

function hashPassword(password, salt) {
  const data = `g-neex-v1|${salt}|${password}`;
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function randomSalt() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = { hashPassword, randomSalt };
