/**
 * Compara cada cuenta integrada (plantilla en auth.js) con Patrick (gneex-builtin-5):
 * pestañas / matriz principal y acciones finas efectivas (como ve la app).
 *
 * Uso: node scripts/compare-builtins-to-patrick.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { webcrypto } from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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
  localStorage: {
    _m: new Map(),
    getItem(k) {
      return this._m.has(k) ? this._m.get(k) : null;
    },
    setItem(k, v) {
      this._m.set(k, String(v));
    },
    removeItem(k) {
      this._m.delete(k);
    }
  },
  STORAGE_KEYS
};

vm.createContext(context);
vm.runInContext(`${authSrc}\n;globalThis.Auth = Auth;`, context);
const Auth = context.Auth;

const PATRICK_ID = "gneex-builtin-5";
const ORDER = { none: 0, view: 1, edit: 2 };

function lvl(v) {
  const x = v === "none" || v === "view" || v === "edit" ? v : "none";
  return ORDER[x] ?? 0;
}

function label(diff) {
  if (diff > 0) return "más que Patrick";
  if (diff < 0) return "menos que Patrick";
  return "igual";
}

function builtinTemplate(id) {
  return Auth._getBuiltinUser(id);
}

const pat = builtinTemplate(PATRICK_ID);
if (!pat || pat.role === "admin") {
  console.error("No se encontró plantilla Patrick");
  process.exit(1);
}

const patMx = Auth.getUserPermissionMatrix(pat);
const patAct = Auth.getEffectivePermissionActionMatrix(pat);

const matrixKeys = [...Auth.MATRIX_KEYS];
const actionKeys = [
  ...Auth.CONFIG_ACTION_KEYS,
  ...Auth.ORDER_ACTION_KEYS,
  ...Auth.TAB_FEATURE_ACTION_KEYS
];

const ids = (Auth.BUILTIN_IDS_ORDERED || []).filter(id => id !== "gneex-builtin-1");

console.log("\n=== Integrados vs Patrick (plantilla en código) ===\n");
console.log(
  "Referencia: Patrick —",
  pat.displayName || pat.username,
  "(" + PATRICK_ID + ")\n"
);

for (const id of ids) {
  if (id === PATRICK_ID) continue;
  const u = builtinTemplate(id);
  if (!u) {
    console.log(`--- ${id}: (sin plantilla)\n`);
    continue;
  }
  const name = `${u.displayName || u.username} (${id})`;
  const mx = Auth.getUserPermissionMatrix(u);
  const act = Auth.getEffectivePermissionActionMatrix(u);

  const mxLess = [];
  const mxMore = [];
  for (const k of matrixKeys) {
    const d = lvl(mx[k]) - lvl(patMx[k]);
    if (d < 0) mxLess.push(`${k}: ${mx[k] || "none"} vs Patrick ${patMx[k] || "none"}`);
    if (d > 0) mxMore.push(`${k}: ${mx[k] || "none"} vs Patrick ${patMx[k] || "none"}`);
  }

  const actLess = [];
  const actMore = [];
  for (const k of actionKeys) {
    const d = lvl(act[k]) - lvl(patAct[k]);
    if (d < 0) actLess.push(`${k}: ${act[k] || "none"} vs Pat ${patAct[k] || "none"}`);
    if (d > 0) actMore.push(`${k}: ${act[k] || "none"} vs Pat ${patAct[k] || "none"}`);
  }

  console.log(`── ${name}`);
  console.log(
    `   Resumen matriz: ${mxLess.length} claves por debajo de Patrick, ${mxMore.length} por encima (solo donde difiere).`
  );
  console.log(
    `   Resumen acciones: ${actLess.length} por debajo, ${actMore.length} por encima.\n`
  );

  if (mxLess.length) {
    console.log("   [Matriz] Menos opción que Patrick:");
    mxLess.slice(0, 40).forEach(line => console.log("      • " + line));
    if (mxLess.length > 40) console.log(`      … +${mxLess.length - 40} más`);
    console.log("");
  }
  if (mxMore.length) {
    console.log("   [Matriz] Más opción que Patrick:");
    mxMore.slice(0, 40).forEach(line => console.log("      • " + line));
    if (mxMore.length > 40) console.log(`      … +${mxMore.length - 40} más`);
    console.log("");
  }
  if (actLess.length) {
    console.log("   [Acciones finas] Menos que Patrick (primeras 35):");
    actLess.slice(0, 35).forEach(line => console.log("      • " + line));
    if (actLess.length > 35) console.log(`      … +${actLess.length - 35} más`);
    console.log("");
  }
  if (actMore.length) {
    console.log("   [Acciones finas] Más que Patrick (primeras 35):");
    actMore.slice(0, 35).forEach(line => console.log("      • " + line));
    if (actMore.length > 35) console.log(`      … +${actMore.length - 35} más`);
    console.log("");
  }
  if (!mxLess.length && !mxMore.length && !actLess.length && !actMore.length) {
    console.log("   (Misma fuerza efectiva que Patrick en todas las claves comparadas.)\n");
  }
}

console.log("Nota: comparación entre plantillas del código (no el JSON del respaldo).\n");
