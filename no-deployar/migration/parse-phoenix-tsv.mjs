#!/usr/bin/env node
/**
 * Convierte un pegado/export **TSV** de la rejilla Phoenix (una fila de cabecera con fechas
 * y filas de artículo con celdas de movimiento) en `intermediate.json` para build-gneex-backup.mjs.
 *
 * Convención de celda (texto): primer número con signo = cantidad del movimiento; opcional
 * total intermedio; fecha ISO en la celda si viene; "PROJECT: 12345" u otro id.
 *
 * Limitación: si el export es solo texto, **se pierde el color** de la celda (tipo Phoenix).
 * Usa --default-type (p. ej. CONSUMO_DIARIO) o enriquece el intermedio a mano / export con columna de tipo.
 *
 * Uso:
 *   node parse-phoenix-tsv.mjs --input phoenix-grid.txt --output intermediate.json
 *   node parse-phoenix-tsv.mjs --input phoenix-grid.txt --output intermediate.json --default-type AJUSTE
 *
 * PowerShell:
 *   Set-Location migration; node parse-phoenix-tsv.mjs --input phoenix-grid.txt --output intermediate.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ES_MON = {
    ene: 0,
    feb: 1,
    mar: 2,
    abr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    ago: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dic: 11
};

function parseArgs() {
    const a = process.argv.slice(2);
    const o = {
        input: null,
        output: "intermediate.json",
        defaultType: "CONSUMO_DIARIO",
        skipRows: 0,
        codeCol: 0,
        descCol: 1,
        catCol: 2,
        initialCol: 3,
        firstDateCol: 4
    };
    for (let i = 0; i < a.length; i++) {
        if (a[i] === "--input" && a[i + 1]) o.input = a[++i];
        else if (a[i] === "--output" && a[i + 1]) o.output = a[++i];
        else if (a[i] === "--default-type" && a[i + 1]) o.defaultType = a[++i];
        else if (a[i] === "--skip-rows" && a[i + 1]) o.skipRows = parseInt(a[++i], 10) || 0;
        else if (a[i] === "--code-col" && a[i + 1]) o.codeCol = parseInt(a[++i], 10);
        else if (a[i] === "--desc-col" && a[i + 1]) o.descCol = parseInt(a[++i], 10);
        else if (a[i] === "--cat-col" && a[i + 1]) o.catCol = parseInt(a[++i], 10);
        else if (a[i] === "--initial-col" && a[i + 1]) o.initialCol = parseInt(a[++i], 10);
        else if (a[i] === "--first-date-col" && a[i + 1]) o.firstDateCol = parseInt(a[++i], 10);
    }
    return o;
}

function splitTsvLine(line) {
    return line.split("\t");
}

/** yyyy-mm-dd en local mediodía UTC-safe para el generador */
function toYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function parseHeaderDateCell(s) {
    const t = String(s || "").trim();
    if (!t) return null;
    const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    const stripped = t.replace(/^[a-zá]{3,9},\s*/i, "").trim();
    const m = stripped.match(/^([a-zá]{3,9})\s+(\d{1,2}),\s*(\d{4})$/i);
    if (m) {
        const key = m[1].toLowerCase().slice(0, 3);
        const mon = ES_MON[key];
        if (mon != null) {
            const d = new Date(parseInt(m[3], 10), mon, parseInt(m[2], 10));
            if (!Number.isNaN(d.getTime())) return toYmd(d);
        }
    }
    const p = Date.parse(t);
    if (!Number.isNaN(p)) return toYmd(new Date(p));
    return null;
}

/** Coherente con phoenix_sheet_utils.maybe_repair_concatenated_decimal (coma perdida → entero gigante). */
function maybeRepairConcatenatedDecimal(rawClean, parsed) {
    const t = rawClean.trim();
    if (/[,.]/.test(t)) return parsed;
    const neg = t.startsWith("-");
    const core = neg ? t.slice(1) : t;
    if (!/^\d+$/.test(core)) return parsed;
    const absP = Math.abs(parsed);
    const ln = core.length;
    const sign = neg ? -1 : 1;
    const split2 = () => Number(`${core.slice(0, 2)}.${core.slice(2)}`);
    // ln >= 11: entero demasiado largo para ser un conteo Phoenix real (coma decimal ausente)
    if (ln >= 11) return sign * split2();
    if (ln >= 8 && absP >= 5e7) return sign * split2();
    return parsed;
}

function parseQtyToken(tok) {
    if (tok == null) return null;
    const rawClean = String(tok).replace(/\s/g, "");
    let s = rawClean;
    if (s.includes(",") && s.includes(".")) {
        if (s.lastIndexOf(".") > s.lastIndexOf(",")) s = s.replace(/,/g, "");
        else s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) s = s.replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    return maybeRepairConcatenatedDecimal(rawClean, n);
}

