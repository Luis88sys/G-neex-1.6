/**
 * Repara `data["phoenix-users"]` en un respaldo G-NEEX usando la misma lógica que
 * migrateUserPerms + syncBuiltinStoredUsersWithTemplate en auth.js (sin navegador).
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { webcrypto } from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function stripBom(s) {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem(k) {
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      m.set(k, String(v));
    },
    removeItem(k) {
      m.delete(k);
    }
  };
}

/** Claves usadas por auth.js (mismo contrato que utils.js). */
const STORAGE_KEYS = {
  USERS: "phoenix-users",
  SESSION: "phoenix-session",
  AUDIT: "phoenix-audit",
  ELEVATION_POOL: "phoenix-elevation-pool",
  ELEVATION_OUTSTANDING: "phoenix-elevation-outstanding",
  ELEVATION_CONSUMED: "phoenix-elevation-consumed"
};

const authPath = path.join(root, "js", "auth.js");
const authSrc = fs.readFileSync(authPath, "utf8");

const context = {
  console,
  crypto: webcrypto,
  btoa: bin => Buffer.from(bin, "binary").toString("base64"),
  atob: b64 => Buffer.from(b64, "base64").toString("binary"),
  TextEncoder,
  TextDecoder,
  Uint8Array,
  ArrayBuffer,
  localStorage: makeLocalStorage(),
  STORAGE_KEYS
};

vm.createContext(context);

try {
  vm.runInContext(`${authSrc}\n;globalThis.Auth = Auth;`, context);
} catch (e) {
  console.error("No se pudo cargar auth.js en VM:", e);
  process.exit(1);
}

const Auth = context.Auth;
if (!Auth || typeof Auth.syncBuiltinStoredUsersWithTemplate !== "function") {
  console.error("Auth.syncBuiltinStoredUsersWithTemplate no disponible");
  process.exit(1);
}

const backupPath = path.resolve(process.argv[2] || path.join(root, "GNEEX_Backup_2026-05-08_18-26-40.json"));
const raw = stripBom(fs.readFileSync(backupPath, "utf8"));
const backup = JSON.parse(raw);

const usersKey = "phoenix-users";
const usersJson = backup.data && backup.data[usersKey];
if (typeof usersJson !== "string") {
  console.error(`No hay data["${usersKey}"] (string) en el respaldo`);
  process.exit(1);
}

Auth.users = JSON.parse(usersJson);
if (!Array.isArray(Auth.users)) {
  console.error("phoenix-users no es un array JSON");
  process.exit(1);
}

/**
 * Sustituye perfil de cuentas integradas por la plantilla en código (sin pisar credenciales).
 * Sin esto, syncBuiltinStoredUsersWithTemplate solo sube permisos (`max`) y no puede bajar una matriz
 * antigua cuando la plantilla se endurece (p. ej. Patrick sin pedidos).
 */
function resetBuiltinsFromTemplate(Auth, users) {
  for (const u of users) {
    if (!u || !Auth.isBuiltinId(u.id) || u.id === "gneex-builtin-1") continue;
    const tmpl = Auth._getBuiltinUser(u.id);
    if (!tmpl) continue;
    const keep = {
      id: u.id,
      username: u.username,
      salt: u.salt,
      passwordHash: u.passwordHash,
      passwordHistory: Array.isArray(u.passwordHistory) ? u.passwordHistory : [],
      builtin: true
    };
    Object.assign(u, tmpl, keep);
  }
}

resetBuiltinsFromTemplate(Auth, Auth.users);
Auth.users.forEach(u => Auth.migrateUserPerms(u));
Auth.syncBuiltinStoredUsersWithTemplate();

/** Respaldos antiguos a veces tienen la misma cuenta dos veces (id numérico + gneex-builtin-*). Conservar la integrada. */
function dedupeByUsernamePreferBuiltin(Auth, users) {
  const byName = new Map();
  const noName = [];
  for (const u of users) {
    const un = (u.username || "").trim().toLowerCase();
    if (!un) {
      noName.push(u);
      continue;
    }
    const prev = byName.get(un);
    if (!prev) {
      byName.set(un, u);
      continue;
    }
    const pBuilt = Auth.isBuiltinId(prev.id);
    const uBuilt = Auth.isBuiltinId(u.id);
    if (uBuilt && !pBuilt) byName.set(un, u);
    else if (pBuilt && !uBuilt) {
      /* mantener prev */
    } else {
      byName.set(un, prev);
    }
  }
  return [...byName.values(), ...noName];
}

Auth.users = dedupeByUsernamePreferBuiltin(Auth, Auth.users);

/* Política actual: importar respaldo JSON permitido con sesión (matriz persistida coherente). */
Auth.users.forEach(u => {
  if (u.permissionActionMatrix && typeof u.permissionActionMatrix === "object") {
    u.permissionActionMatrix.cfgActBackupImport = "edit";
  }
});

backup.data[usersKey] = JSON.stringify(Auth.users);

const outArg = process.argv[3];
const outPath = outArg ? path.resolve(outArg) : backupPath;

fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), "utf8");
console.log("Listo:", outPath);
