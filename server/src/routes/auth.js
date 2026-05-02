const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { hashPassword, randomSalt } = require("../hash");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ ok: true, service: "gneex-api", time: new Date().toISOString() });
});

/**
 * Registro inicial: solo si no hay usuarios (bootstrap).
 * Body: { username, email, password, displayName?, role? }
 */
router.post("/register-bootstrap", (req, res) => {
  const users = db.readUsers();
  if (users.length > 0) {
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
  db.upsertUser({
    id,
    username,
    email,
    displayName,
    role,
    salt,
    passwordHash,
    createdAt: new Date().toISOString()
  });
  return res.json({ ok: true, id });
});

/**
 * Login contra el almacén del servidor (opcional para integrar la SPA más adelante).
 */
router.post("/login", (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const u = db.findUserByUsername(username);
  if (!u || !u.salt || !u.passwordHash) {
    return res.status(401).json({ ok: false, error: "bad_credentials" });
  }
  const h = hashPassword(password, u.salt);
  if (h !== u.passwordHash) {
    return res.status(401).json({ ok: false, error: "bad_credentials" });
  }
  res.json({
    ok: true,
    user: {
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      email: u.email,
      role: u.role || "user"
    }
  });
});

module.exports = router;
