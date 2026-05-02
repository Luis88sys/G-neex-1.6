#!/usr/bin/env node
/**
 * Genera un JSON de respaldo G-NEEX importable desde Configuración,
 * a partir de migration/intermediate.json (inventario + movimientos) y phoenix-type-map.json.
 *
 * Uso:
 *   node build-gneex-backup.mjs --input intermediate.json --output ../Backup/GNEEX_MIGRATED.json
 *   node build-gneex-backup.mjs --input intermediate.json --output out.json --base ../Backup/GNEEX_Backup_actual.json
 *
 * --base: opcional. Mezcla: conserva usuarios, tema, transportes, etc. del respaldo base;
 *         sustituye inventario, movimientos y contadores SEQ derivados del intermedio.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Mismas claves que STORAGE_KEYS en js/utils.js (orden no importa). */
const STORAGE_KEY_VALUES = [
    "phoenix-inventory",
    "phoenix-purchases",
    "phoenix-movements",
    "phoenix-transport",
    "phoenix-pending-elec-obra",
    "phoenix-pending-elec-prod",
    "phoenix-purchase-orders",
    "phoenix-order-lines",
    "phoenix-item-edit-pin",
    "phoenix-receptions",
    "phoenix-theme",
    "phoenix-lang",
    "phoenix-test-mode",
    "phoenix-test-demo-snapshot-v1",
    "phoenix-users",
    "phoenix-session",
    "phoenix-audit",
    "phoenix-seq-movement-ref",
    "phoenix-seq-movement-ref-by-type",
    "phoenix-seq-entity-id",
    "phoenix-reminders",
    "phoenix-consumo-cart",
    "phoenix-consumo-auto-day",
    "phoenix-float-standby-dismissed",
    "phoenix-float-consumo-dismissed",
    "phoenix-app-last-session-day",
    "phoenix-consumo-cart-activity-day",
    "phoenix-float-pos-standby",
    "phoenix-float-pos-consumo",
    "phoenix-employees",
    "phoenix-occasional-recipients",
    "phoenix-suppliers",
    "phoenix-exp-alert",
    "phoenix-me-legacy",
    "phoenix-elevation-pool",
    "phoenix-elevation-outstanding",
    "phoenix-elevation-consumed",
    "phoenix-location-catalog",
    "phoenix-location-catalog-base-disabled",
    "phoenix-location-catalog-custom-disabled",
    "phoenix-nav-open-target",
    "phoenix-modal-layouts",
    "phoenix-table-column-layouts",
    "phoenix-view-history-ui",
    "phoenix-view-transport-ui",
    "phoenix-view-orderlines-ui"
];

/** Misma tabla que MOVEMENT_REF_PREFIX en js/utils.js */
const MOVEMENT_REF_PREFIX = {
    AJUSTE: "AJU",
    CONSUMO_DIARIO: "CDI",
    FERRETERIA: "FER",
    ESPECIAL: "ESP",
    LISTA_CHEQUEO: "LCH",
    MERMA: "MER",
    RETORNO: "RET",
    DESMANTELAR: "DES",
    TRANSFERENCIA: "TRF",
    TRANSFORMACION: "TRN",
    ENVIAR_PRODUCCION: "EVP",
    MAT_ELEC_PROD: "MEP",
    MAT_ELEC_OBRA: "MEO",
    STANDBY: "STB",
    COMPRA_STOCK: "COM",
    RECEPCION_MATERIAL: "REM"
};

const MOVEMENT_REF_PREFIX_TO_TYPE = Object.fromEntries(
    Object.entries(MOVEMENT_REF_PREFIX).map(([typ, pre]) => [pre, typ])
);

const MOVEMENT_REF_NUM_DIGITS = 6;
function formatMovementRefNumericPart(num) {
    let n = Math.abs(Math.trunc(Number(num)));
    if (!Number.isFinite(n)) n = 0;
    const cap = Math.pow(10, MOVEMENT_REF_NUM_DIGITS);
    if (n >= cap) n = n % cap;
    return String(n).padStart(MOVEMENT_REF_NUM_DIGITS, "0");
}

