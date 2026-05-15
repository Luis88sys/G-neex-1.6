/**
 * Repara un respaldo G-NEEX completo:
 * - `data["phoenix-users"]`: migrateUserPerms + syncBuiltinStoredUsersWithTemplate (auth.js en VM).
 * - `data["phoenix-movements"]`: fusiona todas las listas de movimientos encontradas en el archivo
 *   (string JSON en phoenix-movements, `_rawMovements`, `movements` legible) y opcionalmente otros JSON
 *   pasados como argv[4…], deduplicando por `id` y conservando la copia más completa por movimiento.
 * - Tras fusionar: en `COMPRA_STOCK` y `RECEPCION_MATERIAL` fuerza `hadOverdraft: false` y quita
 *   `overdraftReason` en la raíz del movimiento si existía (misma regla que `MovementManager.effectiveHadOverdraft` en la app).
 * - Claves `data["phoenix-*"]` presentes en `js/utils.js` (STORAGE_KEYS) y ausentes en el JSON: se rellenan
 *   con valores por defecto seguros (tema, idioma, vistas, posiciones de globos, layouts) para alinear el
 *   archivo con la plantilla actual de importación.
 *
 * Compatibilidad: los objetos de movimiento y de cada línea (`items[]`) pueden traer propiedades nuevas
 * o ausentes según la versión que generó el respaldo (p. ej. metadatos de ajuste por caja, notas
 * ampliadas, `salesOrder` / `prNumber` en la raíz para venta directa y expedición de stock). La fusión no las elimina; solo elige qué copia de cada `id` conservar por «plenitud».
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

const MOV_KEY = "phoenix-movements";

/** Prioriza registros con más detalle (ítems, campos) para no pisar un movimiento completo con un resumen. */
function movementFullness(m) {
  if (!m || typeof m !== "object") return 0;
  let n = Object.keys(m).length;
  if (Array.isArray(m.items)) {
    n += m.items.length * 3;
    for (const it of m.items) {
      if (it && typeof it === "object") n += Object.keys(it).length;
    }
  }
  return n;
}