/**
 * Interpreta una celda de movimiento Phoenix pegada como texto.
 * Devuelve { qty, projectId, dateYmd, balance, raw } o null si vacío / no reconocible.
 */
function parseMovementCell(text, columnDateYmd) {
    const raw = String(text || "").replace(/\r/g, "").trim();
    if (!raw) return null;
    const projectM = raw.match(/PROJECT:\s*(\S+)/i);
    const projectId = projectM ? projectM[1].replace(/[,;]+$/, "") : "";
    let dateYmd = columnDateYmd;
    const isoInCell = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoInCell) dateYmd = isoInCell[1];
    else {
        const p = Date.parse(raw);
        if (!Number.isNaN(p)) dateYmd = toYmd(new Date(p));
    }
    const tokens = raw.split(/\s+/);
    const qty = tokens.length ? parseQtyToken(tokens[0]) : null;
    if (qty == null) return null;
    let balance = null;
    for (let i = 1; i < tokens.length; i++) {
        const q = parseQtyToken(tokens[i]);
        if (q != null && Math.abs(q) > Math.abs(qty) * 0.5) {
            balance = q;
            break;
        }
    }
    return { qty, projectId, dateYmd, balance, raw };
}

function padRef(n, w) {
    return String(n).padStart(w, "0");
}

function main() {
    const args = parseArgs();
    if (!args.input) {
        console.error(
            "Uso: node parse-phoenix-tsv.mjs --input phoenix-grid.txt [--output intermediate.json] [--default-type CONSUMO_DIARIO]"
        );
        process.exit(1);
    }
    const inPath = path.isAbsolute(args.input) ? args.input : path.join(process.cwd(), args.input);
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(process.cwd(), args.output);

    const rawFile = fs.readFileSync(inPath, "utf8");
    const lines = rawFile.split(/\n/).filter(l => l.length > 0);

    let start = args.skipRows;
    if (start >= lines.length) {
        console.error("skip-rows demasiado grande");
        process.exit(1);
    }

    const headerCells = splitTsvLine(lines[start]);
    const dateByCol = [];
    for (let c = args.firstDateCol; c < headerCells.length; c++) {
        dateByCol[c] = parseHeaderDateCell(headerCells[c]);
    }

    const inventoryMap = new Map();
    const movements = [];
    let refNum = 1;

    for (let r = start + 1; r < lines.length; r++) {
        const cells = splitTsvLine(lines[r]);
        const code = String(cells[args.codeCol] || "").trim();
        if (!code || /^CODE$/i.test(code)) continue;

        const description = String(cells[args.descCol] || "").trim();
        const category = String(cells[args.catCol] || "").trim();
        const initialRaw = String(cells[args.initialCol] || "").trim().replace(",", ".");
        const initial = parseFloat(initialRaw) || 0;

        if (!inventoryMap.has(code.toLowerCase())) {
            inventoryMap.set(code.toLowerCase(), {
                code,
                description,
                category,
                mainStock: initial,
                prodStock: 0,
                transStock: 0,
                location: "",
                minStock: 0,
                maxStock: 0
            });
        } else {
            const ex = inventoryMap.get(code.toLowerCase());
            if (description) ex.description = description;
            if (category) ex.category = category;
        }

        let rowSum = 0;
        for (let c = args.firstDateCol; c < cells.length; c++) {
            const colDate = dateByCol[c];
            const parsed = parseMovementCell(cells[c], colDate);
            if (!parsed) continue;
            rowSum += parsed.qty;
            const dateIso = parsed.dateYmd
                ? `${parsed.dateYmd}T12:00:00.000Z`
                : new Date().toISOString();
            const notes = parsed.raw.slice(0, 500);
            movements.push({
                reference: padRef(refNum++, 8),
                date: dateIso,
                type: args.defaultType,
                projectId: parsed.projectId || "",
                notes,
                createdBy: "Migración Phoenix (TSV)",
                lines: [{ code, quantity: parsed.qty, target: "main" }]
            });
        }

        const inv = inventoryMap.get(code.toLowerCase());
        inv.mainStock = initial + rowSum;
    }

    const intermediate = {
        meta: {
            source: "Phoenix Excel grid (TSV)",
            parser: "parse-phoenix-tsv.mjs",
            input: path.basename(inPath),
            defaultMovementType: args.defaultType,
            warning:
                "Los tipos por color de Phoenix no están en texto plano; revisa type en intermediate o usa otro export."
        },
        inventory: [...inventoryMap.values()],
        movements
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(intermediate, null, 2), "utf8");
    console.log("Escrito:", outPath);
    console.log("Artículos:", intermediate.inventory.length, "| Movimientos:", intermediate.movements.length);
}

main();