const VALID_TYPES = new Set([
    "AJUSTE",
    "CONSUMO_DIARIO",
    "FERRETERIA",
    "ESPECIAL",
    "LISTA_CHEQUEO",
    "MERMA",
    "RETORNO",
    "DESMANTELAR",
    "TRANSFERENCIA",
    "TRANSFORMACION",
    "ENVIAR_PRODUCCION",
    "MAT_ELEC_PROD",
    "MAT_ELEC_OBRA",
    "STANDBY",
    "COMPRA_STOCK",
    "RECEPCION_MATERIAL"
]);

function parseArgs() {
    const a = process.argv.slice(2);
    const o = { input: null, output: null, base: null };
    for (let i = 0; i < a.length; i++) {
        if (a[i] === "--input" && a[i + 1]) o.input = a[++i];
        else if (a[i] === "--output" && a[i + 1]) o.output = a[++i];
        else if (a[i] === "--base" && a[i + 1]) o.base = a[++i];
    }
    return o;
}

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Igual que Utils.normalizeMovementReference — referencias intermedias solo dígitos o legacy. */
function normalizeMovementReference(movType, reference) {
    const typeKey = movType || "AJUSTE";
    let prefix = MOVEMENT_REF_PREFIX[typeKey];
    if (!prefix) {
        prefix = String(typeKey)
            .replace(/[^A-Za-z]/g, "")
            .toUpperCase()
            .slice(0, 3)
            .padEnd(3, "X");
    }
    let refStr = String(reference ?? "").trim();
    if (refStr.startsWith("#")) refStr = refStr.slice(1).trim();
    if (!refStr) return String(reference ?? "").trim();

    let m = refStr.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
    if (m) {
        const num = parseInt(m[1], 10);
        if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
    }
    m = refStr.match(/^([A-Z]{2,6})(\d+)$/i);
    if (m) {
        const num = parseInt(m[2], 10);
        if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
    }
    m = refStr.match(/^([A-Z]{2,6})-(\d+)$/i);
    if (m) {
        const num = parseInt(m[2], 10);
        if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
    }
    const digits = refStr.replace(/\D/g, "");
    if (digits) {
        const num = parseInt(digits, 10);
        if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
    }
    return refStr;
}

function toIsoDate(d) {
    if (d == null || d === "") return new Date().toISOString();
    if (typeof d === "number" && Number.isFinite(d)) return new Date(d).toISOString();
    const s = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00.000Z").toISOString();
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
    return new Date().toISOString();
}

