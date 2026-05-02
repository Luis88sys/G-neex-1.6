const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readUsers() {
  const list = readJson(USERS_FILE, []);
  return Array.isArray(list) ? list : [];
}

function writeUsers(users) {
  writeJson(USERS_FILE, users);
}

function findUserByUsername(username) {
  const u = (username || "").trim().toLowerCase();
  if (!u) return null;
  return readUsers().find(x => (x.username || "").toLowerCase() === u) || null;
}

function findUserById(id) {
  return readUsers().find(x => x.id === id) || null;
}

function upsertUser(user) {
  const users = readUsers();
  const idx = users.findIndex(x => x.id === user.id);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  writeUsers(users);
}

module.exports = {
  DATA_DIR,
  USERS_FILE,
  readUsers,
  writeUsers,
  findUserByUsername,
  findUserById,
  upsertUser
};
