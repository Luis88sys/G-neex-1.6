const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const config = require("../config");
const db = require("../db");
const { hashPassword, randomSalt } = require("../hash");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role || "user" },
    config.jwtSecret,
    { expiresIn: `${config.jwtExpiresDays}d` }
  );
}

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "gneex-hosted-api",
    time: new Date().toISOString()
  });
});

/**
 * Primera cuenta: solo si la base no tiene usuarios.
 * Body: { username, email, password, displayName?, role? }
 */
router.post("/bootstrap", bootstrapLimiter, (req, res) => {
  if (db.countUsers() > 0) {
    return res.status(403).json({ ok: false, error: "already_initialized" });
  }
  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim();
  const password = req.body.password || "";
  const displayName = (req.body.displayName || "").trim() || username;
  const role = req.body.role === "admin" ? "admin" : "user";

  if (username.length < 2 || password.length < 6 || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "invalid_fields" });
  }

  const salt = randomSalt();
  const passwordHash = hashPassword(password, salt);
  const id = `usr_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();

  db.insertUser({
    id,
    username,
    email,
    display_name: displayName,
    role,
    salt,
    password_hash: passwordHash,
    created_at: createdAt
  });

  const user = db.findUserById(id);
  const token = signToken(user);
  return res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      email: user.email,
      role: user.role || "user"
    }
  });
});

router.post("/login", loginLimiter, (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const u = db.findUserByUsername(username);
  if (!u || !u.salt || !u.password_hash) {
    return res.status(401).json({ ok: false, error: "bad_credentials" });
  }
  const h = hashPassword(password, u.salt);
  if (h !== u.password_hash) {
    return res.status(401).json({ ok: false, error: "bad_credentials" });
  }
  const token = signToken(u);
  res.json({
    ok: true,
    token,
    user: {
      id: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      email: u.email,
      role: u.role || "user"
    }
  });
});

module.exports = router;
