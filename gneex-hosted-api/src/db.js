const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("./config");

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

let _db;

function getDb() {
  if (_db) return _db;
  ensureDataDir();
  _db = new Database(path.resolve(config.dbPath));
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE,
      email TEXT,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      k TEXT PRIMARY KEY,
      v TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);
}

function countUsers() {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM users").get();
  return row ? row.n : 0;
}

function findUserByUsername(username) {
  const u = (username || "").trim();
  if (!u) return null;
  return getDb().prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(u) || null;
}

function findUserById(id) {
  if (!id) return null;
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

function insertUser(row) {
  getDb()
    .prepare(
      `INSERT INTO users (id, username, email, display_name, role, salt, password_hash, created_at)
       VALUES (@id, @username, @email, @display_name, @role, @salt, @password_hash, @created_at)`
    )
    .run(row);
}

function getAllKv() {
  const rows = getDb().prepare("SELECT k, v FROM kv_store").all();
  const out = {};
  for (const r of rows) {
    out[r.k] = r.v;
  }
  return out;
}

function getKv(key) {
  const row = getDb().prepare("SELECT v FROM kv_store WHERE k = ?").get(key);
  return row ? row.v : null;
}

function upsertKv(key, value, updatedAt) {
  const at = updatedAt || new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO kv_store (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
    )
    .run(key, value, at);
}

function upsertMany(map) {
  const db = getDb();
  const at = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO kv_store (k, v, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(map)) {
      if (k === "phoenix-session") continue;
      const str = v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v);
      stmt.run(k, str, at);
    }
  });
  tx();
}

function deleteKv(key) {
  getDb().prepare("DELETE FROM kv_store WHERE k = ?").run(key);
}

function clearAllKv() {
  getDb().prepare("DELETE FROM kv_store").run();
}

function getMeta(key) {
  const row = getDb().prepare("SELECT v FROM app_meta WHERE k = ?").get(key);
  return row ? row.v : null;
}

function setMeta(key, value) {
  getDb()
    .prepare("INSERT INTO app_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .run(key, value);
}

function bumpRevision() {
  const cur = parseInt(getMeta("revision") || "0", 10) || 0;
  const next = String(cur + 1);
  setMeta("revision", next);
  return next;
}

module.exports = {
  getDb,
  countUsers,
  findUserByUsername,
  findUserById,
  insertUser,
  getAllKv,
  getKv,
  upsertKv,
  upsertMany,
  deleteKv,
  clearAllKv,
  getMeta,
  setMeta,
  bumpRevision
};