function mergeMovementLists(labeled) {
  const byId = new Map();
  for (const { arr } of labeled) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (!m || typeof m !== "object") continue;
      const id = m.id != null ? String(m.id) : "";
      if (!id) continue;
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, m);
        continue;
      }
      const fp = movementFullness(prev);
      const fn = movementFullness(m);
      if (fn > fp) byId.set(id, m);
      else if (fn === fp && JSON.stringify(m).length > JSON.stringify(prev).length) byId.set(id, m);
    }
  }
  const out = Array.from(byId.values());
  out.sort((a, b) => {
    const ta = new Date(a?.date || 0).getTime();
    const tb = new Date(b?.date || 0).getTime();
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    if (va !== vb) return va - vb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  return out;
}

/** Alineado con MovementManager.effectiveHadOverdraft: compra/recepción no usan sobregiro en UI. */
const NO_OVERDRAFT_MOVEMENT_TYPES = new Set(["COMPRA_STOCK", "RECEPCION_MATERIAL"]);

function normalizeInboundOverdraftFlags(movements) {
  if (!Array.isArray(movements)) return 0;
  let n = 0;
  for (const m of movements) {
    if (!m || typeof m !== "object") continue;
    const t = m.type;
    if (!t || !NO_OVERDRAFT_MOVEMENT_TYPES.has(t)) continue;
    if (!m.hadOverdraft) continue;
    m.hadOverdraft = false;
    if (m.overdraftReason != null && m.overdraftReason !== "") {
      delete m.overdraftReason;
    }
    n++;
  }
  return n;
}

function parseMovementsString(raw) {
  if (raw == null || raw === "") return { ok: true, arr: [] };
  if (typeof raw !== "string") return { ok: false, arr: [] };
  try {
    const arr = JSON.parse(raw);
    return { ok: true, arr: Array.isArray(arr) ? arr : [] };
  } catch {
    return { ok: false, arr: [] };
  }
}

function collectMovementSources(backupRoot, extraPaths) {
  /** @type {{ label: string; arr: unknown[] }[]} */
  const sources = [];

  if (backupRoot.data && typeof backupRoot.data === "object") {
    const raw = backupRoot.data[MOV_KEY];
    const { ok, arr } = parseMovementsString(raw);
    sources.push({
      label: ok ? `data.${MOV_KEY} (${arr.length})` : `data.${MOV_KEY} (JSON inválido → 0 parseados)`,
      arr
    });
    if (!ok && typeof raw === "string" && raw.trim().length > 0) {
      console.warn(
        "Advertencia: data[\"phoenix-movements\"] no es JSON válido; intente fusionar con _rawMovements o un archivo de archivo adjunto."
      );
    }
  }

  if (Array.isArray(backupRoot._rawMovements)) {
    sources.push({ label: `root._rawMovements (${backupRoot._rawMovements.length})`, arr: backupRoot._rawMovements });
  }
  if (Array.isArray(backupRoot.movements)) {
    sources.push({ label: `root.movements (${backupRoot.movements.length})`, arr: backupRoot.movements });
  }

  for (const ep of extraPaths) {
    try {
      const txt = stripBom(fs.readFileSync(ep, "utf8"));
      const parsed = JSON.parse(txt);
      if (parsed.data && typeof parsed.data === "object" && parsed.data[MOV_KEY] != null) {
        const { ok, arr } = parseMovementsString(parsed.data[MOV_KEY]);
        if (arr.length)
          sources.push({
            label: `${path.basename(ep)} data.${MOV_KEY} (${arr.length})${ok ? "" : " parse parcial"}`,
            arr
          });
      }
      if (Array.isArray(parsed._rawMovements) && parsed._rawMovements.length) {
        sources.push({
          label: `${path.basename(ep)}._rawMovements (${parsed._rawMovements.length})`,
          arr: parsed._rawMovements
        });
      }
      if (Array.isArray(parsed.movements) && parsed.movements.length) {
        sources.push({
          label: `${path.basename(ep)}.movements (${parsed.movements.length})`,
          arr: parsed.movements
        });
      }
    } catch (e) {
      console.warn("No se pudieron leer movimientos extra de", ep, e.message || e);
    }
  }

  return sources;
}

function repairMovementsInBackup(backupRoot, extraMovementFiles) {
  if (!backupRoot.data || typeof backupRoot.data !== "object") {
    console.warn("Sin data: se omitió fusión de movimientos.");
    return;
  }

  const labeled = collectMovementSources(backupRoot, extraMovementFiles);
  const nonempty = labeled.filter(s => Array.isArray(s.arr) && s.arr.length > 0);
  if (!nonempty.length) {
    console.warn("Movimientos: no hay listas no vacías para fusionar.");
    return;
  }

  const merged = mergeMovementLists(labeled);
  if (!merged.length) {
    console.warn("Movimientos: tras fusionar no quedó ningún movimiento con id.");
    return;
  }

  const fixedOd = normalizeInboundOverdraftFlags(merged);
  if (fixedOd) {
    console.log(
      `Movimientos: ${fixedOd} movimiento(s) COMPRA_STOCK/RECEPCION_MATERIAL con hadOverdraft forzado a false (coherente con la app).`
    );
  }

  backupRoot.data[MOV_KEY] = JSON.stringify(merged);
  console.log(`Movimientos: ${merged.length} únicos ← ${nonempty.map(s => s.label).join("; ")}`);
}

/**
 * Añade en `data` las claves `phoenix-*` definidas en `js/utils.js` (STORAGE_KEYS)
 * que falten en el respaldo, con valores por defecto seguros para importación.
 * Muchos respaldos antiguos no traían preferencias de UI (tema, idioma, vistas);
 * sin ellas el import solo no borra esas claves en localStorage, pero el JSON
 * queda incompleto respecto a la plantilla actual.
 */
function parseStorageKeysFromUtilsFile(utilsPath) {
  const raw = stripBom(fs.readFileSync(utilsPath, "utf8"));
  const cut = raw.indexOf("\nconst MOVEMENT_TYPES");
  const head = cut === -1 ? raw : raw.slice(0, cut);
  const keys = [];
  for (const m of head.matchAll(/^\s+[A-Z0-9_]+:\s*'(phoenix[^']+)'/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

function ensureBackupDataKeysFromUtilsTemplate(backupRoot, rootDir) {
  if (!backupRoot.data || typeof backupRoot.data !== "object") return;
  const utilsPath = path.join(rootDir, "js", "utils.js");
  let templateKeys;
  try {
    templateKeys = parseStorageKeysFromUtilsFile(utilsPath);
  } catch (e) {
    console.warn("No se pudieron leer claves desde utils.js:", e.message || e);
    return;
  }
  if (!templateKeys.length) {
    console.warn("Plantilla de claves vacía (utils.js).");
    return;
  }
  /** Valores string tal como van a `localStorage` (mismas convenciones que la app). */
  const optionalDefaults = {
    "phoenix-theme": "dark",
    "phoenix-lang": "es",
    "phoenix-float-standby-dismissed": "false",
    "phoenix-float-consumo-dismissed": "false",
    "phoenix-float-pos-standby": "{}",
    "phoenix-float-pos-consumo": "{}",
    "phoenix-float-pos-draft-movement": "{}",
    "phoenix-float-pos-draft-config": "{}",
    "phoenix-view-history-ui": "tiles",
    "phoenix-view-transport-ui": "tiles",
    "phoenix-view-orderlines-ui": "table",
    "phoenix-nav-open-target": "same",
    "phoenix-modal-layouts": "{}",
    "phoenix-table-column-layouts": "[]"
  };
  let added = 0;
  const unknown = [];
  for (const k of templateKeys) {
    if (Object.prototype.hasOwnProperty.call(backupRoot.data, k)) continue;
    if (Object.prototype.hasOwnProperty.call(optionalDefaults, k)) {
      backupRoot.data[k] = optionalDefaults[k];
      added++;
    } else {
      unknown.push(k);
    }
  }
  if (added) console.log(`Data: ${added} clave(s) opcional(es) añadida(s) (plantilla utils / importación completa).`);
  if (unknown.length) {
    console.warn(
      "Data: faltan claves respecto a utils.js sin valor por defecto en el script; añádalas manualmente o amplíe optionalDefaults:",
      unknown.join(", ")
    );
  }
}

const outArg = process.argv[3];
const outPath = outArg ? path.resolve(outArg) : backupPath;

const extraMovementPaths = process.argv.slice(4).map(p => path.resolve(p));
repairMovementsInBackup(backup, extraMovementPaths);
ensureBackupDataKeysFromUtilsTemplate(backup, root);

backup.meta = backup.meta && typeof backup.meta === "object" ? backup.meta : {};
backup.meta.repairAppliedUtc = new Date().toISOString();
backup.meta.repairScript =
  "scripts/repair-backup-users.mjs (users + movement merge + inbound hadOverdraft normalize + phoenix-* defaults)";

fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), "utf8");
console.log("Listo:", outPath);