function maxNumericRef(movements) {
    let max = 0;
    for (const m of movements || []) {
        const digits = String(m.reference || "").replace(/\D/g, "");
        if (!digits) continue;
        const n = parseInt(digits, 10);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
}

/** Alineado con Utils.syncMovementRefCounterFromMovements */
function buildMovementRefCountersFromMovements(movements) {
    const counters = {};
    for (const m of movements || []) {
        const ref = String(m.reference || "").trim();
        const typ = m.type || "";
        if (!ref || !typ) continue;

        const prefMatch = ref.match(/^([A-Z]{2,6})(\d+)$/i);
        if (prefMatch) {
            const pre = prefMatch[1].toUpperCase();
            const n = parseInt(prefMatch[2], 10);
            if (!Number.isFinite(n)) continue;
            const t = MOVEMENT_REF_PREFIX_TO_TYPE[pre] || typ;
            if (!counters[t] || n > counters[t]) counters[t] = n;
            continue;
        }
        const hyphenMatch = ref.match(/^([A-Z]{2,6})-(\d+)$/i);
        if (hyphenMatch) {
            const pre = hyphenMatch[1].toUpperCase();
            const n = parseInt(hyphenMatch[2], 10);
            if (!Number.isFinite(n)) continue;
            const t = MOVEMENT_REF_PREFIX_TO_TYPE[pre] || typ;
            if (!counters[t] || n > counters[t]) counters[t] = n;
            continue;
        }
        const digits = ref.replace(/\D/g, "");
        if (!digits) continue;
        const n = parseInt(digits, 10);
        if (!Number.isFinite(n)) continue;
        if (!counters[typ] || n > counters[typ]) counters[typ] = n;
    }
    return counters;
}

function maxEntityId(inventory, movements) {
    let max = 0;
    const consider = id => {
        if (id == null || id === "") return;
        const s = String(id).trim();
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    };
    (inventory || []).forEach(i => consider(i.id));
    (movements || []).forEach(m => consider(m.id));
    return max;
}

function emptyBackupData() {
    const data = {};
    for (const key of STORAGE_KEY_VALUES) {
        if (
            key === "phoenix-session" ||
            key === "phoenix-consumo-auto-day" ||
            key === "phoenix-float-standby-dismissed" ||
            key === "phoenix-float-consumo-dismissed" ||
            key === "phoenix-app-last-session-day" ||
            key === "phoenix-consumo-cart-activity-day" ||
            key === "phoenix-float-pos-standby" ||
            key === "phoenix-float-pos-consumo"
        ) {
            data[key] = null;
            continue;
        }
        if (key === "phoenix-pending-elec-obra") {
            data[key] = "{}";
            continue;
        }
        if (key === "phoenix-pending-elec-prod") {
            data[key] = "{}";
            continue;
        }
        if (key === "phoenix-seq-movement-ref-by-type") {
            data[key] = "{}";
            continue;
        }
        if (
            key === "phoenix-seq-movement-ref" ||
            key === "phoenix-seq-entity-id"
        ) {
            data[key] = "0";
            continue;
        }
        if (
            key === "phoenix-theme"
        ) {
            data[key] = "dark";
            continue;
        }
        if (key === "phoenix-lang") {
            data[key] = "es";
            continue;
        }
        if (key === "phoenix-item-edit-pin") {
            data[key] = "";
            continue;
        }
        if (key === "phoenix-test-mode") {
            data[key] = "0";
            continue;
        }
        if (key === "phoenix-test-demo-snapshot-v1") {
            data[key] = null;
            continue;
        }
        if (
            key === "phoenix-employees" ||
            key === "phoenix-occasional-recipients" ||
            key === "phoenix-suppliers"
        ) {
            data[key] = "[]";
            continue;
        }
        if (
            key === "phoenix-elevation-pool" ||
            key === "phoenix-elevation-outstanding" ||
            key === "phoenix-elevation-consumed" ||
            key === "phoenix-location-catalog" ||
            key === "phoenix-location-catalog-base-disabled" ||
            key === "phoenix-location-catalog-custom-disabled"
        ) {
            data[key] = "[]";
            continue;
        }
        if (key === "phoenix-nav-open-target") {
            data[key] = "same";
            continue;
        }
        if (key === "phoenix-modal-layouts" || key === "phoenix-table-column-layouts") {
            data[key] = "{}";
            continue;
        }
        if (
            key === "phoenix-view-history-ui" ||
            key === "phoenix-view-transport-ui" ||
            key === "phoenix-view-orderlines-ui"
        ) {
            data[key] = null;
            continue;
        }
        if (key === "phoenix-exp-alert") {
            data[key] = "30";
            continue;
        }
        data[key] = "[]";
    }
    return data;
}

function mapMovementType(raw, typeMapJson) {
    const map = typeMapJson.map || {};
    const key = String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
    if (VALID_TYPES.has(raw)) return raw;
    if (map[key]) return map[key];
    if (map[raw]) return map[raw];
    const def = typeMapJson.defaultType || "AJUSTE";
    if (!VALID_TYPES.has(def)) return "AJUSTE";
    return def;
}

function buildInventoryRows(rows) {
    let nextId = 0;
    const existing = new Set();
    for (const r of rows || []) {
        const id = r.id != null ? String(r.id).trim() : "";
        if (!id) continue;
        if (/^\d+$/.test(id)) {
            const n = parseInt(id, 10);
            if (n > nextId) nextId = n;
        }
        existing.add(id);
    }
    const out = [];
    for (const r of rows || []) {
        let id = r.id != null ? String(r.id).trim() : "";
        if (!id) {
            nextId += 1;
            id = String(nextId);
            while (existing.has(id)) {
                nextId += 1;
                id = String(nextId);
            }
            existing.add(id);
        } else if (!existing.has(id)) {
            existing.add(id);
        }
        out.push({
            id,
            code: String(r.code || "").trim(),
            description: String(r.description || "").trim(),
            category: String(r.category || "").trim(),
            mainStock: parseFloat(r.mainStock) || 0,
            prodStock: parseFloat(r.prodStock) || 0,
            transStock: parseFloat(r.transStock) || 0,
            location: String(r.location || r.Ubicacion || r.ubicacion || "").trim(),
            qtyPerBox: parseFloat(r.qtyPerBox) || 0,
            numBoxes: parseFloat(r.numBoxes) || 0,
            expDate: String(r.expDate || "").trim(),
            daysToExpire: parseInt(r.daysToExpire, 10) || 0,
            shelfLifeMonths: Math.max(0, parseInt(r.shelfLifeMonths, 10) || 0),
            expirationDate: String(r.expirationDate || "").trim(),
            supplier: String(r.supplier || "").trim(),
            lastOrder: String(r.lastOrder || "").trim(),
            details: String(r.details || "").trim(),
            defaultPrice: (() => {
                const n = parseFloat(r.defaultPrice != null ? r.defaultPrice : r.PrecioDefecto);
                if (!Number.isFinite(n)) return 0;
                return Math.round(n * 100) / 100;
            })(),
            minStock: parseFloat(r.minStock) || 0,
            maxStock: parseFloat(r.maxStock) || 0,
            expirations: Array.isArray(r.expirations) ? r.expirations : [],
            notes: String(r.notes || "").trim()
        });
    }
    return out;
}

function buildMovementRows(intermediate, inventoryByCode, typeMapJson) {
    const out = [];
    let movId = maxEntityId(intermediate.inventory || [], intermediate.movements || []) + 1;
    for (const m of intermediate.movements || []) {
        const type = mapMovementType(m.type, typeMapJson);
        if (!VALID_TYPES.has(type)) {
            console.warn("Tipo inválido, usando AJUSTE:", m.type, "→", type);
        }
        const items = [];
        for (const line of m.lines || []) {
            const code = String(line.code || "").trim();
            const inv = inventoryByCode.get(code.toLowerCase());
            if (!inv) {
                throw new Error(`Movimiento ref ${m.reference}: código de artículo no encontrado en inventario: "${code}"`);
            }
            const target = String(line.target || "main").trim();
            const qty = parseFloat(line.quantity);
            if (!Number.isFinite(qty)) {
                throw new Error(`Cantidad inválida en línea código "${code}"`);
            }
            items.push({
                itemId: inv.id,
                code: inv.code,
                description: inv.description,
                quantity: qty,
                target: target === "production" || target === "transformation" ? target : "main",
                location: String(line.location || line.Ubicacion || inv.location || "").trim(),
                annulled: !!line.annulled
            });
        }
        const resolvedType = VALID_TYPES.has(type) ? type : "AJUSTE";
        let ref =
            String(m.reference != null ? m.reference : "").trim() ||
            formatMovementRefNumericPart(out.length + 1);
        ref = normalizeMovementReference(resolvedType, ref);
        const mov = {
            id: String(m.id != null ? m.id : movId++),
            reference: ref,
            type: resolvedType,
            projectId: String(m.projectId || "").trim(),
            notes: String(m.notes || "").trim(),
            date: toIsoDate(m.date),
            items,
            hadOverdraft: !!m.hadOverdraft,
            annulled: !!m.annulled,
            createdBy: String(m.createdBy || "Migración Phoenix").trim()
        };
        if (m.overdraftReason) {
            mov.overdraftReason = String(m.overdraftReason);
            mov.overdraftAt = m.overdraftAt ? toIsoDate(m.overdraftAt) : mov.date;
        }
        if (m.purchaseMeta && typeof m.purchaseMeta === "object") {
            mov.purchaseMeta = {
                poNumber: String(m.purchaseMeta.poNumber || "").trim(),
                packingSlip: String(m.purchaseMeta.packingSlip || "").trim(),
                supplier: String(m.purchaseMeta.supplier || "").trim()
            };
        }
        if (mov.type === "STANDBY") {
            mov.pending = true;
            mov.pendingSince = m.pendingSince ? toIsoDate(m.pendingSince) : mov.date;
            mov.standbyReleaseType = String(m.standbyReleaseType || "AJUSTE").trim();
        }
        if (m.receptionId) mov.receptionId = m.receptionId;
        if (m.orderLineId) mov.orderLineId = m.orderLineId;
        out.push(mov);
    }
    return out;
}

function main() {
    const args = parseArgs();
    if (!args.input || !args.output) {
        console.error(
            "Uso: node build-gneex-backup.mjs --input intermediate.json --output GNEEX_MIGRATED.json [--base respaldo_existente.json]"
        );
        process.exit(1);
    }
    const inputPath = path.isAbsolute(args.input) ? args.input : path.join(__dirname, args.input);
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(process.cwd(), args.output);
    const mapPath = path.join(__dirname, "phoenix-type-map.json");

    const intermediate = readJson(inputPath);
    const typeMapJson = fs.existsSync(mapPath) ? readJson(mapPath) : { map: {}, defaultType: "AJUSTE" };

    const inventory = buildInventoryRows(intermediate.inventory || []);
    const inventoryByCode = new Map();
    for (const it of inventory) {
        const k = (it.code || "").toLowerCase();
        if (!k) continue;
        if (inventoryByCode.has(k)) {
            throw new Error(`Código duplicado en inventario: ${it.code}`);
        }
        inventoryByCode.set(k, it);
    }

    const movements = buildMovementRows(intermediate, inventoryByCode, typeMapJson);

    const maxRef = maxNumericRef(movements);
    const refByType = buildMovementRefCountersFromMovements(movements);
    const maxEnt = maxEntityId(inventory, movements);

    const overrides = {
        "phoenix-inventory": JSON.stringify(inventory),
        "phoenix-movements": JSON.stringify(movements),
        "phoenix-seq-movement-ref": String(maxRef),
        "phoenix-seq-movement-ref-by-type": JSON.stringify(refByType),
        "phoenix-seq-entity-id": String(maxEnt),
        "phoenix-consumo-cart": "[]",
        "phoenix-consumo-auto-day": null,
        "phoenix-consumo-cart-activity-day": null,
        "phoenix-app-last-session-day": null,
        "phoenix-float-pos-standby": null,
        "phoenix-float-pos-consumo": null,
        "phoenix-session": null
    };

    let data = emptyBackupData();
    if (args.base) {
        const basePath = path.isAbsolute(args.base) ? args.base : path.join(process.cwd(), args.base);
        const baseParsed = readJson(basePath);
        const baseData = baseParsed?.data;
        if (!baseData || typeof baseData !== "object") {
            throw new Error("Respaldo base inválido: falta .data");
        }
        for (const key of STORAGE_KEY_VALUES) {
            if (Object.prototype.hasOwnProperty.call(baseData, key)) {
                data[key] = baseData[key];
            }
        }
    }
    Object.assign(data, overrides);

    const payload = {
        exportedAt: new Date().toISOString(),
        app: "G-NEEX",
        meta: {
            format: "G-NEEX-backup",
            generator: "build-gneex-backup.mjs",
            source: intermediate.meta || {},
            movementCount: movements.length,
            itemCount: inventory.length,
            inventoryExpiration: {
                description:
                    "Each item in phoenix-inventory includes expDate, daysToExpire, expirationDate, shelfLifeMonths, expirations[]"
            }
        },
        data
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("Escrito:", outPath);
    console.log("Artículos:", inventory.length, "| Movimientos:", movements.length, "| SEQ ref:", maxRef, "| SEQ id:", maxEnt);
}

main();
