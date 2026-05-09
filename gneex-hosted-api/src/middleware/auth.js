const jwt = require("jsonwebtoken");
const config = require("../config");
const db = require("../db");

function extractBearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "missing_token" });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const sub = payload.sub;
    const user = db.findUserById(sub);
    if (!user) {
      return res.status(401).json({ ok: false, error: "user_not_found" });
    }
    req.auth = {
      userId: user.id,
      username: user.username,
      role: user.role || "user"
    };
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") {
    return res.status(403).json({ ok: false, error: "admin_required" });
  }
  next();
}

function canSyncWrite(req) {
  if (config.syncWriteRole === "all") return true;
  return req.auth && req.auth.role === "admin";
}

module.exports = { extractBearer, requireAuth, requireAdmin, canSyncWrite };
