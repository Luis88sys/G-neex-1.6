// inventory.js — gestión avanzada de inventario (min/max, expiraciones, notas, compras, import CSV)

/** Iconos SVG de barra de inventario (mismos que en index.html). */
/** Formato oficial G-NEEX: misma 1.ª fila en plantilla, exportación e importación (hoja recomendada «Datos»). */
const BOX_STOCK_SHEET_HEADERS = Object.freeze([
  "Codigo",
  "Caja",
  "UbicacionCaja",
  "CantidadCaja",
  "CantidadCajas",
  "Vacia"
]);

/** Selectores especiales en transferencias (no son IDs de caja). */
const BOX_TRANSFER_PROD_ID = "__PROD_STOCK__";
const BOX_TRANSFER_TRANS_ID = "__TRANS_STOCK__";
const BOX_TRANSFER_LOCATION_ID = "__ITEM_LOCATION__";
const BOX_TRANSFER_MAIN_POOL_ID = "__MAIN_POOL__";

function _boxXferKind(id) {
  if (!id) return "";
  if (id === BOX_TRANSFER_MAIN_POOL_ID) return "mainpool";
  if (id === BOX_TRANSFER_PROD_ID) return "prod";
  if (id === BOX_TRANSFER_TRANS_ID) return "trans";
  if (id === BOX_TRANSFER_LOCATION_ID) return "loc";
  if (String(id).startsWith("loc:")) return "locrow";
  return "box";
}

function _boxXferIsSpecial(id) {
  return (
    id === BOX_TRANSFER_MAIN_POOL_ID ||
    id === BOX_TRANSFER_PROD_ID ||
    id === BOX_TRANSFER_TRANS_ID ||
    id === BOX_TRANSFER_LOCATION_ID ||
    String(id).startsWith("loc:")
  );
}

const INV_ICONS = {
  calendar:
    '<svg class="inv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  close:
    '<svg class="inv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  download:
    '<svg class="inv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  print:
    '<svg class="inv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>'
};

const InventoryManager = {

  items: [],
  standaloneBoxes: [], // cajas reservadas sin artículo asociado
  purchaseList: [],   // productos a comprar
  expAlertDays: 30,   // umbral para aviso de vencimiento (días)
  /** Última lista mostrada en la tabla (completa o filtrada por buscador). */
  _inventoryViewList: [],
  _inventorySearchQuery: "",
  /** Artículo cuyas notas están en el modal (id). */
  _invNotesItemId: null,
  /** Si está definido (YYYY-MM-DD), la tabla muestra stock reconstruido al final de ese día. */
  _asOfDate: null,
  /** Solo artículos con texto en «Problemas con el artículo» (campo itemProblemsNote). */
  _inventoryFilterProblemsOnly: false,
  /** Solo artículos con alerta de stock bajo desactivada (ignoreLowStockAlert). */
  _inventoryFilterLowStockIgnoredOnly: false,
  /** Lista del modal de alertas abierto (exportar / imprimir). */
  _insightExportItems: [],
  /** En insight "stock bajo": false=mostrar bajos, true=mostrar artículos ignorados. */
  _insightLowShowIgnored: false,
  _invRowActionsCloseTimers: {},
  PRICE_CURRENCIES: Object.freeze(["USD", "CAD"]),

  _isValidBoxNumber(n) {
    return Number.isFinite(n) && n >= 1;
  },

  _canManageBoxMutations() {
    return typeof Auth !== "undefined" && Auth.isAdmin();
  },

  // =========================================================
  // INICIALIZACIÓN
  // =========================================================
  init() {
    try {
      this.items = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVENTORY) || "[]");
      this._normalizeBoxStocksForAllItems();
      this.standaloneBoxes = JSON.parse(localStorage.getItem(STORAGE_KEYS.STANDALONE_BOXES) || "[]");
      this._normalizeStandaloneBoxes();
      this.purchaseList = JSON.parse(localStorage.getItem(STORAGE_KEYS.PURCHASES) || "[]");
      const expSaved = localStorage.getItem(STORAGE_KEYS.EXP_ALERT);
      if (expSaved) this.expAlertDays = parseInt(expSaved, 10) || 30;
      this.render();
      this.setupEventListeners();
    } catch (err) {
      console.error("❌ Error inicializando InventoryManager:", err);
    }
  },

  save() {
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(this.items));
    localStorage.setItem(STORAGE_KEYS.STANDALONE_BOXES, JSON.stringify(this.standaloneBoxes || []));
    localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(this.purchaseList));
  },

  _normalizeStandaloneBoxes() {
    const src = Array.isArray(this.standaloneBoxes) ? this.standaloneBoxes : [];
    const byNumber = new Map();
    for (const raw of src) {
      const n = parseInt(raw?.boxNumber, 10);
      if (!this._isValidBoxNumber(n)) continue;
      byNumber.set(n, {
        boxNumber: n,
        locationLabel: String(raw?.locationLabel || "").trim(),
        notes: String(raw?.notes || "").trim(),
        updatedAt: raw?.updatedAt || new Date().toISOString()
      });
    }
    this.standaloneBoxes = [...byNumber.values()].sort((a, b) => a.boxNumber - b.boxNumber);
  },

  _findStandaloneBoxIndex(boxNumber) {
    const n = parseInt(boxNumber, 10);
    if (!this._isValidBoxNumber(n) || !Array.isArray(this.standaloneBoxes)) return -1;
    return this.standaloneBoxes.findIndex(b => Number(b.boxNumber) === n);
  },

  upsertStandaloneBox(payload) {
    const n = parseInt(payload?.boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return { ok: false, reason: "invalid-box-number" };
    this._normalizeStandaloneBoxes();
    const next = {
      boxNumber: n,
      locationLabel: String(payload?.locationLabel || "").trim(),
      notes: String(payload?.notes || "").trim(),
      updatedAt: new Date().toISOString()
    };
    const idx = this._findStandaloneBoxIndex(n);
    if (idx >= 0) this.standaloneBoxes[idx] = next;
    else this.standaloneBoxes.push(next);
    this._normalizeStandaloneBoxes();
    this.save();
    this.populateInventoryBoxFilter();
    this._refreshBoxManagerLocationDatalists();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return { ok: true, box: next };
  },

  _normalizePriceCurrency(rawCurrency) {
    const c = String(rawCurrency || "").trim().toUpperCase();
    return this.PRICE_CURRENCIES.includes(c) ? c : "CAD";
  },

  _formatPriceDisplay(value, currency) {
    const amount = Utils.roundDecimal(value, 2);
    const iso = this._normalizePriceCurrency(currency);
    const sign = iso === "CAD" ? "C$" : "US$";
    return `${sign} ${Utils.formatDecimalDisplay(amount, 2)}`;
  },

  _computeNumBoxesFromMainStock(mainStock, qtyPerBox) {
    const perBox = Utils.roundDecimal(qtyPerBox);
    if (!Number.isFinite(perBox) || perBox <= 0) return 0;
    const stock = Utils.roundDecimal(mainStock);
    if (!Number.isFinite(stock)) return 0;
    return Utils.roundDecimal(stock / perBox, 4);
  },

  _normalizeItemCoreFields(item, options = {}) {
    const out = { ...(item || {}) };
    out.mainStock = Utils.roundDecimal(parseFloat(out.mainStock) || 0);
    out.prodStock = Utils.roundDecimal(parseFloat(out.prodStock) || 0);
    out.transStock = Utils.roundDecimal(parseFloat(out.transStock) || 0);
    out.qtyPerBox = Utils.roundDecimal(parseFloat(out.qtyPerBox) || 0);
    out.numBoxes = options.recomputeNumBoxes
      ? this._computeNumBoxesFromMainStock(out.mainStock, out.qtyPerBox)
      : Utils.roundDecimal(parseFloat(out.numBoxes) || 0, 4);
    out.minStock = Utils.roundDecimal(parseFloat(out.minStock) || 0);
    out.maxStock = Utils.roundDecimal(parseFloat(out.maxStock) || 0);
    out.defaultPrice = Utils.roundDecimal(parseFloat(out.defaultPrice) || 0, 2);
    out.priceCurrency = this._normalizePriceCurrency(out.priceCurrency);
    out.ignoreLowStockAlert = !!out.ignoreLowStockAlert;
    let ms = String(out.measureStockUnitId || "").trim();
    let ma = String(out.measureAltUnitId || "").trim();
    if (!ms) ma = "";
    if (ma === ms) ma = "";
    out.measureStockUnitId = ms;
    out.measureAltUnitId = ma;
    return out;
  },

  _normalizeBoxStocksForAllItems() {
    let changed = false;
    this.items = (this.items || []).map(it => {
      const before = it && typeof it === "object" ? JSON.stringify(it) : "";
      const normalized = this._normalizeItemForStorage(it);
      normalized.location = this._stripOrphanBoxTokensFromLocation(normalized);
      if (!changed && before !== JSON.stringify(normalized)) changed = true;
      return normalized;
    });
    if (changed) this.save();
  },

  _normalizeItemForStorage(itemLike) {
    const withLegacyBoxes = this._ensureBoxStocksFromLocationText(itemLike);
    const normalized = this._normalizeItemCoreFields(this._normalizeItemBoxStocks(withLegacyBoxes), { recomputeNumBoxes: true });
    const fromBoxes = this._composeLocationHierarchyFromBoxStocks(normalized);
    normalized.location = fromBoxes
      ? this._mergeLegacyLocationWithBoxHierarchy(normalized.location || "", fromBoxes)
      : this._coerceLocationOrRelocate(normalized.location || "", normalized);
    normalized.location = this._stripOrphanBoxTokensFromLocation(normalized);
    return normalized;
  },

  _stripOrphanBoxTokensFromLocation(itemLike) {
    const item = itemLike || {};
    const valid = new Set(
      (Array.isArray(item.boxStocks) ? item.boxStocks : [])
        .map(b => parseInt(b?.boxNumber, 10))
        .filter(n => this._isValidBoxNumber(n))
    );
    const parts = String(item.location || "")
      .split(/\s*,\s*/)
      .map(s => String(s || "").trim())
      .filter(Boolean);
    const kept = parts.filter(p => {
      const nums = Utils.parseWarehouseBoxesFromLocation(p);
      if (!nums.length) return true;
      // Mantener solo segmentos cuyas cajas todavía existen en boxStocks.
      return nums.some(n => valid.has(n));
    });
    return kept.join(", ");
  },

  _ensureBoxStocksFromLocationText(itemLike) {
    const item = { ...(itemLike || {}) };
    const srcRows = Array.isArray(item.boxStocks) ? item.boxStocks : [];
    const rows = srcRows.map(r => ({ ...(r || {}) }));
    const byNumber = new Map();
    for (const r of rows) {
      const n = parseInt(r?.boxNumber, 10);
      if (!this._isValidBoxNumber(n)) continue;
      if (!byNumber.has(n)) byNumber.set(n, r);
    }

    const rawLocation = String(item.location || "").trim();
    if (!rawLocation) {
      item.boxStocks = rows;
      return item;
    }
    const parts = rawLocation
      .split(/\s*,\s*/)
      .map(s => String(s || "").trim())
      .filter(Boolean);
    const inferredAdded = [];
    for (const p of parts) {
      const nums = Utils.parseWarehouseBoxesFromLocation(p);
      if (!nums.length) continue;
      const strict = Utils.strictEffectiveWarehouseLocationText(p);
      for (const n of nums) {
        if (byNumber.has(n)) {
          const hit = byNumber.get(n);
          if (!String(hit.locationLabel || "").trim() && strict) hit.locationLabel = strict;
          continue;
        }
        const inferred = {
          boxId: `box-${n}-${Utils.generateId().slice(0, 8)}`,
          boxNumber: n,
          locationLabel: strict || "",
          qty: 0,
          qtyBoxes: 0,
          empty: false,
          notes: "",
          updatedAt: new Date().toISOString()
        };
        rows.push(inferred);
        byNumber.set(n, inferred);
        inferredAdded.push(inferred);
      }
    }
    item.boxStocks = rows;
    return item;
  },

  /**
   * Ranuras reconocidas en `item.location` y en cada línea de `locationStocks` (stock por ubicación).
   */
  _collectWarehouseSlotsFromItem(it) {
    const ordered = [];
    const add = arr => {
      for (const s of arr || []) {
        if (s && !ordered.includes(s)) ordered.push(s);
      }
    };
    add(Utils.parseWarehouseSlotsFromLocation(it.location || ""));
    for (const ls of this._normalizeItemLocationStocks(it)) {
      add(Utils.parseWarehouseSlotsFromLocation(ls.location || ""));
    }
    return ordered;
  },

  /**
   * Números de caja en texto de ubicación y en `boxStocks`.
   */
  _collectWarehouseBoxesFromItem(it) {
    const ordered = [];
    const addNum = n => {
      const x = parseInt(n, 10);
      if (!Number.isFinite(x) || x < 1) return;
      if (!ordered.includes(x)) ordered.push(x);
    };
    for (const n of Utils.parseWarehouseBoxesFromLocation(it.location || "")) addNum(n);
    if (Array.isArray(it.boxStocks)) {
      for (const b of it.boxStocks) addNum(b.boxNumber);
    }
    return ordered;
  },

  _coerceLocationOrRelocate(rawLocation, item) {
    const rawText = String(rawLocation || "").trim();
    const boxNums = Utils.parseWarehouseBoxesFromLocation(rawText);
    if (boxNums.length > 0) {
      // Si hay caja(s), preservar la jerarquía "ubicación > BOXn" y no degradarla a solo ubicación.
      const parts = rawText
        .split(/\s*,\s*/)
        .map(s => String(s || "").trim())
        .filter(Boolean);
      const out = [];
      const seen = new Set();
      const push = val => {
        const v = String(val || "").trim();
        if (!v) return;
        const k = v.toUpperCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push(v);
      };
      for (const p of parts) {
        const nums = Utils.parseWarehouseBoxesFromLocation(p);
        if (nums.length) {
          const base = Utils.strictEffectiveWarehouseLocationText(p);
          for (const n of nums) push(base ? `${base} > BOX${n}` : `BOX${n}`);
          continue;
        }
        const strictPart = Utils.strictEffectiveWarehouseLocationText(p);
        push(strictPart || Utils.normalizeWarehouseLocationText(p) || p);
      }
      if (out.length) return out.join(", ");
    }
    const normalized = Utils.normalizeWarehouseLocationText(rawLocation || "");
    const strict = Utils.strictEffectiveWarehouseLocationText(rawLocation || "");
    if (strict) {
      return strict;
    }

    if (item && Array.isArray(item.locationStocks)) {
      const chunks = [];
      for (const ls of item.locationStocks) {
        const q = parseFloat(ls?.qty) || 0;
        if (q <= 0) continue;
        const lab = String(ls?.location || "").trim();
        const piece = Utils.strictEffectiveWarehouseLocationText(lab);
        if (piece) chunks.push(piece);
      }
      if (chunks.length) {
        const synth = Utils.strictEffectiveWarehouseLocationText(chunks.join(", "));
        if (synth) return synth;
      }
    }

    return normalized || String(rawLocation || "").trim();
  },

  _composeLocationHierarchyFromBoxStocks(item) {
    const rows = Array.isArray(item?.boxStocks) ? item.boxStocks : [];
    const out = [];
    const seen = new Set();
    for (const b of rows) {
      const n = parseInt(b?.boxNumber, 10);
      if (!this._isValidBoxNumber(n)) continue;
      const rawLab = String(b?.locationLabel || "").trim();
      const strict = Utils.strictEffectiveWarehouseLocationText(rawLab);
      const base = strict || rawLab;
      const entry = base ? `${base} > BOX${n}` : `BOX${n}`;
      const key = entry.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
    return out.join(", ");
  },

  _mergeLegacyLocationWithBoxHierarchy(rawLocation, boxHierarchyText) {
    const baseParts = String(rawLocation || "")
      .split(/\s*,\s*/)
      .map(s => String(s || "").trim())
      .filter(Boolean);
    const boxParts = String(boxHierarchyText || "")
      .split(/\s*,\s*/)
      .map(s => String(s || "").trim())
      .filter(Boolean);
    const out = [];
    const seen = new Set();
    const push = part => {
      const p = String(part || "").trim();
      if (!p) return;
      const k = p.toUpperCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(p);
    };
    // Conserva ubicaciones antiguas que no sean referencias de caja.
    for (const p of baseParts) {
      if (Utils.parseWarehouseBoxesFromLocation(p).length > 0) continue;
      const strict = Utils.strictEffectiveWarehouseLocationText(p);
      push(strict || Utils.normalizeWarehouseLocationText(p) || p);
    }
    // Agrega ubicaciones jerárquicas de cajas.
    for (const p of boxParts) push(p);
    return out.join(", ");
  },

  /**
   * Cantidad numérica desde JSON/plantilla (coma decimal, miles, espacios).
   * Evita filas con qty aparentemente vacío por formato regional.
   */
  _parseBoxStockQtyValue(raw) {
    if (raw == null || raw === "") return 0;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    let s = String(raw).trim().replace(/\s/g, "");
    if (!s) return 0;
    const hasComma = s.includes(",");
    const hasDot = s.includes(".");
    if (hasComma && !hasDot) s = s.replace(",", ".");
    else if (hasComma && hasDot) {
      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");
      if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  },

  _parseBoxStockQtyBoxesValue(raw) {
    const q = this._parseBoxStockQtyValue(raw);
    if (!Number.isFinite(q)) return 0;
    return Math.max(0, Math.round(q));
  },

  _normalizeItemBoxStocks(item) {
    const src = Array.isArray(item?.boxStocks) ? item.boxStocks : [];
    const map = {};
    for (const raw of src) {
      const n = parseInt(raw?.boxNumber, 10);
      if (!this._isValidBoxNumber(n)) continue;
      /* Una sola fila lógica por número de caja: importaciones generan boxIds distintos por fila;
         si no se fusiona aquí, las cantidades quedan repartidas en varias filas o no suman bien. */
      const mergeKey = `bn:${n}`;
      if (!map[mergeKey]) {
        const bid = String(raw?.boxId || "").trim();
        map[mergeKey] = {
          boxId: bid || `box-${n}-${Utils.generateId().slice(0, 8)}`,
          boxNumber: n,
          locationLabel: Utils.resolveImportLocationLabel(String(raw?.locationLabel || "").trim()),
          qty: 0,
          qtyBoxes: 0,
          empty: false,
          notes: String(raw?.notes || "").trim(),
          updatedAt: raw?.updatedAt || new Date().toISOString()
        };
      }
      map[mergeKey].qty = Utils.roundDecimal((map[mergeKey].qty || 0) + this._parseBoxStockQtyValue(raw?.qty));
      map[mergeKey].qtyBoxes = Math.max(
        0,
        (map[mergeKey].qtyBoxes || 0) + this._parseBoxStockQtyBoxesValue(raw?.qtyBoxes)
      );
      if (raw?.empty) map[mergeKey].empty = true;
      if (!map[mergeKey].locationLabel && raw?.locationLabel) {
        map[mergeKey].locationLabel = Utils.resolveImportLocationLabel(String(raw.locationLabel).trim());
      }
      if (!map[mergeKey].notes && raw?.notes) map[mergeKey].notes = String(raw.notes).trim();
    }
    for (const b of Object.values(map)) {
      if (b.empty) {
        b.qty = 0;
        b.qtyBoxes = 0;
      }
    }
    const boxStocks = Object.values(map).sort((a, b) => a.boxNumber - b.boxNumber);
    const locationStocks = this._normalizeItemLocationStocks(item);
    return { ...(item || {}), boxStocks, locationStocks };
  },

  _canonicalLocationLabel(label) {
    return Utils.strictCatalogLocationToken(label);
  },

  _normalizeItemLocationStocks(item) {
    const src = item?.locationStocks;
    const entries = Array.isArray(src)
      ? src
      : src && typeof src === "object"
        ? Object.entries(src).map(([location, qty]) => ({ location, qty }))
        : [];
    const map = {};
    for (const entry of entries) {
      const location =
        typeof Utils.resolveImportLocationLabel === "function"
          ? Utils.resolveImportLocationLabel(entry?.location || "")
          : Utils.strictEffectiveWarehouseLocationText(entry?.location || "");
      if (!location) continue;
      const q = parseFloat(entry?.qty) || 0;
      if (!Number.isFinite(q) || q <= 0) continue;
      if (!map[location]) {
        map[location] = {
          location,
          qty: 0,
          updatedAt: entry?.updatedAt || new Date().toISOString()
        };
      }
      map[location].qty = Utils.roundDecimal((map[location].qty || 0) + q);
      if (entry?.updatedAt) map[location].updatedAt = String(entry.updatedAt);
    }
    return Object.values(map).sort((a, b) => String(a.location).localeCompare(String(b.location)));
  },

  _incrementItemLocationStock(item, locationLabel, qty) {
    if (!item) return;
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return;
    item.locationStocks = this._normalizeItemLocationStocks(item);
    let idx = this._findLocationStockRowIndex(item, locationLabel);
    if (idx < 0) {
      const raw = String(locationLabel ?? "").trim();
      const loc =
        Utils.resolveImportLocationLabel(raw) ||
        Utils.strictCatalogLocationToken(raw) ||
        raw;
      if (!loc) return;
      item.locationStocks.push({
        location: loc,
        qty: q,
        updatedAt: new Date().toISOString()
      });
      item.locationStocks = this._normalizeItemLocationStocks(item);
      return;
    }
    item.locationStocks[idx].qty = Utils.roundDecimal((parseFloat(item.locationStocks[idx].qty) || 0) + q);
    item.locationStocks[idx].updatedAt = new Date().toISOString();
  },

  getItemById(itemId) {
    return (this.items || []).find(i => String(i.id) === String(itemId)) || null;
  },

  getItemBoxStocks(itemId) {
    const it = this.getItemById(itemId);
    if (!it) return [];
    return Array.isArray(it.boxStocks) ? it.boxStocks.slice() : [];
  },

  /**
   * True si algún artículo tiene stock &gt; 0 (o cajas contables) en el número de caja dado.
   */
  _hasAnyPositiveQtyInBoxAcrossInventory(boxNumber) {
    const n = parseInt(boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return false;
    for (const it of this.items || []) {
      const rows = Array.isArray(it.boxStocks) ? it.boxStocks : [];
      for (const b of rows) {
        if (parseInt(b.boxNumber, 10) !== n) continue;
        if (this._parseBoxStockQtyValue(b.qty) > 1e-12) return true;
        if (Math.max(0, parseInt(b.qtyBoxes, 10) || 0) > 0) return true;
      }
    }
    return false;
  },

  getItemAvailableBoxes(itemId) {
    return this.getItemBoxStocks(itemId).filter(b => {
      if (b.empty) return false;
      const qty = parseFloat(b.qty) || 0;
      const qtyBoxes = parseInt(b.qtyBoxes, 10) || 0;
      // Permite considerar cajas "contables por cantidad de cajas" aunque no se declare unidad exacta.
      return qty > 0 || qtyBoxes > 0;
    });
  },

  _findBoxIndex(item, boxId) {
    if (!item || !Array.isArray(item.boxStocks)) return -1;
    return item.boxStocks.findIndex(b => String(b.boxId) === String(boxId));
  },

  /** Comparación insensible a mayúsculas / acentos para etiquetas de ubicación. */
  _locationLabelEquals(a, b) {
    const norm = s =>
      String(s ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
    return norm(a) === norm(b);
  },

  /**
   * Índice en `item.locationStocks` que corresponde a la clave del movimiento (catálogo o texto libre).
   */
  _findLocationStockRowIndex(item, rawKey) {
    if (!item || !Array.isArray(item.locationStocks)) return -1;
    const raw = String(rawKey ?? "").trim();
    if (!raw) return -1;
    const candidates = [
      raw,
      Utils.resolveImportLocationLabel(raw),
      Utils.strictEffectiveWarehouseLocationText(raw),
      Utils.strictCatalogLocationToken(raw)
    ].filter(Boolean);
    const rows = item.locationStocks;
    for (let i = 0; i < rows.length; i++) {
      const stored = rows[i]?.location;
      if (stored == null) continue;
      for (const c of candidates) {
        if (this._locationLabelEquals(stored, c)) return i;
      }
    }
    return -1;
  },

  /**
   * Índice de fila de caja por id; si falla (p. ej. tras reimportar), por número de caja.
   */
  _findBoxRowIndexForMovement(item, boxId, boxNumberHint) {
    if (!item || !Array.isArray(item.boxStocks)) return -1;
    let idx = this._findBoxIndex(item, boxId);
    if (idx >= 0) return idx;
    const n = parseInt(boxNumberHint, 10);
    if (!this._isValidBoxNumber(n)) return -1;
    return item.boxStocks.findIndex(b => Number(b.boxNumber) === n);
  },

  /** Cantidad disponible en una caja para validar movimientos (tras importación / normalización). */
  getBoxStockQtyForMovement(itemId, boxId, boxNumberHint) {
    const item = this.getItemById(itemId);
    if (!item) return 0;
    const idx = this._findBoxRowIndexForMovement(item, boxId, boxNumberHint);
    if (idx < 0) return 0;
    return Math.max(0, this._parseBoxStockQtyValue(item.boxStocks[idx].qty));
  },

  /** True si existe fila JSON de stock por ubicación que case con la clave del movimiento (no solo ranura sintética). */
  hasLocationStockRowForMovement(itemId, rawLocationKey) {
    const item = this.getItemById(itemId);
    if (!item) return false;
    const locRows = this._normalizeItemLocationStocks(item);
    return this._findLocationStockRowIndex({ locationStocks: locRows }, rawLocationKey) >= 0;
  },

  upsertItemBoxStock(itemId, payload, options = {}) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    item.boxStocks = Array.isArray(item.boxStocks) ? item.boxStocks : [];
    const n = parseInt(payload?.boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return { ok: false, reason: "invalid-box-number" };
    const rawLab = String(payload?.locationLabel || "").trim();
    const resolvedLocLab = Utils.resolveImportLocationLabel(rawLab);
    const locLab = String(resolvedLocLab || "").trim() || rawLab;
    const boxId = String(payload?.boxId || `box-${n}-${Utils.generateId().slice(0, 8)}`);
    const idx = this._findBoxIndex(item, boxId);
    const markEmpty = !!payload?.empty;
    const oldQty = idx >= 0 ? this._parseBoxStockQtyValue(item.boxStocks[idx].qty) : 0;
    const next = {
      boxId,
      boxNumber: n,
      locationLabel: locLab,
      qty: markEmpty ? 0 : Utils.roundDecimal(this._parseBoxStockQtyValue(payload?.qty)),
      qtyBoxes: markEmpty ? 0 : Math.max(0, this._parseBoxStockQtyBoxesValue(payload?.qtyBoxes)),
      empty: markEmpty,
      notes: String(payload?.notes || "").trim(),
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) item.boxStocks[idx] = next;
    else item.boxStocks.push(next);
    item.boxStocks = this._normalizeItemBoxStocks(item).boxStocks;
    this._syncItemLocationFromBox(item, boxId, locLab);
    /* Mantén `mainStock` como suma efectiva: cuando el llamador edita una caja directamente
       (Box Manager / importación masiva por caja), `syncMainStock: true` aplica el delta
       de la caja al stock principal para que el total siga reflejando «todo lo que hay». */
    if (options?.syncMainStock) {
      const delta = Utils.roundDecimal(next.qty - oldQty);
      if (delta !== 0) {
        item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) + delta);
      }
    }
    this.save();
    if (!options?.silent) this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return { ok: true, box: next, deltaApplied: options?.syncMainStock ? Utils.roundDecimal(next.qty - oldQty) : 0 };
  },

  deleteItemBoxStock(itemId, boxId, force = false, options = {}) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    item.boxStocks = Array.isArray(item.boxStocks) ? item.boxStocks : [];
    const idx = this._findBoxIndex(item, boxId);
    if (idx < 0) return { ok: false, reason: "box-not-found" };
    const b = item.boxStocks[idx];
    const removedQty = this._parseBoxStockQtyValue(b.qty);
    if (!force && removedQty > 0) return { ok: false, reason: "box-has-stock" };
    const boxNumber = parseInt(b?.boxNumber, 10);
    item.boxStocks.splice(idx, 1);
    this._removeItemLocationForBox(item, boxNumber);
    /* Si se borra una caja con unidades y el llamador pide sincronizar, descuenta del principal
       (coherente con `upsertItemBoxStock({ syncMainStock: true })`). */
    if (options?.syncMainStock && removedQty > 0) {
      item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) - removedQty);
    }
    this.save();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return { ok: true, deltaApplied: options?.syncMainStock ? -removedQty : 0 };
  },

  consumeFromBoxAndMain(itemId, boxId, qty, options = {}) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const idx = this._findBoxRowIndexForMovement(item, boxId, options.boxNumber);
    if (idx < 0) return { ok: false, reason: "box-not-found" };
    const cur = this._parseBoxStockQtyValue(item.boxStocks[idx].qty);
    if (cur < q) return { ok: false, reason: "box-overdraft" };
    const next = Utils.roundDecimal(cur - q);
    const qb = Math.max(0, parseInt(item.boxStocks[idx].qtyBoxes, 10) || 0);
    const boxNum = parseInt(item.boxStocks[idx].boxNumber, 10);
    const snapLoc = String(item.boxStocks[idx].locationLabel || "").trim();
    const snapNotes = String(item.boxStocks[idx].notes || "").trim();
    item.boxStocks[idx].qty = next;
    item.boxStocks[idx].updatedAt = new Date().toISOString();
    item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) - q);
    if (next <= 1e-12 && qb <= 0) {
      item.boxStocks.splice(idx, 1);
      item.boxStocks = this._normalizeItemBoxStocks(item).boxStocks;
      if (this._isValidBoxNumber(boxNum) && !this._hasAnyPositiveQtyInBoxAcrossInventory(boxNum)) {
        this.upsertStandaloneBox({
          boxNumber: boxNum,
          locationLabel: snapLoc,
          notes: snapNotes
        });
      } else {
        this.save();
      }
      return { ok: true };
    }
    this.save();
    return { ok: true };
  },

  /** Igual que retirar de caja: descuenta la fila de stock por ubicación y el principal (mismo criterio que caja). */
  consumeFromLocationStockAndMain(itemId, locationKey, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    item.locationStocks = this._normalizeItemLocationStocks(item);
    const idx = this._findLocationStockRowIndex(item, locationKey);
    if (idx < 0) return { ok: false, reason: "location-not-found" };
    const cur = parseFloat(item.locationStocks[idx].qty) || 0;
    if (cur < q) return { ok: false, reason: "location-overdraft" };
    const next = Utils.roundDecimal(cur - q);
    if (next <= 0) item.locationStocks.splice(idx, 1);
    else {
      item.locationStocks[idx].qty = next;
      item.locationStocks[idx].updatedAt = new Date().toISOString();
    }
    item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) - q);
    this.save();
    return { ok: true };
  },

  restoreToBoxAndMain(itemId, boxId, qty, options = {}) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    item.boxStocks = Array.isArray(item.boxStocks) ? item.boxStocks : [];
    let idx = this._findBoxRowIndexForMovement(item, boxId, options.boxNumber);
    if (idx < 0) {
      const n = parseInt(options.boxNumber, 10);
      if (this._isValidBoxNumber(n)) {
        const rUp = this.upsertItemBoxStock(
          itemId,
          { boxNumber: n, qty: 0, boxId: boxId || "", locationLabel: "" },
          { silent: true }
        );
        if (!rUp || !rUp.ok) return { ok: false, reason: "box-not-found" };
        idx = this._findBoxRowIndexForMovement(item, boxId, options.boxNumber);
      }
    }
    if (idx < 0) return { ok: false, reason: "box-not-found" };
    item.boxStocks[idx].qty = Utils.roundDecimal(this._parseBoxStockQtyValue(item.boxStocks[idx].qty) + q);
    item.boxStocks[idx].updatedAt = new Date().toISOString();
    item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) + q);
    const nRm = parseInt(item.boxStocks[idx].boxNumber, 10);
    if (this._isValidBoxNumber(nRm)) {
      const sbIx = this._findStandaloneBoxIndex(nRm);
      if (sbIx >= 0) {
        this.standaloneBoxes.splice(sbIx, 1);
        this._normalizeStandaloneBoxes();
      }
    }
    this.save();
    return { ok: true };
  },

  restoreToLocationStockAndMain(itemId, locationKey, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    this._incrementItemLocationStock(item, locationKey, q);
    item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  /**
   * Ingreso COMPRA_STOCK: stock principal (total) o reparto a caja / fila de ubicación (criterio coherente con restore*).
   * @param {object} [place] { kind: 'main'|'box'|'location', boxNumber?, boxId?, locationKey? }
   */
  applyCompraStockPlacement(itemId, quantity, place) {
    const inv0 = this.getItemById(itemId);
    if (inv0 && inv0.inventoryConsumable) return { ok: false, reason: "inventory-consumable" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(quantity) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const p = place && typeof place === "object" ? place : { kind: "main" };
    const kind = p.kind || "main";
    if (kind === "main") {
      this.updateStock(itemId, "main", q);
      return { ok: true, kind: "main" };
    }
    if (kind === "box") {
      const n = parseInt(p.boxNumber, 10);
      if (!this._isValidBoxNumber(n)) return { ok: false, reason: "invalid-box" };
      const rUp = this.upsertItemBoxStock(
        itemId,
        { boxNumber: n, qty: 0, boxId: p.boxId || "", locationLabel: p.locationLabel || "" },
        { silent: true }
      );
      if (!rUp || !rUp.ok) return { ok: false, reason: "box-upsert" };
      const bid = rUp.box && rUp.box.boxId ? rUp.box.boxId : p.boxId;
      return this.restoreToBoxAndMain(itemId, bid, q, { boxNumber: n });
    }
    if (kind === "location") {
      const locKey = String(p.locationKey || "").trim();
      if (!locKey) return { ok: false, reason: "invalid-location" };
      const canon = Utils.strictEffectiveWarehouseLocationText(locKey) || locKey;
      return this.restoreToLocationStockAndMain(itemId, canon, q);
    }
    this.updateStock(itemId, "main", q);
    return { ok: true };
  },

  /** Revierte applyCompraStockPlacement (p. ej. anular movimiento). */
  revertCompraStockPlacement(itemId, quantity, place) {
    const inv0 = this.getItemById(itemId);
    if (inv0 && inv0.inventoryConsumable) return { ok: true };
    const q = Utils.roundDecimal(Math.abs(parseFloat(quantity) || 0));
    if (q <= 0) return { ok: true };
    const p = place && typeof place === "object" ? place : { kind: "main" };
    const kind = p.kind || "main";
    if (kind === "main") {
      this.updateStock(itemId, "main", -q);
      return { ok: true };
    }
    if (kind === "box" && p.boxId) {
      return this.consumeFromBoxAndMain(itemId, p.boxId, q, { boxNumber: p.boxNumber });
    }
    if (kind === "box") {
      const it = this.getItemById(itemId);
      const n = parseInt(p.boxNumber, 10);
      if (it && this._isValidBoxNumber(n)) {
        const idx = it.boxStocks ? it.boxStocks.findIndex(b => Number(b.boxNumber) === n) : -1;
        if (idx >= 0) {
          return this.consumeFromBoxAndMain(itemId, it.boxStocks[idx].boxId, q, { boxNumber: n });
        }
      }
      this.updateStock(itemId, "main", -q);
      return { ok: true };
    }
    if (kind === "location" && p.locationKey) {
      const canon = Utils.strictEffectiveWarehouseLocationText(p.locationKey) || String(p.locationKey).trim();
      if (canon) return this.consumeFromLocationStockAndMain(itemId, canon, q);
    }
    this.updateStock(itemId, "main", -q);
    return { ok: true };
  },

  getItemLocationStocksNormalized(itemId) {
    const it = this.getItemById(itemId);
    if (!it) return [];
    return this._normalizeItemLocationStocks(it);
  },

  /** Suma del stock declarado en cajas del depósito principal (CajasJson). */
  _sumBoxStockQtyForItem(item) {
    if (!item || !item.id) return 0;
    let s = 0;
    for (const b of this.getItemBoxStocks(item.id)) {
      s += this._parseBoxStockQtyValue(b.qty);
    }
    return Utils.roundDecimal(s);
  },

  /** Suma del stock declarado por ubicación (UbicacionesJson, sin contar cajas). */
  _sumLocationStockQtyForItem(item) {
    if (!item) return 0;
    const rows = this._normalizeItemLocationStocks(item);
    let s = 0;
    for (const r of rows) s += parseFloat(r?.qty) || 0;
    return Utils.roundDecimal(s);
  },

  /**
   * Vista previa (sin aplicar) de la reconciliación: lista artículos cuyo
   * `mainStock` está por debajo de la **suma real** de cajas + ubicaciones.
   * Incluye el detalle por artículo para mostrarlo en la confirmación.
   * @returns {{items: Array<{id:string, code:string, description:string, main:number, boxes:number, locs:number, sum:number, delta:number}>, totalDelta:number}}
   */
  previewReconcileMainStock() {
    const out = [];
    let totalDelta = 0;
    for (const it of this.items || []) {
      if (!it || it.inventoryConsumable) continue;
      const boxes = this._sumBoxStockQtyForItem(it);
      const locs = this._sumLocationStockQtyForItem(it);
      const sum = Utils.roundDecimal(boxes + locs);
      const main = Utils.roundDecimal(parseFloat(it.mainStock) || 0);
      if (sum > main) {
        const delta = Utils.roundDecimal(sum - main);
        out.push({
          id: it.id,
          code: it.code || "",
          description: it.description || "",
          main,
          boxes,
          locs,
          sum,
          delta
        });
        totalDelta = Utils.roundDecimal(totalDelta + delta);
      }
    }
    return { items: out, totalDelta };
  },

  /**
   * Recalcula `mainStock` para cada artículo como **suma de todo lo registrado**
   * (cajas + filas por ubicación, manteniendo el sobrante no asignado si supera al
   * total registrado). Pensado para reparar inventarios cuyas cajas / ubicaciones
   * se editaron sin sincronizar con el total y el principal aparece por debajo
   * de la suma real. **No reduce** el principal en ningún caso: solo lo lleva al
   * alza cuando hace falta (porque el principal puede incluir además un sobrante
   * no asignado a cajas/ubicaciones).
   * @returns {{changed:number, totalDelta:number, items:Array<object>}}
   */
  reconcileMainStockFromContainers() {
    const preview = this.previewReconcileMainStock();
    for (const row of preview.items) {
      const it = this.getItemById(row.id);
      if (!it) continue;
      it.mainStock = row.sum;
    }
    if (preview.items.length > 0) {
      this.save();
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    }
    return { changed: preview.items.length, totalDelta: preview.totalDelta, items: preview.items };
  },

  /**
   * Vista previa (sin aplicar) de la normalización al formato de almacenamiento
   * canónico: detecta artículos cuyo JSON difiere de la salida de
   * `_normalizeItemForStorage` (ubicación, `locationStocks`, `boxStocks`). Es
   * el mismo trabajo que se hace al guardar manualmente un artículo desde el
   * editor, así que sirve para arrastrar al canon a items importados desde
   * respaldos antiguos cuya ubicación venía en texto libre, en minúsculas, o
   * con tokens de caja huérfanos que deben eliminarse o promoverse a la
   * jerarquía `ubicación > BOXn`.
   *
   * @returns {{items: Array<{id:string, code:string, description:string, changes:Array<{field:string, from:any, to:any}>}>}}
   */
  previewNormalizeStorageDrift() {
    const out = [];
    for (const it of this.items || []) {
      if (!it || typeof it !== "object") continue;
      const normalized = this._normalizeItemForStorage(it);
      const changes = [];
      const stringify = v => JSON.stringify(v ?? null);
      if (String(it.location || "") !== String(normalized.location || "")) {
        changes.push({ field: "location", from: it.location || "", to: normalized.location || "" });
      }
      if (stringify(it.locationStocks) !== stringify(normalized.locationStocks)) {
        changes.push({
          field: "locationStocks",
          from: Array.isArray(it.locationStocks) ? it.locationStocks.length : 0,
          to: Array.isArray(normalized.locationStocks) ? normalized.locationStocks.length : 0
        });
      }
      if (stringify(it.boxStocks) !== stringify(normalized.boxStocks)) {
        changes.push({
          field: "boxStocks",
          from: Array.isArray(it.boxStocks) ? it.boxStocks.length : 0,
          to: Array.isArray(normalized.boxStocks) ? normalized.boxStocks.length : 0
        });
      }
      if (changes.length) {
        out.push({
          id: it.id,
          code: it.code || "",
          description: it.description || "",
          changes
        });
      }
    }
    return { items: out };
  },

  /**
   * Aplica la normalización canónica a cada artículo (equivalente a guardarlo
   * todo desde el editor). Solo escribe cuando hay diferencias reales para no
   * tocar `updatedAt` innecesariamente ni saturar respaldos posteriores con
   * cambios fantasma.
   * @returns {{items:Array<object>}}
   */
  normalizeStorageDrift() {
    const preview = this.previewNormalizeStorageDrift();
    if (!preview.items.length) return preview;
    const byId = new Set(preview.items.map(r => String(r.id)));
    this.items = (this.items || []).map(it => {
      if (!byId.has(String(it.id))) return it;
      return this._normalizeItemForStorage(it);
    });
    this.save();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return preview;
  },

  /**
   * Vista previa (sin aplicar) del refresco de caducidades dinámicas. Identifica
   * lotes con `lot.date` almacenado **redundante**: aquellos cuya fecha guardada
   * coincide ya con `expDate + shelfLifeMonths`, o aquellos cuya `lot.date` no
   * concuerda con la vida útil vigente (lotes legacy donde la vida útil cambió
   * tras el registro). En ambos casos, eliminar `lot.date` deja que el motor lo
   * recalcule al vuelo con el `shelfLifeMonths` actual.
   *
   * Nota: para evitar pisar caducidades **personalizadas** del envase (típico:
   * "caducidad escrita a mano distinta a la calculada"), se reporta también la
   * comparación contra el valor que se obtendría al recalcular: si la persona
   * usuaria escribió una caducidad que coincide con la calculada, da igual
   * limpiarla; si es distinta, se considera personalizada y la dejamos intacta.
   *
   * @returns {{itemsChanged:number, lotsChanged:number, lotsKept:number, items:Array<{id:string,code:string,description:string,lotIndex:number,storedDate:string,recomputedDate:string,expDate:string}>}}
   */
  previewRefreshLotExpiriesFromShelfLife() {
    const items = [];
    let itemsChanged = 0;
    let lotsChanged = 0;
    let lotsKept = 0;
    for (const it of this.items || []) {
      if (!it || it.inventoryConsumable) continue;
      const months = Math.max(0, parseInt(it.shelfLifeMonths, 10) || 0);
      if (months <= 0) continue;
      const arr = Array.isArray(it.expirations) ? it.expirations : [];
      let touched = false;
      for (let i = 0; i < arr.length; i++) {
        const lot = arr[i];
        const expedition = String(lot?.expDate || "").trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expedition)) continue;
        const stored = String(lot?.date || "").trim().slice(0, 10);
        if (!stored) continue;
        const recomputed = this.addMonthsToIsoDate(expedition, months) || "";
        if (stored === recomputed) {
          /* Redundante: clear no cambia comportamiento, pero migra al formato
             nuevo (dinámico). Lo aplicamos. */
          items.push({
            id: it.id,
            code: it.code || "",
            description: it.description || "",
            lotIndex: i,
            storedDate: stored,
            recomputedDate: recomputed,
            expDate: expedition
          });
          touched = true;
          lotsChanged++;
        } else {
          /* `lot.date` distinto a `expDate + vidaUtil`: lo dejamos. Es una
             caducidad personalizada del envase (o legacy con vida útil cambiada
             que queremos preservar como referencia). */
          lotsKept++;
        }
      }
      if (touched) itemsChanged++;
    }
    return { itemsChanged, lotsChanged, lotsKept, items };
  },

  /**
   * Recalcula la fecha de caducidad por lote a partir de la expedición + vida
   * útil **actual** del artículo. Limpia `lot.date` solo donde su valor ya
   * coincide con la fecha computada (es decir, no había información extra) para
   * que `getLotEffectiveExpiryDate` lo derive al vuelo con el `shelfLifeMonths`
   * vigente. Caducidades personalizadas del envase (distintas a `expDate + vidaUtil`)
   * se **preservan**.
   * @returns {{itemsChanged:number, lotsChanged:number, lotsKept:number, items:object[]}}
   */
  refreshLotExpiriesFromShelfLife() {
    const preview = this.previewRefreshLotExpiriesFromShelfLife();
    if (!preview.items.length) return preview;
    /* Aplicamos limpiando `lot.date` solo en las posiciones identificadas por la
       vista previa, para no tocar nada más. */
    for (const row of preview.items) {
      const it = this.getItemById(row.id);
      const lot = Array.isArray(it?.expirations) ? it.expirations[row.lotIndex] : null;
      if (!lot) continue;
      delete lot.date;
    }
    this.save();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return preview;
  },

  /**
   * Acción combinada **«Actualizar inventario»**: encadena en una sola
   * confirmación las tres rutinas de mantenimiento:
   *
   * 1. **Normalización de almacenamiento** (`normalizeStorageDrift`): para cada
   *    artículo, re-aplica el mismo paso de saneo que se hace al guardar desde
   *    el editor. Pone la ubicación en mayúsculas catálogo, promueve tokens
   *    `BOXn` huérfanos, sincroniza `boxStocks`/`locationStocks` y limpia
   *    cualquier residuo heredado de respaldos antiguos.
   * 2. **Reconciliación de stock principal** (`reconcileMainStockFromContainers`):
   *    eleva `mainStock` a la suma de cajas + ubicaciones cuando esté por debajo.
   *    Solo sube, nunca baja.
   * 3. **Migración de caducidades por lote** (`refreshLotExpiriesFromShelfLife`):
   *    libera `lot.date` solo cuando es redundante con `expDate + vidaUtil`.
   *    Caducidades personalizadas del envase se preservan.
   *
   * Cada rutina genera su propia vista previa y se muestran juntas en una
   * confirmación común. Si ninguna tiene cambios, un toast informativo.
   */
  async runRefreshInventoryDataAction() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("editItems")) return;
    /* Importante: normalizamos PRIMERO para que `reconcileMainStockFromContainers`
       trabaje sobre `locationStocks` y `boxStocks` ya saneados. Así no se queda
       fuera ninguna ubicación importada en texto libre que el normalizador
       acaba de promover al catálogo. */
    const norm = this.previewNormalizeStorageDrift();
    const recon = this.previewReconcileMainStock();
    const lots = this.previewRefreshLotExpiriesFromShelfLife();
    if (!norm.items.length && !recon.items.length && !lots.items.length) {
      Utils.showToast(
        I18n.t("inventory.refreshDataNothing") ||
          "Nada que actualizar: stock principal, ubicaciones y caducidades de lotes ya están al día.",
        "info"
      );
      return;
    }
    /* Detalle por sección para que la persona vea exactamente qué se va a tocar
       antes de aceptar. Limitado a 5 filas por sección para mantener la
       confirmación legible. */
    const normBlock = (() => {
      if (!norm.items.length) {
        return `• ${I18n.t("inventory.refreshDataNormalizeSkip") || "Ubicaciones / cajas: ya están normalizadas."}`;
      }
      const sample = norm.items
        .slice(0, 5)
        .map(r => {
          const fields = r.changes.map(c => c.field).join(", ");
          return `   ${r.code} — ${fields}`;
        })
        .join("\n");
      const extra = norm.items.length > 5 ? `\n   …y ${norm.items.length - 5} más` : "";
      const head = (I18n.t("inventory.refreshDataNormalizeHead") ||
        "• Ubicaciones / cajas: {n} artículo(s) se normalizarán al formato canónico (texto → catálogo)")
        .replace("{n}", String(norm.items.length));
      return `${head}\n${sample}${extra}`;
    })();
    const reconBlock = (() => {
      if (!recon.items.length) {
        return `• ${I18n.t("inventory.refreshDataReconcileSkip") || "Stock principal: ya cuadra con cajas + ubicaciones."}`;
      }
      const sample = recon.items
        .slice(0, 5)
        .map(r => {
          const pieces = [];
          if (r.boxes > 0) pieces.push(`cajas: ${Utils.formatDecimalDisplay(r.boxes)}`);
          if (r.locs > 0) pieces.push(`ubicaciones: ${Utils.formatDecimalDisplay(r.locs)}`);
          const breakdown = pieces.join(" + ") || "—";
          return `   ${r.code} — ${Utils.formatDecimalDisplay(r.main)} → ${Utils.formatDecimalDisplay(r.sum)} (${breakdown})`;
        })
        .join("\n");
      const extra = recon.items.length > 5 ? `\n   …y ${recon.items.length - 5} más` : "";
      const head = (I18n.t("inventory.refreshDataReconcileHead") ||
        "• Stock principal: {n} artículo(s), Δ total = +{d}")
        .replace("{n}", String(recon.items.length))
        .replace("{d}", Utils.formatDecimalDisplay(recon.totalDelta));
      return `${head}\n${sample}${extra}`;
    })();
    const lotsBlock = (() => {
      if (!lots.items.length) {
        return `• ${I18n.t("inventory.refreshDataLotsSkip") || "Caducidades de lotes: ya están al día."}`;
      }
      const sample = lots.items
        .slice(0, 5)
        .map(r => `   ${r.code} — lote exp. ${r.expDate}`)
        .join("\n");
      const extra = lots.items.length > 5 ? `\n   …y ${lots.items.length - 5} más` : "";
      const head = (I18n.t("inventory.refreshDataLotsHead") ||
        "• Caducidades de lotes: {l} lote(s) en {n} artículo(s) pasarán al cálculo dinámico (vida útil vigente)")
        .replace("{l}", String(lots.lotsChanged))
        .replace("{n}", String(lots.itemsChanged));
      const keepNote = lots.lotsKept > 0
        ? `\n   (${(I18n.t("inventory.refreshDataLotsKept") ||
            "{k} lote(s) con caducidad personalizada se preservan").replace("{k}", String(lots.lotsKept))})`
        : "";
      return `${head}\n${sample}${extra}${keepNote}`;
    })();
    const head = I18n.t("inventory.refreshDataConfirmHead") ||
      "Se actualizará el inventario con tres pasadas de mantenimiento:";
    const tail = I18n.t("inventory.refreshDataConfirmTail") ||
      "\n\nNo se reducirá ningún stock principal y las caducidades personalizadas se conservan. ¿Continuar?";
    const prompt = `${head}\n\n${normBlock}\n\n${reconBlock}\n\n${lotsBlock}${tail}`;
    const apply = () => {
      /* Orden estricto: 1) normalizar 2) reconciliar 3) caducidades. Cambiar el
         orden puede dejar la reconciliación leyendo un `locationStocks` aún
         sin normalizar y subir el principal por debajo de lo debido. */
      const resNorm = this.normalizeStorageDrift();
      const resRecon = this.reconcileMainStockFromContainers();
      const resLots = this.refreshLotExpiriesFromShelfLife();
      const msg = (I18n.t("inventory.refreshDataDone") ||
        "Actualización aplicada. Normalizados: {p} artículo(s). Stock principal: {n} artículo(s) Δ=+{d}. Caducidades de lotes: {l} lote(s) en {m} artículo(s).")
        .replace("{p}", String(resNorm.items.length))
        .replace("{n}", String(resRecon.changed))
        .replace("{d}", Utils.formatDecimalDisplay(resRecon.totalDelta))
        .replace("{l}", String(resLots.lotsChanged))
        .replace("{m}", String(resLots.itemsChanged));
      const ok = resNorm.items.length > 0 || resRecon.changed > 0 || resLots.lotsChanged > 0;
      Utils.showToast(msg, ok ? "success" : "info");
      if (typeof window !== "undefined") {
        window.__gneexLastNormalizeReport = resNorm;
        window.__gneexLastReconcileReport = resRecon;
        window.__gneexLastRefreshLotsReport = resLots;
      }
    };
    if (typeof App !== "undefined" && App.showConfirm) {
      App.showConfirm(prompt, apply);
    } else if (window.confirm(prompt)) {
      apply();
    }
  },

  /** @deprecated Mantener por compatibilidad con automatizaciones externas; ahora unificado en `runRefreshInventoryDataAction`. */
  async runReconcileMainStockAction() {
    return this.runRefreshInventoryDataAction();
  },

  /** @deprecated Mantener por compatibilidad con automatizaciones externas; ahora unificado en `runRefreshInventoryDataAction`. */
  async runRefreshLotExpiriesAction() {
    return this.runRefreshInventoryDataAction();
  },

  /**
   * Convierte el logo de la cabecera en el atajo rápido para «Actualizar
   * inventario» (normalizar + reconciliar stock + caducidades de lotes).
   *
   * Decisiones de diseño:
   * - **Idempotente**: si el logo ya está cableado lo detectamos con un flag
   *   en el dataset y no duplicamos listeners (importante porque
   *   `setupEventListeners` se llama en `init()` y podría re-ejecutarse tras
   *   re-render del header tras cambio de tema/locale en el futuro).
   * - **Permiso**: la propia acción interna ejecuta `Auth.guardPerm("editItems")`
   *   y muestra toast denegando si procede. Aquí no bloqueamos el clic para
   *   que el feedback (toast de denegación) llegue al usuario en lugar de
   *   silenciar el botón.
   * - **Spin antihorario**: añadimos la clase `is-spinning` (CSS keyframes
   *   `gneex-logo-spin-ccw`) y la quitamos en `animationend`. Mantenemos un
   *   timeout de seguridad por si el evento no llega (DevTools/iframe).
   * - **Anti-doble-clic**: durante el giro ignoramos clics adicionales para
   *   no encadenar varias confirmaciones del modal.
   * - **Accesibilidad**: respondemos también a Enter / Espacio porque al
   *   ser un `<img role="button" tabindex="0">` no recibe activación nativa.
   */
  setupLogoRefreshTrigger() {
    if (typeof document === "undefined") return;
    const logo = document.getElementById("app-logo-refresh");
    if (!logo) return;
    if (logo.dataset.gneexLogoRefreshWired === "1") return;
    logo.dataset.gneexLogoRefreshWired = "1";

    const SPIN_MS = 900;
    let spinning = false;
    let safetyTimer = null;

    const stopSpin = () => {
      spinning = false;
      logo.classList.remove("is-spinning");
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
    };

    const startSpinAndRun = () => {
      if (spinning) return;
      spinning = true;
      logo.classList.remove("is-spinning");
      /* Forzamos un reflow para reiniciar la animación si el usuario clica
         repetidamente tras `animationend`. Sin esto, la segunda animación no
         se reproduciría en algunos navegadores. */
      void logo.offsetWidth;
      logo.classList.add("is-spinning");
      safetyTimer = setTimeout(stopSpin, SPIN_MS + 200);
      try {
        this.runRefreshInventoryDataAction();
      } catch (err) {
        console.error("❌ Logo refresh trigger failed:", err);
        stopSpin();
      }
    };

    logo.addEventListener("animationend", e => {
      if (e.animationName === "gneex-logo-spin-ccw") stopSpin();
    });

    logo.addEventListener("click", e => {
      e.preventDefault();
      startSpinAndRun();
    });

    logo.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault();
      startSpinAndRun();
    });
  },

  /**
   * Cantidad atribuible a «ubicación» en principal: stock principal total − stock en cajas.
   * Es la base para las opciones loc: en movimientos de salida (sin duplicar el total del principal).
   */
  _getMainLocationPoolQty(item) {
    if (!item) return 0;
    const main = parseFloat(item.mainStock) || 0;
    return Math.max(0, Utils.roundDecimal(main - this._sumBoxStockQtyForItem(item)));
  },

  /**
   * Filas de ubicación para el desplegable de origen con cantidades **coherentes** con el pool (principal − cajas):
   * reparte ese pool entre las mismas ranuras que `getMovementLocationOptions`, proporcionalmente a sus pesos.
   */
  getMovementLocationSourceOptions(item) {
    if (!item) return [];
    const pool = this._getMainLocationPoolQty(item);
    if (pool <= 0) return [];
    const base = this.getMovementLocationOptions(item);
    if (!base.length) return [];
    const weights = base.map(r => Math.max(0, parseFloat(r.qty) || 0));
    const sumW = weights.reduce((a, b) => a + b, 0);
    const n = base.length;
    let distributed;
    if (sumW < 1e-9) {
      const each = Utils.roundDecimal(pool / n);
      distributed = base.map((r, i) => ({
        ...r,
        qty: i === n - 1 ? Utils.roundDecimal(pool - each * (n - 1)) : each
      }));
    } else {
      const rawParts = weights.map(w => pool * (w / sumW));
      distributed = base.map((r, i) => ({
        ...r,
        qty: Utils.roundDecimal(rawParts[i])
      }));
      let drift = Utils.roundDecimal(pool - distributed.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0));
      if (Math.abs(drift) > 1e-9 && distributed.length) {
        const last = distributed[distributed.length - 1];
        last.qty = Utils.roundDecimal((parseFloat(last.qty) || 0) + drift);
      }
    }
    return distributed;
  },

  /**
   * Ubicaciones de almacén para el desplegable de movimientos: filas JSON + a lo sumo una ranura del texto
   * «Ubicación» sin fila JSON (resto = principal − suma JSON). Con varias ranuras en texto y sin detalle JSON
   * no se reparte el principal por igual entre ellas.
   */
  getMovementLocationOptions(item) {
    if (!item) return [];
    const seen = new Set();
    const out = [];
    const add = (loc, qty, synthetic) => {
      const L = String(loc || "").trim();
      if (!L) return;
      const k = L.toUpperCase();
      if (seen.has(k)) return;
      seen.add(k);
      const q = Utils.roundDecimal(Math.max(0, parseFloat(qty) || 0));
      out.push({ location: L, qty: q, synthetic: !!synthetic });
    };
    const structured = this._normalizeItemLocationStocks(item);
    let sumStructured = 0;
    for (const ls of structured) {
      const q = parseFloat(ls.qty) || 0;
      sumStructured += q;
      add(ls.location, q, false);
    }
    const textSlots = [
      ...new Set(
        Utils.parseWarehouseSlotsFromLocation(item.location || "").map(s => Utils.strictCatalogLocationToken(s) || s).filter(Boolean)
      )
    ];
    const main = parseFloat(item.mainStock) || 0;
    const orphans = textSlots.filter(s => !seen.has(String(s).toUpperCase()));
    if (orphans.length) {
      const remainder = Math.max(0, Utils.roundDecimal(main - sumStructured));
      /* Una sola ranura en texto sin fila JSON: el resto no asignado va ahí. Varias ranuras: no repartir el principal por igual; hay que detallar stock por ubicación en JSON. */
      if (orphans.length === 1) add(orphans[0], remainder, true);
    }
    return out.sort((a, b) => String(a.location).localeCompare(String(b.location)));
  },

  /** Cantidad disponible para una línea de movimiento `loc:` (JSON o inferida del texto). */
  getMovementLocationAvailableQty(itemId, rawLocationKey) {
    const item = this.getItemById(itemId);
    if (!item) return 0;
    const raw = String(rawLocationKey ?? "").trim();
    if (!raw) return 0;
    const needle = Utils.strictEffectiveWarehouseLocationText(raw) || raw;
    const token = needle.split(/\s*,\s*/)[0]?.trim();
    if (!token) return 0;
    const nu = token.toUpperCase();
    const opts = this.getMovementLocationSourceOptions(item);
    const hit = opts.find(l => String(l.location).toUpperCase() === nu);
    if (hit) return Math.max(0, parseFloat(hit.qty) || 0);
    const locRows = this._normalizeItemLocationStocks(item);
    const idx = this._findLocationStockRowIndex({ locationStocks: locRows }, raw);
    if (idx >= 0) return Math.max(0, parseFloat(locRows[idx].qty) || 0);
    return 0;
  },

  /**
   * Cantidad máxima para una línea con origen `ibox:` (caja citada en texto pero sin opción `box:`).
   * - Si existe fila CajasJson con cantidad &gt; 0 para esa caja → 0 aquí (se usa solo `box:id`; stock propio por caja, sin reparto).
   * - Si solo está en el texto (o la fila tiene 0 unidades) → el movimiento sigue descontando del **principal sin caja**
   *   (pool = principal − cajas), para no duplicar cantidades entre cajas/ubicaciones.
   */
  getMovementInferredBoxAvailableQty(itemId, boxNumber) {
    const item = this.getItemById(itemId);
    if (!item) return 0;
    const n = parseInt(boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return 0;
    const nums = Utils.parseWarehouseBoxesFromLocation(item.location || "");
    if (!nums.includes(n)) return 0;
    const rows = this.getItemBoxStocks(itemId);
    const row = rows.find(b => Number(b.boxNumber) === n);
    const rowQty = row ? this._parseBoxStockQtyValue(row.qty) : 0;
    if (row && rowQty > 0) return 0;
    // Caja inferida solo desde texto (sin fila de caja): no debe reclamar todo el principal.
    // Se limita al pool sin caja para mantener la jerarquía global > ubicación > caja > sin caja.
    return Math.max(0, this._getMainLocationPoolQty(item));
  },

  /** Fragmento(s) del texto Ubicación del artículo que mencionan esta caja (p. ej. «BOX3, E1R»). */
  _snippetFromItemLocationForBox(item, boxNumber) {
    const raw = String(item?.location || "").trim();
    if (!raw) return "";
    const n = parseInt(boxNumber, 10);
    if (!Number.isFinite(n) || n < 1) return "";
    const parts = raw.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
    const hits = [];
    for (const p of parts) {
      const nums = Utils.parseWarehouseBoxesFromLocation(p);
      if (nums.includes(n)) hits.push(p);
    }
    return hits.length ? hits.join(", ") : "";
  },

  transferBetweenBoxes(itemId, fromBoxId, toBoxId, qty, toLocationLabel = "") {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const fromIdx = this._findBoxIndex(item, fromBoxId);
    const toIdx = this._findBoxIndex(item, toBoxId);
    if (fromIdx < 0 || toIdx < 0) return { ok: false, reason: "box-not-found" };
    const fromCur = this._parseBoxStockQtyValue(item.boxStocks[fromIdx].qty);
    if (fromCur < q) return { ok: false, reason: "box-overdraft" };
    item.boxStocks[fromIdx].qty = Utils.roundDecimal(fromCur - q);
    item.boxStocks[fromIdx].updatedAt = new Date().toISOString();
    item.boxStocks[toIdx].qty = Utils.roundDecimal((this._parseBoxStockQtyValue(item.boxStocks[toIdx].qty)) + q);
    const rawLab = String(toLocationLabel || "").trim();
    const locLab = Utils.strictEffectiveWarehouseLocationText(rawLab);
    if (rawLab && !locLab) return { ok: false, reason: "invalid-location-catalog" };
    item.boxStocks[toIdx].locationLabel = locLab;
    item.boxStocks[toIdx].updatedAt = new Date().toISOString();
    this._syncItemLocationFromBox(item, item.boxStocks[toIdx].boxId, locLab);
    this.save();
    return { ok: true };
  },

  /** Tras una transferencia, refleja en `item.location` la ubicación de la caja destino. */
  _syncItemLocationFromBox(item, boxId, locationOverride = "") {
    if (!item) return;
    const b = (item.boxStocks || []).find(x => String(x.boxId) === String(boxId));
    if (!b) return;
    const boxNumber = parseInt(b.boxNumber, 10);
    if (!this._isValidBoxNumber(boxNumber)) return;
    const explicit = String(locationOverride || "").trim();
    if (explicit) {
      const strict = Utils.strictEffectiveWarehouseLocationText(explicit);
      this._upsertItemLocationForBox(item, boxNumber, strict || explicit);
      return;
    }
    const label = String(b.locationLabel || "").trim();
    const labelStrict = Utils.strictEffectiveWarehouseLocationText(label);
    this._upsertItemLocationForBox(item, boxNumber, labelStrict || label || "");
  },

  /**
   * Modelo unificado ubicación/caja:
   * elimina menciones previas de esa caja y agrega una ruta jerárquica
   * `ubicación > BOXn` (una sola ubicación con sububicación).
   */
  _upsertItemLocationForBox(item, boxNumber, strictLocationLabel = "") {
    if (!item) return;
    const n = parseInt(boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return;
    const boxToken = `BOX${n}`;
    const normalizedCurrent = Utils.normalizeWarehouseLocationText(item.location || "");
    const parts = normalizedCurrent
      .split(/\s*,\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    const kept = parts.filter(p => !Utils.parseWarehouseBoxesFromLocation(p).includes(n));
    const nextParts = [];
    const nestedLocation = strictLocationLabel ? `${strictLocationLabel} > ${boxToken}` : boxToken;
    nextParts.push(nestedLocation);
    const merged = [...kept, ...nextParts]
      .map(s => String(s || "").trim())
      .filter(Boolean)
      .join(", ");
    item.location = merged;
  },

  _removeItemLocationForBox(item, boxNumber) {
    if (!item) return;
    const n = parseInt(boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return;
    const parts = String(item.location || "")
      .split(/\s*,\s*/)
      .map(s => String(s || "").trim())
      .filter(Boolean);
    const kept = parts.filter(p => !Utils.parseWarehouseBoxesFromLocation(p).includes(n));
    item.location = kept.join(", ");
  },

  /** Añade una ubicación al texto del artículo sin sobrescribir ni duplicar. */
  _appendItemLocation(item, locationText = "") {
    if (!item) return;
    const incoming = Utils.strictEffectiveWarehouseLocationText(locationText);
    if (!incoming) return;
    const current = this._coerceLocationOrRelocate(item.location || "", item);
    if (!current) {
      item.location = this._coerceLocationOrRelocate(incoming, item);
      return;
    }
    const incomingNorm = incoming.toUpperCase();
    const existingParts = current
      .split(/[;,|]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.toUpperCase());
    if (existingParts.includes(incomingNorm)) return;
    item.location = this._coerceLocationOrRelocate(`${current}, ${incoming}`, item);
  },

  transferBoxToProdStock(itemId, fromBoxId, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const fromIdx = this._findBoxIndex(item, fromBoxId);
    if (fromIdx < 0) return { ok: false, reason: "box-not-found" };
    if (item.boxStocks[fromIdx].empty) return { ok: false, reason: "box-empty" };
    const fromCur = this._parseBoxStockQtyValue(item.boxStocks[fromIdx].qty);
    if (fromCur < q) return { ok: false, reason: "box-overdraft" };
    item.boxStocks[fromIdx].qty = Utils.roundDecimal(fromCur - q);
    item.boxStocks[fromIdx].updatedAt = new Date().toISOString();
    item.prodStock = Utils.roundDecimal((parseFloat(item.prodStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  transferBoxToLocation(itemId, fromBoxId, qty, toLocationLabel = "") {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const dest = String(toLocationLabel || "").trim();
    if (!dest) return { ok: false, reason: "location-required" };
    const destStrict = Utils.strictEffectiveWarehouseLocationText(dest);
    if (!destStrict) return { ok: false, reason: "invalid-location-catalog" };
    const destParts = destStrict.split(/\s*,\s*/).filter(Boolean);
    if (destParts.length !== 1) return { ok: false, reason: "invalid-location-catalog" };
    const token = destParts[0];
    const fromIdx = this._findBoxIndex(item, fromBoxId);
    if (fromIdx < 0) return { ok: false, reason: "box-not-found" };
    if (item.boxStocks[fromIdx].empty) return { ok: false, reason: "box-empty" };
    const fromCur = this._parseBoxStockQtyValue(item.boxStocks[fromIdx].qty);
    if (fromCur < q) return { ok: false, reason: "box-overdraft" };
    item.boxStocks[fromIdx].qty = Utils.roundDecimal(fromCur - q);
    item.boxStocks[fromIdx].updatedAt = new Date().toISOString();
    this._incrementItemLocationStock(item, token, q);
    this._appendItemLocation(item, token);
    this.save();
    return { ok: true };
  },

  transferMainPoolToBox(itemId, toBoxId, qty, toLocationLabel = "") {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    if (this._getMainLocationPoolQty(item) < q) return { ok: false, reason: "insufficient-pool" };
    const toIdx = this._findBoxIndex(item, toBoxId);
    if (toIdx < 0) return { ok: false, reason: "box-not-found" };
    const rawLab = String(toLocationLabel || "").trim();
    const locLab = Utils.strictEffectiveWarehouseLocationText(rawLab);
    if (rawLab && !locLab) return { ok: false, reason: "invalid-location-catalog" };
    item.boxStocks[toIdx].qty = Utils.roundDecimal(this._parseBoxStockQtyValue(item.boxStocks[toIdx].qty) + q);
    item.boxStocks[toIdx].empty = false;
    item.boxStocks[toIdx].updatedAt = new Date().toISOString();
    if (locLab) {
      item.boxStocks[toIdx].locationLabel = locLab;
      this._syncItemLocationFromBox(item, item.boxStocks[toIdx].boxId, locLab);
    }
    this.save();
    return { ok: true };
  },

  transferBoxToMainPool(itemId, fromBoxId, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const fromIdx = this._findBoxIndex(item, fromBoxId);
    if (fromIdx < 0) return { ok: false, reason: "box-not-found" };
    if (item.boxStocks[fromIdx].empty) return { ok: false, reason: "box-empty" };
    const fromCur = this._parseBoxStockQtyValue(item.boxStocks[fromIdx].qty);
    if (fromCur < q) return { ok: false, reason: "box-overdraft" };
    item.boxStocks[fromIdx].qty = Utils.roundDecimal(fromCur - q);
    item.boxStocks[fromIdx].updatedAt = new Date().toISOString();
    this.save();
    return { ok: true };
  },

  _consumeLocationStock(item, fromLocationKey, qty) {
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    item.locationStocks = this._normalizeItemLocationStocks(item);
    const idx = this._findLocationStockRowIndex(item, fromLocationKey);
    if (idx < 0) return { ok: false, reason: "location-not-found" };
    const cur = parseFloat(item.locationStocks[idx].qty) || 0;
    if (cur < q) return { ok: false, reason: "location-overdraft" };
    const next = Utils.roundDecimal(cur - q);
    if (next <= 0) item.locationStocks.splice(idx, 1);
    else {
      item.locationStocks[idx].qty = next;
      item.locationStocks[idx].updatedAt = new Date().toISOString();
    }
    return { ok: true };
  },

  transferLocationToBox(itemId, fromLocationKey, toBoxId, qty, toLocationLabel = "") {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const toIdx = this._findBoxIndex(item, toBoxId);
    if (toIdx < 0) return { ok: false, reason: "box-not-found" };
    const rawLab = String(toLocationLabel || "").trim();
    const locLab = Utils.strictEffectiveWarehouseLocationText(rawLab);
    if (rawLab && !locLab) return { ok: false, reason: "invalid-location-catalog" };
    const c = this._consumeLocationStock(item, fromLocationKey, q);
    if (!c.ok) return c;
    item.boxStocks[toIdx].qty = Utils.roundDecimal(this._parseBoxStockQtyValue(item.boxStocks[toIdx].qty) + q);
    item.boxStocks[toIdx].empty = false;
    item.boxStocks[toIdx].updatedAt = new Date().toISOString();
    if (locLab) {
      item.boxStocks[toIdx].locationLabel = locLab;
      this._syncItemLocationFromBox(item, item.boxStocks[toIdx].boxId, locLab);
    }
    this.save();
    return { ok: true };
  },

  transferLocationToLocation(itemId, fromLocationKey, toLocationLabel, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const dest = String(toLocationLabel || "").trim();
    if (!dest) return { ok: false, reason: "location-required" };
    const destStrict = Utils.strictEffectiveWarehouseLocationText(dest);
    if (!destStrict) return { ok: false, reason: "invalid-location-catalog" };
    const fromCanon = Utils.strictEffectiveWarehouseLocationText(fromLocationKey) || String(fromLocationKey || "").trim();
    if (this._locationLabelEquals(fromCanon, destStrict)) return { ok: false, reason: "invalid-transfer" };
    const c = this._consumeLocationStock(item, fromLocationKey, q);
    if (!c.ok) return c;
    this._incrementItemLocationStock(item, destStrict, q);
    this._appendItemLocation(item, destStrict);
    this.save();
    return { ok: true };
  },

  transferLocationToProdStock(itemId, fromLocationKey, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const c = this._consumeLocationStock(item, fromLocationKey, q);
    if (!c.ok) return c;
    item.prodStock = Utils.roundDecimal((parseFloat(item.prodStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  transferLocationToTransStock(itemId, fromLocationKey, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const c = this._consumeLocationStock(item, fromLocationKey, q);
    if (!c.ok) return c;
    item.transStock = Utils.roundDecimal((parseFloat(item.transStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  transferMainPoolToLocation(itemId, toLocationLabel, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    if (this._getMainLocationPoolQty(item) < q) return { ok: false, reason: "insufficient-pool" };
    const dest = String(toLocationLabel || "").trim();
    if (!dest) return { ok: false, reason: "location-required" };
    const destStrict = Utils.strictEffectiveWarehouseLocationText(dest);
    if (!destStrict) return { ok: false, reason: "invalid-location-catalog" };
    this._incrementItemLocationStock(item, destStrict, q);
    this._appendItemLocation(item, destStrict);
    this.save();
    return { ok: true };
  },

  transferProdStockToBox(itemId, toBoxId, qty, toLocationLabel = "") {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const rawLab = String(toLocationLabel || "").trim();
    const locLab = Utils.strictEffectiveWarehouseLocationText(rawLab);
    if (rawLab && !locLab) return { ok: false, reason: "invalid-location-catalog" };
    const pq = parseFloat(item.prodStock) || 0;
    if (pq < q) return { ok: false, reason: "prod-overdraft" };
    const toIdx = this._findBoxIndex(item, toBoxId);
    if (toIdx < 0) return { ok: false, reason: "box-not-found" };
    item.prodStock = Utils.roundDecimal(pq - q);
    item.boxStocks[toIdx].qty = Utils.roundDecimal((this._parseBoxStockQtyValue(item.boxStocks[toIdx].qty)) + q);
    item.boxStocks[toIdx].empty = false;
    item.boxStocks[toIdx].locationLabel = locLab;
    item.boxStocks[toIdx].updatedAt = new Date().toISOString();
    this._syncItemLocationFromBox(item, item.boxStocks[toIdx].boxId, locLab);
    this.save();
    return { ok: true };
  },

  transferBoxToTransStock(itemId, fromBoxId, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const fromIdx = this._findBoxIndex(item, fromBoxId);
    if (fromIdx < 0) return { ok: false, reason: "box-not-found" };
    if (item.boxStocks[fromIdx].empty) return { ok: false, reason: "box-empty" };
    const fromCur = this._parseBoxStockQtyValue(item.boxStocks[fromIdx].qty);
    if (fromCur < q) return { ok: false, reason: "box-overdraft" };
    item.boxStocks[fromIdx].qty = Utils.roundDecimal(fromCur - q);
    item.boxStocks[fromIdx].updatedAt = new Date().toISOString();
    item.transStock = Utils.roundDecimal((parseFloat(item.transStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  transferTransStockToBox(itemId, toBoxId, qty, toLocationLabel = "") {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const rawLab = String(toLocationLabel || "").trim();
    const locLab = Utils.strictEffectiveWarehouseLocationText(rawLab);
    if (rawLab && !locLab) return { ok: false, reason: "invalid-location-catalog" };
    const tq = parseFloat(item.transStock) || 0;
    if (tq < q) return { ok: false, reason: "trans-overdraft" };
    const toIdx = this._findBoxIndex(item, toBoxId);
    if (toIdx < 0) return { ok: false, reason: "box-not-found" };
    item.transStock = Utils.roundDecimal(tq - q);
    item.boxStocks[toIdx].qty = Utils.roundDecimal((this._parseBoxStockQtyValue(item.boxStocks[toIdx].qty)) + q);
    item.boxStocks[toIdx].empty = false;
    item.boxStocks[toIdx].locationLabel = locLab;
    item.boxStocks[toIdx].updatedAt = new Date().toISOString();
    this._syncItemLocationFromBox(item, item.boxStocks[toIdx].boxId, locLab);
    this.save();
    return { ok: true };
  },

  transferProdToTransStock(itemId, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const pq = parseFloat(item.prodStock) || 0;
    if (pq < q) return { ok: false, reason: "prod-overdraft" };
    item.prodStock = Utils.roundDecimal(pq - q);
    item.transStock = Utils.roundDecimal((parseFloat(item.transStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  transferTransToProdStock(itemId, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const tq = parseFloat(item.transStock) || 0;
    if (tq < q) return { ok: false, reason: "trans-overdraft" };
    item.transStock = Utils.roundDecimal(tq - q);
    item.prodStock = Utils.roundDecimal((parseFloat(item.prodStock) || 0) + q);
    this.save();
    return { ok: true };
  },

  // =========================================================
  // LECTURA / ACTUALIZACIÓN DE STOCK
  // =========================================================
  getStock(id, target="main") {
    const i = this.items.find(x => x.id === id);
    if (!i) return 0;
    switch(target){
      case "production": return i.prodStock||0;
      case "transformation": return i.transStock||0;
      default: return i.mainStock||0;
    }
  },

  updateStock(id, target, qty, opts = {}) {
    const i = this.items.find(x => x.id === id);
    if(!i) return false;
    if (i.inventoryConsumable && !opts.bypassInventoryConsumable) return false;
    const dq = Utils.roundDecimal(qty);
    switch(target){
      case "production": i.prodStock = Utils.roundDecimal((i.prodStock||0)+dq); break;
      case "transformation": i.transStock = Utils.roundDecimal((i.transStock||0)+dq); break;
      default: i.mainStock = Utils.roundDecimal((i.mainStock||0)+dq);
    }
    this.save(); this.render();
    return true;
  },

  // =========================================================
  // CRUD DE ARTÍCULOS
  // =========================================================
  addItem(data) {
    const item = this._normalizeItemCoreFields({
      id: Utils.generateId(),
      code: data.code || "",
      description: data.description || "",
      category: data.category || "",
      mainStock: parseFloat(data.mainStock)||0,
      prodStock: parseFloat(data.prodStock)||0,
      transStock: parseFloat(data.transStock)||0,
      location: this._coerceLocationOrRelocate(data.location || "", {
        locationStocks: Array.isArray(data.locationStocks) ? data.locationStocks : []
      }),
      qtyPerBox: parseFloat(data.qtyPerBox)||0,
      numBoxes: parseFloat(data.numBoxes)||0,
      expDate: data.expDate || "",
      daysToExpire: parseInt(data.daysToExpire)||0,
      shelfLifeMonths: Math.max(0, parseInt(data.shelfLifeMonths, 10) || 0),
      expirationDate: data.expirationDate || "",
      supplier: data.supplier || "",
      lastOrder: data.lastOrder || "",
      details: data.details || "",
      minStock: parseFloat(data.minStock)||0,
      maxStock: parseFloat(data.maxStock)||0,
      defaultPrice: Utils.roundDecimal(parseFloat(data.defaultPrice), 2) || 0,
      priceCurrency: this._normalizePriceCurrency(data.priceCurrency),
      expirations: data.expirations || [],     // [{date,qty}]
      notes: data.notes || "",
      itemProblemsNote: String(data.itemProblemsNote || "").trim(),
      boxStocks: Array.isArray(data.boxStocks) ? data.boxStocks : [],
      locationStocks: Array.isArray(data.locationStocks) ? data.locationStocks : [],
      inventoryConsumable: !!data.inventoryConsumable,
      tracksExpiration: data.tracksExpiration === true,
      measureStockUnitId: String(data.measureStockUnitId || "").trim(),
      measureAltUnitId: String(data.measureAltUnitId || "").trim()
    }, { recomputeNumBoxes: true });
    this.items.push(this._normalizeItemBoxStocks(item));
    this.save();
    if (
      typeof MovementManager !== "undefined" &&
      MovementManager.recordAjusteNewItemInitialStock &&
      typeof I18n !== "undefined"
    ) {
      MovementManager.recordAjusteNewItemInitialStock(item, I18n.t("movements.newItemInitialStockNote"));
    }
    this.render();
    return item;
  },

  updateItem(id, upd){
    const i = this.items.findIndex(x=>x.id===id);
    if(i===-1) return;
    const next = { ...upd };
    if (Object.prototype.hasOwnProperty.call(next, "location")) {
      const ctx = { ...this.items[i], ...next };
      next.location = this._coerceLocationOrRelocate(next.location || "", ctx);
    }
    const shouldRecomputeBoxes =
      Object.prototype.hasOwnProperty.call(next, "mainStock") ||
      Object.prototype.hasOwnProperty.call(next, "qtyPerBox") ||
      Object.prototype.hasOwnProperty.call(next, "numBoxes");
    next.priceCurrency = this._normalizePriceCurrency(
      Object.prototype.hasOwnProperty.call(next, "priceCurrency") ? next.priceCurrency : this.items[i].priceCurrency
    );
    const merged = this._normalizeItemCoreFields({ ...this.items[i], ...next }, { recomputeNumBoxes: shouldRecomputeBoxes });
    this.items[i] = merged;
    this.save(); this.render();
  },

  deleteItem(id){
    this.items=this.items.filter(i=>i.id!==id);
    this.save(); this.render();
  },

  search(q){
    if(!q) return this.items;
    const s=q.toLowerCase();
    return this.items.filter(i=>
      [i.code,i.description,i.category,i.location,i.notes,i.itemProblemsNote]
        .some(f=>f&&f.toLowerCase().includes(s))
    );
  },

  _hasItemProblemsNote(item) {
    return !!(item && String(item.itemProblemsNote || "").trim());
  },

  // =========================================================
  // SISTEMA DE MIN / MAX / ALERTAS
  // =========================================================
  getStockClass(item){
    if (item && item.inventoryConsumable) return "stock-ok";
    const total = this.itemTotalStock(item);
    const exp = this.getExpirationInsight(item);
    if (exp.has && (exp.expired || exp.soon)) return "stock-expiring";
    if (total < 0) return "stock-negative";
    if (item.minStock && total < item.minStock) return "stock-below-min";
    if (item.maxStock && total > item.maxStock) return "stock-over-max";
    if (this.isItemLowStock(item)) return "stock-low";
    return "stock-ok";
  },

  daysTo(date){
    const d1=new Date(), d2=new Date(date);
    return Math.round((d2-d1)/(1000*60*60*24));
  },

  addMonthsToIsoDate(isoDateStr, months) {
    const m = Math.max(0, parseInt(months, 10) || 0);
    if (!isoDateStr || !m) return "";
    const d = new Date(isoDateStr + "T12:00:00");
    if (Number.isNaN(d.getTime())) return "";
    d.setMonth(d.getMonth() + m);
    return d.toISOString().split("T")[0];
  },

  /**
   * Artículos que participan en caducidad / FEFO (alineado con edición de artículo).
   * Solo se activa cuando el usuario marca explícitamente el checkbox.
   */
  itemTracksExpiration(item) {
    if (!item || item.inventoryConsumable) return false;
    return item.tracksExpiration === true;
  },

  /** Cualquier dato que sugiera caducidad (vida útil, fechas o lotes). */
  itemHasAnyExpiryRelatedData(item) {
    if (!item) return false;
    if (Math.max(0, parseInt(item.shelfLifeMonths, 10) || 0) > 0) return true;
    if (String(item.expDate || "").trim()) return true;
    if (String(item.expirationDate || "").trim()) return true;
    if (Array.isArray(item.expirations) && item.expirations.length) return true;
    return false;
  },

  /** Activo el control de caducidad pero aún no hay fecha efectiva calculable. */
  itemNeedsExpirationConfigComplete(item) {
    return (
      !!item &&
      !item.inventoryConsumable &&
      this.itemTracksExpiration(item) &&
      !this.getEffectiveExpirationDate(item)
    );
  },

  /**
   * Stock sin ningún dato de caducidad en el artículo: conviene completar o marcar «no caduca».
   * No aplica si ya activó el control (otra regla) o no hay stock.
   */
  _itemAnyDepotStockTotal(item) {
    if (!item) return 0;
    return (
      (parseFloat(item.mainStock) || 0) +
      (parseFloat(item.prodStock) || 0) +
      (parseFloat(item.transStock) || 0)
    );
  },

  itemNeedsExpiryDataOrOptOut(item) {
    if (!item || item.inventoryConsumable) return false;
    // Opción 1: si el control de caducidad está desactivado, no mostrar
    // aviso visual por falta de datos en inventario.
    if (!this.itemTracksExpiration(item)) return false;
    if (this._itemAnyDepotStockTotal(item) <= 0) return false;
    return !this.itemHasAnyExpiryRelatedData(item);
  },

  /**
   * Fecha de caducidad de un lote: `date` = caducidad del paquete si viene informada;
   * si no, expedición del lote (`expDate`) + vida útil del artículo (meses).
   */
  getLotEffectiveExpiryDate(lot, item) {
    if (!lot) return null;
    const rawLotDate = String(lot.date || "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawLotDate)) return rawLotDate;
    const expStr = String(lot.expDate || "").trim().slice(0, 10);
    const months = Math.max(0, parseInt(item && item.shelfLifeMonths, 10) || 0);
    if (/^\d{4}-\d{2}-\d{2}$/.test(expStr) && months > 0) {
      return this.addMonthsToIsoDate(expStr, months) || null;
    }
    return null;
  },

  /**
   * Filas de caducidad por lote (principal), orden FEFO. Sin incluir datos solo a nivel artículo.
   */
  getExpirationLotsBreakdown(item) {
    if (!item || item.inventoryConsumable) return [];
    const alertDays = Math.max(1, parseInt(this.expAlertDays, 10) || 30);
    const arr = Array.isArray(item.expirations) ? item.expirations : [];
    const rows = [];
    for (let i = 0; i < arr.length; i++) {
      const lot = arr[i];
      const q = Utils.roundDecimal(parseFloat(lot.qty) || 0);
      if (q <= 0) continue;
      const eff = this.getLotEffectiveExpiryDate(lot, item);
      let days = null;
      let status = "unknown";
      if (eff) {
        days = this.daysTo(eff);
        if (days < 0) status = "expired";
        else if (days <= alertDays) status = "soon";
        else status = "ok";
      }
      rows.push({
        kind: "lot",
        lotIndex: i,
        expeditionDate: String(lot.expDate || "").trim().slice(0, 10),
        expiryDate: eff || "",
        qty: q,
        days,
        status
      });
    }
    rows.sort((a, b) => {
      if (!a.expiryDate && !b.expiryDate) return (a.lotIndex || 0) - (b.lotIndex || 0);
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return new Date(a.expiryDate) - new Date(b.expiryDate) || (a.lotIndex || 0) - (b.lotIndex || 0);
    });
    return rows;
  },

  /**
   * Una fila «sintética» cuando hay caducidad solo a nivel artículo (sin lotes en expirations).
   */
  getArticleOnlyLotProxyRow(item) {
    if (!item || item.inventoryConsumable) return null;
    const exp = Array.isArray(item.expirations) ? item.expirations : [];
    const hasLots = exp.some(l => Utils.roundDecimal(parseFloat(l.qty) || 0) > 0);
    if (hasLots) return null;
    const eff = this.getEffectiveExpirationDateForDisplay(item);
    if (!eff) return null;
    const alertDays = Math.max(1, parseInt(this.expAlertDays, 10) || 30);
    const days = this.daysTo(eff);
    const status = days < 0 ? "expired" : days <= alertDays ? "soon" : "ok";
    const q = Utils.roundDecimal(parseFloat(item.mainStock) || 0);
    return {
      kind: "article",
      expeditionDate: String(item.expDate || "").trim().slice(0, 10),
      expiryDate: eff,
      qty: q,
      days,
      status
    };
  },

  /**
   * Fila «sintética» con el remanente de stock principal que **no está asignado**
   * a ningún lote (mainStock − Σ qty lotes con qty > 0). Aparece cuando hay
   * lotes reales pero la suma no cubre el stock principal: así el tooltip y la
   * vista rápida reflejan también las unidades sin caducidad declarada (ej.
   * stock de 55 con un lote de 30 → se añade una fila "Sin lote" de 25).
   */
  getUnassignedStockLotProxyRow(item) {
    if (!item || item.inventoryConsumable) return null;
    const main = Utils.roundDecimal(parseFloat(item.mainStock) || 0);
    if (main <= 0) return null;
    const lots = Array.isArray(item.expirations) ? item.expirations : [];
    let lotted = 0;
    for (const l of lots) {
      const q = Utils.roundDecimal(parseFloat(l?.qty) || 0);
      if (q > 0) lotted = Utils.roundDecimal(lotted + q);
    }
    /* Tolerancia decimal: nada que reportar si los lotes ya cubren (o exceden) el principal. */
    const remainder = Utils.roundDecimal(main - lotted);
    if (remainder <= 1e-9) return null;
    return {
      kind: "unassigned",
      expeditionDate: "",
      expiryDate: "",
      qty: remainder,
      days: null,
      status: "unknown"
    };
  },

  /**
   * Lotes reales (con su orden FEFO) y, **solo si ya existe al menos un lote
   * con caducidad declarada**, una fila sintética «Sin lote» con el remanente
   * del stock principal. Si el artículo no tiene lotes, devuelve la fila
   * «Nivel artículo» (con su caducidad propia) cuando aplica, pero **no** se
   * pinta el remanente en este caso: para artículos sin caducidad no queremos
   * mostrar «Sin lote» en el tooltip por defecto.
   */
  getUnifiedLotRowsForDisplay(item) {
    const lots = this.getExpirationLotsBreakdown(item);
    if (lots.length) {
      const remainder = this.getUnassignedStockLotProxyRow(item);
      return remainder ? [...lots, remainder] : lots;
    }
    const proxy = this.getArticleOnlyLotProxyRow(item);
    return proxy ? [proxy] : [];
  },

  _lotStatusLabel(status) {
    if (status === "expired") return I18n.t("inventory.lotStatusExpired");
    if (status === "soon") return I18n.t("inventory.lotStatusSoon");
    if (status === "ok") return I18n.t("inventory.lotStatusOk");
    return I18n.t("inventory.lotStatusUnknown");
  },

  _lotDaysLabel(days, status) {
    if (days === null || Number.isNaN(days)) return "—";
    if (status === "expired") return I18n.t("inventory.lotDaysExpiredAgo").replace("{n}", String(Math.abs(days)));
    return I18n.t("inventory.lotDaysRemaining").replace("{n}", String(days));
  },

  /** Celda compacta inventario: pastillas por estado + tooltip detalle. */
  _renderInventoryLotsBreakdownCell(it) {
    const rows = this.getUnifiedLotRowsForDisplay(it);
    if (!rows.length) {
      return `<td class="inv-lots-cell muted">—</td>`;
    }
    const fmt = v => Utils.formatDecimalDisplay(v);
    let sumEx = 0,
      sumSoon = 0,
      sumOk = 0,
      sumUn = 0;
    for (const r of rows) {
      if (r.status === "expired") sumEx = Utils.roundDecimal(sumEx + r.qty);
      else if (r.status === "soon") sumSoon = Utils.roundDecimal(sumSoon + r.qty);
      else if (r.status === "ok") sumOk = Utils.roundDecimal(sumOk + r.qty);
      else sumUn = Utils.roundDecimal(sumUn + r.qty);
    }
    const pillParts = [];
    if (sumEx > 0) {
      pillParts.push(
        `<span class="inv-lot-pill inv-lot-pill--expired">${this.esc(fmt(sumEx))}</span>`
      );
    }
    if (sumSoon > 0) {
      pillParts.push(`<span class="inv-lot-pill inv-lot-pill--soon">${this.esc(fmt(sumSoon))}</span>`);
    }
    if (sumOk > 0) {
      pillParts.push(`<span class="inv-lot-pill inv-lot-pill--ok">${this.esc(fmt(sumOk))}</span>`);
    }
    if (sumUn > 0) {
      pillParts.push(`<span class="inv-lot-pill inv-lot-pill--unknown">${this.esc(fmt(sumUn))}</span>`);
    }
    const tipLines = rows.map(r => {
      const expL = r.expiryDate ? Utils.formatDate(r.expiryDate) : "—";
      const expd = r.expeditionDate ? Utils.formatDate(r.expeditionDate) : "—";
      const st = this._lotStatusLabel(r.status);
      const dy = this._lotDaysLabel(r.days, r.status);
      const lab = this._lotRowKindLabel(r.kind);
      return `${lab}: ${fmt(r.qty)} · ${I18n.t("inventory.lotTooltipExpiry")} ${expL} · ${I18n.t("inventory.lotTooltipExped")} ${expd} · ${dy} · ${st}`;
    });
    const title = Utils.escapeAttr(tipLines.join("\n"));
    return `<td class="inv-lots-cell" title="${title}"><span class="inv-lots-pills">${pillParts.join("")}</span></td>`;
  },

  /** Etiqueta «Origen» para cada tipo de fila de la tabla/tooltip de lotes. */
  _lotRowKindLabel(kind) {
    if (kind === "article") return I18n.t("inventory.lotRowArticleLevel");
    if (kind === "unassigned") return I18n.t("inventory.lotRowUnassigned") || "Sin lote";
    return I18n.t("inventory.lotRowLotLevel");
  },

  _renderQuickViewLotsTable(item) {
    const rows = this.getUnifiedLotRowsForDisplay(item);
    if (!rows.length) return "";
    const fmt = v => Utils.formatDecimalDisplay(v);
    const showDate = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d).slice(0, 10)) ? Utils.formatDate(d.slice(0, 10)) : "—");
    const body = rows
      .map(r => {
        const cls =
          r.status === "expired"
            ? "inv-lots-tr--expired"
            : r.status === "soon"
              ? "inv-lots-tr--soon"
              : r.status === "ok"
                ? "inv-lots-tr--ok"
                : "inv-lots-tr--unknown";
        const kindLab = `<span class="inv-lots-kind inv-lots-kind--${r.kind || "lot"}">${this.esc(this._lotRowKindLabel(r.kind))}</span>`;
        return `<tr class="${cls}">
          <td>${kindLab}</td>
          <td>${this.esc(fmt(r.qty))}</td>
          <td>${this.esc(showDate(r.expeditionDate))}</td>
          <td>${this.esc(showDate(r.expiryDate))}</td>
          <td>${this.esc(this._lotDaysLabel(r.days, r.status))}</td>
          <td>${this.esc(this._lotStatusLabel(r.status))}</td>
        </tr>`;
      })
      .join("");
    return `<div class="inv-lots-section">
      <h4 class="inv-lots-heading">${this.esc(I18n.t("inventory.lotsBreakdownTitle"))}</h4>
      <div class="inventory-table-container inventory-table-container--nested">
        <table class="inventory-table inv-lots-table">
          <thead><tr>
            <th>${this.esc(I18n.t("inventory.lotsColOrigin"))}</th>
            <th>${this.esc(I18n.t("inventory.lotsColQty"))}</th>
            <th>${this.esc(I18n.t("inventory.lotsColExpedition"))}</th>
            <th>${this.esc(I18n.t("inventory.lotsColExpiry"))}</th>
            <th>${this.esc(I18n.t("inventory.lotsColWhen"))}</th>
            <th>${this.esc(I18n.t("inventory.lotsColStatus"))}</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="form-hint muted inv-lots-legend">${this.esc(I18n.t("inventory.lotsBreakdownLegend"))}</p>
    </div>`;
  },

  /**
   * Fecha de caducidad efectiva para listados, vista rápida y pastillas de lotes:
   * usa las mismas fuentes que {@link getEffectiveExpirationDate} pero **sin** exigir
   * el checkbox «Controlar caducidad» (muchas piezas tienen fechas/lotes por compra sin ese flag).
   */
  getEffectiveExpirationDateForDisplay(item) {
    if (!item || item.inventoryConsumable) return null;
    const candidates = [];
    const months = Math.max(0, parseInt(item.shelfLifeMonths, 10) || 0);
    if (item.expDate && months > 0) {
      const end = this.addMonthsToIsoDate(item.expDate, months);
      if (end) candidates.push(end);
    }
    if (item.expirationDate && /^\d{4}-\d{2}-\d{2}/.test(String(item.expirationDate).trim())) {
      candidates.push(String(item.expirationDate).trim().slice(0, 10));
    }
    if (item.expirations?.length) {
      for (const lot of item.expirations) {
        const eff = this.getLotEffectiveExpiryDate(lot, item);
        if (eff) candidates.push(eff);
      }
    }
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
  },

  /**
   * Fecha de caducidad efectiva cuando el artículo tiene activado el control FEFO en edición.
   * Movimientos y reglas estrictas siguen usando esto.
   */
  getEffectiveExpirationDate(item) {
    if (!item || !this.itemTracksExpiration(item)) return null;
    return this.getEffectiveExpirationDateForDisplay(item);
  },

  /**
   * Desglose de unidades afectadas por caducidad: cuánto stock está **vencido**
   * y cuánto **próximo a vencer** dentro del umbral configurado (`expAlertDays`).
   *
   * Reglas:
   * - Si hay lotes reales (`item.expirations` con `qty > 0`), suma la cantidad
   *   de cada lote según su estado individual (FEFO ya respeta cada caducidad).
   *   El resto del stock principal (cajas/ubicaciones sin lote, o stock libre)
   *   no se cuenta como afectado porque no tiene caducidad declarada.
   * - Si no hay lotes pero sí caducidad a nivel artículo (campo `expirationDate`
   *   o `expDate + shelfLifeMonths`), todo el `mainStock` se atribuye al estado
   *   resultante (vencido o próximo).
   * - Para artículos sin caducidad alguna, devuelve ceros.
   *
   * @returns {{expired:number, soon:number, total:number, lotsCount:number}}
   */
  getExpirationAffectedBreakdown(item) {
    const empty = { expired: 0, soon: 0, total: 0, lotsCount: 0 };
    if (!item || item.inventoryConsumable) return empty;
    const alertDays = Math.max(1, parseInt(this.expAlertDays, 10) || 30);
    const lots = this.getExpirationLotsBreakdown(item);
    if (lots.length > 0) {
      let exp = 0, soon = 0, n = 0;
      for (const r of lots) {
        if (r.status === "expired") {
          exp = Utils.roundDecimal(exp + (parseFloat(r.qty) || 0));
          n++;
        } else if (r.status === "soon") {
          soon = Utils.roundDecimal(soon + (parseFloat(r.qty) || 0));
          n++;
        }
      }
      return {
        expired: Utils.roundDecimal(exp),
        soon: Utils.roundDecimal(soon),
        total: Utils.roundDecimal(exp + soon),
        lotsCount: n
      };
    }
    const eff = this.getEffectiveExpirationDateForDisplay(item);
    if (!eff) return empty;
    const days = this.daysTo(eff);
    const qty = Utils.roundDecimal(parseFloat(item.mainStock) || 0);
    if (qty <= 0) return empty;
    if (days < 0) return { expired: qty, soon: 0, total: qty, lotsCount: 1 };
    if (days <= alertDays) return { expired: 0, soon: qty, total: qty, lotsCount: 1 };
    return empty;
  },

  getExpirationInsight(item) {
    if (!item || item.inventoryConsumable) return { has: false, days: null, expired: false, soon: false };
    const eff = this.getEffectiveExpirationDateForDisplay(item);
    if (!eff) return { has: false, days: null, expired: false, soon: false };
    const days = this.daysTo(eff);
    const parsed = {
      has: true,
      days,
      expired: days < 0,
      soon: days >= 0 && days <= (this.expAlertDays || 30)
    };
    return parsed;
  },

  minEffective(item) {
    const m = parseFloat(item.minStock);
    return m > 0 ? m : 5;
  },

  /**
   * Stock «principal» para totales/alertas: solo almacén principal (mainStock).
   * Producción y transformación son depósitos separados y no se suman al principal.
   */
  itemTotalStock(item) {
    return parseFloat(item && item.mainStock) || 0;
  },

  /**
   * Cantidad disponible en un extremo de transferencia (depósito o caja del artículo).
   * @param {string} depot 'main' | 'production' | 'transformation'
   * @param {string} [boxId] si depot==='main' y hay caja, stock de esa fila
   */
  getTransferenciaEndpointQty(itemId, depot, boxId) {
    const item = this.getItemById(itemId);
    if (!item) return 0;
    const d = String(depot || "main");
    if (d === "production") return parseFloat(item.prodStock) || 0;
    if (d === "transformation") return parseFloat(item.transStock) || 0;
    const bid = String(boxId || "").trim();
    if (bid) {
      const idx = this._findBoxIndex(item, bid);
      if (idx < 0) return 0;
      return this._parseBoxStockQtyValue(item.boxStocks[idx].qty);
    }
    return parseFloat(item.mainStock) || 0;
  },

  /**
   * Aplica una línea de movimiento TRANSFERENCIA (incl. cajas del artículo cuando aplica).
   * @returns {{ ok: boolean, reason?: string }}
   */
  applyTransferenciaLine(line) {
    const itemId = line && line.itemId;
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(line.quantity) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    const from = String(line.transferFrom || "main");
    const to = String(line.transferTo || "main");
    const fromBox = String(line.transferFromBoxId || "").trim();
    const toBox = String(line.transferToBoxId || "").trim();

    if (from === "main" && fromBox && to === "production" && !toBox) {
      const r = this.transferBoxToProdStock(itemId, fromBox, q);
      return r && r.ok ? { ok: true } : { ok: false, reason: "box-to-prod" };
    }
    if (from === "production" && !fromBox && to === "main" && toBox) {
      const r = this.transferProdStockToBox(itemId, toBox, q, "");
      return r && r.ok ? { ok: true } : { ok: false, reason: "prod-to-box" };
    }
    if (from === "main" && fromBox && to === "transformation" && !toBox) {
      const r = this.transferBoxToTransStock(itemId, fromBox, q);
      return r && r.ok ? { ok: true } : { ok: false, reason: "box-to-trans" };
    }
    if (from === "transformation" && !fromBox && to === "main" && toBox) {
      const r = this.transferTransStockToBox(itemId, toBox, q, "");
      return r && r.ok ? { ok: true } : { ok: false, reason: "trans-to-box" };
    }
    if (from === "main" && fromBox && to === "main" && toBox && fromBox !== toBox) {
      const r = this.transferBetweenBoxes(itemId, fromBox, toBox, q, "");
      return r && r.ok ? { ok: true } : { ok: false, reason: "box-to-box" };
    }

    if (fromBox || toBox) {
      return { ok: false, reason: "unsupported-box-endpoint" };
    }
    this.updateStock(itemId, from, -q);
    this.updateStock(itemId, to, q);
    return { ok: true };
  },

  /** Anula el efecto de `applyTransferenciaLine` (mismas convenciones de línea). */
  revertTransferenciaLine(line) {
    const itemId = line && line.itemId;
    const item = this.getItemById(itemId);
    if (!item) return false;
    const q = Utils.roundDecimal(Math.abs(parseFloat(line.quantity) || 0));
    if (q <= 0) return true;
    const from = String(line.transferFrom || "main");
    const to = String(line.transferTo || "main");
    const fromBox = String(line.transferFromBoxId || "").trim();
    const toBox = String(line.transferToBoxId || "").trim();

    if (from === "main" && fromBox && to === "production" && !toBox) {
      const idx = this._findBoxIndex(item, fromBox);
      if (idx < 0) return false;
      item.prodStock = Utils.roundDecimal(Math.max(0, (parseFloat(item.prodStock) || 0) - q));
      item.boxStocks[idx].qty = Utils.roundDecimal(this._parseBoxStockQtyValue(item.boxStocks[idx].qty) + q);
      item.boxStocks[idx].updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    if (from === "production" && !fromBox && to === "main" && toBox) {
      const idx = this._findBoxIndex(item, toBox);
      if (idx < 0) return false;
      item.prodStock = Utils.roundDecimal((parseFloat(item.prodStock) || 0) + q);
      const cur = this._parseBoxStockQtyValue(item.boxStocks[idx].qty);
      item.boxStocks[idx].qty = Utils.roundDecimal(Math.max(0, cur - q));
      item.boxStocks[idx].updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    if (from === "main" && fromBox && to === "transformation" && !toBox) {
      const idx = this._findBoxIndex(item, fromBox);
      if (idx < 0) return false;
      item.transStock = Utils.roundDecimal(Math.max(0, (parseFloat(item.transStock) || 0) - q));
      item.boxStocks[idx].qty = Utils.roundDecimal(this._parseBoxStockQtyValue(item.boxStocks[idx].qty) + q);
      item.boxStocks[idx].updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    if (from === "transformation" && !fromBox && to === "main" && toBox) {
      const idx = this._findBoxIndex(item, toBox);
      if (idx < 0) return false;
      item.transStock = Utils.roundDecimal((parseFloat(item.transStock) || 0) + q);
      const cur = this._parseBoxStockQtyValue(item.boxStocks[idx].qty);
      item.boxStocks[idx].qty = Utils.roundDecimal(Math.max(0, cur - q));
      item.boxStocks[idx].updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    if (from === "main" && fromBox && to === "main" && toBox && fromBox !== toBox) {
      return this.transferBetweenBoxes(itemId, toBox, fromBox, q, "") ? true : false;
    }
    if (!fromBox && !toBox) {
      this.updateStock(itemId, from, q);
      this.updateStock(itemId, to, -q);
      return true;
    }
    return false;
  },

  /** Combina un artículo con un mapa de stock (salida de MovementManager.computeStockMapAsOfDate). */
  mergeItemStockFromMap(item, stockMap) {
    if (!item || !stockMap || !stockMap.get) return item;
    const row = stockMap.get(item.id);
    if (!row) {
      return { ...item, mainStock: 0, prodStock: 0, transStock: 0 };
    }
    return {
      ...item,
      mainStock: row.main,
      prodStock: row.prod,
      transStock: row.trans
    };
  },

  /** Lista de artículos con stock real o reconstruido si hay consulta «al». */
  getItemsWithOptionalAsOfStock() {
    if (!this._asOfDate || typeof MovementManager === "undefined" || !MovementManager.computeStockMapAsOfDate) {
      return this.items;
    }
    const sm = MovementManager.computeStockMapAsOfDate(this._asOfDate);
    return this.items.map(it => this.mergeItemStockFromMap(it, sm));
  },

  _updateAsOfUi() {
    const clearBtn = document.getElementById("inventory-asof-clear");
    const activeEl = document.getElementById("inventory-asof-active");
    const dateInp = document.getElementById("inventory-asof-date");
    if (clearBtn) clearBtn.style.display = this._asOfDate ? "inline-flex" : "none";
    if (activeEl) {
      if (this._asOfDate) {
        activeEl.style.display = "inline-block";
        activeEl.textContent = Utils.formatDate(this._asOfDate);
        activeEl.title = I18n.t("inventory.asOfActive").replace("{date}", Utils.formatDate(this._asOfDate));
      } else {
        activeEl.style.display = "none";
        activeEl.textContent = "";
        activeEl.removeAttribute("title");
      }
    }
    if (dateInp && !this._asOfDate) dateInp.value = "";
    else if (dateInp && this._asOfDate) dateInp.value = this._asOfDate;
  },

  /** Abre selección de fecha para inventario histórico (prompt robusto, sin depender del datepicker oculto). */
  async _openInventoryAsOfPicker() {
    const inp = document.getElementById("inventory-asof-date");
    if (!inp) return;
    const defaultDate = this._asOfDate || new Date().toISOString().slice(0, 10);
    inp.value = defaultDate;
    try {
      if (typeof App !== "undefined" && App.showPrompt) {
        const picked = await App.showPrompt({
          message: I18n.t("inventory.asOfOpenTitle"),
          defaultValue: defaultDate,
          inputType: "date"
        });
        const v = picked != null ? String(picked).trim() : "";
        if (!v) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          Utils.showToast(I18n.t("inventory.asOfPickerFail"), "warning");
          return;
        }
        inp.value = v;
        this._asOfDate = v;
        this.render(this.search(document.getElementById("inventory-search")?.value || ""));
        return;
      }
    } catch (e) {
      /* fallback native below */
    }

    // Fallback final (por si App.showPrompt no existe): datepicker nativo.
    try {
      if (typeof inp.showPicker === "function") {
        inp.showPicker();
        return;
      }
      inp.focus();
      inp.click();
      return;
    } catch (e) {
      /* toast below */
    }
    Utils.showToast(I18n.t("inventory.asOfPickerFail"), "warning");
  },

  isLowStockIgnored(item) {
    return !!(item && item.ignoreLowStockAlert);
  },

  isItemLowStock(item) {
    if (item && item.inventoryConsumable) return false;
    if (this.isLowStockIgnored(item)) return false;
    const total = this.itemTotalStock(item);
    const minEff = this.minEffective(item);
    return total > 0 && total <= minEff;
  },

  setIgnoreLowStockDetection(itemId, enabled) {
    const idx = (this.items || []).findIndex(it => String(it.id) === String(itemId));
    if (idx < 0) return false;
    this.items[idx] = this._normalizeItemCoreFields({
      ...this.items[idx],
      ignoreLowStockAlert: !!enabled
    });
    this.save();
    if (typeof Dashboard !== "undefined" && Dashboard.refresh) Dashboard.refresh();
    return true;
  },

  isItemOverstock(item) {
    if (item && item.inventoryConsumable) return false;
    const total = this.itemTotalStock(item);
    return (item.maxStock || 0) > 0 && total > item.maxStock;
  },

  getItemsLowStock() {
    return (this.items || []).filter(i => this.isItemLowStock(i));
  },

  getItemsNegative() {
    return (this.items || []).filter(i => !i.inventoryConsumable && this.itemTotalStock(i) < 0);
  },

  getItemsOverstock() {
    return (this.items || []).filter(i => this.isItemOverstock(i));
  },

  getItemsZeroStock() {
    return (this.items || []).filter(i => this.itemTotalStock(i) === 0);
  },

  /** Vencidos o dentro del umbral de aviso (días), según fecha efectiva basada en expedición + vida útil. */
  getItemsExpirationAlert() {
    return (this.items || []).filter(i => {
      const x = this.getExpirationInsight(i);
      return x.has && (x.expired || x.soon);
    });
  },

  /** Clase de color solo para la celda de stock principal. */
  getMainStockDisplayClass(item) {
    if (item && item.inventoryConsumable) return "inv-main-good";
    const total = this.itemTotalStock(item);
    const minEff = this.minEffective(item);
    const maxS = item.maxStock > 0 ? item.maxStock : 0;

    if (total < 0) return "inv-main-negative";
    if (maxS && total > maxS) return "inv-main-overstock";

    const exp = this.getExpirationInsight(item);
    if (exp.has) {
      if (exp.expired) return "inv-main-expired";
      if (exp.soon) return "inv-main-expiring";
    }

    if (total === 0) return "inv-main-zero";

    if (total > 0 && total <= minEff) return "inv-main-low";

    const midMax = maxS ? Math.max(minEff + 1, Math.floor(maxS * 0.5)) : minEff * 3;
    if (total > minEff && total <= midMax) return "inv-main-mid";

    return "inv-main-good";
  },

  // =========================================================
  // EXPIRACIONES
  // =========================================================
  getNearestExpiration(item) {
    if (!item.expirations?.length) return null;
    const rows = item.expirations
      .map((e, idx) => ({ e, idx, eff: this.getLotEffectiveExpiryDate(e, item), q: Utils.roundDecimal(parseFloat(e.qty) || 0) }))
      .filter(x => x.q > 0 && x.eff);
    if (!rows.length) return null;
    rows.sort((a, b) => new Date(a.eff) - new Date(b.eff) || a.idx - b.idx);
    return rows[0].e;
  },

  /**
   * ¿Consumir `qAbs` del principal por FEFO tocaría lotes ya vencidos?
   */
  wouldMainFefoConsumeExpired(item, qAbs) {
    const q = Utils.roundDecimal(Math.abs(parseFloat(qAbs) || 0));
    if (!item || q <= 0 || !this.itemTracksExpiration(item)) return false;
    const exp = Array.isArray(item.expirations) ? item.expirations : [];
    const today = new Date();
    const withIdx = exp
      .map((l, idx) => ({
        l,
        idx,
        q: Utils.roundDecimal(parseFloat(l.qty) || 0),
        eff: this.getLotEffectiveExpiryDate(l, item)
      }))
      .filter(x => x.q > 0);
    if (!withIdx.length) {
      const ins = this.getExpirationInsight(item);
      return !!(ins.has && ins.expired);
    }
    const sorted = withIdx.sort((a, b) => {
      if (!a.eff && !b.eff) return a.idx - b.idx;
      if (!a.eff) return 1;
      if (!b.eff) return -1;
      return new Date(a.eff) - new Date(b.eff) || a.idx - b.idx;
    });
    let need = q;
    for (const row of sorted) {
      if (need <= 0) break;
      const take = Utils.roundDecimal(Math.min(need, row.q));
      if (take <= 0) continue;
      if (row.eff && new Date(row.eff + "T12:00:00") < today) return true;
      need = Utils.roundDecimal(need - take);
    }
    if (need > 1e-9) {
      const ins = this.getExpirationInsight(item);
      return !!(ins.has && ins.expired);
    }
    return false;
  },

  /**
   * Movimiento con proyecto: ¿hay consumo desde principal que tocaría stock vencido (FEFO)?
   */
  movementWouldConsumeExpiredStockForProject(movementMgr, mappedItems, movementType) {
    if (!mappedItems?.length || movementType === "COMPRA_STOCK" || movementType === "RECEPCION_MATERIAL") return false;
    for (const li of mappedItems) {
      if (!li || li.consumableReceipt || li.itemId == null) continue;
      const qty = parseFloat(li.quantity) || 0;
      if (qty >= 0) continue;
      const tgt = movementMgr._resolveStockTargetForLine(li);
      if (tgt !== "main") continue;
      const src = movementMgr._getLineStockSourceId(li);
      if (src) continue;
      const inv = this.getItemById(li.itemId);
      if (!inv) continue;
      const qAbs = Math.abs(qty);
      if (this.wouldMainFefoConsumeExpired(inv, qAbs)) return true;
    }
    return false;
  },

  /**
   * Salida del stock principal: descuenta lotes en orden FEFO; sin lotes, descuenta solo el principal.
   * @returns {{ ok: boolean, deductions?: Array<{date?: string, expDate?: string, qty: number, untracked?: boolean}> }}
   */
  consumeFromMainStockFefo(itemId, qty) {
    const item = this.getItemById(itemId);
    if (!item) return { ok: false, reason: "item-not-found" };
    const q = Utils.roundDecimal(Math.abs(parseFloat(qty) || 0));
    if (q <= 0) return { ok: false, reason: "invalid-qty" };
    if (!this.itemTracksExpiration(item)) {
      this.updateStock(itemId, "main", -q);
      return { ok: true, deductions: [{ untracked: true, qty: q }] };
    }
    const exp = Array.isArray(item.expirations) ? item.expirations.map(l => ({ ...l })) : [];
    const indexed = exp
      .map((l, idx) => ({
        l,
        idx,
        q: Utils.roundDecimal(parseFloat(l.qty) || 0),
        eff: this.getLotEffectiveExpiryDate(l, item)
      }))
      .filter(x => x.q > 0);
    if (!indexed.length) {
      this.updateStock(itemId, "main", -q);
      return { ok: true, deductions: [{ untracked: true, qty: q }] };
    }
    const sorted = indexed.sort((a, b) => {
      if (!a.eff && !b.eff) return a.idx - b.idx;
      if (!a.eff) return 1;
      if (!b.eff) return -1;
      return new Date(a.eff) - new Date(b.eff) || a.idx - b.idx;
    });
    let need = q;
    const deductions = [];
    for (const row of sorted) {
      if (need <= 0) break;
      const curQ = Utils.roundDecimal(parseFloat(exp[row.idx].qty) || 0);
      if (curQ <= 0) continue;
      const take = Utils.roundDecimal(Math.min(need, curQ));
      if (take <= 0) continue;
      exp[row.idx].qty = Utils.roundDecimal(curQ - take);
      deductions.push({
        date: exp[row.idx].date,
        expDate: exp[row.idx].expDate || "",
        qty: take
      });
      need = Utils.roundDecimal(need - take);
    }
    item.expirations = exp.filter(l => Utils.roundDecimal(parseFloat(l.qty) || 0) > 1e-9);
    if (need > 1e-9) {
      deductions.push({ untracked: true, qty: need });
    }
    item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) - q);
    this.save();
    this.render();
    return { ok: true, deductions };
  },

  /** Anula consumo FEFO guardando los mismos recortes de lote. */
  restoreMainStockFefo(itemId, deductions) {
    if (!deductions?.length) return;
    const item = this.getItemById(itemId);
    if (!item) return;
    let mainAdd = 0;
    const exp = Array.isArray(item.expirations) ? item.expirations.map(l => ({ ...l })) : [];
    for (const d of deductions) {
      const dq = Utils.roundDecimal(parseFloat(d.qty) || 0);
      if (dq <= 0) continue;
      mainAdd = Utils.roundDecimal(mainAdd + dq);
      if (d.untracked) continue;
      const k = `${String(d.date || "").slice(0, 10)}|${String(d.expDate || "").slice(0, 10)}`;
      let idx = exp.findIndex(
        l => `${String(l.date || "").slice(0, 10)}|${String(l.expDate || "").slice(0, 10)}` === k
      );
      if (idx >= 0) {
        exp[idx].qty = Utils.roundDecimal((parseFloat(exp[idx].qty) || 0) + dq);
      } else {
        const row = { date: d.date, qty: dq };
        if (d.expDate) row.expDate = d.expDate;
        exp.push(row);
      }
    }
    item.expirations = exp;
    item.mainStock = Utils.roundDecimal((parseFloat(item.mainStock) || 0) + mainAdd);
    this.save();
    this.render();
  },

  /**
   * COMPRA hacia principal: acumula cantidad por fecha de caducidad / expedición de lote.
   *
   * Reglas de almacenamiento (fix vida-útil 2026-05):
   * - Si el usuario fija explícitamente la fecha de caducidad → se guarda en `lot.date`.
   * - Si solo da la fecha de expedición → **no** se precalcula `lot.date` a partir
   *   de la vida útil del artículo: se almacena solo `lot.expDate` y la caducidad
   *   efectiva se computa al vuelo en `getLotEffectiveExpiryDate` con el valor
   *   actual de `item.shelfLifeMonths`. Así, si más adelante el usuario corrige
   *   la vida útil (p. ej. de 1 a 18 meses), los lotes existentes reflejan
   *   automáticamente la nueva caducidad.
   */
  mergeCompraLotIntoExpirations(itemId, quantity, lotMeta) {
    const item = this.getItemById(itemId);
    if (!item || item.inventoryConsumable) return;
    const q = Utils.roundDecimal(Math.abs(parseFloat(quantity) || 0));
    if (q <= 0) return;
    const explicitExpiry = String((lotMeta && lotMeta.expiryDate) || "").trim().slice(0, 10);
    const expStr = String((lotMeta && lotMeta.expDate) || "").trim().slice(0, 10);
    const months = Math.max(0, parseInt(item.shelfLifeMonths, 10) || 0);
    const hasExplicitExpiry = /^\d{4}-\d{2}-\d{2}$/.test(explicitExpiry);
    const hasExpedition = /^\d{4}-\d{2}-\d{2}$/.test(expStr);
    /* Sin caducidad explícita ni base (expedición + vida útil) no hay nada que registrar. */
    if (!hasExplicitExpiry && !(hasExpedition && months > 0)) return;
    const arr = Array.isArray(item.expirations) ? item.expirations.map(l => ({ ...l })) : [];
    /* Clave estable: usa la expiración explícita si existe; si no, solo la expedición
       (para que cambios futuros de vida útil no creen duplicados). */
    const storedDate = hasExplicitExpiry ? explicitExpiry : "";
    const k = `${storedDate}|${expStr}`;
    let idx = arr.findIndex(
      l => `${String(l.date || "").slice(0, 10)}|${String(l.expDate || "").slice(0, 10)}` === k
    );
    /* Backwards-compat: lotes anteriores podían guardar `lot.date` precalculado
       con la vida útil de entonces; intentamos identificarlos por la expedición
       coincidente para acumular en la misma fila en vez de duplicar. */
    if (idx < 0 && !hasExplicitExpiry && hasExpedition) {
      idx = arr.findIndex(l => {
        const sameExp = String(l.expDate || "").slice(0, 10) === expStr;
        const noExplicitDate = !String(l.date || "").trim();
        return sameExp && noExplicitDate;
      });
    }
    if (idx >= 0) {
      arr[idx].qty = Utils.roundDecimal((parseFloat(arr[idx].qty) || 0) + q);
      /* Si encontramos un legacy con `date` precalculado y ahora el usuario no fija
         caducidad explícita, lo migramos a la nueva forma (sin `date`) para que se
         recalcule dinámicamente con la vida útil vigente. */
      if (!hasExplicitExpiry && String(arr[idx].date || "").trim()) {
        delete arr[idx].date;
      }
    } else {
      const row = { qty: q };
      if (storedDate) row.date = storedDate;
      if (hasExpedition) row.expDate = expStr;
      arr.push(row);
    }
    /* Reflejamos las fechas del lote también a nivel artículo SOLO cuando el
       campo correspondiente está vacío. Sirve como referencia rápida en la
       tabla de inventario sin pisar lo que la persona ya escribió a mano. La
       fuente de verdad para múltiples fechas sigue siendo `item.expirations`. */
    const patch = { expirations: arr, tracksExpiration: true };
    if (hasExpedition && !String(item.expDate || "").trim()) {
      patch.expDate = expStr;
    }
    if (hasExplicitExpiry && !String(item.expirationDate || "").trim()) {
      patch.expirationDate = explicitExpiry;
    } else if (!hasExplicitExpiry && hasExpedition && months > 0 && !String(item.expirationDate || "").trim()) {
      const computed = this.addMonthsToIsoDate(expStr, months);
      if (computed) patch.expirationDate = computed;
    }
    this.updateItem(itemId, patch);
  },

  /** Anula merge de lote en COMPRA (principal). */
  revertMergeCompraLotFromExpirations(itemId, quantity, line) {
    const item = this.getItemById(itemId);
    if (!item || item.inventoryConsumable) return;
    const q = Utils.roundDecimal(Math.abs(parseFloat(quantity) || 0));
    if (q <= 0) return;
    const explicitExpiry = String(line.compraLotExpiry || "").trim().slice(0, 10);
    const expStr = String(line.compraLotExpedition || "").trim().slice(0, 10);
    const months = Math.max(0, parseInt(item.shelfLifeMonths, 10) || 0);
    const hasExplicitExpiry = /^\d{4}-\d{2}-\d{2}$/.test(explicitExpiry);
    const hasExpedition = /^\d{4}-\d{2}-\d{2}$/.test(expStr);
    if (!hasExplicitExpiry && !(hasExpedition && months > 0)) return;
    const arr = Array.isArray(item.expirations) ? item.expirations.map(l => ({ ...l })) : [];
    const storedDate = hasExplicitExpiry ? explicitExpiry : "";
    const k1 = `${storedDate}|${expStr}`;
    let idx = arr.findIndex(
      l => `${String(l.date || "").slice(0, 10)}|${String(l.expDate || "").slice(0, 10)}` === k1
    );
    /* Fallback legacy: si el lote se guardó con `date` precalculado, intenta encontrarlo
       sin tener que adivinar los meses originales: cualquier fila con la misma expedición
       y sin caducidad explícita en la línea es elegible. */
    if (idx < 0 && !hasExplicitExpiry && hasExpedition) {
      idx = arr.findIndex(l => String(l.expDate || "").slice(0, 10) === expStr);
    }
    if (idx < 0) return;
    arr[idx].qty = Utils.roundDecimal((parseFloat(arr[idx].qty) || 0) - q);
    if ((parseFloat(arr[idx].qty) || 0) <= 1e-9) arr.splice(idx, 1);
    this.updateItem(itemId, { expirations: arr });
  },

  // =========================================================
  // NOTAS Y LISTA DE COMPRAS
  // =========================================================
  markForPurchase(code){
    const it=this.items.find(i=>i.code===code);
    if(!it)return;
    const exists=this.purchaseList.some(p=>p.code===code);
    if(!exists) this.purchaseList.push({code,description:it.description,date:new Date().toISOString(),status:"pendiente"});
    this.save();
    if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.renderPurchaseSuggestionsPanel) {
      OrderLinesManager.renderPurchaseSuggestionsPanel();
    }
    Utils.showToast(I18n.t("msg.addedToPurchaseList"),"info");
  },

  // =========================================================
  // RENDER
  // =========================================================
  render(list=null){
    const tb=document.getElementById("inventory-body");
    if(!tb) return;
    this.populateInventoryBoxFilter();
    let arr = list != null ? list : this.items;
    if (this._asOfDate && typeof MovementManager !== "undefined" && MovementManager.computeStockMapAsOfDate) {
      const sm = MovementManager.computeStockMapAsOfDate(this._asOfDate);
      arr = arr.map(it => this.mergeItemStockFromMap(it, sm));
    }
    arr = this._filterInventoryByBoxSelect(arr);
    arr = this._filterInventoryDepotPreset(arr);
    arr = this._filterInventoryConsumablePreset(arr);
    const probOn = !!this._inventoryFilterProblemsOnly;
    const lowIgOn = !!this._inventoryFilterLowStockIgnoredOnly;
    if (probOn && lowIgOn) {
      arr = arr.filter(it => this._hasItemProblemsNote(it) || !!it.ignoreLowStockAlert);
    } else if (probOn) {
      arr = arr.filter(it => this._hasItemProblemsNote(it));
    } else if (lowIgOn) {
      arr = arr.filter(it => !!it.ignoreLowStockAlert);
    }
    this._inventoryViewList = Array.isArray(arr) ? arr.slice() : [];
    this._inventorySearchQuery =
      list != null ? (document.getElementById("inventory-search")?.value || "").trim() : "";
    this._updateAsOfUi();
    const activeDistributionFilter = this._getActiveDistributionFilter
      ? this._getActiveDistributionFilter()
      : null;
    const mainHeader = document.querySelector('.inventory-table--main thead th[data-i18n="table.mainStock"]');
    if (mainHeader) {
      const hint = activeDistributionFilter
        ? "Stock principal mostrado como reparticion del filtro activo (ubicacion/caja). El total global sigue en principal/produccion/transformacion."
        : "";
      mainHeader.setAttribute("title", hint);
    }

    if(!arr.length){
      const boxF = (document.getElementById("inventory-box-filter")?.value || "all") !== "all";
      const depF = (document.getElementById("inventory-depot-preset")?.value || "all") !== "all";
      const consF = (document.getElementById("inventory-consumable-filter")?.value || "all") !== "all";
      const probF = !!this._inventoryFilterProblemsOnly;
      const lowIgF = !!this._inventoryFilterLowStockIgnoredOnly;
      const emptyMsg =
        boxF || depF || consF || probF || lowIgF ? I18n.t("msg.noResults") : I18n.t("msg.inventoryEmpty");
      tb.innerHTML=`<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:2rem;">${this.esc(emptyMsg)}</td></tr>`;
      this._syncInventoryBoxFilterToggleUi();
      this._syncInventoryDepotFilterToggleUi();
      this._syncInventoryConsumableFilterToggleUi();
      this._syncInventoryProblemsFilterToggleUi();
      this._syncInventoryLowStockIgnoredFilterToggleUi();
      this._syncInventoryProblemsMenuItemUi();
      this._syncInventoryLowStockIgnoredMenuItemUi();
      this._syncInventoryHeaderFiltersCollapseBtn();
      this._syncZeroTotalBoxToolbarBtn();
      this._ensureInventoryMainHorizontalScroll();
      requestAnimationFrame(() => this._syncInventoryMainHorizontalScrollLayout());
      return;
    }

    tb.innerHTML=arr.map(it=>{
      const cls=this.getStockClass(it);
      const mainCls = this.getMainStockDisplayClass(it);
      const hasProbNote = this._hasItemProblemsNote(it);
      const probSpanCls = hasProbNote ? "inv-desc-text inv-problem-pill inv-problem-pill--pulse" : "inv-desc-text";
      const canEditNotes = typeof Auth !== "undefined" && Auth.hasPerm("editItems");
      const hasNotes = (it.notes || "").trim().length > 0;
      let descTd;
      const quickAria = I18n.t("inventory.quickViewAria").replace(
        "{desc}",
        (it.description || it.code || "").trim().slice(0, 120)
      );
      const quickBtn = `<button type="button" class="inv-quick-hit" data-item-id="${Utils.escapeAttr(
        it.id
      )}" aria-label="${Utils.escapeAttr(quickAria)}" title="${Utils.escapeAttr(I18n.t("inventory.quickViewTitle"))}"><span aria-hidden="true">👁</span></button>`;
      const addPurchaseAria = I18n.t("inventory.addPurchaseFromRow")
        .replace("{code}", String(it.code || "").trim());
      const addPurchaseBtn = `<button type="button" class="inv-add-purchase-hit" data-item-code="${Utils.escapeAttr(
        it.code || ""
      )}" aria-label="${Utils.escapeAttr(addPurchaseAria)}" title="${Utils.escapeAttr(
        I18n.t("inventory.addPurchaseTitle")
      )}"><span aria-hidden="true">🛒</span></button>`;
      const notesBtn =
        canEditNotes || hasNotes
          ? `<button type="button" class="inv-notes-hit" data-item-id="${Utils.escapeAttr(
              it.id
            )}" aria-label="${Utils.escapeAttr(
              I18n.t("inventory.notesHitAria").replace("{desc}", (it.description || it.code || "").trim().slice(0, 120))
            )}"><span class="${hasNotes ? "inv-notes-icon" : "inv-notes-icon inv-notes-icon--muted"}" aria-hidden="true">📝</span></button>`
          : "";
      const rowActions = `<div class="inv-row-actions" data-item-id="${Utils.escapeAttr(it.id)}">
        <button type="button" class="inv-row-actions-toggle" data-item-id="${Utils.escapeAttr(
          it.id
        )}" title="${Utils.escapeAttr(I18n.t("inventory.rowActionsToggleTitle"))}" aria-label="${Utils.escapeAttr(
          I18n.t("inventory.rowActionsToggleTitle")
        )}">+</button>
        <div class="inv-row-actions-pop" data-item-id="${Utils.escapeAttr(it.id)}">
          ${quickBtn}${addPurchaseBtn}${notesBtn}
        </div>
      </div>`;
      if (canEditNotes || hasNotes) {
        descTd = `<td class="inv-desc-cell">${rowActions}<span class="${probSpanCls}">${this.esc(
          it.description
        )}</span></td>`;
      } else {
        descTd = `<td class="inv-desc-cell">${rowActions}<span class="${probSpanCls}">${this.esc(it.description)}</span></td>`;
      }
      const effUi = this.getEffectiveExpirationDateForDisplay(it);
      const insight = this.getExpirationInsight(it);
      const lot = this.getNearestExpiration(it);
      const fmt = v => Utils.formatDecimalDisplay(v);
      const isAdmin = typeof Auth !== "undefined" && Auth.isAdmin();
      const codeCellClass = isAdmin ? "inv-code-cell inv-code-cell--admin" : "inv-code-cell";
      const consumableBadge = this._inventoryConsumableBadgeHtml(it);
      const lowIgnoredBadge = this._lowStockIgnoredBadgeHtml(it);
      const codeInner = hasProbNote
        ? `<span class="inv-problem-pill inv-problem-pill--pulse"><strong>${this.esc(it.code)}</strong></span>`
        : `<strong>${this.esc(it.code)}</strong>`;
      const codeTitle =
        isAdmin && typeof I18n !== "undefined" && I18n.t
          ? ` title="${Utils.escapeAttr(I18n.t("inventory.codeDblClickAdminHint"))}"`
          : "";
      const expTxt = effUi ? Utils.formatDate(effUi) : lot ? `${Utils.formatDate(lot.date)} (${fmt(lot.qty)})` : "-";
      const boxNums = this._collectWarehouseBoxesFromItem(it);
      const slotIds = this._collectWarehouseSlotsFromItem(it);
      const tipFor = n => I18n.t("inventory.boxInferredTooltip").replace("{n}", String(n));
      const tipSlot = id => I18n.t("inventory.slotInferredTooltip").replace("{id}", String(id));
      const chipsHtml = boxNums
        .map(
          n =>
            `<span class="inv-box-chip" title="${Utils.escapeAttr(tipFor(n))}" data-jump-kind="box" data-item-id="${Utils.escapeAttr(
              String(it.id)
            )}" data-box-number="${Utils.escapeAttr(String(n))}">📦${n}</span>`
        )
        .join("");
      const slotChipsHtml = slotIds
        .map(
          id =>
            `<span class="inv-slot-chip" title="${Utils.escapeAttr(tipSlot(id))}" data-jump-kind="slot" data-slot-id="${Utils.escapeAttr(
              String(id)
            )}" data-item-id="${Utils.escapeAttr(String(it.id))}" data-location-key="${Utils.escapeAttr(
              String(id)
            )}">📍${this.esc(id)}</span>`
        )
        .join("");
      const locationStocks = this._normalizeItemLocationStocks(it);
      const locQtyChipsHtml = locationStocks
        .map(
          ls =>
            `<span class="inv-loc-qty-chip" title="${Utils.escapeAttr(`${ls.location}: ${fmt(ls.qty)}`)}" data-jump-kind="locqty" data-item-id="${Utils.escapeAttr(
              String(it.id)
            )}" data-location-key="${Utils.escapeAttr(String(ls.location || ""))}">📍${this.esc(ls.location)}: ${this.esc(
              fmt(ls.qty)
            )}</span>`
        )
        .join("");
      const chipParts = [];
      if (boxNums.length) chipParts.push(...boxNums.map(n => tipFor(n)));
      if (slotIds.length) chipParts.push(...slotIds.map(id => tipSlot(id)));
      if (locationStocks.length) chipParts.push(...locationStocks.map(ls => `${ls.location}: ${fmt(ls.qty)}`));
      const tdTitle = chipParts.length ? Utils.escapeAttr(chipParts.join(" · ")) : "";
      const hasChips = boxNums.length > 0 || slotIds.length > 0;
      const hasLocationQty = locQtyChipsHtml.length > 0;
      const locHtml = hasChips || hasLocationQty
        ? `<span class="inv-box-chips">${chipsHtml}${slotChipsHtml}${locQtyChipsHtml}</span>`
        : this.esc(it.location || "-");
      const rowCons = it.inventoryConsumable ? " inv-row--inventory-consumable" : "";
      const rowExpSoon =
        insight && insight.has && !insight.expired && insight.soon ? " inv-row--expiry-incomplete" : "";
      const hasExpiryConfigHint =
        this.itemNeedsExpirationConfigComplete(it) || this.itemNeedsExpiryDataOrOptOut(it);
      const rowExpHint = !rowExpSoon && hasExpiryConfigHint ? " inv-row--expiry-missing-hint" : "";
      const rowExpTitle = rowExpSoon
        ? `${I18n.t("inventory.lotStatusSoon")} (${Math.max(1, parseInt(this.expAlertDays, 10) || 30)}d)`
        : this.itemNeedsExpirationConfigComplete(it)
          ? I18n.t("inventory.rowTitleExpiryIncomplete")
          : this.itemNeedsExpiryDataOrOptOut(it)
            ? I18n.t("inventory.rowTitleExpiryNoData")
            : "";
      const mainQtyShown = activeDistributionFilter
        ? this._getItemDistributedQtyForFilter(it, activeDistributionFilter)
        : (it.mainStock || 0);
      return `
        <tr data-id="${Utils.escapeAttr(it.id)}" class="inv-row inv-row--${cls}${rowCons}${rowExpSoon}${rowExpHint}"${
          rowExpTitle ? ` title="${Utils.escapeAttr(rowExpTitle)}"` : ""
        }>
          <td class="${codeCellClass}"${codeTitle}>${lowIgnoredBadge}${codeInner}${consumableBadge}</td>
          ${descTd}
          <td>${this.esc(it.category||'-')}</td>
          <td>${this._formatPriceDisplay(it.defaultPrice ?? 0, it.priceCurrency)}</td>
          <td class="inv-main-cell"><span class="inv-main-qty ${mainCls}">${fmt(mainQtyShown)}</span>${
            typeof MeasureUnitsManager !== "undefined" && MeasureUnitsManager.itemStockUnitSuffixHtml
              ? MeasureUnitsManager.itemStockUnitSuffixHtml(it, mainQtyShown)
              : ""
          }</td>
          <td>${fmt(it.prodStock||0)}</td>
          <td>${fmt(it.transStock||0)}</td>
          <td title="${tdTitle}">${locHtml}</td>
          ${this._renderInventoryLotsBreakdownCell(it)}
          <td>${this.esc(expTxt)}</td>
        </tr>`;
    }).join('');
    this.updateStats();
    this._syncInventoryBoxFilterToggleUi();
    this._syncInventoryDepotFilterToggleUi();
    this._syncInventoryConsumableFilterToggleUi();
    this._syncInventoryProblemsFilterToggleUi();
    this._syncInventoryLowStockIgnoredFilterToggleUi();
    this._syncInventoryProblemsMenuItemUi();
    this._syncInventoryLowStockIgnoredMenuItemUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
    this._syncZeroTotalBoxToolbarBtn();
    this._ensureInventoryMainHorizontalScroll();
    requestAnimationFrame(() => this._syncInventoryMainHorizontalScrollLayout());
  },

  _ensureInventoryMainHorizontalScroll() {
    if (this._invMainHScrollEnsured) return;
    const body = document.getElementById("inventory-hscroll-body");
    const top = document.getElementById("inventory-hscroll-top");
    if (!body || !top) return;
    this._invMainHScrollEnsured = true;
    this._invHSyncIgnore = false;
    body.addEventListener(
      "scroll",
      () => {
        if (this._invHSyncIgnore) return;
        this._invHSyncIgnore = true;
        top.scrollLeft = body.scrollLeft;
        queueMicrotask(() => {
          this._invHSyncIgnore = false;
        });
      },
      { passive: true }
    );
    top.addEventListener(
      "scroll",
      () => {
        if (this._invHSyncIgnore) return;
        this._invHSyncIgnore = true;
        body.scrollLeft = top.scrollLeft;
        queueMicrotask(() => {
          this._invHSyncIgnore = false;
        });
      },
      { passive: true }
    );
    if (typeof ResizeObserver !== "undefined") {
      this._invMainHScrollResizeObserver = new ResizeObserver(() =>
        this._syncInventoryMainHorizontalScrollLayout()
      );
      this._invMainHScrollResizeObserver.observe(body);
    }
    this._invMainHScrollOnResize = () => this._syncInventoryMainHorizontalScrollLayout();
    window.addEventListener("resize", this._invMainHScrollOnResize);
  },

  _syncInventoryMainHorizontalScrollLayout() {
    const topInner = document.getElementById("inventory-hscroll-top-inner");
    const body = document.getElementById("inventory-hscroll-body");
    const top = document.getElementById("inventory-hscroll-top");
    if (!topInner || !body) return;
    const table = body.querySelector(".inventory-table--main");
    if (!table) {
      topInner.style.width = "0px";
      topInner.style.minWidth = "0";
      return;
    }
    const w = table.scrollWidth;
    topInner.style.width = `${w}px`;
    topInner.style.minHeight = "1px";
    if (top) top.scrollLeft = body.scrollLeft;
  },

  toggleInventoryProblemsFilter() {
    this._inventoryFilterProblemsOnly = !this._inventoryFilterProblemsOnly;
    this._syncInventoryProblemsFilterToggleUi();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
  },

  _syncInventoryProblemsFilterToggleUi() {
    const btn = document.getElementById("inventory-problems-filter-toggle-btn");
    if (!btn) return;
    const on = !!this._inventoryFilterProblemsOnly;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const showKey = on ? "inventory.problemsFilterToggleHide" : "inventory.problemsFilterToggleShow";
    const txt = typeof I18n !== "undefined" && I18n.t ? I18n.t(showKey) : showKey;
    btn.setAttribute("title", txt);
    btn.setAttribute("aria-label", txt);
  },

  _syncInventoryProblemsMenuItemUi() {
    const item = document.querySelector("#inventory-header-tools-menu [data-inv-toggle-problems]");
    if (!item) return;
    const on = !!this._inventoryFilterProblemsOnly;
    item.setAttribute("aria-checked", on ? "true" : "false");
    item.classList.toggle("inventory-header-tools-menu-item--checked", on);
  },

  toggleInventoryLowStockIgnoredFilter() {
    this._inventoryFilterLowStockIgnoredOnly = !this._inventoryFilterLowStockIgnoredOnly;
    this._syncInventoryLowStockIgnoredFilterToggleUi();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
  },

  _syncInventoryLowStockIgnoredFilterToggleUi() {
    const btn = document.getElementById("inventory-lowstock-ignored-filter-toggle-btn");
    if (!btn) return;
    const on = !!this._inventoryFilterLowStockIgnoredOnly;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const showKey = on ? "inventory.lowStockIgnoredFilterToggleHide" : "inventory.lowStockIgnoredFilterToggleShow";
    const txt = typeof I18n !== "undefined" && I18n.t ? I18n.t(showKey) : showKey;
    btn.setAttribute("title", txt);
    btn.setAttribute("aria-label", txt);
  },

  _syncInventoryLowStockIgnoredMenuItemUi() {
    const item = document.querySelector("#inventory-header-tools-menu [data-inv-toggle-lowstock-ignored]");
    if (!item) return;
    const on = !!this._inventoryFilterLowStockIgnoredOnly;
    item.setAttribute("aria-checked", on ? "true" : "false");
    item.classList.toggle("inventory-header-tools-menu-item--checked", on);
  },

  updateStats(){
    const total=document.getElementById("total-items");
    const low=document.getElementById("low-stock");
    const negative=document.getElementById("negative-stock");
    const expEl = document.getElementById("expiration-alert");
    const overEl = document.getElementById("overstock-count");
    const zeroEl = document.getElementById("zero-stock");

    const itemsForStats = this.getItemsWithOptionalAsOfStock();

    if(total) total.textContent=this.items.length;
    if(low) {
      low.textContent = itemsForStats.filter(i => this.isItemLowStock(i)).length;
    }
    if (expEl) {
      expEl.textContent = itemsForStats.filter(i => {
        const x = this.getExpirationInsight(i);
        return x.has && (x.expired || x.soon);
      }).length;
    }
    if (overEl) {
      overEl.textContent = itemsForStats.filter(i => this.isItemOverstock(i)).length;
    }
    if (zeroEl) {
      zeroEl.textContent = itemsForStats.filter(i => this.itemTotalStock(i) === 0).length;
    }
    if(negative) {
      negative.textContent = itemsForStats.filter(i => this.itemTotalStock(i) < 0).length;
    }
  },

  esc(s) {
    return Utils.escapeHtml(s);
  },

  async _copyTextToClipboard(text) {
    if (typeof Utils !== "undefined" && Utils.copyTextToClipboard) {
      return Utils.copyTextToClipboard(text);
    }
    const raw = String(text || "").trim();
    if (!raw) return false;
    try {
      const ta = document.createElement("textarea");
      ta.value = raw;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  },

  /** Pastilla visual para artículos en modo consumible de inventario (lista e impresión). */
  _inventoryConsumableBadgeHtml(it) {
    if (!it || !it.inventoryConsumable || typeof I18n === "undefined" || !I18n.t) return "";
    return ` <span class="inv-inventory-consumable-badge" title="${Utils.escapeAttr(
      I18n.t("inventory.inventoryConsumableBadgeTitle")
    )}">${this.esc(I18n.t("inventory.inventoryConsumableBadge"))}</span>`;
  },

  /** Insignia para artículos excluidos de alerta de stock bajo. */
  _lowStockIgnoredBadgeHtml(it) {
    if (!it || !it.ignoreLowStockAlert || typeof I18n === "undefined" || !I18n.t) {
      return `<span class="inv-low-stock-ignored-slot" aria-hidden="true"></span>`;
    }
    return ` <span class="inv-low-stock-ignored-badge" title="${Utils.escapeAttr(
      I18n.t("inventory.lowStockIgnoredBadgeTitle")
    )}">${this.esc(I18n.t("inventory.lowStockIgnoredBadge"))}</span>`;
  },

  openItemNotesModal(itemId) {
    const id = itemId != null ? String(itemId) : "";
    const item = this.items.find(i => String(i.id) === id);
    if (!item) return;
    const modal = document.getElementById("inventory-item-notes-modal");
    const sub = document.getElementById("inv-notes-modal-sub");
    const ta = document.getElementById("inv-notes-textarea");
    const saveBtn = document.getElementById("inv-notes-save");
    if (!modal || !ta) return;

    this._invNotesItemId = item.id;
    if (sub) sub.textContent = `${item.code || "—"} — ${item.description || ""}`;
    ta.value = item.notes || "";

    const canEdit = typeof Auth !== "undefined" && Auth.hasPerm("editItems");
    ta.readOnly = !canEdit;
    if (saveBtn) saveBtn.style.display = canEdit ? "" : "none";

    modal.classList.add("active");
    if (canEdit) {
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }, 50);
    }
  },

  openItemQuickViewModal(itemId) {
    const id = itemId != null ? String(itemId) : "";
    const item = this.items.find(i => String(i.id) === id);
    if (!item) return;
    const modal = document.getElementById("inventory-item-quick-modal");
    const sub = document.getElementById("inv-quick-modal-sub");
    const body = document.getElementById("inventory-item-quick-body");
    if (!modal || !body) return;
    this._invQuickItemId = item.id;

    if (sub) sub.textContent = `${item.code || "—"} — ${item.description || ""}`;
    const fmtQty = v => Utils.formatDecimalDisplay(v, 4);
    const showDate = d => (d ? Utils.formatDate(d) : "—");
    const fmtPrice = this._formatPriceDisplay(item.defaultPrice ?? 0, item.priceCurrency);
    const boxStocks = Array.isArray(item.boxStocks) ? item.boxStocks : [];
    const boxTxt = boxStocks.length
      ? boxStocks.map(b => `BOX${parseInt(b.boxNumber, 10) || 0}: ${fmtQty(b.qty || 0)}`).join(" · ")
      : "—";
    const rows = [
      [I18n.t("table.code"), item.code || "—"],
      [I18n.t("table.description"), item.description || "—"],
      [I18n.t("table.category"), item.category || "—"],
      [I18n.t("table.defaultPrice"), fmtPrice],
      [I18n.t("table.mainStock"), fmtQty(item.mainStock || 0)],
      [I18n.t("table.prodStock"), fmtQty(item.prodStock || 0)],
      [I18n.t("table.transStock"), fmtQty(item.transStock || 0)],
      [I18n.t("table.qtyPerBox"), fmtQty(item.qtyPerBox || 0)],
      [I18n.t("table.numBoxes"), fmtQty(item.numBoxes || 0)],
      [I18n.t("table.location"), item.location || "—"],
      [I18n.t("inventory.boxSummaryTitle"), boxTxt],
      [I18n.t("table.expDate"), showDate(item.expDate)],
      [I18n.t("table.expirationDate"), showDate(item.expirationDate)],
      [I18n.t("table.daysToExpire"), String(item.daysToExpire ?? "—")],
      [I18n.t("table.supplier"), item.supplier || "—"],
      [I18n.t("table.lastOrder"), item.lastOrder || "—"],
      [I18n.t("table.details"), item.details || "—"],
      [I18n.t("table.notes"), item.notes || "—"]
    ];
    const lotsBlock = this._renderQuickViewLotsTable(item);
    body.innerHTML = `<div class="inventory-table-container inventory-table-container--nested"><table class="inventory-table"><tbody>${rows
      .map(([k, v]) => `<tr><th style="width:34%">${this.esc(k)}</th><td>${this.esc(v)}</td></tr>`)
      .join("")}</tbody></table></div>${lotsBlock}`;
    modal.classList.add("active");
  },

  closeItemQuickViewModal() {
    document.getElementById("inventory-item-quick-modal")?.classList.remove("active");
    const body = document.getElementById("inventory-item-quick-body");
    if (body) body.innerHTML = "";
    this._invQuickItemId = null;
  },

  printQuickViewLotsTable() {
    const id = this._invQuickItemId != null ? String(this._invQuickItemId) : "";
    if (!id) return;
    const item = this.items.find(i => String(i.id) === id);
    if (!item) return;
    const rows = this.getUnifiedLotRowsForDisplay(item);
    if (!rows.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const fmt = v => Utils.formatDecimalDisplay(v);
    const showDate = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d).slice(0, 10)) ? Utils.formatDate(String(d).slice(0, 10)) : "—");
    const bodyRows = rows
      .map(r => {
        const kind = this._lotRowKindLabel(r.kind);
        return `<tr>
          <td>${this.esc(kind)}</td>
          <td>${this.esc(fmt(r.qty))}</td>
          <td>${this.esc(showDate(r.expeditionDate))}</td>
          <td>${this.esc(showDate(r.expiryDate))}</td>
          <td>${this.esc(this._lotDaysLabel(r.days, r.status))}</td>
          <td>${this.esc(this._lotStatusLabel(r.status))}</td>
        </tr>`;
      })
      .join("");
    const table = `<table class="inventory-table inv-lots-table"><thead><tr>
      <th>${this.esc(I18n.t("inventory.lotsColOrigin"))}</th>
      <th>${this.esc(I18n.t("inventory.lotsColQty"))}</th>
      <th>${this.esc(I18n.t("inventory.lotsColExpedition"))}</th>
      <th>${this.esc(I18n.t("inventory.lotsColExpiry"))}</th>
      <th>${this.esc(I18n.t("inventory.lotsColWhen"))}</th>
      <th>${this.esc(I18n.t("inventory.lotsColStatus"))}</th>
    </tr></thead><tbody>${bodyRows}</tbody></table>`;
    const title = `${I18n.t("inventory.lotsBreakdownTitle")} — ${item.code || "—"}`;
    const subtitle = `${item.code || "—"} — ${item.description || ""}`;
    this._printDocument(title, subtitle, table);
  },

  async exportQuickViewLotsTable() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
    const id = this._invQuickItemId != null ? String(this._invQuickItemId) : "";
    if (!id) return;
    const item = this.items.find(i => String(i.id) === id);
    if (!item) return;
    const rows = this.getUnifiedLotRowsForDisplay(item);
    if (!rows.length) {
      Utils.showToast(I18n.t("msg.noDataToExport"), "warning");
      return;
    }
    const headers = [
      I18n.t("table.code"),
      I18n.t("table.description"),
      I18n.t("inventory.lotsColOrigin"),
      I18n.t("inventory.lotsColQty"),
      I18n.t("inventory.lotsColExpedition"),
      I18n.t("inventory.lotsColExpiry"),
      I18n.t("inventory.lotsColWhen"),
      I18n.t("inventory.lotsColStatus")
    ];
    const showDate = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d).slice(0, 10)) ? Utils.formatDate(String(d).slice(0, 10)) : "");
    const out = rows.map(r => ({
      [headers[0]]: item.code || "",
      [headers[1]]: item.description || "",
      [headers[2]]: this._lotRowKindLabel(r.kind),
      [headers[3]]: Utils.formatDecimalDisplay(r.qty),
      [headers[4]]: showDate(r.expeditionDate),
      [headers[5]]: showDate(r.expiryDate),
      [headers[6]]: this._lotDaysLabel(r.days, r.status),
      [headers[7]]: this._lotStatusLabel(r.status)
    }));
    const fnCode = String(item.code || "item").replace(/[^\w.-]+/g, "_");
    const filename = `GNEEX_Lotes_${fnCode}_${this._fileStamp()}.xlsx`;
    await Utils.exportStyledXlsxToInformFolder(filename, headers, out, {
      title: `${I18n.t("inventory.lotsBreakdownTitle")} — ${item.code || "—"}`,
      details: [
        `${I18n.t("table.code")}: ${item.code || "—"}`,
        `${I18n.t("table.description")}: ${item.description || "—"}`,
        `${I18n.t("export.manifest.rows")}: ${out.length}`
      ]
    });
  },

  closeItemNotesModal() {
    document.getElementById("inventory-item-notes-modal")?.classList.remove("active");
    this._invNotesItemId = null;
    const ta = document.getElementById("inv-notes-textarea");
    if (ta) {
      ta.value = "";
      ta.readOnly = false;
    }
  },

  saveItemNotesFromModal() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("editItems")) return;
    const id = this._invNotesItemId;
    if (id == null) return;
    const ta = document.getElementById("inv-notes-textarea");
    if (!ta) return;
    const sid = String(id);
    const item = this.items.find(i => String(i.id) === sid);
    if (!item) {
      this.closeItemNotesModal();
      return;
    }
    const notes = ta.value.trim();
    this.updateItem(item.id, { notes });
    if (typeof Auth !== "undefined") Auth.logAudit("inventory.item.notes", String(item.code || id));
    Utils.showToast(I18n.t("inventory.notesSaved"), "success");
    this.closeItemNotesModal();
  },

  _fileStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  },

  /**
   * Encabezados y orden idénticos al CSV de importación inicial (importInitialCSV).
   * Columnas finales: id, mín/máx, vida útil, notas y lotes para ida y vuelta sin pérdida.
   */
  INVENTORY_IMPORT_CSV_HEADERS: [
    "Codigo",
    "Descripcion",
    "Categoria",
    "StockPrincipal",
    "StockProduccion",
    "StockTransformacion",
    "CantidadPorCaja",
    "NumeroCajas",
    "Ubicacion",
    "FechaExpedicion",
    "DiasParaExpirar",
    "FechaExpiracion",
    "Proveedor",
    "UltimaOrden",
    "Detalles",
    "PrecioDefecto",
    "MonedaPrecio",
    "Id",
    "StockMinimo",
    "StockMaximo",
    "VidaUtilMeses",
    "Notas",
    "LotesJson",
    "CajasJson",
    "UbicacionesJson",
    "UnidadStockSimbolo",
    "UnidadEquivalenteSimbolo"
  ],

  /** Parsea el JSON de lotes del CSV; [] si falta o es inválido. */
  _parseLotesJsonFromCsv(raw) {
    if (raw === undefined || raw === null) return [];
    const s = String(raw).trim();
    if (!s) return [];
    try {
      const a = JSON.parse(s);
      if (!Array.isArray(a)) return [];
      return a
        .map(entry => ({
          date: entry && entry.date != null ? String(entry.date).trim() : "",
          qty: entry && entry.qty != null ? parseFloat(entry.qty) || 0 : 0
        }))
        .filter(e => e.date);
    } catch {
      return [];
    }
  },

  _parseBoxStocksJsonFromCsv(raw) {
    if (raw === undefined || raw === null) return [];
    const s = String(raw).trim();
    if (!s) return [];
    try {
      const a = JSON.parse(s);
      if (!Array.isArray(a)) return [];
      return a
        .map(entry => {
          const e = entry && typeof entry === "object" ? entry : {};
          const boxNumber = parseInt(
            e.boxNumber ??
              e.BoxNumber ??
              e.Caja ??
              e.CAJA ??
              e.CAJAnum ??
              e.box ??
              e.Box ??
              e.BOX ??
              e.n ??
              e.NumeroCaja ??
              e.NCaja ??
              0,
            10
          );
          const qtyRaw =
            e.qty ??
            e.Qty ??
            e.Quantity ??
            e.Cantidad ??
            e.CantidadCaja ??
            e.quantity ??
            e.Units ??
            e.UNITS ??
            0;
          const qbRaw =
            e.qtyBoxes ??
            e.QtyBoxes ??
            e.CantidadCajas ??
            e.NbCaisse ??
            e.QTY_BOXES ??
            e.NumerodeCajas ??
            0;
          const locRaw =
            e.locationLabel ??
            e.LocationLabel ??
            e.UbicacionCaja ??
            e.ubicacion ??
            e.Location ??
            "";
          return {
            boxId: e.boxId != null && String(e.boxId).trim() ? String(e.boxId).trim() : Utils.generateId(),
            boxNumber,
            locationLabel:
              typeof Utils.resolveImportLocationLabel === "function"
                ? Utils.resolveImportLocationLabel(locRaw)
                : Utils.strictEffectiveWarehouseLocationText(String(locRaw || "").trim()),
            qty: this._parseBoxStockQtyValue(qtyRaw),
            qtyBoxes: Math.max(0, this._parseBoxStockQtyBoxesValue(qbRaw)),
            empty: !!(e.empty ?? e.Empty ?? e.Vacia),
            notes: e.notes != null ? String(e.notes).trim() : "",
            updatedAt: e.updatedAt ? String(e.updatedAt) : new Date().toISOString()
          };
        })
        .filter(e => this._isValidBoxNumber(e.boxNumber));
    } catch {
      return [];
    }
  },

  _parseLocationStocksJsonFromCsv(raw) {
    if (raw === undefined || raw === null) return [];
    const s = String(raw).trim();
    if (!s) return [];
    try {
      const a = JSON.parse(s);
      if (!Array.isArray(a)) return [];
      return a
        .map(entry => ({
          location:
            typeof Utils.resolveImportLocationLabel === "function"
              ? Utils.resolveImportLocationLabel(entry && entry.location != null ? entry.location : "")
              : Utils.strictEffectiveWarehouseLocationText(
                  entry && entry.location != null ? String(entry.location).trim() : ""
                ),
          qty: parseFloat(entry && entry.qty) || 0,
          updatedAt: entry && entry.updatedAt ? String(entry.updatedAt) : new Date().toISOString()
        }))
        .filter(e => e.location && e.qty > 0);
    } catch {
      return [];
    }
  },

  /**
   * Filas de detalle por caja en la misma hoja que el artículo (columnas Caja + CantidadCaja sin JSON).
   * No sustituye a CajasJson ni a hojas aparte; se fusiona en normalize.
   */
  _inlineBoxStocksFromInventoryRow(r) {
    if (!r || typeof r !== "object") return [];
    const cajaRaw =
      this._firstCsvField(r, [
        "CODE BOX",
        "Code Box",
        "Caja",
        "Box",
        "BOX",
        "NumeroCaja",
        "NúmeroCaja",
        "NroCaja",
        "CAJA",
        "No Caja",
        "N° Caja"
      ]) || "";
    const n = this._parseImportBoxNumber(cajaRaw);
    if (!this._isValidBoxNumber(n)) return [];
    const qtyRaw = this._firstCsvField(r, [
      "CantidadCaja",
      "Cantidad Caja",
      "Cantidad_Unidades",
      "LAST COUNT",
      "Last Count",
      "LastCount",
      "QUANTITY",
      "Quantity",
      "QtyCaja",
      "StockCaja",
      "UnidadesCaja"
    ]);
    const qs = qtyRaw != null ? String(qtyRaw).trim() : "";
    if (qs === "" || qs === "?" || qs === "-") return [];
    const qty = this._parseBoxStockQtyValue(qtyRaw);
    if (!Number.isFinite(qty) || qty < 0) return [];
    const loc = this._firstCsvField(r, [
      "UbicacionCaja",
      "UbicaciónCaja",
      "Ubicacion Caja",
      "Bin",
      "BIN",
      "BoxLocation"
    ]);
    const qb = this._firstCsvField(r, ["CantidadCajas", "Qty Boxes", "QTY BOXES", "Número de cajas", "NumCajas"]);
    const notesPick = this._firstCsvField(r, [
      "DERNIER PROJECT",
      "Dernier Project",
      "Dernier projet",
      "Ultimo Proyecto",
      "Último Proyecto",
      "Last Pick Project"
    ]);
    return [
      {
        boxId: Utils.generateId(),
        boxNumber: n,
        locationLabel:
          typeof Utils.resolveImportLocationLabel === "function"
            ? Utils.resolveImportLocationLabel(loc)
            : Utils.strictEffectiveWarehouseLocationText(String(loc || "").trim()) || "",
        qty: Utils.roundDecimal(qty),
        qtyBoxes: Math.max(0, this._parseBoxStockQtyBoxesValue(qb)),
        empty: false,
        notes: String(notesPick || "").trim(),
        updatedAt: new Date().toISOString()
      }
    ];
  },

  /**
   * Varias filas con el mismo código (p. ej. una por caja) → un artículo con `boxStocks` reunidos.
   */
  _mergeInventoryImportRowsByCode(rawRows) {
    const merged = new Map();
    const noCode = [];
    for (const r of rawRows || []) {
      const it = this._itemFromInventoryCsvRow(r);
      const k = this._normalizeImportCodeValue(it.code);
      if (!k) {
        noCode.push(it);
        continue;
      }
      if (!merged.has(k)) {
        merged.set(k, it);
        continue;
      }
      const base = merged.get(k);
      base.boxStocks = [...(Array.isArray(base.boxStocks) ? base.boxStocks : []), ...(Array.isArray(it.boxStocks) ? it.boxStocks : [])];
      base.locationStocks = [
        ...(Array.isArray(base.locationStocks) ? base.locationStocks : []),
        ...(Array.isArray(it.locationStocks) ? it.locationStocks : [])
      ];
      const mNew = parseFloat(it.mainStock) || 0;
      const mOld = parseFloat(base.mainStock) || 0;
      if (mNew > 0 && mOld <= 0) base.mainStock = it.mainStock;
      if (!String(base.description || "").trim() && String(it.description || "").trim()) base.description = it.description;
      if (!String(base.category || "").trim() && String(it.category || "").trim()) base.category = it.category;
      if (!String(base.location || "").trim() && String(it.location || "").trim()) base.location = it.location;
    }
    return [...merged.values(), ...noCode];
  },

  /** Busca valor en fila importada por varios nombres posibles de columna (Excel cambia espacios/mayúsculas). */
  _firstCsvField(r, aliases) {
    if (!r || typeof r !== "object") return "";
    const norm = s =>
      String(s || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    for (const a of aliases) {
      if (r[a] !== undefined && r[a] !== null && String(r[a]).trim() !== "") return r[a];
    }
    const keys = Object.keys(r);
    for (const a of aliases) {
      const na = norm(a);
      const hit = keys.find(k => norm(k) === na);
      if (hit != null && String(r[hit]).trim() !== "") return r[hit];
    }
    return "";
  },

  /**
   * Convierte una fila CSV al objeto ítem (misma forma que addItem / almacenamiento).
   * CSV antiguo sin StockMinimo/StockMaximo: se mantienen min 5 y max 100 como antes.
   */
  _itemFromInventoryCsvRow(r) {
    const minRaw = this._firstCsvField(r, [
      "StockMinimo",
      "Stock Mínimo",
      "Stock mínimo",
      "MinimumStock",
      "Minimum stock",
      "MinStock",
      "Stock minimum"
    ]);
    const maxRaw = this._firstCsvField(r, [
      "StockMaximo",
      "Stock Máximo",
      "Stock máximo",
      "MaximumStock",
      "Maximum stock",
      "MaxStock",
      "Stock maximum"
    ]);
    const legacyStock = String(minRaw || "").trim() === "" && String(maxRaw || "").trim() === "";
    let minStock;
    let maxStock;
    if (legacyStock) {
      minStock = 5;
      maxStock = 100;
    } else {
      const mn = parseFloat(minRaw);
      const mx = parseFloat(maxRaw);
      minStock = Number.isFinite(mn) ? mn : 0;
      maxStock = Number.isFinite(mx) ? mx : 0;
    }

    const idRaw = String(
      this._firstCsvField(r, ["Id", "ID", "id", "Identifiant"]) ?? r.Id ?? r.id ?? ""
    ).trim();
    const id = idRaw || Utils.generateId();

    const mainRaw =
      this._firstCsvField(r, [
        "StockPrincipal",
        "Stock Principal",
        "STOCK PRINCIPAL",
        "Stock principal",
        "MainStock",
        "Main Stock",
        "Stock Main",
        "Principal",
        "TotalStock",
        "Stock Total"
      ]) ?? r.StockPrincipal;
    const codeRaw =
      this._firstCsvField(r, [
        "Codigo",
        "Código",
        "CODE",
        "Code",
        "CODIGO",
        "SKU",
        "Articulo",
        "Artículo",
        "Item",
        "Article",
        "Référence",
        "Reference",
        "Referencia",
        "Ref",
        "Producto"
      ]) ||
      r.Codigo ||
      r.code ||
      "";
    const descRaw =
      this._firstCsvField(r, [
        "Descripcion",
        "Descripción",
        "Description",
        "DECRIPTION",
        "Desc",
        "Libelle",
        "Nombre"
      ]) ||
      r.Descripcion ||
      r.description ||
      "";
    const catRaw = this._firstCsvField(r, ["Categoria", "Categoría", "Category", "Familia"]) || r.Categoria || "";
    const ubicRaw = this._firstCsvField(r, ["Ubicacion", "Ubicación", "Location", "Emplacement"]) || r.Ubicacion || "";

    const jsonBoxRaw =
      this._firstCsvField(r, [
        "CajasJson",
        "CajasJSON",
        "cajasJson",
        "Cajas JSON",
        "Cajas (JSON)",
        "CAJAS JSON",
        "BoxStocksJson",
        "BoxesJson",
        "Boxes (JSON)",
        "BoitesJson",
        "BoîtesJson",
        "Boites (JSON)",
        "Boîtes (JSON)",
        "boxStocksJson",
        "Stock por caja",
        "StockPorCaja",
        "JSON_Cajas",
        "DetalleCajas"
      ]) ||
      r.CajasJson ||
      r.CajasJSON ||
      "";
    let boxStocks = this._parseBoxStocksJsonFromCsv(jsonBoxRaw || "[]");
    const inlineBoxes = this._inlineBoxStocksFromInventoryRow(r);
    if (inlineBoxes.length) boxStocks = [...boxStocks, ...inlineBoxes];

    const parsed = {
      id,
      code: String(codeRaw).trim(),
      description: String(descRaw).trim(),
      category: String(catRaw).trim(),
      mainStock: Utils.roundDecimal(this._parseBoxStockQtyValue(mainRaw !== undefined && mainRaw !== null ? mainRaw : 0)),
      prodStock: Utils.roundDecimal(
        this._parseBoxStockQtyValue(
          this._firstCsvField(r, [
            "StockProduccion",
            "Stock Produccion",
            "StockProduction",
            "ProductionStock",
            "Production Stock",
            "Stock production"
          ]) ||
            r.StockProduccion ||
            0
        )
      ),
      transStock: Utils.roundDecimal(
        this._parseBoxStockQtyValue(
          this._firstCsvField(r, [
            "StockTransformacion",
            "Stock Transformacion",
            "TransformationStock",
            "StockTransformation",
            "Stock Transformation",
            "Stock transformation"
          ]) ||
            r.StockTransformacion ||
            0
        )
      ),
      qtyPerBox:
        parseFloat(
          this._firstCsvField(r, [
            "CantidadPorCaja",
            "Cantidad Por Caja",
            "QtyPerBox",
            "Qty per Box",
            "QuantityPerBox",
            "Quantity per Box",
            "Qté par Boîte",
            "Qte par Boite"
          ]) || r.CantidadPorCaja
        ) || 0,
      numBoxes:
        parseFloat(
          this._firstCsvField(r, [
            "NumeroCajas",
            "Numero Cajas",
            "NúmeroCajas",
            "NumberOfBoxes",
            "Number of Boxes",
            "BoxCount",
            "Nombre de Boîtes",
            "Nombre de Boites"
          ]) || r.NumeroCajas
        ) || 0,
      location: String(ubicRaw).trim(),
      expDate:
        this._firstCsvField(r, [
          "FechaExpedicion",
          "Fecha Expedición",
          "IssueDate",
          "Issue Date",
          "Date d'Émission",
          "Date d'Emission"
        ]) ||
        r.FechaExpedicion ||
        "",
      daysToExpire:
        parseInt(
          this._firstCsvField(r, [
            "DiasParaExpirar",
            "Días Para Expirar",
            "DaysToExpire",
            "Days to Expire",
            "Jours avant Expiration"
          ]) || r.DiasParaExpirar,
          10
        ) || 0,
      expirationDate:
        this._firstCsvField(r, [
          "FechaExpiracion",
          "Fecha Expiración",
          "ExpirationDate",
          "Expiration Date",
          "Date d'Expiration",
          "Date d’Expiration"
        ]) ||
        r.FechaExpiracion ||
        "",
      supplier: this._firstCsvField(r, ["Proveedor", "Supplier", "Fournisseur"]) || r.Proveedor || "",
      lastOrder:
        this._firstCsvField(r, ["UltimaOrden", "Última Orden", "LastOrder", "Last Order", "Dernière Commande", "Derniere Commande"]) ||
        r.UltimaOrden ||
        "",
      details: this._firstCsvField(r, ["Detalles", "Details", "Détails", "DetailsText"]) || r.Detalles || "",
      defaultPrice: Utils.roundDecimal(
        parseFloat(
          this._firstCsvField(r, [
            "PrecioDefecto",
            "Precio Defecto",
            "Precio por defecto",
            "Precio",
            "DefaultPrice",
            "Default Price",
            "Prix par défaut",
            "Prix par defaut"
          ]) || r.PrecioDefecto
        ),
        2
      ) || 0,
      priceCurrency:
        this._firstCsvField(r, [
          "MonedaPrecio",
          "Moneda Precio",
          "Moneda del precio",
          "PriceCurrency",
          "Price currency",
          "Currency",
          "Devise du prix"
        ]) ||
        r.MonedaPrecio ||
        "CAD",
      minStock,
      maxStock,
      shelfLifeMonths: (() => {
        const rawShelf = this._firstCsvField(r, [
          "VidaUtilMeses",
          "Vida Útil Meses",
          "Vida útil (meses)",
          "ShelfLifeMonths",
          "Shelf Life Months",
          "Shelf life (months)",
          "Durée de vie (mois)",
          "Duree de vie (mois)"
        ]);
        return rawShelf !== undefined && String(rawShelf).trim() !== ""
          ? Math.max(0, parseInt(rawShelf, 10) || 0)
          : 0;
      })(),
      expirations: this._parseLotesJsonFromCsv(
        this._firstCsvField(r, [
          "LotesJson",
          "Lotes JSON",
          "Lotes (JSON)",
          "BatchesJson",
          "Batches (JSON)",
          "LotsJson",
          "Lots (JSON)"
        ]) || r.LotesJson
      ),
      notes:
        r.Notas !== undefined
          ? String(r.Notas ?? "")
          : String(this._firstCsvField(r, ["Notas", "Notes", "Remarques"]) || ""),
      boxStocks,
      locationStocks: this._parseLocationStocksJsonFromCsv(
        this._firstCsvField(r, [
          "UbicacionesJson",
          "Ubicaciones JSON",
          "Ubicaciones (JSON)",
          "LocationStocksJson",
          "LocationsJson",
          "Locations (JSON)",
          "EmplacementsJson",
          "Emplacements (JSON)",
          "UbicacionesJSON",
          "ubicacionesJson",
          "Stock por ubicación",
          "StockPorUbicacion",
          "Ubicaciones"
        ]) ||
          r.UbicacionesJson ||
          r.LocationStocksJson ||
          ""
      ),
      measureStockUnitId: (() => {
        const raw =
          this._firstCsvField(r, [
            "UnidadStockSimbolo",
            "Unidad Stock Simbolo",
            "Unidad stock (símbolo)",
            "StockUnitSymbol",
            "Stock unit symbol",
            "Unité stock (symbole)"
          ]) || r.UnidadStockSimbolo;
        return typeof MeasureUnitsManager !== "undefined" && MeasureUnitsManager.resolveUnitIdFromImportSymbol
          ? MeasureUnitsManager.resolveUnitIdFromImportSymbol(raw)
          : "";
      })(),
      measureAltUnitId: (() => {
        const raw =
          this._firstCsvField(r, [
            "UnidadEquivalenteSimbolo",
            "Unidad Equivalente Simbolo",
            "Unidad equivalente (símbolo)",
            "DisplayUnitSymbol",
            "Equivalent unit symbol",
            "Unité équivalente (symbole)"
          ]) || r.UnidadEquivalenteSimbolo;
        return typeof MeasureUnitsManager !== "undefined" && MeasureUnitsManager.resolveUnitIdFromImportSymbol
          ? MeasureUnitsManager.resolveUnitIdFromImportSymbol(raw)
          : "";
      })()
    };
    return this._normalizeItemCoreFields(parsed, { recomputeNumBoxes: true });
  },

  buildExportRowsForItems(items) {
    const headers = this.INVENTORY_IMPORT_CSV_HEADERS;
    const rows = (items || []).map(it => ({
      Codigo: it.code || "",
      Descripcion: it.description || "",
      Categoria: it.category || "",
      StockPrincipal: it.mainStock ?? 0,
      StockProduccion: it.prodStock ?? 0,
      StockTransformacion: it.transStock ?? 0,
      CantidadPorCaja: it.qtyPerBox ?? 0,
      NumeroCajas: it.numBoxes ?? 0,
      Ubicacion: it.location || "",
      FechaExpedicion: it.expDate || "",
      DiasParaExpirar: it.daysToExpire ?? "",
      FechaExpiracion: it.expirationDate || "",
      Proveedor: it.supplier || "",
      UltimaOrden: it.lastOrder || "",
      Detalles: it.details || "",
      PrecioDefecto: it.defaultPrice ?? 0,
      MonedaPrecio: this._normalizePriceCurrency(it.priceCurrency),
      Id: it.id || "",
      StockMinimo: it.minStock ?? 0,
      StockMaximo: it.maxStock ?? 0,
      VidaUtilMeses: it.shelfLifeMonths ?? 0,
      Notas: it.notes || "",
      LotesJson: JSON.stringify(Array.isArray(it.expirations) ? it.expirations : []),
      CajasJson: JSON.stringify(Array.isArray(it.boxStocks) ? it.boxStocks : []),
      UbicacionesJson: JSON.stringify(Array.isArray(it.locationStocks) ? it.locationStocks : []),
      UnidadStockSimbolo:
        typeof MeasureUnitsManager !== "undefined" && MeasureUnitsManager.getUnit
          ? MeasureUnitsManager.getUnit(it.measureStockUnitId)?.symbol || ""
          : "",
      UnidadEquivalenteSimbolo:
        typeof MeasureUnitsManager !== "undefined" && MeasureUnitsManager.getUnit
          ? MeasureUnitsManager.getUnit(it.measureAltUnitId)?.symbol || ""
          : ""
    }));
    return { headers, rows };
  },

  async exportItemsToCsv(items, manifestMeta, selectedHeaders = null) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
    const { headers, rows } = this.buildExportRowsForItems(items);
    if (!rows.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const sourceHeaders = Array.isArray(selectedHeaders) && selectedHeaders.length
      ? headers.filter(h => selectedHeaders.includes(h))
      : headers;
    const exportHeaders = sourceHeaders.map(h => this._inventoryExportHeaderLabel(h));
    const projectedRows = rows.map(r => {
      const o = {};
      sourceHeaders.forEach((h, idx) => {
        o[exportHeaders[idx]] = r[h];
      });
      return o;
    });
    const filename = Utils.backupFolderFilename("inventory");
    await Utils.exportStyledXlsxToInformFolder(filename, exportHeaders, projectedRows, manifestMeta || null);
  },

  _renderInventoryExportColumnsPicker() {
    const list = document.getElementById("inventory-export-columns-list");
    if (!list) return;
    list.innerHTML = this.INVENTORY_IMPORT_CSV_HEADERS.map(
      h =>
        `<label class="report-col-opt"><input type="checkbox" class="inventory-export-col-check" value="${Utils.escapeAttr(
          h
        )}" checked> <span>${this.esc(this._inventoryExportHeaderLabel(h))}</span></label>`
    ).join("");
  },

  _inventoryExportHeaderLabel(header) {
    const map = {
      Codigo: "table.code",
      Descripcion: "table.description",
      Categoria: "table.category",
      StockPrincipal: "table.mainStock",
      StockProduccion: "table.prodStock",
      StockTransformacion: "table.transStock",
      CantidadPorCaja: "table.qtyPerBox",
      NumeroCajas: "table.numBoxes",
      Ubicacion: "table.location",
      FechaExpedicion: "table.expDate",
      DiasParaExpirar: "table.daysToExpire",
      FechaExpiracion: "table.expirationDate",
      Proveedor: "table.supplier",
      UltimaOrden: "table.lastOrder",
      Detalles: "table.details",
      PrecioDefecto: "table.defaultPrice",
      MonedaPrecio: "table.priceCurrency",
      Id: "inventory.exportCol.id",
      StockMinimo: "inventory.exportCol.minStock",
      StockMaximo: "inventory.exportCol.maxStock",
      VidaUtilMeses: "inventory.exportCol.shelfLifeMonths",
      Notas: "table.notes",
      LotesJson: "inventory.exportCol.lotesJson",
      CajasJson: "inventory.exportCol.cajasJson",
      UbicacionesJson: "inventory.exportCol.ubicacionesJson",
      UnidadStockSimbolo: "inventory.exportCol.unidadStockSimbolo",
      UnidadEquivalenteSimbolo: "inventory.exportCol.unidadEquivalenteSimbolo"
    };
    const k = map[header];
    if (!k || typeof I18n === "undefined" || !I18n.t) return String(header || "");
    const t = I18n.t(k);
    return t === k ? String(header || "") : t;
  },

  _setAllInventoryExportColumns(checked) {
    document.querySelectorAll(".inventory-export-col-check").forEach(el => {
      el.checked = !!checked;
    });
  },

  _setInventoryExportColumnsDisabled(disabled) {
    document.querySelectorAll(".inventory-export-col-check").forEach(el => {
      el.disabled = !!disabled;
    });
    const allBtn = document.getElementById("inventory-export-columns-all");
    const noneBtn = document.getElementById("inventory-export-columns-none");
    if (allBtn) allBtn.disabled = !!disabled;
    if (noneBtn) noneBtn.disabled = !!disabled;
  },

  openInventoryExportModal() {
    this._renderInventoryExportColumnsPicker();
    const modeDefault = document.getElementById("inventory-export-mode-default");
    const modeCustom = document.getElementById("inventory-export-mode-custom");
    if (modeDefault) modeDefault.checked = true;
    if (modeCustom) modeCustom.checked = false;
    this._setInventoryExportColumnsDisabled(true);
    document.getElementById("inventory-export-modal")?.classList.add("active");
  },

  closeInventoryExportModal() {
    document.getElementById("inventory-export-modal")?.classList.remove("active");
  },

  _printDocument(title, subtitle, tableHtml) {
    Utils.printHtmlDocument(title, subtitle, tableHtml);
  },

  async printItemsTable(items, title, subtitle) {
    if (!items.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const allCols = [
      I18n.t("table.code"),
      I18n.t("table.description"),
      I18n.t("table.category"),
      I18n.t("table.defaultPrice"),
      I18n.t("table.mainStock"),
      I18n.t("inventory.colTotal"),
      I18n.t("inventory.colMin"),
      I18n.t("inventory.colMax"),
      I18n.t("table.expDate"),
      I18n.t("table.expirationDate"),
      I18n.t("inventory.colDays"),
      I18n.t("table.location")
    ];
    const selected = await Utils.pickColumns(allCols, title || I18n.t("inventory.printTitleInventory"));
    if (!selected || !selected.length) return;
    const fmt = v => Utils.formatDecimalDisplay(v);
    const rows = items
      .map(it => {
        const tot = this.itemTotalStock(it);
        const eff = this.getEffectiveExpirationDateForDisplay(it);
        const ins = this.getExpirationInsight(it);
        const days =
          ins.has && ins.days !== null
            ? ins.days < 0
              ? I18n.t("inventory.insightExpired")
              : String(ins.days)
            : "—";
        const minS = it.minStock != null && it.minStock !== "" ? fmt(parseFloat(it.minStock) || 0) : "—";
        const maxS = it.maxStock != null && it.maxStock !== "" ? fmt(parseFloat(it.maxStock) || 0) : "—";
        const map = {
          [I18n.t("table.code")]: `<td class="print-cell-code app-code-copy-cell">${this.esc(it.code)}${this._inventoryConsumableBadgeHtml(it)}</td>`,
          [I18n.t("table.description")]: `<td class="app-desc-copy-cell">${this.esc(it.description)}</td>`,
          [I18n.t("table.category")]: `<td>${this.esc(it.category || "—")}</td>`,
          [I18n.t("table.defaultPrice")]: `<td>${this._formatPriceDisplay(it.defaultPrice ?? 0, it.priceCurrency)}</td>`,
          [I18n.t("table.mainStock")]: `<td>${fmt(it.mainStock ?? 0)}</td>`,
          [I18n.t("inventory.colTotal")]: `<td>${fmt(tot)}</td>`,
          [I18n.t("inventory.colMin")]: `<td>${minS}</td>`,
          [I18n.t("inventory.colMax")]: `<td>${maxS}</td>`,
          [I18n.t("table.expDate")]: `<td>${it.expDate ? Utils.formatDate(it.expDate) : "—"}</td>`,
          [I18n.t("table.expirationDate")]: `<td>${eff ? Utils.formatDate(eff) : "—"}</td>`,
          [I18n.t("inventory.colDays")]: `<td>${this.esc(days)}</td>`,
          [I18n.t("table.location")]: `<td>${this.esc(it.location || "—")}</td>`
        };
        return `<tr>${selected.map(h => map[h] || "<td></td>").join("")}</tr>`;
      })
      .join("");
    const table = `<table class="inventory-table"><thead><tr>${selected
      .map(h => `<th${h === I18n.t("table.code") ? ' class="print-cell-code"' : ""}>${this.esc(h)}</th>`)
      .join("")}</tr></thead><tbody>${rows}</tbody></table>`;
    this._printDocument(title, subtitle, table);
  },

  exportCurrentInventoryView(mode = "default") {
    const items = this._inventoryViewList || [];
    const details = [`${I18n.t("export.manifest.rows")}: ${items.length}`];
    const searchQ = (document.getElementById("inventory-search")?.value || "").trim();
    if (searchQ) details.push(`${I18n.t("export.manifest.search")}: ${searchQ}`);
    if (this._asOfDate)
      details.push(`${I18n.t("export.manifest.asOf")}: ${Utils.formatDate(this._asOfDate)}`);
    const consFil = document.getElementById("inventory-consumable-filter")?.value || "all";
    if (consFil === "invcons") details.push(I18n.t("export.manifest.inventoryConsumableOnly"));
    else if (consFil === "noninvcons") details.push(I18n.t("export.manifest.inventoryConsumableExclude"));
    const useCustom = mode === "custom";
    const selectedHeaders = useCustom
      ? Array.from(document.querySelectorAll(".inventory-export-col-check:checked")).map(el => String(el.value || ""))
      : [];
    const allHeaders = this.INVENTORY_IMPORT_CSV_HEADERS.slice();
    const headers = selectedHeaders.length ? allHeaders.filter(h => selectedHeaders.includes(h)) : allHeaders;
    const exportHeaders = headers.map(h => this._inventoryExportHeaderLabel(h));
    const { rows } = this.buildExportRowsForItems(items);
    const projectedRows = rows.map(r => {
      const o = {};
      headers.forEach((h, idx) => {
        o[exportHeaders[idx]] = r[h];
      });
      return o;
    });
    if (!projectedRows.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const filename = Utils.backupFolderFilename("inventory");
    void Utils.exportStyledXlsxToInformFolder(filename, exportHeaders, projectedRows, {
      kind: "inventory_current_table",
      title: I18n.t("export.manifest.inventoryCurrentView"),
      details
    });
  },

  /**
   * Exporta una plantilla XLSX **minimalista** (solo-stock) con las columnas
   * imprescindibles para actualizar cantidades por código: incluye una fila por
   * artículo del inventario actual. El usuario edita las celdas de stock y la
   * vuelve a importar con `importInventoryStockUpdate` para refrescar valores
   * sin modificar nada más (descripciones, ubicaciones, lotes, cajas, etc.).
   */
  async exportInventoryStockUpdateTemplate() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
    const items = Array.isArray(this.items) ? this.items : [];
    if (!items.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const codeLab = I18n.t("table.code");
    const descLab = I18n.t("table.description");
    const mainLab = I18n.t("table.mainStock");
    const prodLab = I18n.t("table.prodStock");
    const transLab = I18n.t("table.transStock");
    const minLab = I18n.t("inventory.exportCol.minStock") || "Stock mínimo";
    const maxLab = I18n.t("inventory.exportCol.maxStock") || "Stock máximo";
    const notesLab = I18n.t("inventory.stockUpdateNotesCol") || "Notas (opcional)";
    const headers = [codeLab, descLab, mainLab, prodLab, transLab, minLab, maxLab, notesLab];
    const rows = items
      .filter(it => it && (it.code || "").trim() !== "")
      .map(it => ({
        [codeLab]: it.code || "",
        [descLab]: it.description || "",
        [mainLab]: Utils.roundDecimal(parseFloat(it.mainStock) || 0),
        [prodLab]: Utils.roundDecimal(parseFloat(it.prodStock) || 0),
        [transLab]: Utils.roundDecimal(parseFloat(it.transStock) || 0),
        [minLab]: Utils.roundDecimal(parseFloat(it.minStock) || 0),
        [maxLab]: Utils.roundDecimal(parseFloat(it.maxStock) || 0),
        [notesLab]: ""
      }));
    const filename = `GNEEX_Inventario_Solo_Stock_${this._fileStamp()}.xlsx`;
    await Utils.exportStyledXlsxToInformFolder(filename, headers, rows, {
      kind: "inventory_stock_update_template",
      title: I18n.t("export.manifest.inventoryStockUpdateTemplate") || "Plantilla XLSX — solo stock (actualización)",
      details: [
        `${I18n.t("export.manifest.rows") || "Filas"}: ${rows.length}`,
        I18n.t("inventory.stockUpdateTemplateHint") ||
          "Edite los valores de stock y vuelva a importar. Solo se actualizan cantidades; descripción, lotes, cajas y ubicaciones no se tocan."
      ]
    });
  },

  /**
   * Importa una plantilla solo-stock: empareja por código y aplica únicamente
   * los campos numéricos de stock (principal, producción, transformación,
   * mínimo, máximo). No crea artículos nuevos, no toca cajas, lotes, ubicaciones
   * ni metadatos. Si una cantidad viene vacía/no numérica, se omite ese campo.
   */
  importInventoryStockUpdate(file) {
    if (!file) return;
    Utils.importDataCSV(
      file,
      "__tmp_stock_update__",
      parsed => {
        try {
          localStorage.removeItem("__tmp_stock_update__");
        } catch (e) {}
        const rows = Array.isArray(parsed) ? parsed : [];
        if (!rows.length) {
          Utils.showToast(I18n.t("msg.noDataToExport"), "warning");
          return;
        }
        const byCode = new Map();
        for (const it of this.items || []) {
          const k = this._normalizeImportCodeValue(it.code);
          if (k) byCode.set(k, it);
        }
        const codeAliases = [
          "Codigo", "Código", "CODE", "Code", "CODIGO", "SKU", "Articulo",
          "Artículo", "Item", "Article", "Référence", "Reference", "Referencia", "Ref"
        ];
        const mainAliases = [
          "StockPrincipal", "Stock Principal", "Stock principal", "MainStock",
          "Main Stock", "Stock Main", I18n.t("table.mainStock")
        ];
        const prodAliases = [
          "StockProduccion", "Stock Produccion", "Stock Producción",
          "ProductionStock", "Production Stock", I18n.t("table.prodStock")
        ];
        const transAliases = [
          "StockTransformacion", "Stock Transformacion", "Stock Transformación",
          "TransformationStock", "StockTransformation", I18n.t("table.transStock")
        ];
        const minAliases = [
          "StockMinimo", "Stock Mínimo", "Stock mínimo", "MinimumStock",
          I18n.t("inventory.exportCol.minStock") || ""
        ].filter(Boolean);
        const maxAliases = [
          "StockMaximo", "Stock Máximo", "Stock máximo", "MaximumStock",
          I18n.t("inventory.exportCol.maxStock") || ""
        ].filter(Boolean);
        let applied = 0;
        let skipped = 0;
        const skippedRows = [];
        const touchedItems = [];
        const prevMap = {};
        const readNum = raw => {
          if (raw === null || raw === undefined || String(raw).trim() === "") return null;
          const n = parseFloat(String(raw).replace(",", "."));
          return Number.isFinite(n) ? Utils.roundDecimal(n) : null;
        };
        for (const r of rows) {
          if (!r || typeof r !== "object") continue;
          const codeRaw = this._firstCsvField(r, codeAliases) || r.Codigo || r.code || "";
          const codeKey = this._normalizeImportCodeValue(codeRaw);
          if (!codeKey) {
            skipped++;
            skippedRows.push({ reason: "no-code", raw: r });
            continue;
          }
          const it = byCode.get(codeKey);
          if (!it) {
            skipped++;
            skippedRows.push({ reason: "code-not-found", code: codeRaw });
            continue;
          }
          const patch = {};
          const main = readNum(this._firstCsvField(r, mainAliases));
          if (main !== null) patch.mainStock = main;
          const prod = readNum(this._firstCsvField(r, prodAliases));
          if (prod !== null) patch.prodStock = prod;
          const trans = readNum(this._firstCsvField(r, transAliases));
          if (trans !== null) patch.transStock = trans;
          const mn = readNum(this._firstCsvField(r, minAliases));
          if (mn !== null) patch.minStock = mn;
          const mx = readNum(this._firstCsvField(r, maxAliases));
          if (mx !== null) patch.maxStock = mx;
          if (!Object.keys(patch).length) {
            skipped++;
            skippedRows.push({ reason: "no-numeric-value", code: codeRaw });
            continue;
          }
          if (!prevMap[it.id]) {
            prevMap[it.id] = {
              main: parseFloat(it.mainStock) || 0,
              prod: parseFloat(it.prodStock) || 0,
              trans: parseFloat(it.transStock) || 0
            };
            touchedItems.push(it);
          }
          Object.assign(it, patch);
          applied++;
        }
        if (applied > 0) {
          this.save();
          /* Registra los cambios como AJUSTE para que el historial refleje quién y
             cuándo actualizó las cantidades vía plantilla solo-stock. */
          if (
            typeof MovementManager !== "undefined" &&
            MovementManager.recordAjusteInventoryCsvImportBatch
          ) {
            try {
              MovementManager.recordAjusteInventoryCsvImportBatch({
                prevMap,
                items: touchedItems,
                notes:
                  I18n.t("movements.stockUpdateImportNote") ||
                  "Actualización vía plantilla solo-stock"
              });
            } catch (e) {
              console.warn("Stock-only update: ajuste audit failed", e);
            }
          }
          this.render(this.search(document.getElementById("inventory-search")?.value || ""));
        }
        const summary =
          (I18n.t("inventory.stockUpdateApplied") || "Stock actualizado en {n} artículos.").replace(
            "{n}",
            String(applied)
          ) +
          (skipped
            ? ` · ${(I18n.t("inventory.stockUpdateSkipped") || "Filas omitidas: {n}").replace(
                "{n}",
                String(skipped)
              )}`
            : "");
        Utils.showToast(summary, skipped && !applied ? "warning" : "success");
        if (typeof window !== "undefined") {
          window.__gneexLastStockUpdateReport = { summary, applied, skipped, skippedRows };
        }
      },
      { silentToast: true }
    );
  },

  async exportInventoryImportTemplateCsv() {
    if (typeof Auth !== "undefined" && !Auth.guardLoadInventoryCsv()) return;
    const technicalHeaders = this.INVENTORY_IMPORT_CSV_HEADERS;
    const headers = technicalHeaders.map(h => this._inventoryExportHeaderLabel(h));
    const sample = {
      Codigo: "ART-001",
      Descripcion: "Articulo ejemplo",
      Categoria: "GENERAL",
      StockPrincipal: 10,
      StockProduccion: 0,
      StockTransformacion: 0,
      CantidadPorCaja: 1,
      NumeroCajas: 10,
      Ubicacion: "PASILLO A",
      FechaExpedicion: "",
      DiasParaExpirar: "",
      FechaExpiracion: "",
      Proveedor: "Proveedor ejemplo",
      UltimaOrden: "",
      Detalles: "",
      PrecioDefecto: 0,
      MonedaPrecio: "CAD",
      Id: "",
      StockMinimo: 5,
      StockMaximo: 100,
      VidaUtilMeses: 0,
      Notas: "",
      LotesJson: "[]",
      CajasJson: "[]",
      UbicacionesJson: "[]"
    };
    const sampleLocalized = {};
    technicalHeaders.forEach((h, idx) => {
      sampleLocalized[headers[idx]] = sample[h];
    });
    const filename = `GNEEX_Inventory_Import_Template_${this._fileStamp()}.xlsx`;
    await Utils.exportStyledXlsxToInformFolder(filename, headers, [sampleLocalized], {
      kind: "inventory_import_template",
      title: I18n.t("export.manifest.inventoryImportTemplate"),
      details: [I18n.t("export.manifest.templateOneExampleRow")]
    });
  },

  async printCurrentInventoryView() {
    const q = this._inventorySearchQuery;
    let sub = I18n.t("inventory.printSubtitleAll");
    if (this._asOfDate) {
      sub = I18n.t("inventory.printSubtitleAsOf").replace("{date}", Utils.formatDate(this._asOfDate));
    } else if (q) {
      sub = I18n.t("inventory.printSubtitleFiltered").replace("{q}", q);
    }
    await this.printItemsTable(this._inventoryViewList || [], I18n.t("inventory.printTitleInventory"), sub);
  },

  async clearAllExpirationData() {
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("invDangerClearExpiry", "edit")) return;
    const total = Array.isArray(this.items) ? this.items.length : 0;
    if (!total) {
      Utils.showToast(I18n.t("msg.noDataToExport"), "info");
      return;
    }
    const run = () => {
      let changed = 0;
      this.items = (this.items || []).map(it => {
        if (!it || it.inventoryConsumable) return it;
        const hadData =
          it.tracksExpiration === true ||
          Math.max(0, parseInt(it.shelfLifeMonths, 10) || 0) > 0 ||
          String(it.expDate || "").trim() ||
          String(it.expirationDate || "").trim() ||
          Math.abs(parseFloat(it.daysToExpire) || 0) > 0 ||
          (Array.isArray(it.expirations) && it.expirations.length > 0);
        if (!hadData) return it;
        changed++;
        return this._normalizeItemCoreFields(
          {
            ...it,
            tracksExpiration: false,
            shelfLifeMonths: 0,
            expDate: "",
            expirationDate: "",
            daysToExpire: 0,
            expirations: []
          },
          { recomputeNumBoxes: false }
        );
      });
      this.save();
      this.render(this.search(this._inventorySearchQuery || ""));
      Utils.showToast(
        I18n.t("inventory.clearExpiryDone").replace("{n}", String(changed)),
        changed > 0 ? "success" : "info"
      );
      if (typeof Auth !== "undefined" && Auth.logAudit) {
        Auth.logAudit("inventory.clear.expiration.all", `changed=${changed}`);
      }
    };
    const msg = I18n.t("inventory.clearExpiryConfirm");
    const dNow = new Date();
    const y = String(dNow.getFullYear());
    const m = String(dNow.getMonth() + 1).padStart(2, "0");
    const d = String(dNow.getDate()).padStart(2, "0");
    const requiredPhrase = `${I18n.t("inventory.clearExpiryTypePhraseBase")} ${y}-${m}-${d}`;
    const confirmPhraseAndRun = async () => {
      if (typeof App !== "undefined" && App.showPrompt) {
        const typed = await App.showPrompt({
          message: I18n.t("inventory.clearExpiryTypePrompt").replace("{phrase}", requiredPhrase),
          defaultValue: "",
          inputType: "text"
        });
        if (typed == null) return;
        if (String(typed || "").trim() !== requiredPhrase) {
          Utils.showToast(I18n.t("inventory.clearExpiryTypeMismatch"), "warning");
          return;
        }
      } else if (!window.confirm(`${I18n.t("inventory.clearExpiryTypePrompt").replace("{phrase}", requiredPhrase)}\n\n${requiredPhrase}`)) {
        return;
      }
      run();
    };
    if (typeof App !== "undefined" && App.showConfirm) {
      App.showConfirm(msg, () => {
        void confirmPhraseAndRun();
      });
    } else if (window.confirm(msg)) {
      await confirmPhraseAndRun();
    }
  },

  async exportInsightList() {
    const items = this._insightExportItems || [];
    const insightKey = this._insightTitleKey || "inventory.insightTitleLow";
    const allHeaders = this.INVENTORY_IMPORT_CSV_HEADERS.slice();
    const labels = allHeaders.map(h => this._inventoryExportHeaderLabel(h));
    const selectedLabels = await Utils.pickColumns(labels, I18n.t("inventory.exportCsv"));
    if (!selectedLabels || !selectedLabels.length) return;
    const selectedHeaders = allHeaders.filter(h => selectedLabels.includes(this._inventoryExportHeaderLabel(h)));
    void this.exportItemsToCsv(items, {
      kind: "inventory_alert_insight",
      title: I18n.t(insightKey),
      details: [`${I18n.t("export.manifest.rows")}: ${items.length}`]
    }, selectedHeaders);
  },

  async printInsightList() {
    const title = I18n.t(this._insightTitleKey || "inventory.insightTitleLow");
    await this.printItemsTable(this._insightExportItems || [], title, "");
  },

  buildBoxOptionsHtmlForMovement(itemId, selectedBoxId = "") {
    const boxes = this.getItemBoxStocks(itemId);
    const ph = this.esc(I18n.t("inventory.boxOptionalNone"));
    const opts = [`<option value="">${ph}</option>`];
    for (const b of boxes) {
      const id = Utils.escapeAttr(String(b.boxId));
      const sel = String(selectedBoxId) === String(b.boxId) ? " selected" : "";
      const qBox = this._parseBoxStockQtyValue(b.qty);
      const locShort = String(b.locationLabel || "").trim();
      const tpl = locShort ? "inventory.boxOptionWithQtyLoc" : "inventory.boxOptionWithQty";
      let text = I18n.t(tpl)
        .replace("{n}", String(b.boxNumber))
        .replace("{q}", Utils.formatDecimalDisplay(qBox));
      if (locShort) text = text.replace("{loc}", locShort);
      const label = this.esc(text);
      opts.push(`<option value="${id}"${sel}>${label}</option>`);
    }
    return opts.join("");
  },

  /**
   * Origen de stock para movimientos en salida: producción, transformación, cajas (principal), ubicaciones.
   * Ubicaciones muestran cantidad = stock principal − stock en cajas, repartida entre ranuras (no se duplica el total del principal).
   * Valores: "", "depot:production", "depot:transformation", "box:id", "ibox:número", "loc:encoded"
   * @param {{ onlyOriginsWithStock?: boolean, excludeDepotProductionTransformation?: boolean }} [options] — si `onlyOriginsWithStock`, no lista orígenes con cantidad ≤ 0 (consumo diario, merma); la opción ya seleccionada se mantiene aunque sea 0. Si `excludeDepotProductionTransformation`, no se ofrecen depósitos producción/transformación (Venta directa, Expedición de stock).
   */
  buildStockSourceOptionsHtmlForMovement(itemId, selectedValue = "", options = {}) {
    const item = this.getItemById(itemId);
    const opts = [];
    if (!item) {
      opts.push(`<option value="">${this.esc(I18n.t("inventory.stockSourceNoRemainder"))}</option>`);
      return opts.join("");
    }
    const selNorm = String(selectedValue || "").trim();
    const onlyOriginsWithStock = !!options.onlyOriginsWithStock;
    const excludeDepotPT = !!options.excludeDepotProductionTransformation;
    const pool = this._getMainLocationPoolQty(item);
    const locSourceRows = this.getMovementLocationSourceOptions(item);

    if (locSourceRows.length === 0 && pool > 0) {
      const sel = selNorm === "" ? " selected" : "";
      opts.push(
        `<option value=""${sel}>${this.esc(
          I18n.t("inventory.stockSourceRemainderPool").replace("{q}", Utils.formatDecimalDisplay(pool))
        )}</option>`
      );
    } else if (locSourceRows.length === 0 && pool <= 0 && !onlyOriginsWithStock) {
      opts.push(
        `<option value="">${this.esc(I18n.t("inventory.stockSourceNoRemainder"))}</option>`
      );
    }

    const prodNum = this._parseBoxStockQtyValue(item.prodStock);
    const transNum = this._parseBoxStockQtyValue(item.transStock);
    const prodQ = Utils.formatDecimalDisplay(prodNum);
    const transQ = Utils.formatDecimalDisplay(transNum);
    const selP = selNorm === "depot:production" ? " selected" : "";
    const selT = selNorm === "depot:transformation" ? " selected" : "";
    const showProd =
      !excludeDepotPT && (!onlyOriginsWithStock || prodNum > 0 || selNorm === "depot:production");
    const showTrans =
      !excludeDepotPT && (!onlyOriginsWithStock || transNum > 0 || selNorm === "depot:transformation");
    if (showProd) {
      opts.push(
        `<option value="depot:production"${selP}>${this.esc(
          I18n.t("inventory.stockSourceProduction").replace("{q}", prodQ)
        )}</option>`
      );
    }
    if (showTrans) {
      opts.push(
        `<option value="depot:transformation"${selT}>${this.esc(
          I18n.t("inventory.stockSourceTransformation").replace("{q}", transQ)
        )}</option>`
      );
    }
    const seenRealBox = new Set();
    for (const b of this.getItemBoxStocks(itemId)) {
      const qBox = this._parseBoxStockQtyValue(b.qty);
      const v = `box:${String(b.boxId)}`;
      if (onlyOriginsWithStock && qBox <= 0 && selNorm !== v) continue;
      seenRealBox.add(Number(b.boxNumber));
      const sel = selNorm === v ? " selected" : "";
      const qDisp = Utils.formatDecimalDisplay(qBox);
      const text = I18n.t("inventory.boxOptionWithQty")
        .replace("{n}", String(b.boxNumber))
        .replace("{q}", qDisp);
      const label = this.esc(text);
      opts.push(`<option value="${Utils.escapeAttr(v)}"${sel}>${label}</option>`);
    }
    const inferredNums = Utils.parseWarehouseBoxesFromLocation(item.location || "").filter(
      num => !seenRealBox.has(num)
    );
    const boxRowsByNum = this.getItemBoxStocks(itemId);
    for (const num of inferredNums) {
      const qInf = this.getMovementInferredBoxAvailableQty(itemId, num);
      const v = `ibox:${num}`;
      if (onlyOriginsWithStock && qInf <= 0 && selNorm !== v) continue;
      const sel = selNorm === v ? " selected" : "";
      const row = boxRowsByNum.find(br => Number(br.boxNumber) === Number(num));
      const qMgmt = row ? this._parseBoxStockQtyValue(row.qty) : qInf;
      const label = this.esc(
        I18n.t("inventory.boxOptionWithQty")
          .replace("{n}", String(num))
          .replace("{q}", Utils.formatDecimalDisplay(qMgmt))
      );
      opts.push(`<option value="${Utils.escapeAttr(v)}"${sel}>${label}</option>`);
    }
    for (const ls of locSourceRows) {
      const qLoc = Math.max(0, parseFloat(ls.qty) || 0);
      const v = `loc:${encodeURIComponent(ls.location)}`;
      if (onlyOriginsWithStock && qLoc <= 0 && selNorm !== v) continue;
      const sel = selNorm === v ? " selected" : "";
      const label = this.esc(
        `${ls.location} · ${Utils.formatDecimalDisplay(qLoc)}`
      );
      opts.push(`<option value="${Utils.escapeAttr(v)}"${sel}>${label}</option>`);
    }
    let html = opts.join("");
    if (onlyOriginsWithStock && !String(html).trim()) {
      html = `<option value="">${this.esc(I18n.t("inventory.stockSourceNoRemainder"))}</option>`;
    }
    return html;
  },

  _resetBoxManagerBoxForm() {
    this._boxMgrEditBoxId = null;
    const pairs = [
      ["inventory-box-number", ""],
      ["inventory-box-qty", "0"],
      ["inventory-box-qty-boxes", "0"],
      ["inventory-box-location", ""],
      ["inventory-box-notes", ""]
    ];
    for (const [id, def] of pairs) {
      const el = document.getElementById(id);
      if (el) el.value = def;
    }
    const cb = document.getElementById("inventory-box-mark-empty");
    if (cb) cb.checked = false;
    const q = document.getElementById("inventory-box-qty");
    const qb = document.getElementById("inventory-box-qty-boxes");
    if (q) q.readOnly = false;
    if (qb) qb.readOnly = false;
    this._syncBoxManagerFormUi();
  },

  _syncEmptyCheckboxUi() {
    const cb = document.getElementById("inventory-box-mark-empty");
    const q = document.getElementById("inventory-box-qty");
    const qb = document.getElementById("inventory-box-qty-boxes");
    const on = !!(cb && cb.checked);
    if (q) {
      q.readOnly = on;
      if (on) q.value = "0";
    }
    if (qb) {
      qb.readOnly = on;
      if (on) qb.value = "0";
    }
  },

  _syncBoxManagerArticleClearBtn() {
    const btn = document.getElementById("inventory-box-clear-article-btn");
    if (btn) btn.disabled = !this._boxMgrItemId;
  },

  clearBoxManagerArticleSelection() {
    this._boxMgrItemId = "";
    const inp = document.getElementById("inventory-box-item-search");
    if (inp) inp.value = "";
    const results = document.getElementById("inventory-box-item-search-results");
    if (results) {
      results.classList.remove("active");
      results.innerHTML = "";
    }
    this._resetBoxManagerBoxForm();
    this._applyBoxManagerItemSelection();
  },

  _syncBoxManagerFormUi() {
    const saveBtn = document.getElementById("inventory-box-save-btn");
    const cancelBtn = document.getElementById("inventory-box-cancel-edit-btn");
    const canEdit = this._canManageBoxMutations();
    const editing = !!this._boxMgrEditBoxId;
    if (saveBtn && typeof I18n !== "undefined") {
      saveBtn.textContent = I18n.t(editing ? "inventory.boxMgrSaveUpdate" : "inventory.boxMgrSaveAdd");
      saveBtn.hidden = !canEdit;
    }
    if (cancelBtn) cancelBtn.hidden = !canEdit || !editing;
  },

  _syncBoxManagerAccessUi() {
    const canEdit = this._canManageBoxMutations();
    const idsDisable = [
      "inventory-box-number",
      "inventory-box-qty",
      "inventory-box-qty-boxes",
      "inventory-box-location",
      "inventory-box-notes",
      "inventory-box-mark-empty",
      "inventory-box-transfer-from",
      "inventory-box-transfer-to",
      "inventory-box-transfer-qty",
      "inventory-box-transfer-location"
    ];
    idsDisable.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !canEdit;
    });
    const transferBtn = document.getElementById("inventory-box-transfer-btn");
    if (transferBtn) transferBtn.hidden = !canEdit;
    const saveBtn = document.getElementById("inventory-box-save-btn");
    if (saveBtn) saveBtn.hidden = !canEdit;
    const cancelBtn = document.getElementById("inventory-box-cancel-edit-btn");
    if (cancelBtn) cancelBtn.hidden = !canEdit || cancelBtn.hidden;
  },

  /** Sugerencias alineadas al catálogo efectivo + cajas conocidas (gestión de cajas y transferencias). */
  _refreshBoxManagerLocationDatalists() {
    if (typeof Utils === "undefined" || !Utils.getEffectiveWarehouseLocationSlots) return;
    const slots = Utils.getEffectiveWarehouseLocationSlots() || [];
    const opts = [];
    const seen = new Set();
    const pushOpt = val => {
      const v = String(val || "").trim();
      if (!v) return;
      const k = v.toUpperCase();
      if (seen.has(k)) return;
      seen.add(k);
      opts.push(`<option value="${Utils.escapeAttr(v)}"></option>`);
    };
    for (const s of slots) pushOpt(s);
    const known = this._getKnownBoxNumbers();
    for (const n of known) {
      pushOpt(`BOX${n}`);
      pushOpt(`BOX ${n}`);
    }
    const html = opts.join("");
    const d1 = document.getElementById("inventory-box-location-datalist");
    const d2 = document.getElementById("inventory-box-transfer-location-datalist");
    if (d1) d1.innerHTML = html;
    if (d2) d2.innerHTML = html;
  },

  /** Actualiza tabla de cajas y selects de transferencia según `_boxMgrItemId`. */
  _applyBoxManagerItemSelection() {
    this._renderBoxManagerRows();
    this._syncBoxManagerArticleClearBtn();
    const canEdit = this._canManageBoxMutations();
    const item = this.getItemById(this._boxMgrItemId);
    const boxes = item && Array.isArray(item.boxStocks) ? item.boxStocks : [];
    const opts = boxes
      .map(
        b =>
          `<option value="${Utils.escapeAttr(String(b.boxId))}">${this.esc(
            I18n.t("inventory.boxFilterOption").replace("{n}", String(b.boxNumber))
          )}</option>`
      )
      .join("");
    const itemBoxNums = new Set(
      boxes
        .map(b => parseInt(b?.boxNumber, 10))
        .filter(n => this._isValidBoxNumber(n))
    );
    const globalBoxCreateOpts = canEdit
      ? this._getKnownBoxNumbers()
          .filter(n => !itemBoxNums.has(n))
          .map(
            n =>
              `<option value="${Utils.escapeAttr(`gbox:${n}`)}">${this.esc(
                `${I18n.t("inventory.boxFilterOption").replace("{n}", String(n))} (+)`
              )}</option>`
          )
          .join("")
      : "";
    const locRows = item ? this._normalizeItemLocationStocks(item) : [];
    const locOpts = locRows
      .map(ls => {
        const raw = String(ls.location || "").trim();
        if (!raw) return "";
        const val = `loc:${encodeURIComponent(raw)}`;
        const qty = Utils.formatDecimalDisplay(parseFloat(ls.qty) || 0);
        return `<option value="${Utils.escapeAttr(val)}">${this.esc(`${raw} · ${qty}`)}</option>`;
      })
      .join("");
    const mainPoolQ = item ? this._getMainLocationPoolQty(item) : 0;
    const mainPoolOpt = `<option value="${Utils.escapeAttr(BOX_TRANSFER_MAIN_POOL_ID)}">${this.esc(
      `${I18n.t("inventory.boxTransferPrincipalPool")} · ${Utils.formatDecimalDisplay(mainPoolQ)}`
    )}</option>`;
    const prodOpt = `<option value="${Utils.escapeAttr(BOX_TRANSFER_PROD_ID)}">${this.esc(I18n.t("table.prodStock"))}</option>`;
    const transOpt = `<option value="${Utils.escapeAttr(BOX_TRANSFER_TRANS_ID)}">${this.esc(I18n.t("table.transStock"))}</option>`;
    const locationOpt = `<option value="${Utils.escapeAttr(BOX_TRANSFER_LOCATION_ID)}">${this.esc(I18n.t("inventory.boxTransferToLocationDirect"))}</option>`;
    const fromSpecialOpts = `${mainPoolOpt}${prodOpt}${transOpt}${locOpts}`;
    const toSpecialOpts = `${mainPoolOpt}${prodOpt}${transOpt}${locationOpt}${locOpts}`;
    const phFrom = this.esc(I18n.t("inventory.boxTransferPlaceholderFrom"));
    const phTo = this.esc(I18n.t("inventory.boxTransferPlaceholderTo"));
    const fromSel = document.getElementById("inventory-box-transfer-from");
    const toSel = document.getElementById("inventory-box-transfer-to");
    if (fromSel) fromSel.innerHTML = `<option value="">${phFrom}</option>${fromSpecialOpts}${opts}`;
    if (toSel) toSel.innerHTML = `<option value="">${phTo}</option>${toSpecialOpts}${opts}${globalBoxCreateOpts}`;
    this._refreshBoxManagerLocationDatalists();
    this._syncBoxTransferLocationVisibility();
    this._syncBoxManagerAccessUi();
    this._syncZeroTotalBoxToolbarBtn();
  },

  /** Oculta «ubicación destino» si el destino no es una caja física. */
  _syncBoxTransferLocationVisibility() {
    const toSel = document.getElementById("inventory-box-transfer-to");
    const wrap = document.getElementById("inventory-box-transfer-location-wrap");
    if (!wrap) return;
    const toVal = toSel?.value || "";
    const tk = _boxXferKind(toVal);
    const show = tk === "box" || tk === "loc";
    wrap.hidden = !show;
  },

  _syncInventoryBoxFilterToggleUi() {
    const wrap = document.getElementById("inventory-box-filter-wrap");
    const btn = document.getElementById("inventory-box-filter-toggle-btn");
    if (!wrap || !btn) return;
    const k = wrap.hidden ? "inventory.boxFilterToggleShow" : "inventory.boxFilterToggleHide";
    const txt = typeof I18n !== "undefined" && I18n.t ? I18n.t(k) : k;
    btn.setAttribute("title", txt);
    btn.setAttribute("aria-label", txt);
  },

  _collapseOtherInventoryFilterPanels(exceptKind) {
    for (const k of ["box", "depot", "consumable"]) {
      if (k === exceptKind) continue;
      this.collapseInventoryFilterPanel(k);
    }
  },

  /** Primera fila del menú ⋮: minimizar tiras; deshabilitada si ninguna tira está abierta. */
  _syncInventoryHeaderFiltersCollapseBtn() {
    const btn = document.getElementById("inventory-header-filters-collapse-menuitem");
    if (!btn) return;
    const ids = ["inventory-box-filter-wrap", "inventory-depot-filter-wrap", "inventory-consumable-filter-wrap"];
    const anyOpen = ids.some(id => {
      const w = document.getElementById(id);
      return !!(w && w.isConnected && !w.hidden);
    });
    btn.disabled = !anyOpen;
  },

  hideAllInventoryFilterPanels() {
    const searchVal = document.getElementById("inventory-search")?.value || "";
    let needsRender = false;
    const pairs = [
      ["inventory-box-filter-wrap", "inventory-box-filter"],
      ["inventory-depot-filter-wrap", "inventory-depot-preset"],
      ["inventory-consumable-filter-wrap", "inventory-consumable-filter"]
    ];
    for (const [wid, sid] of pairs) {
      const wrap = document.getElementById(wid);
      const sel = document.getElementById(sid);
      if (wrap) {
        wrap.hidden = true;
        wrap.style.display = "none";
      }
      if (sel && sel.value !== "all") {
        sel.value = "all";
        needsRender = true;
      }
    }
    this._syncInventoryBoxFilterToggleUi();
    this._syncInventoryDepotFilterToggleUi();
    this._syncInventoryConsumableFilterToggleUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
    if (needsRender) this.render(this.search(searchVal));
  },

  toggleInventoryBoxFilterVisibility() {
    const wrap = document.getElementById("inventory-box-filter-wrap");
    if (!wrap) return;
    const nextHidden = !wrap.hidden;
    if (!nextHidden) {
      this._collapseOtherInventoryFilterPanels("box");
    }
    wrap.hidden = nextHidden;
    wrap.style.display = nextHidden ? "none" : "inline-flex";
    if (nextHidden) {
      const sel = document.getElementById("inventory-box-filter");
      if (sel && sel.value !== "all") {
        sel.value = "all";
        this.render(this.search(document.getElementById("inventory-search")?.value || ""));
      }
    }
    this._syncInventoryBoxFilterToggleUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
  },

  _syncInventoryDepotFilterToggleUi() {
    const wrap = document.getElementById("inventory-depot-filter-wrap");
    const btn = document.getElementById("inventory-depot-filter-toggle-btn");
    if (!wrap || !btn) return;
    const k = wrap.hidden ? "inventory.depotFilterToggleShow" : "inventory.depotFilterToggleHide";
    const txt = typeof I18n !== "undefined" && I18n.t ? I18n.t(k) : k;
    btn.setAttribute("title", txt);
    btn.setAttribute("aria-label", txt);
  },

  toggleInventoryDepotFilterVisibility() {
    const wrap = document.getElementById("inventory-depot-filter-wrap");
    if (!wrap) return;
    const nextHidden = !wrap.hidden;
    if (!nextHidden) {
      this._collapseOtherInventoryFilterPanels("depot");
    }
    wrap.hidden = nextHidden;
    wrap.style.display = nextHidden ? "none" : "inline-flex";
    if (nextHidden) {
      const sel = document.getElementById("inventory-depot-preset");
      if (sel && sel.value !== "all") {
        sel.value = "all";
        this.render(this.search(document.getElementById("inventory-search")?.value || ""));
      }
    }
    this._syncInventoryDepotFilterToggleUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
  },

  _syncInventoryConsumableFilterToggleUi() {
    const wrap = document.getElementById("inventory-consumable-filter-wrap");
    const btn = document.getElementById("inventory-consumable-filter-toggle-btn");
    if (!wrap || !btn) return;
    const k = wrap.hidden ? "inventory.consumableFilterToggleShow" : "inventory.consumableFilterToggleHide";
    const txt = typeof I18n !== "undefined" && I18n.t ? I18n.t(k) : k;
    btn.setAttribute("title", txt);
    btn.setAttribute("aria-label", txt);
  },

  toggleInventoryConsumableFilterVisibility() {
    const wrap = document.getElementById("inventory-consumable-filter-wrap");
    if (!wrap) return;
    const nextHidden = !wrap.hidden;
    if (!nextHidden) {
      this._collapseOtherInventoryFilterPanels("consumable");
    }
    wrap.hidden = nextHidden;
    wrap.style.display = nextHidden ? "none" : "inline-flex";
    if (nextHidden) {
      const sel = document.getElementById("inventory-consumable-filter");
      if (sel && sel.value !== "all") {
        sel.value = "all";
        this.render(this.search(document.getElementById("inventory-search")?.value || ""));
      }
    }
    this._syncInventoryConsumableFilterToggleUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
  },

  collapseInventoryFilterPanel(kind) {
    const map = {
      box: {
        wrapId: "inventory-box-filter-wrap",
        selId: "inventory-box-filter",
        sync: () => this._syncInventoryBoxFilterToggleUi()
      },
      depot: {
        wrapId: "inventory-depot-filter-wrap",
        selId: "inventory-depot-preset",
        sync: () => this._syncInventoryDepotFilterToggleUi()
      },
      consumable: {
        wrapId: "inventory-consumable-filter-wrap",
        selId: "inventory-consumable-filter",
        sync: () => this._syncInventoryConsumableFilterToggleUi()
      }
    };
    const m = map[kind];
    if (!m) return;
    const wrap = document.getElementById(m.wrapId);
    const sel = document.getElementById(m.selId);
    const searchVal = document.getElementById("inventory-search")?.value || "";
    if (!wrap || wrap.hidden) {
      if (sel && sel.value !== "all") {
        sel.value = "all";
        this.render(this.search(searchVal));
      }
      m.sync();
      this._syncInventoryHeaderFiltersCollapseBtn();
      return;
    }
    wrap.hidden = true;
    wrap.style.display = "none";
    let needsRender = false;
    if (sel && sel.value !== "all") {
      sel.value = "all";
      needsRender = true;
    }
    m.sync();
    if (needsRender) this.render(this.search(searchVal));
    this._syncInventoryHeaderFiltersCollapseBtn();
  },

  _renderBoxManagerSearchResults(query) {
    const results = document.getElementById("inventory-box-item-search-results");
    if (!results) return;
    const q = String(query || "").trim().toLowerCase();
    if (!q || q.length < 1) {
      results.classList.remove("active");
      results.innerHTML = "";
      return;
    }
    const matches = (this.items || [])
      .filter(it => {
        if (
          [it.code, it.description, it.category, it.location].some(v =>
            String(v || "")
              .toLowerCase()
              .includes(q)
          )
        ) {
          return true;
        }
        const qNum = /^\d{1,6}$/.test(q) ? parseInt(q, 10) : NaN;
        if (this._isValidBoxNumber(qNum)) {
          if (Utils.parseWarehouseBoxesFromLocation(it.location || "").includes(qNum)) return true;
          if ((it.boxStocks || []).some(b => parseInt(b.boxNumber, 10) === qNum)) return true;
        }
        return (it.boxStocks || []).some(b => String(b.boxNumber ?? "").toLowerCase().includes(q));
      })
      .slice(0, 40);
    if (!matches.length) {
      results.classList.add("active");
      results.innerHTML = `<div class="search-result-item no-results">${this.esc(I18n.t("msg.noResults"))}</div>`;
      return;
    }
    results.classList.add("active");
    results.innerHTML = matches
      .map(
        it => `<div class="search-result-item" data-item-id="${Utils.escapeAttr(String(it.id))}">
          <strong>${this.esc(it.code || "—")}</strong> — ${this.esc(it.description || "")}
          <small class="muted">${this.esc(it.category || "-")}</small>
        </div>`
      )
      .join("");
  },

  _renderBoxManagerRows() {
    const tbody = document.getElementById("inventory-box-item-body");
    const title = document.getElementById("inventory-box-item-title");
    if (!tbody) return;
    const item = this.getItemById(this._boxMgrItemId);
    if (title) title.textContent = item ? `${item.code || "—"} — ${item.description || ""}` : I18n.t("inventory.boxMgrNoItem");
    if (!item) {
      const rows = (this.standaloneBoxes || []).slice().sort((a, b) => a.boxNumber - b.boxNumber);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted">${this.esc(I18n.t("inventory.boxMgrNoItem"))}</td></tr>`;
        return;
      }
      tbody.innerHTML = rows
        .map(b => {
          const selected = String(document.getElementById("inventory-box-number")?.value || "") === String(b.boxNumber)
            ? " inv-box-mgr-row--selected"
            : "";
          return `<tr class="inv-box-mgr-row${selected}" data-standalone-box="${Utils.escapeAttr(String(b.boxNumber))}" tabindex="0" role="button" title="${this.esc(I18n.t("inventory.boxMgrRowClickHint"))}">
        <td><strong>${b.boxNumber}</strong><span class="inv-box-empty-badge">${this.esc(I18n.t("inventory.boxMgrBadgeEmpty"))}</span></td>
        <td class="inv-box-mgr-ubic-cell">${this.esc(String(b.locationLabel || "").trim() || "—")}</td>
        <td>0</td>
        <td>0</td>
        <td>${this.esc(String(b.notes || "").trim() || "-")}</td>
        <td>${this.esc(b.updatedAt ? Utils.formatDateTime(b.updatedAt) : "-")}</td>
        <td class="inv-box-mgr-actions-cell">—</td>
      </tr>`;
        })
        .join("");
      return;
    }
    const rows = this._normalizeItemBoxStocks(item).boxStocks || [];
    const inferredNums = Utils.parseWarehouseBoxesFromLocation(item.location || "");
    const byNumber = new Map(rows.map(b => [Number(b.boxNumber), b]));
    const unionNums = [...new Set([...rows.map(b => Number(b.boxNumber)), ...inferredNums])]
      .filter(n => this._isValidBoxNumber(n))
      .sort((a, b) => a - b);
    if (!unionNums.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">${this.esc(I18n.t("inventory.boxMgrEmpty"))}</td></tr>`;
      return;
    }
    const selId = this._boxMgrEditBoxId != null ? String(this._boxMgrEditBoxId) : "";
    const canEdit = this._canManageBoxMutations();
    const hintInferred = I18n.t("inventory.boxMgrRowInferredHint");
    tbody.innerHTML = unionNums
      .map(n => {
        const b = byNumber.get(n);
        if (b) {
          const bid = Utils.escapeAttr(String(b.boxId));
          const selected = selId && String(b.boxId) === selId ? " inv-box-mgr-row--selected" : "";
          const emptyBadge = b.empty
            ? `<span class="inv-box-empty-badge">${this.esc(I18n.t("inventory.boxMgrBadgeEmpty"))}</span>`
            : "";
          const ubicCol = this._snippetFromItemLocationForBox(item, b.boxNumber);
          const ubicShow = ubicCol
            ? this.esc(ubicCol)
            : this.esc(String(b.locationLabel || "").trim() || "—");
          const actionsHtml = canEdit
            ? `<button type="button" class="btn btn-sm btn-danger inv-box-del-btn" data-box-id="${bid}">${this.esc(
                I18n.t("inventory.boxMgrDeleteBtn")
              )}</button>`
            : "—";
          const rowRole = canEdit ? "button" : "row";
          const rowTitle = canEdit ? this.esc(I18n.t("inventory.boxMgrRowClickHint")) : "";
          return `<tr class="inv-box-mgr-row${selected}" data-box-id="${bid}" tabindex="0" role="${rowRole}" title="${rowTitle}">
        <td><strong>${b.boxNumber}</strong>${emptyBadge}</td>
        <td class="inv-box-mgr-ubic-cell">${ubicShow}</td>
        <td>${Utils.formatDecimalDisplay(b.qty || 0)}</td>
        <td>${Math.max(0, parseInt(b.qtyBoxes, 10) || 0)}</td>
        <td>${this.esc(b.notes || "-")}</td>
        <td>${this.esc(b.updatedAt ? Utils.formatDateTime(b.updatedAt) : "-")}</td>
        <td class="inv-box-mgr-actions-cell">
          ${actionsHtml}
        </td>
      </tr>`;
        }
        const nb = Utils.escapeAttr(String(n));
        const inferUb = this._snippetFromItemLocationForBox(item, n);
        const inferUbHtml = inferUb ? this.esc(inferUb) : "—";
        const inferredQty = this.getMovementInferredBoxAvailableQty(item.id, n);
        const perBox = Utils.roundDecimal(parseFloat(item.qtyPerBox) || 0);
        const inferredQtyBoxes = perBox > 0 ? Math.max(0, Math.round(inferredQty / perBox)) : 0;
        return `<tr class="inv-box-mgr-row inv-box-mgr-row--inferred muted" data-inferred-box="${nb}" tabindex="0" role="button" title="${this.esc(I18n.t("inventory.boxMgrRowInferredTitle"))}">
        <td><strong>${n}</strong> <span class="inv-box-inferred-badge">${this.esc(I18n.t("inventory.boxMgrInferredBadge"))}</span></td>
        <td class="inv-box-mgr-ubic-cell">${inferUbHtml}</td>
        <td>${this.esc(Utils.formatDecimalDisplay(inferredQty || 0))}</td>
        <td>${this.esc(String(inferredQtyBoxes))}</td>
        <td>${this.esc(hintInferred)}</td>
        <td>—</td>
        <td class="inv-box-mgr-actions-cell">—</td>
      </tr>`;
      })
      .join("");
  },

  openBoxManagerModal() {
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("invTools", "edit")) return false;
    const modal = document.getElementById("inventory-box-manager-modal");
    if (!modal) return false;
    this._resetBoxManagerBoxForm();
    const inp = document.getElementById("inventory-box-item-search");
    if (inp) inp.value = "";
    if (this._boxMgrItemId && !this.getItemById(this._boxMgrItemId)) this._boxMgrItemId = "";
    this._applyBoxManagerItemSelection();
    this._syncBoxManagerAccessUi();
    modal.classList.add("active");
    return true;
  },

  closeBoxManagerModal() {
    document.getElementById("inventory-box-manager-modal")?.classList.remove("active");
    this._resetBoxManagerBoxForm();
  },

  /** Filas CajasJson con cantidad 0 (ajuste / corrección en gestión por caja). */
  _collectZeroQtyBoxRows() {
    const rows = [];
    for (const item of this.items || []) {
      if (!item || !Array.isArray(item.boxStocks)) continue;
      for (const b of item.boxStocks) {
        const q = this._parseBoxStockQtyValue(b?.qty);
        if (q > 1e-9) continue;
        const n = parseInt(b?.boxNumber, 10);
        if (!this._isValidBoxNumber(n)) continue;
        rows.push({
          itemId: item.id,
          code: item.code || "",
          description: item.description || "",
          boxNumber: n,
          boxId: b.boxId,
          locationLabel: String(b.locationLabel || "").trim(),
          empty: !!b.empty,
          qty: q
        });
      }
    }
    rows.sort((a, b) => {
      const c = String(a.code).localeCompare(String(b.code), undefined, { sensitivity: "base" });
      if (c !== 0) return c;
      return a.boxNumber - b.boxNumber;
    });
    return rows;
  },

  _syncZeroBoxesToolbarBtn() {
    const btn = document.getElementById("inventory-zero-boxes-btn");
    if (!btn) return;
    const n = this._collectZeroQtyBoxRows().length;
    btn.dataset.zeroBoxCount = String(n);
    const baseTitle =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("inventory.zeroBoxesBtnTitle") : "";
    btn.title = n ? `${baseTitle} (${n})` : baseTitle;
    btn.setAttribute("aria-label", btn.title);
  },

  _renderZeroQtyBoxesModal() {
    const body = document.getElementById("inventory-zero-boxes-body");
    if (!body) return;
    const rows = this._collectZeroQtyBoxRows();
    const esc = s => this.esc(s);
    const fmt = v => Utils.formatDecimalDisplay(v);
    if (!rows.length) {
      body.innerHTML = `<p class="muted">${esc(I18n.t("inventory.zeroBoxesEmpty"))}</p>`;
      return;
    }
    const intro = `<p class="muted inventory-zero-boxes-intro">${esc(I18n.t("inventory.zeroBoxesIntro"))}</p>`;
    const th = k => `<th>${esc(I18n.t(k))}</th>`;
    const head = [
      "table.code",
      "table.description",
      "inventory.boxColNumber",
      "table.quantity",
      "inventory.boxColLocationLabel",
      "inventory.boxMgrBadgeEmpty"
    ];
    const tableRows = rows
      .map(r => {
        const rowAria = I18n.t("inventory.zeroBoxesRowAria")
          .replace("{code}", r.code || "—")
          .replace("{n}", String(r.boxNumber));
        const emptyCell = r.empty ? esc(I18n.t("inventory.boxMgrBadgeEmpty")) : "—";
        return `<tr class="inv-zero-box-row" tabindex="0" role="button" data-item-id="${Utils.escapeAttr(
          String(r.itemId)
        )}" data-box-number="${Utils.escapeAttr(String(r.boxNumber))}" aria-label="${Utils.escapeAttr(rowAria)}">
          <td class="app-code-copy-cell"><strong>${esc(r.code)}</strong></td>
          <td class="app-desc-copy-cell">${esc(r.description)}</td>
          <td>📦${r.boxNumber}</td>
          <td>${esc(fmt(r.qty))}</td>
          <td>${esc(r.locationLabel || "—")}</td>
          <td>${emptyCell}</td>
        </tr>`;
      })
      .join("");
    body.innerHTML = `${intro}
      <div class="inventory-table-container inventory-table-container--nested">
        <table class="inventory-table">
          <thead><tr>${head.map(th).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  },

  openZeroQtyBoxesModal() {
    const modal = document.getElementById("inventory-zero-boxes-modal");
    if (!modal) return;
    this._renderZeroQtyBoxesModal();
    if (typeof App !== "undefined" && typeof App._bringModalToFront === "function") {
      App._bringModalToFront(modal);
    }
    modal.classList.add("active");
  },

  closeZeroQtyBoxesModal() {
    document.getElementById("inventory-zero-boxes-modal")?.classList.remove("active");
  },

  _syncZeroTotalBoxToolbarBtn() {
    const btn = document.getElementById("inventory-box-zero-total-btn");
    if (!btn) return;
    const n = this._collectZeroTotalStockByBoxNumber().length;
    btn.dataset.zeroTotalBoxCount = String(n);
    const baseTitle =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("inventory.boxZeroTotalBtnTitle") : "";
    btn.title = n ? `${baseTitle} (${n})` : baseTitle;
    btn.setAttribute("aria-label", btn.title);
  },

  _renderZeroTotalStockByBoxModal() {
    const body = document.getElementById("inventory-box-zero-total-body");
    if (!body) return;
    const rows = this._collectZeroTotalStockByBoxNumber();
    const esc = s => this.esc(s);
    const fmt = v => Utils.formatDecimalDisplay(v);
    if (!rows.length) {
      body.innerHTML = `<p class="muted">${esc(I18n.t("inventory.boxZeroTotalEmpty"))}</p>`;
      return;
    }
    const intro = `<p class="muted inventory-box-zero-total-intro">${esc(I18n.t("inventory.boxZeroTotalIntro"))}</p>`;
    const th = k => `<th>${esc(I18n.t(k))}</th>`;
    const head = [
      "inventory.boxColNumber",
      "inventory.boxZeroTotalColSum",
      "inventory.boxZeroTotalColArticles",
      "inventory.boxZeroTotalColSituation"
    ];
    const kindLabel = key =>
      key === "no-json" ? I18n.t("inventory.boxZeroTotalKindNoJson") : I18n.t("inventory.boxZeroTotalKindZeroSum");
    const tableRows = rows
      .map(r => {
        const aria = I18n.t("inventory.boxZeroTotalRowAria")
          .replace("{n}", String(r.boxNumber))
          .replace("{sum}", fmt(r.totalQty));
        const situation = kindLabel(r.kindKey);
        const openId = r.openItemId ? Utils.escapeAttr(String(r.openItemId)) : "";
        return `<tr class="inv-box-zero-total-row" tabindex="0" role="button" data-box-number="${Utils.escapeAttr(
          String(r.boxNumber)
        )}" data-open-item-id="${openId}" aria-label="${Utils.escapeAttr(aria)}">
          <td><strong>📦${r.boxNumber}</strong></td>
          <td>${esc(fmt(r.totalQty))}</td>
          <td>${r.itemCount}</td>
          <td>${esc(situation)}</td>
        </tr>`;
      })
      .join("");
    body.innerHTML = `${intro}
      <div class="inventory-table-container inventory-table-container--nested">
        <table class="inventory-table">
          <thead><tr>${head.map(th).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  },

  openZeroTotalStockByBoxModal() {
    const modal = document.getElementById("inventory-box-zero-total-modal");
    if (!modal) return;
    this._renderZeroTotalStockByBoxModal();
    if (typeof App !== "undefined" && typeof App._bringModalToFront === "function") {
      App._bringModalToFront(modal);
    }
    modal.classList.add("active");
  },

  closeZeroTotalStockByBoxModal() {
    document.getElementById("inventory-box-zero-total-modal")?.classList.remove("active");
  },

  /** Abre la gestión de stock por caja en un artículo y caja concretos (público para enlaces UI). */
  openBoxManagerAtItemBox(itemId, boxNumber) {
    this._openBoxManagerAtItemBox(itemId, boxNumber);
  },

  async saveBoxManagerBoxFromForm() {
    if (!this._canManageBoxMutations()) {
      Utils.showToast(I18n.t("auth.noPermission"), "warning");
      return;
    }
    const itemId = this._boxMgrItemId;
    const boxNumber = parseInt(document.getElementById("inventory-box-number")?.value, 10);
    const qty = parseFloat(document.getElementById("inventory-box-qty")?.value) || 0;
    const qtyBoxes = parseInt(document.getElementById("inventory-box-qty-boxes")?.value, 10) || 0;
    const locationLabel = document.getElementById("inventory-box-location")?.value || "";
    const notes = document.getElementById("inventory-box-notes")?.value || "";
    const empty = !!document.getElementById("inventory-box-mark-empty")?.checked;
    const res = itemId
      ? this.upsertItemBoxStock(
          itemId,
          {
            boxId: this._boxMgrEditBoxId || undefined,
            boxNumber,
            qty,
            qtyBoxes,
            empty,
            locationLabel,
            notes
          },
          { syncMainStock: true }
        )
      : this.upsertStandaloneBox({
          boxNumber,
          locationLabel,
          notes
        });
    if (!res.ok) {
      Utils.showToast(
        I18n.t(
          res.reason === "invalid-location-catalog"
            ? "inventory.boxTransferLocationNotInCatalog"
            : "inventory.boxMgrInvalid"
        ),
        "error"
      );
      return;
    }
    if (
      itemId &&
      res.box &&
      typeof MovementManager !== "undefined" &&
      MovementManager.recordAjusteFromBoxManager
    ) {
      const dApplied = Utils.roundDecimal(parseFloat(res.deltaApplied) || 0);
      if (Math.abs(dApplied) > 1e-9) {
        const invIt = this.getItemById(itemId);
        if (invIt && !invIt.inventoryConsumable) {
          let reasonExtra = "";
          if (typeof App !== "undefined" && App.showPrompt) {
            const reason = await App.showPrompt({
              message: I18n.t("movements.editorAjusteReasonPrompt"),
              defaultValue: "",
              inputType: "text"
            });
            if (reason != null && String(reason).trim()) reasonExtra = String(reason).trim();
          }
          const baseNote = I18n.t("movements.boxMgrAjusteNote");
          const movNotes = reasonExtra
            ? `${baseNote}\n\n${I18n.t("movements.editorAjusteReasonLabel")}: ${reasonExtra}`
            : baseNote;
          MovementManager.recordAjusteFromBoxManager({
            itemId,
            boxId: res.box.boxId,
            boxNumber: res.box.boxNumber,
            deltaBox: dApplied,
            notes: movNotes
          });
        }
      }
    }
    this._resetBoxManagerBoxForm();
    this._applyBoxManagerItemSelection();
    Utils.showToast(I18n.t("inventory.boxMgrSaved"), "success");
  },

  /** Carga una caja en el formulario inferior (mismo efecto que antes tenía el botón Editar). */
  _loadBoxIntoManagerForm(box) {
    if (!box) return;
    this._boxMgrEditBoxId = box.boxId;
    document.getElementById("inventory-box-number").value = String(box.boxNumber || "");
    document.getElementById("inventory-box-qty").value = String(box.qty || 0);
    document.getElementById("inventory-box-qty-boxes").value = String(Math.max(0, parseInt(box.qtyBoxes, 10) || 0));
    document.getElementById("inventory-box-location").value = box.locationLabel || "";
    document.getElementById("inventory-box-notes").value = box.notes || "";
    const cb = document.getElementById("inventory-box-mark-empty");
    if (cb) cb.checked = !!box.empty;
    this._syncEmptyCheckboxUi();
    this._syncBoxManagerFormUi();
    document.querySelector(".inventory-box-mgr-form-hint")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  handleBoxManagerTableClick(e) {
    const canEdit = this._canManageBoxMutations();
    const inferredRow = e.target.closest("tr[data-inferred-box]");
    if (canEdit && inferredRow && !e.target.closest(".inv-box-del-btn")) {
      const item = this.getItemById(this._boxMgrItemId);
      if (!item) return;
      const n = parseInt(inferredRow.getAttribute("data-inferred-box"), 10);
      if (!this._isValidBoxNumber(n)) return;
      this._boxMgrEditBoxId = null;
      document.getElementById("inventory-box-number").value = String(n);
      document.getElementById("inventory-box-qty").value = "0";
      document.getElementById("inventory-box-qty-boxes").value = "0";
      document.getElementById("inventory-box-location").value = "";
      document.getElementById("inventory-box-notes").value = "";
      const cb = document.getElementById("inventory-box-mark-empty");
      if (cb) cb.checked = false;
      this._syncEmptyCheckboxUi();
      this._syncBoxManagerFormUi();
      this._renderBoxManagerRows();
      document.querySelector(".inventory-box-mgr-form-hint")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const del = canEdit ? e.target.closest(".inv-box-del-btn[data-box-id]") : null;
    if (del) {
      e.stopPropagation();
    }
    const row = !del && e.target.closest("tr.inv-box-mgr-row[data-box-id]");
    const standaloneRow = !del && e.target.closest("tr.inv-box-mgr-row[data-standalone-box]");
    if (!del && !row && !standaloneRow) return;
    if (standaloneRow && !this._boxMgrItemId) {
      const n = parseInt(standaloneRow.getAttribute("data-standalone-box"), 10);
      if (!this._isValidBoxNumber(n)) return;
      const b = (this.standaloneBoxes || []).find(x => Number(x.boxNumber) === n);
      if (!b) return;
      this._boxMgrEditBoxId = null;
      document.getElementById("inventory-box-number").value = String(b.boxNumber || "");
      document.getElementById("inventory-box-qty").value = "0";
      document.getElementById("inventory-box-qty-boxes").value = "0";
      document.getElementById("inventory-box-location").value = b.locationLabel || "";
      document.getElementById("inventory-box-notes").value = b.notes || "";
      const cb = document.getElementById("inventory-box-mark-empty");
      if (cb) cb.checked = true;
      this._syncEmptyCheckboxUi();
      this._syncBoxManagerFormUi();
      this._renderBoxManagerRows();
      return;
    }
    const item = this.getItemById(this._boxMgrItemId);
    if (!item) return;
    const boxId = (del || row).getAttribute("data-box-id");
    const box = (item.boxStocks || []).find(b => String(b.boxId) === String(boxId));
    if (!box) return;
    if (row) {
      this._loadBoxIntoManagerForm(box);
      this._renderBoxManagerRows();
      return;
    }
    const doDelete = () => {
      const res = this.deleteItemBoxStock(item.id, box.boxId, false);
      if (!res.ok) {
        Utils.showToast(I18n.t("inventory.boxMgrDeleteWithStock"), "warning");
        return;
      }
      if (String(this._boxMgrEditBoxId || "") === String(box.boxId)) this._resetBoxManagerBoxForm();
      this._applyBoxManagerItemSelection();
      Utils.showToast(I18n.t("inventory.boxMgrDeleted"), "success");
    };
    if (typeof App !== "undefined" && App.showConfirm) {
      App.showConfirm(I18n.t("confirm.deleteBoxStock"), doDelete);
    } else if (window.confirm(I18n.t("confirm.deleteBoxStock"))) {
      doDelete();
    }
  },

  transferBoxManagerStock() {
    if (!this._canManageBoxMutations()) {
      Utils.showToast(I18n.t("auth.noPermission"), "warning");
      return;
    }
    const itemId = this._boxMgrItemId;
    const fromId = document.getElementById("inventory-box-transfer-from")?.value || "";
    const toId = document.getElementById("inventory-box-transfer-to")?.value || "";
    const qty = parseFloat(document.getElementById("inventory-box-transfer-qty")?.value) || 0;
    const fk = _boxXferKind(fromId);
    const tk = _boxXferKind(toId);
    const toLocation =
      tk === "box" || tk === "loc" ? document.getElementById("inventory-box-transfer-location")?.value || "" : "";
    if (!itemId || !fromId || !toId || fromId === toId || qty <= 0) {
      Utils.showToast(I18n.t("inventory.boxTransferInvalid"), "error");
      return;
    }
    let res;
    let toIdResolved = toId;
    const parseLocRow = id => {
      try {
        return decodeURIComponent(String(id || "").slice(4));
      } catch (e) {
        return "";
      }
    };
    if (String(toIdResolved).startsWith("gbox:")) {
      const n = parseInt(String(toIdResolved).slice(5), 10);
      if (!this._isValidBoxNumber(n)) {
        Utils.showToast(I18n.t("inventory.boxTransferInvalid"), "error");
        return;
      }
      const item = this.getItemById(itemId);
      const exists = (item?.boxStocks || []).find(b => Number(b.boxNumber) === n);
      if (exists && exists.boxId) {
        toIdResolved = String(exists.boxId);
      } else {
        const created = this.upsertItemBoxStock(
          itemId,
          {
            boxNumber: n,
            qty: 0,
            qtyBoxes: 0,
            empty: false,
            locationLabel: toLocation || "",
            notes: ""
          },
          { silent: true }
        );
        if (!created?.ok || !created?.box?.boxId) {
          Utils.showToast(I18n.t("inventory.boxTransferInvalid"), "error");
          return;
        }
        toIdResolved = String(created.box.boxId);
      }
    }

    if (fk === "box" && tk === "box") {
      res = this.transferBetweenBoxes(itemId, fromId, toIdResolved, qty, toLocation);
    } else if (fk === "mainpool" && tk === "box") {
      res = this.transferMainPoolToBox(itemId, toIdResolved, qty, toLocation);
    } else if (fk === "box" && tk === "mainpool") {
      res = this.transferBoxToMainPool(itemId, fromId, qty);
    } else if (fk === "mainpool" && tk === "loc") {
      res = this.transferMainPoolToLocation(itemId, toLocation, qty);
    } else if (fk === "mainpool" && tk === "locrow") {
      res = this.transferMainPoolToLocation(itemId, parseLocRow(toId), qty);
    } else if (fk === "locrow" && tk === "mainpool") {
      res = this._consumeLocationStock(this.getItemById(itemId), parseLocRow(fromId), qty);
    } else if (fk === "box" && tk === "loc") {
      res = this.transferBoxToLocation(itemId, fromId, qty, toLocation);
    } else if (fk === "box" && tk === "locrow") {
      res = this.transferBoxToLocation(itemId, fromId, qty, parseLocRow(toId));
    } else if (fk === "box" && tk === "prod") {
      res = this.transferBoxToProdStock(itemId, fromId, qty);
    } else if (fk === "prod" && tk === "box") {
      res = this.transferProdStockToBox(itemId, toIdResolved, qty, toLocation);
    } else if (fk === "prod" && tk === "locrow") {
      // Paso intermedio: prod -> caja no aplica para ubicación directa.
      res = { ok: false, reason: "invalid-transfer" };
    } else if (fk === "box" && tk === "trans") {
      res = this.transferBoxToTransStock(itemId, fromId, qty);
    } else if (fk === "trans" && tk === "box") {
      res = this.transferTransStockToBox(itemId, toIdResolved, qty, toLocation);
    } else if (fk === "trans" && tk === "locrow") {
      res = { ok: false, reason: "invalid-transfer" };
    } else if (fk === "locrow" && tk === "box") {
      res = this.transferLocationToBox(itemId, parseLocRow(fromId), toIdResolved, qty, toLocation);
    } else if (fk === "locrow" && tk === "loc") {
      res = this.transferLocationToLocation(itemId, parseLocRow(fromId), toLocation, qty);
    } else if (fk === "locrow" && tk === "locrow") {
      res = this.transferLocationToLocation(itemId, parseLocRow(fromId), parseLocRow(toId), qty);
    } else if (fk === "locrow" && tk === "prod") {
      res = this.transferLocationToProdStock(itemId, parseLocRow(fromId), qty);
    } else if (fk === "locrow" && tk === "trans") {
      res = this.transferLocationToTransStock(itemId, parseLocRow(fromId), qty);
    } else if (fk === "prod" && tk === "trans") {
      res = this.transferProdToTransStock(itemId, qty);
    } else if (fk === "trans" && tk === "prod") {
      res = this.transferTransToProdStock(itemId, qty);
    } else {
      Utils.showToast(I18n.t("inventory.boxTransferInvalid"), "error");
      return;
    }
    if (!res.ok) {
      const key =
        res.reason === "prod-overdraft"
            ? "inventory.boxTransferInsufficientProd"
            : res.reason === "trans-overdraft"
              ? "inventory.boxTransferInsufficientTrans"
              : res.reason === "box-overdraft"
                ? "inventory.boxTransferInsufficientBox"
                : res.reason === "location-required"
                  ? "inventory.boxTransferLocationRequired"
                  : res.reason === "invalid-location-catalog"
                    ? "inventory.boxTransferLocationNotInCatalog"
                    : res.reason === "insufficient-pool" || res.reason === "location-overdraft" || res.reason === "location-not-found"
                      ? "inventory.boxTransferInsufficientPool"
                    : res.reason === "box-empty"
                      ? "inventory.boxTransferBoxEmpty"
                      : "inventory.boxTransferInvalid";
      Utils.showToast(I18n.t(key), "error");
      return;
    }
    const tq = document.getElementById("inventory-box-transfer-qty");
    if (tq) tq.value = "0";
    const tloc = document.getElementById("inventory-box-transfer-location");
    if (tloc) tloc.value = "";
    this._applyBoxManagerItemSelection();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    Utils.showToast(I18n.t("inventory.boxTransferDone"), "success");
  },

  async exportBoxStockTemplate() {
    const headers = [...BOX_STOCK_SHEET_HEADERS];
    const rows = [
      { Codigo: "ART-001", Caja: 1, UbicacionCaja: "BOX1", CantidadCaja: 10, CantidadCajas: 1, Vacia: 0 }
    ];
    await Utils.exportStyledXlsxToInformFolder(`GNEEX_BoxStock_Template_${this._fileStamp()}.xlsx`, headers, rows, {
      kind: "inventory_box_stock_template",
      title: I18n.t("inventory.boxTemplateTitle"),
      details: [
        I18n.t("inventory.boxStockManifestSheetDatos"),
        I18n.t("inventory.boxStockManifestColCodigo"),
        I18n.t("inventory.boxStockManifestColCaja"),
        I18n.t("inventory.boxStockManifestColUbicacion"),
        I18n.t("inventory.boxStockManifestColCantidad"),
        I18n.t("inventory.boxStockManifestColQtyBoxes"),
        I18n.t("inventory.boxStockManifestColEmpty"),
        I18n.t("export.manifest.templateOneExampleRow")
      ]
    });
  },

  /** Exporta todo el stock por caja en el mismo formato que la plantilla (reimportable tal cual). */
  async exportBoxStockData() {
    const headers = [...BOX_STOCK_SHEET_HEADERS];
    const rows = [];
    for (const it of this.items || []) {
      const code = String(it.code || "").trim();
      if (!code) continue;
      for (const b of it.boxStocks || []) {
        const n = parseInt(b.boxNumber, 10);
        if (!Number.isFinite(n)) continue;
        rows.push({
          Codigo: code,
          Caja: n,
          UbicacionCaja: String(b.locationLabel || "").trim(),
          CantidadCaja: Utils.roundDecimal(parseFloat(b.qty) || 0),
          CantidadCajas: Math.max(0, parseInt(b.qtyBoxes, 10) || 0),
          Vacia: b.empty ? 1 : 0
        });
      }
    }
    if (!rows.length) {
      Utils.showToast(I18n.t("inventory.boxExportEmpty"), "info");
      return;
    }
    rows.sort((a, b) => {
      const c = String(a.Codigo).localeCompare(String(b.Codigo), undefined, { sensitivity: "base" });
      if (c !== 0) return c;
      return (parseInt(a.Caja, 10) || 0) - (parseInt(b.Caja, 10) || 0);
    });
    await Utils.exportStyledXlsxToInformFolder(`GNEEX_BoxStock_Export_${this._fileStamp()}.xlsx`, headers, rows, {
      kind: "inventory_box_stock_export",
      title: I18n.t("inventory.boxExportTitle"),
      details: [
        I18n.t("inventory.boxStockManifestSheetDatos"),
        I18n.t("inventory.boxStockManifestColCodigo"),
        I18n.t("inventory.boxStockManifestColCaja"),
        I18n.t("inventory.boxStockManifestColUbicacion"),
        I18n.t("inventory.boxStockManifestColCantidad"),
        I18n.t("inventory.boxStockManifestColQtyBoxes"),
        I18n.t("inventory.boxStockManifestColEmpty")
      ]
    });
  },

  /**
   * Agrupa filas de una hoja tipo plantilla de cajas / Libro (mismas reglas que importBoxStockTemplate).
   * @returns {Record<string, { code: string, boxNumber: number, qty: number, qtyBoxes: number, locationLabel: string, empty: boolean }>}
   */
  _aggregateBoxStockImportRows(rows, codeMap) {
    const agg = {};
    const aliasCode = [
      "Codigo",
      "Código",
      "Code",
      "CODE",
      "SKU",
      "Articulo",
      "Artículo",
      "Item",
      "Cod",
      "CODIGO",
      "Referencia",
      "Ref",
      "CodigoArticulo",
      "CódigoArtículo",
      "Article",
      "Référence",
      "Reference"
    ];
    const aliasBox = [
      "CODE BOX",
      "Code Box",
      "CODEBOX",
      "Caja",
      "Box",
      "BOX",
      "NumeroCaja",
      "NroCaja",
      "CajaNumero",
      "BoxNumber",
      "NBox"
    ];
    const aliasQtyUnits = [
      "LAST COUNT",
      "Last Count",
      "LastCount",
      "QUANTITY",
      "Quantity",
      "UltimoConteo",
      "ÚltimoConteo",
      "Ultimo Conteo",
      "CompteFinal",
      "Compte Final",
      "CantidadCaja",
      "Cantidad",
      "Qty",
      "StockCaja",
      "CajaQty",
      "Cant",
      "Saldo",
      "Stock"
    ];
    const aliasQtyExcludedFromPick = new Set([
      "qtyboxes",
      "qtybox",
      "qtboxes",
      "numerodecajas",
      "numcajas",
      "difference",
      "differenceqty",
      "acciones",
      "action",
      "dernierproject",
      "dernierprojet",
      "cantidadcajas",
      "codebox",
      "description",
      "decription"
    ]);
    const aliasLocation = ["UbicacionCaja", "UbicaciónCaja", "Ubicacion", "Ubicación", "Location", "BoxLocation"];
    /** Texto libre: última cantidad tomada de la caja / proyecto (no es ubicación de ranura). → `boxStocks[].notes` */
    const aliasDernierPickMeta = [
      "DERNIER PROJECT",
      "Dernier Project",
      "Dernier projet",
      "Ultimo Proyecto",
      "Último Proyecto",
      "Last Pick Project",
      "Ultimo proyecto caja",
      "Ultima toma proyecto"
    ];
    const aliasQtyBoxes = [
      "QTY BOXES",
      "Qty Boxes",
      "QTYBOXES",
      "CantidadCajas",
      "NumCajas",
      "NroCajas",
      "Cajas",
      "NbCaisse",
      "NombreCajas"
    ];
    const aliasEmpty = ["Vacia", "Vacía", "Empty", "CajaVacia", "CajaVacía", "IsEmpty", "EstadoCaja"];
    const parseEmptyFlag = raw => {
      const t = String(raw ?? "").trim().toLowerCase();
      if (!t) return false;
      return ["1", "true", "yes", "si", "sí", "oui", "x", "empty", "vacia", "vacía"].includes(t);
    };
    const parseQtyBoxesLocal = raw => {
      const t = String(raw ?? "").trim();
      if (!t || t === "?" || t === "-") return 0;
      const n = parseInt(t, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    for (let idx = 0; idx < (rows || []).length; idx++) {
      const r = rows[idx] || {};
      const rowValues = Object.values(r || {}).map(v => String(v ?? "").trim());
      const isBlankRow = rowValues.every(v => !v);
      if (isBlankRow) continue;
      const emptyInf = this._inferBoxStockFromEmptyKeyedRow(r, codeMap);
      if (emptyInf?.ignore) continue;
      let codeRaw = "";
      let boxRaw = "";
      let qtyRaw = "";
      let qtyBoxesRaw = "";
      let emptyRaw = "";
      let locationRaw = "";
      let pickMetaRaw = "";
      if (emptyInf && !emptyInf.ignore) {
        codeRaw = emptyInf.codeRaw;
        boxRaw = emptyInf.boxRaw;
        qtyRaw = emptyInf.qtyRaw;
        qtyBoxesRaw = emptyInf.qtyBoxesRaw != null ? emptyInf.qtyBoxesRaw : "";
        emptyRaw = "";
        locationRaw = String(emptyInf.locationRaw || "").trim();
        pickMetaRaw = String(emptyInf.pickMetaRaw || "").trim();
      } else {
        codeRaw =
          this._pickImportValue(r, aliasCode) ||
          this._pickCodeValueFromRowByKnownItems(r, codeMap);
        boxRaw = this._pickImportValue(r, aliasBox) || this._pickBoxValueFromRow(r);
        qtyRaw =
          this._firstCsvField(r, [
            "CantidadCaja",
            "Cantidad Caja",
            "Cantidad_Unidades",
            "QtyCaja",
            "StockCaja",
            "UnidadesCaja"
          ]) ||
          this._pickImportQtyByAliasOrder(r, aliasQtyUnits, aliasQtyExcludedFromPick) ||
          this._pickQtyValueFromRow(r, codeRaw, boxRaw, aliasQtyExcludedFromPick);
        qtyBoxesRaw = this._pickImportQtyByAliasOrder(r, aliasQtyBoxes, new Set());
        emptyRaw = this._pickImportValue(r, aliasEmpty);
        locationRaw = String(this._pickImportValue(r, aliasLocation) || "").trim();
        pickMetaRaw = String(this._pickImportValue(r, aliasDernierPickMeta) || "").trim();
      }
      if (!locationRaw) locationRaw = String(this._pickImportValue(r, aliasLocation) || "").trim();
      if (!pickMetaRaw) pickMetaRaw = String(this._pickImportValue(r, aliasDernierPickMeta) || "").trim();
      const code = this._normalizeImportCodeValue(
        codeRaw !== undefined && codeRaw !== null ? String(codeRaw).trim() : ""
      );
      const boxNumber = this._parseImportBoxNumber(boxRaw);
      const markEmpty = parseEmptyFlag(emptyRaw);
      let qty = NaN;
      if (markEmpty) qty = 0;
      else {
        const qs = qtyRaw != null ? String(qtyRaw).trim() : "";
        if (qs === "" || qs === "?" || qs === "-") qty = NaN;
        else {
          qty = this._parseBoxStockQtyValue(qtyRaw);
          if (!Number.isFinite(qty)) qty = NaN;
        }
      }
      if (!code) continue;
      if (!this._isValidBoxNumber(boxNumber)) continue;
      if (!markEmpty && !(Number.isFinite(qty) && qty >= 0)) continue;
      const qtyBoxes = parseQtyBoxesLocal(qtyBoxesRaw);

      const key = `${code}__${boxNumber}`;
      if (!agg[key])
        agg[key] = { code, boxNumber, qty: 0, qtyBoxes: 0, locationLabel: "", empty: false, pickMeta: "" };
      if (markEmpty) {
        agg[key].empty = true;
        agg[key].qty = 0;
        agg[key].qtyBoxes = 0;
        if (!agg[key].locationLabel) agg[key].locationLabel = locationRaw || "";
        if (pickMetaRaw && !agg[key].pickMeta) agg[key].pickMeta = pickMetaRaw;
        continue;
      }
      if (agg[key].empty) continue;
      agg[key].qty = Utils.roundDecimal((agg[key].qty || 0) + qty);
      agg[key].qtyBoxes = (agg[key].qtyBoxes || 0) + qtyBoxes;
      if (!agg[key].locationLabel) agg[key].locationLabel = locationRaw || "";
      if (pickMetaRaw) {
        agg[key].pickMeta = agg[key].pickMeta
          ? `${agg[key].pickMeta} · ${pickMetaRaw}`
          : pickMetaRaw;
      }
    }
    return agg;
  },

  /** Incorpora agregado de caja sobre ítems ya construidos (importación inicial multi-hoja). */
  _applyBoxStockAggToItems(items, agg) {
    const byCode = new Map();
    for (const it of items || []) {
      const k = this._normalizeImportCodeValue(it.code);
      if (k) byCode.set(k, it);
    }
    for (const row of Object.values(agg || {})) {
      const item = byCode.get(row.code);
      if (!item) continue;
      item.boxStocks = Array.isArray(item.boxStocks) ? item.boxStocks : [];
      const n = row.boxNumber;
      const idx = item.boxStocks.findIndex(b => parseInt(b.boxNumber, 10) === n);
      const boxId = idx >= 0 ? item.boxStocks[idx].boxId : `box-${n}-${Utils.generateId().slice(0, 8)}`;
      const rawLab = String(row.locationLabel || "").trim();
      const locLab =
        typeof Utils.resolveImportLocationLabel === "function"
          ? Utils.resolveImportLocationLabel(rawLab)
          : Utils.strictEffectiveWarehouseLocationText(rawLab);
      const prevNotes = idx >= 0 ? String(item.boxStocks[idx].notes || "").trim() : "";
      const meta = String(row.pickMeta || "").trim();
      const notesOut = [prevNotes, meta].filter(Boolean).join("\n");
      const next = {
        boxId,
        boxNumber: n,
        locationLabel: locLab || "",
        qty: row.empty ? 0 : Utils.roundDecimal(row.qty),
        qtyBoxes: row.empty ? 0 : Math.max(0, parseInt(row.qtyBoxes, 10) || 0),
        empty: !!row.empty,
        notes: notesOut,
        updatedAt: new Date().toISOString()
      };
      if (idx >= 0) item.boxStocks[idx] = next;
      else item.boxStocks.push(next);
    }
  },

  /** Stock por ubicación desde hoja adicional (Codigo + ubicación catálogo + cantidad). */
  _mergeLocationStockSheetIntoItems(items, rows) {
    const aliasCode = [
      "Codigo",
      "Código",
      "Code",
      "SKU",
      "Articulo",
      "Artículo",
      "Item",
      "Cod",
      "Referencia",
      "Ref"
    ];
    const aliasLoc = [
      "UbicacionAlmacen",
      "UbicaciónAlmacen",
      "UbicacionStock",
      "Ranura",
      "Slot",
      "Pasillo",
      "PasilloRack",
      "Estante",
      "Ubicacion",
      "Ubicación",
      "Location",
      "Almacen",
      "Deposito"
    ];
    const aliasQty = ["CantidadUbicacion", "Cantidad", "Qty", "Stock", "Saldo", "Quantity", "Units", "LAST COUNT"];
    const byCode = new Map();
    for (const it of items || []) {
      const k = this._normalizeImportCodeValue(it.code);
      if (k) byCode.set(k, it);
    }
    let nApp = 0;
    for (const r of rows || []) {
      const codeRaw = this._pickImportValue(r, aliasCode);
      const code = this._normalizeImportCodeValue(codeRaw);
      if (!code) continue;
      const item = byCode.get(code);
      if (!item) continue;
      const locRaw = this._pickImportValue(r, aliasLoc);
      const loc =
        typeof Utils.resolveImportLocationLabel === "function"
          ? Utils.resolveImportLocationLabel(locRaw)
          : Utils.strictEffectiveWarehouseLocationText(String(locRaw || "").trim());
      if (!loc) continue;
      const qtyRaw = this._pickImportValue(r, aliasQty);
      const qty = this._parseBoxStockQtyValue(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!Array.isArray(item.locationStocks)) item.locationStocks = [];
      const idx = item.locationStocks.findIndex(x => String(x.location).toUpperCase() === loc.toUpperCase());
      const entry = { location: loc, qty: Utils.roundDecimal(qty), updatedAt: new Date().toISOString() };
      if (idx < 0) item.locationStocks.push(entry);
      else item.locationStocks[idx] = entry;
      nApp++;
    }
    return nApp;
  },

  _xlsxSheetHasEmptyKeyedLibroRows(rows) {
    return (rows || []).some(r => r && Object.keys(r).some(k => /^__EMPTY/.test(k)));
  },

  _xlsxSheetHeaderNorms(rows) {
    const r = (rows || []).find(x => x && Object.keys(x || {}).length) || {};
    return new Set(Object.keys(r).map(k => this._normalizeImportHeaderName(k)));
  },

  /** Hoja de artículos (Codigo + StockPrincipal / descripción), no hoja solo de cajas. */
  _xlsxSheetLooksLikeMainInventory(rows) {
    const norms = this._xlsxSheetHeaderNorms(rows);
    if (!norms.size) return false;
    const keys = [...norms];
    const hasStockPrincipal = keys.some(n => /stockprincipal/.test(n));
    const hasCode = keys.some(n => /codigo|^code$|sku|articulo/.test(n));
    const hasDesc = keys.some(n => /descripcion|description|desc|decription/.test(n));
    return hasStockPrincipal || (hasCode && hasDesc);
  },

  _xlsxSheetLooksLikeBoxStock(name, rows) {
    const sn = String(name || "").toLowerCase();
    if (/caja|box|bin|stockcaja|libro/i.test(sn) && !/ubicacion/i.test(sn)) return true;
    if (this._xlsxSheetHasEmptyKeyedLibroRows(rows)) return true;
    const norms = this._xlsxSheetHeaderNorms(rows);
    if (!norms.size) return false;
    const hasCode = [...norms].some(n => /codigo|code|sku|articulo|item|referencia|ref/.test(n));
    const hasBox = [...norms].some(
      n =>
        n === "caja" ||
        n === "box" ||
        n === "codebox" ||
        n.includes("codebox") ||
        n.includes("numerocaja") ||
        n.includes("nrocaja") ||
        (n.includes("caja") && !n.includes("ubicacion"))
    );
    const hasQty = [...norms].some(
      n =>
        /cantidad|qty|quantity|stock|saldo|count|conteo|compte|lastcount|last count|difference/.test(n) &&
        !/qtyboxes|cantidadcajas|numerocajas|ncajas|nombre/.test(n)
    );
    return hasCode && hasBox && hasQty;
  },

  _xlsxSheetLooksLikeLocationStock(name, rows) {
    const sn = String(name || "").toLowerCase();
    if (/ubicacion|ubicaciones|locacion|stock.*ubic|ubic.*stock|rack/.test(sn)) return true;
    const norms = this._xlsxSheetHeaderNorms(rows);
    if (!norms.size) return false;
    const hasCode = [...norms].some(n => /codigo|code|sku|articulo|item/.test(n));
    const hasLoc = [...norms].some(
      n =>
        /ubicacion|ubicación|location|pasillo|ranura|slot|rack|estante|depot|depósito|almacen|magasin/.test(n) &&
        !/ubicacioncaja/i.test(String(n))
    );
    const hasQty = [...norms].some(n => /cantidad|qty|stock|saldo|quantity|units/.test(n));
    return hasCode && hasLoc && hasQty && !this._xlsxSheetLooksLikeBoxStock("", rows);
  },

  importBoxStockTemplate(file) {
    if (!file) return;
    Utils.importDataCSV(file, "__tmp_box_stock__", parsed => {
      localStorage.removeItem("__tmp_box_stock__");
      const rows = Array.isArray(parsed) ? parsed : [];
      let applied = 0;
      let skipped = 0;
      const skippedRows = [];
      const codeMap = {};
      for (const it of this.items || []) {
        const k = this._normalizeImportCodeValue(it.code);
        if (k) codeMap[k] = it;
      }
      const agg = this._aggregateBoxStockImportRows(rows, codeMap);
      for (const row of Object.values(agg)) {
        const { code, boxNumber, qty, qtyBoxes, locationLabel, empty } = row;
        const item = (this.items || []).find(i => String(i.code || "").trim().toLowerCase() === code);
        if (!item) {
          skipped++;
          skippedRows.push({ row: "-", reason: "code-not-found", code });
          continue;
        }
        const existing = (item.boxStocks || []).find(b => parseInt(b.boxNumber, 10) === boxNumber);
        const boxId = existing ? existing.boxId : undefined;
        const res = this.upsertItemBoxStock(
          item.id,
          { boxId, boxNumber, qty, qtyBoxes, locationLabel, empty: !!empty },
          { silent: true, syncMainStock: true }
        );
        if (res.ok) applied++;
        else {
          skipped++;
          skippedRows.push({ row: "-", reason: "upsert-failed", code, boxNumber, qty });
        }
      }
      this._applyBoxManagerItemSelection();
      const skipReasonCounts = {};
      for (const s of skippedRows) {
        const r = s.reason || "unknown";
        skipReasonCounts[r] = (skipReasonCounts[r] || 0) + 1;
      }
      const skipBreakdown =
        skippedRows.length > 0
          ? Object.entries(skipReasonCounts)
              .map(([reason, n]) => `${reason}=${n}`)
              .join(", ")
          : "";
      let summary =
        I18n.t("inventory.boxImportDone").replace("{n}", String(applied)) +
        (skipped ? ` · ${I18n.t("inventory.boxImportSkipped").replace("{n}", String(skipped))}` : "");
      if (skipBreakdown) summary += ` (${skipBreakdown})`;
      const report = {
        summary,
        applied,
        skipped,
        skipReasonCounts,
        skippedRows
      };
      if (typeof window !== "undefined") {
        window.__gneexLastBoxImportReport = report;
      }
      Utils.showToast(summary, skipped ? "warning" : "success");
      if (skippedRows.length && typeof window !== "undefined" && window.__GNEEX_DEBUG) {
        console.group("G-NEEX Box Import Report");
        console.log("Resumen:", summary);
        console.log("Por motivo:", skipReasonCounts);
        console.table(skippedRows.slice(0, 50));
        console.log("Copiar informe completo: copy(window.__gneexLastBoxImportReport)");
        console.groupEnd();
      }
    }, { silentToast: true });
  },

  _normalizeImportCodeValue(v) {
    return String(v || "").trim().toLowerCase();
  },

  _normalizeImportHeaderName(v) {
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
  },

  _pickImportValue(row, aliases) {
    const keys = Object.keys(row || {});
    if (!keys.length) return "";
    const wanted = new Set((aliases || []).map(a => this._normalizeImportHeaderName(a)));
    for (const k of keys) {
      if (wanted.has(this._normalizeImportHeaderName(k))) return row[k];
    }
    return "";
  },

  /** Resuelve cantidad de unidades respetando el orden de alias (p. ej. LAST COUNT antes que Cantidad). */
  _pickImportQtyByAliasOrder(row, orderedAliases, excludeNormSet) {
    const keys = Object.keys(row || {});
    if (!keys.length || !orderedAliases?.length) return "";
    const ex = excludeNormSet instanceof Set ? excludeNormSet : new Set();
    const nk = k => this._normalizeImportHeaderName(k);
    const keyByNorm = new Map();
    for (const k of keys) keyByNorm.set(nk(k), k);
    for (const alias of orderedAliases) {
      const norm = nk(alias);
      if (ex.has(norm)) continue;
      const k = keyByNorm.get(norm);
      if (k === undefined) continue;
      const v = row[k];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s || s === "?" || s === "-") continue;
      return v;
    }
    return "";
  },

  _pickCodeValueFromRowByKnownItems(row, codeMap) {
    const vals = Object.values(row || {});
    for (const raw of vals) {
      const k = this._normalizeImportCodeValue(raw);
      if (k && codeMap[k]) return raw;
    }
    return "";
  },

  _parseImportBoxNumber(raw) {
    const direct = parseInt(raw, 10);
    if (this._isValidBoxNumber(direct)) return direct;
    const fromTxt = Utils.parseWarehouseBoxFromLocation(raw || "");
    return Number.isFinite(fromTxt) ? fromTxt : NaN;
  },

  _pickBoxValueFromRow(row) {
    const vals = Object.values(row || {});
    for (const raw of vals) {
      const n = this._parseImportBoxNumber(raw);
      if (this._isValidBoxNumber(n)) return n;
    }
    return "";
  },

  _pickQtyValueFromRow(row, codeRaw, boxRaw, excludeHeaderNormSet) {
    const codeNorm = this._normalizeImportCodeValue(codeRaw);
    const boxNorm = String(boxRaw || "").trim();
    const ex = excludeHeaderNormSet instanceof Set ? excludeHeaderNormSet : null;
    const keys = Object.keys(row || {});
    for (const k of keys) {
      if (ex && ex.has(this._normalizeImportHeaderName(k))) continue;
      const raw = row[k];
      const s = String(raw ?? "").trim();
      if (!s) continue;
      if (this._normalizeImportCodeValue(s) === codeNorm) continue;
      if (s === boxNorm) continue;
      const n = parseFloat(s.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return "";
  },

  /**
   * Añade a `set` números de caja citados en movimientos (historial), para que «Cajas sin unidades (total)»
   * y filtros no ignoren cajas que ya no tienen fila CajasJson pero sí constancia en movimientos.
   */
  _mergeKnownBoxNumbersFromMovements(set) {
    if (!(set instanceof Set)) return;
    if (typeof MovementManager === "undefined" || !Array.isArray(MovementManager.movements)) return;
    const boxNumFromLine = ln => {
      const n = parseInt(ln?.boxNumber, 10);
      return this._isValidBoxNumber(n) ? n : NaN;
    };
    const boxNumFromBoxIdString = bid => {
      const m = /^box-(\d{1,6})-/i.exec(String(bid || "").trim());
      if (!m) return NaN;
      const n = parseInt(m[1], 10);
      return this._isValidBoxNumber(n) ? n : NaN;
    };
    const boxNumFromBoxId = (itemId, boxId) => {
      if (!itemId || !boxId) return NaN;
      const it = this.getItemById(itemId);
      if (!it || !Array.isArray(it.boxStocks)) return NaN;
      const row = it.boxStocks.find(b => String(b.boxId) === String(boxId));
      return row ? parseInt(row.boxNumber, 10) : NaN;
    };
    const addFromText = raw => {
      for (const n of Utils.parseWarehouseBoxesFromLocation(String(raw || ""))) {
        if (this._isValidBoxNumber(n)) set.add(n);
      }
    };
    for (const m of MovementManager.movements) {
      if (!m || m.annulled) continue;
      addFromText(m.notes);
      for (const ln of m.items || []) {
        if (!ln) continue;
        addFromText(ln.location);
        addFromText(ln.locationStockLabel);
        addFromText(ln.boxLocationLabel);
        const sid = String(ln.stockSourceId || "").trim();
        if (sid.startsWith("ibox:")) {
          const n = parseInt(sid.slice(5), 10);
          if (this._isValidBoxNumber(n)) set.add(n);
        } else if (sid.startsWith("box:")) {
          const bid = sid.slice(4);
          let n = boxNumFromBoxId(ln.itemId, bid);
          if (!this._isValidBoxNumber(n)) n = boxNumFromBoxIdString(bid);
          if (this._isValidBoxNumber(n)) set.add(n);
        }
        const bn = boxNumFromLine(ln);
        if (this._isValidBoxNumber(bn)) set.add(bn);
        for (const bid of [ln.transferFromBoxId, ln.transferToBoxId]) {
          if (!bid) continue;
          let n = boxNumFromBoxId(ln.itemId, bid);
          if (!this._isValidBoxNumber(n)) n = boxNumFromBoxIdString(bid);
          if (this._isValidBoxNumber(n)) set.add(n);
        }
        const pl = ln.compraPlace;
        if (pl && pl.kind === "box") {
          const n = parseInt(pl.boxNumber, 10);
          if (this._isValidBoxNumber(n)) set.add(n);
        }
      }
    }
  },

  _getKnownBoxNumbers() {
    const set = new Set();
    for (const b of this.standaloneBoxes || []) {
      const n = parseInt(b?.boxNumber, 10);
      if (this._isValidBoxNumber(n)) set.add(n);
    }
    for (const it of this.items || []) {
      for (const n of this._collectWarehouseBoxesFromItem(it)) {
        if (this._isValidBoxNumber(n)) set.add(n);
      }
    }
    this._mergeKnownBoxNumbersFromMovements(set);
    return [...set].sort((a, b) => a - b);
  },

  _sortItemIdsByCode(ids) {
    const arr = [...(ids || [])].map(id => ({ id, code: String(this.getItemById(id)?.code || "") }));
    arr.sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" }));
    return arr.map(x => x.id);
  },

  /**
   * Números de caja referenciados (texto ubicación o CajasJson) cuya suma global de cantidad en caja es 0.
   */
  _collectZeroTotalStockByBoxNumber() {
    const known = this._getKnownBoxNumbers();
    const byBox = new Map();
    for (const it of this.items || []) {
      const rows = Array.isArray(it.boxStocks) ? it.boxStocks : [];
      for (const b of rows) {
        const n = parseInt(b?.boxNumber, 10);
        if (!this._isValidBoxNumber(n)) continue;
        const q = this._parseBoxStockQtyValue(b?.qty);
        if (!byBox.has(n)) byBox.set(n, { totalQty: 0, itemIdsWithRow: new Set(), lines: 0 });
        const agg = byBox.get(n);
        agg.totalQty += q;
        agg.itemIdsWithRow.add(it.id);
        agg.lines++;
      }
    }
    const out = [];
    for (const n of known) {
      const agg = byBox.get(n) || { totalQty: 0, itemIdsWithRow: new Set(), lines: 0 };
      const totalQty = Utils.roundDecimal(agg.totalQty);
      if (totalQty > 1e-9) continue;
      let openItemId = "";
      if (agg.itemIdsWithRow.size) {
        openItemId = this._sortItemIdsByCode(agg.itemIdsWithRow)[0] || "";
      } else {
        const candidates = (this.items || []).filter(it => this._collectWarehouseBoxesFromItem(it).includes(n));
        candidates.sort((a, b) =>
          String(a.code || "").localeCompare(String(b.code || ""), undefined, { sensitivity: "base" })
        );
        openItemId = candidates[0]?.id || "";
      }
      const kindKey = agg.lines === 0 ? "no-json" : "zero-sum";
      out.push({
        boxNumber: n,
        totalQty,
        itemCount: agg.itemIdsWithRow.size,
        lineCount: agg.lines,
        kindKey,
        openItemId
      });
    }
    return out.sort((a, b) => a.boxNumber - b.boxNumber);
  },

  /**
   * SheetJS emite __EMPTY / __EMPTY_N cuando la primera fila no tiene texto en esa columna.
   * Hay que ordenar claves para que coincidan con el orden de columnas del Excel.
   */
  _sortSheetJsEmptyKeys(keys) {
    return [...(keys || [])].filter(k => /^__EMPTY/.test(k)).sort((a, b) => {
      if (a === "__EMPTY") return -1;
      if (b === "__EMPTY") return 1;
      const na = parseInt(String(a).replace(/^__EMPTY_/, ""), 10);
      const nb = parseInt(String(b).replace(/^__EMPTY_/, ""), 10);
      return (Number.isFinite(na) ? na : 9999) - (Number.isFinite(nb) ? nb : 9999);
    });
  },

  /**
   * Inferencia (__EMPTY): 6 cols = Libro nuevo (LAST COUNT ix3; DERNIER PROJECT ix5 → notes).
   * ≥7 cols = layout anterior (LAST COUNT ix4; BIN ix6; meta opcional ix7).
   */
  _inferBoxStockFromEmptyKeyedRow(row, codeMap) {
    const keys = Object.keys(row || {});
    const emptyKeys = keys.filter(k => /^__EMPTY/.test(k));
    if (!keys.length || emptyKeys.length !== keys.length) return null;

    const vals = this._sortSheetJsEmptyKeys(keys).map(k => row[k]);
    const strVals = vals.map(v => String(v ?? "").trim());
    const nonEmpty = strVals.filter(Boolean);
    if (!nonEmpty.length) return null;

    const s0 = strVals[0] || "";
    const s1 = strVals[1] || "";

    if (/^#?\s*de\s*box$/i.test(s0) && /^code$/i.test(s1)) return { ignore: true };
    if (/^box$/i.test(s0) && /^code$/i.test(s1)) return { ignore: true };

    if (nonEmpty.length === 1 && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(nonEmpty[0])) return { ignore: true };

    let codeRaw = "";
    for (const raw of vals) {
      const k = this._normalizeImportCodeValue(raw);
      if (k && codeMap[k]) {
        codeRaw = raw;
        break;
      }
    }
    if (!codeRaw) codeRaw = vals[1];

    const boxRaw = vals[0];

    let qtyRaw;
    let qtyBoxesRaw;
    let locationRaw;
    let pickMetaRaw;

    const fillQtyFallback = (primary, fallbacks) => {
      let q = primary;
      const q0 = String(q ?? "").trim();
      if (q0 !== "-" && q0 !== "?" && q0 !== "") return q;
      for (const c of fallbacks) {
        const s = String(c ?? "").trim();
        if (!s || s === "?" || s === "-") continue;
        const n = parseFloat(String(s).replace(",", "."));
        if (Number.isFinite(n) && n >= 0) return c;
      }
      return q;
    };

    if (vals.length === 6) {
      qtyRaw = fillQtyFallback(vals[3], [vals[4], vals[2]]);
      qtyBoxesRaw = vals[4];
      pickMetaRaw = vals[5] != null ? String(vals[5]).trim() : "";
      locationRaw = "";
    } else {
      qtyRaw = fillQtyFallback(vals[4], [vals[3], vals[2]]);
      qtyBoxesRaw = vals[5];
      locationRaw = vals[6] != null ? String(vals[6]).trim() : "";
      pickMetaRaw = vals.length >= 8 && vals[7] != null ? String(vals[7]).trim() : "";
    }

    const qb = String(qtyBoxesRaw ?? "").trim();
    if (qb === "?" || qb === "-") qtyBoxesRaw = "";

    return { codeRaw, boxRaw, qtyRaw, qtyBoxesRaw, locationRaw, pickMetaRaw, ignore: false };
  },

  populateInventoryBoxFilter() {
    const sel = document.getElementById("inventory-box-filter");
    if (!sel) return;
    const prev = sel.value || "all";
    const parts = [
      `<option value="all">${this.esc(I18n.t("inventory.boxFilterAll"))}</option>`,
      `<option value="none">${this.esc(I18n.t("inventory.boxFilterNone"))}</option>`,
      `<optgroup label="${this.esc(I18n.t("inventory.boxFilterGroupBoxes"))}">`
    ];
    for (const n of this._getKnownBoxNumbers()) {
      parts.push(`<option value="${n}">${this.esc(I18n.t("inventory.boxFilterOption").replace("{n}", String(n)))}</option>`);
    }
    parts.push(`</optgroup><optgroup label="${this.esc(I18n.t("inventory.boxFilterGroupSlots"))}">`);
    for (const slot of (Utils.getEffectiveWarehouseLocationSlots ? Utils.getEffectiveWarehouseLocationSlots() : Utils.WAREHOUSE_LOCATION_SLOTS) || []) {
      const val = `slot:${encodeURIComponent(slot)}`;
      parts.push(`<option value="${Utils.escapeAttr(val)}">${this.esc(slot)}</option>`);
    }
    parts.push("</optgroup>");
    sel.innerHTML = parts.join("");
    const ok = [...sel.options].some(o => o.value === prev);
    sel.value = ok ? prev : "all";
  },

  _filterInventoryByBoxSelect(arr) {
    if (!Array.isArray(arr)) return [];
    const sel = document.getElementById("inventory-box-filter");
    const v = sel?.value ?? "all";
    if (!v || v === "all") return arr;
    if (v === "none") {
      return arr.filter(it => this._collectWarehouseBoxesFromItem(it).length === 0);
    }
    if (String(v).startsWith("slot:")) {
      let canon = "";
      try {
        canon = decodeURIComponent(String(v).slice(5));
      } catch (e) {
        canon = String(v).slice(5);
      }
      if (!canon) return arr;
      return arr.filter(it => this._collectWarehouseSlotsFromItem(it).includes(canon));
    }
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return arr;
    return arr.filter(it => this._collectWarehouseBoxesFromItem(it).includes(n));
  },

  _getActiveDistributionFilter() {
    const sel = document.getElementById("inventory-box-filter");
    const v = sel?.value ?? "all";
    if (!v || v === "all" || v === "none") return null;
    if (String(v).startsWith("slot:")) {
      let slot = "";
      try {
        slot = decodeURIComponent(String(v).slice(5));
      } catch (e) {
        slot = String(v).slice(5);
      }
      return slot ? { kind: "slot", slot } : null;
    }
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return null;
    return { kind: "box", boxNumber: n };
  },

  _getItemDistributedQtyForFilter(item, filter) {
    if (!item || !filter) return Utils.roundDecimal(parseFloat(item?.mainStock) || 0);
    if (filter.kind === "box") {
      const n = parseInt(filter.boxNumber, 10);
      const rows = Array.isArray(item.boxStocks) ? item.boxStocks : [];
      let sum = 0;
      for (const b of rows) {
        if (parseInt(b?.boxNumber, 10) !== n) continue;
        sum += this._parseBoxStockQtyValue(b?.qty);
      }
      return Math.max(0, Utils.roundDecimal(sum));
    }
    if (filter.kind === "slot") {
      const slot = String(filter.slot || "").trim();
      if (!slot) return 0;
      let sum = 0;
      const rows = Array.isArray(item.boxStocks) ? item.boxStocks : [];
      for (const b of rows) {
        if (!this._locationLabelEquals(b?.locationLabel || "", slot)) continue;
        sum += this._parseBoxStockQtyValue(b?.qty);
      }
      const locRows = this._normalizeItemLocationStocks(item);
      for (const ls of locRows) {
        if (!this._locationLabelEquals(ls?.location || "", slot)) continue;
        sum += Utils.roundDecimal(parseFloat(ls?.qty) || 0);
      }
      return Math.max(0, Utils.roundDecimal(sum));
    }
    return Utils.roundDecimal(parseFloat(item.mainStock) || 0);
  },

  _filterInventoryDepotPreset(arr) {
    if (!Array.isArray(arr)) return [];
    const sel = document.getElementById("inventory-depot-preset");
    const v = sel?.value ?? "all";
    if (v === "prod") return arr.filter(it => (parseFloat(it.prodStock) || 0) > 0);
    if (v === "trans") return arr.filter(it => (parseFloat(it.transStock) || 0) > 0);
    if (v === "prod_or_trans") {
      return arr.filter(it => (parseFloat(it.prodStock) || 0) > 0 || (parseFloat(it.transStock) || 0) > 0);
    }
    return arr;
  },

  _filterInventoryConsumablePreset(arr) {
    if (!Array.isArray(arr)) return [];
    const sel = document.getElementById("inventory-consumable-filter");
    const v = sel?.value ?? "all";
    if (v === "invcons") return arr.filter(it => !!it.inventoryConsumable);
    if (v === "noninvcons") return arr.filter(it => !it.inventoryConsumable);
    return arr;
  },

  resetInventorySearchAndFilters() {
    const s = document.getElementById("inventory-search");
    if (s) s.value = "";
    const sel = document.getElementById("inventory-box-filter");
    if (sel) sel.value = "all";
    const dep = document.getElementById("inventory-depot-preset");
    if (dep) dep.value = "all";
    const invc = document.getElementById("inventory-consumable-filter");
    if (invc) invc.value = "all";
    this._asOfDate = null;
    const asofDate = document.getElementById("inventory-asof-date");
    if (asofDate) asofDate.value = "";
    this.render();
  },

  _setInventoryBoxFilterBySlot(slotId) {
    const sel = document.getElementById("inventory-box-filter");
    if (!sel) return false;
    const val = `slot:${encodeURIComponent(String(slotId || ""))}`;
    const has = [...(sel.options || [])].some(o => o.value === val);
    if (!has) return false;
    sel.value = val;
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return true;
  },

  _setInventoryBoxFilterByNumber(n) {
    const sel = document.getElementById("inventory-box-filter");
    if (!sel) return false;
    const num = parseInt(n, 10);
    if (!this._isValidBoxNumber(num)) return false;
    const val = String(num);
    const has = [...(sel.options || [])].some(o => o.value === val);
    if (!has) return false;
    sel.value = val;
    this._collapseOtherInventoryFilterPanels("box");
    const wrap = document.getElementById("inventory-box-filter-wrap");
    if (wrap) {
      wrap.hidden = false;
      wrap.style.display = "inline-flex";
    }
    this._syncInventoryBoxFilterToggleUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
    this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    return true;
  },

  _openBoxManagerAtItemBox(itemId, boxNumber) {
    if (!itemId) return;
    if (!this.openBoxManagerModal()) return;
    this._boxMgrItemId = String(itemId);
    this._applyBoxManagerItemSelection();
    const item = this.getItemById(itemId);
    if (!item) return;
    const n = parseInt(boxNumber, 10);
    if (!this._isValidBoxNumber(n)) return;
    const row = (item.boxStocks || []).find(b => parseInt(b?.boxNumber, 10) === n);
    if (row) {
      this._loadBoxIntoManagerForm(row);
      this._renderBoxManagerRows();
      return;
    }
    this._boxMgrEditBoxId = null;
    const numberInput = document.getElementById("inventory-box-number");
    if (numberInput) numberInput.value = String(n);
    this._renderBoxManagerRows();
  },

  _estimateLocationQtyForItem(item, locationKey = "") {
    if (!item) return { qty: 0, mode: "none" };
    const key = String(locationKey || "").trim();
    const locRows = this._normalizeItemLocationStocks(item);
    if (key) {
      const direct = locRows.find(ls => this._locationLabelEquals(ls?.location, key));
      if (direct) return { qty: Math.max(0, this._parseBoxStockQtyValue(direct.qty)), mode: "explicit" };
    }
    if (locRows.length > 1) return { qty: 0, mode: "ambiguous" };
    // Regla pedida: cantidad ubicación ≈ cantidad total - cantidad en cajas.
    const total = Math.max(0, Utils.roundDecimal(this.itemTotalStock(item)));
    const sumBoxes = (Array.isArray(item.boxStocks) ? item.boxStocks : [])
      .reduce((acc, b) => acc + Math.max(0, this._parseBoxStockQtyValue(b?.qty)), 0);
    return { qty: Math.max(0, Utils.roundDecimal(total - sumBoxes)), mode: "derived" };
  },

  _handleInventoryLocationJump(target) {
    const node = target?.closest?.("[data-jump-kind]");
    if (!node) return false;
    const kind = String(node.getAttribute("data-jump-kind") || "").trim();
    if (kind === "box") {
      const itemId = String(node.getAttribute("data-item-id") || "").trim();
      const boxNumber = parseInt(node.getAttribute("data-box-number") || "", 10);
      if (itemId && this._isValidBoxNumber(boxNumber)) {
        this._openBoxManagerAtItemBox(itemId, boxNumber);
        return true;
      }
      return false;
    }
    if (kind === "slot") {
      const slotId = String(node.getAttribute("data-slot-id") || "").trim();
      const itemId = String(node.getAttribute("data-item-id") || "").trim();
      const item = this.getItemById(itemId);
      const est = this._estimateLocationQtyForItem(item, slotId);
      if (est.mode === "ambiguous") {
        Utils.showToast(
          I18n.t("inventory.locationQtyAmbiguousToast").replace("{loc}", slotId),
          "warning"
        );
      } else {
        Utils.showToast(`${slotId}: ${Utils.formatDecimalDisplay(est.qty)}`, "info");
      }
      // Solo informar cantidad en ubicación: no alterar filtros/vista.
      return true;
    }
    if (kind === "locqty") {
      const locationKey = String(node.getAttribute("data-location-key") || "").trim();
      if (!locationKey) return false;
      const itemId = String(node.getAttribute("data-item-id") || "").trim();
      const item = this.getItemById(itemId);
      const est = this._estimateLocationQtyForItem(item, locationKey);
      if (est.mode === "ambiguous") {
        Utils.showToast(
          I18n.t("inventory.locationQtyAmbiguousToast").replace("{loc}", locationKey),
          "warning"
        );
      } else {
        Utils.showToast(`${locationKey}: ${Utils.formatDecimalDisplay(est.qty)}`, "info");
      }
      // Solo informar cantidad en ubicación: no alterar filtros/vista.
      return true;
    }
    return false;
  },

  _focusInventorySearchSoon() {
    setTimeout(() => {
      const inp = document.getElementById("inventory-search");
      if (!inp) return;
      inp.focus({ preventScroll: true });
      const len = String(inp.value || "").length;
      try {
        inp.setSelectionRange(len, len);
      } catch (e) {
        // no-op for unsupported inputs
      }
    }, 0);
  },

  /**
   * Agregación por caja a partir del texto «Ubicación» (convención box/caja + número).
   */
  buildWarehouseBoxSummary(items) {
    const map = {};
    let noBoxSku = 0;
    let noBoxMain = 0;
    const itemsNoBox = [];
    for (const it of items || []) {
      const boxes = this._collectWarehouseBoxesFromItem(it);
      const main = Number(it.mainStock) || 0;
      if (boxes.length) {
        for (const box of boxes) {
          if (!map[box]) map[box] = { box, skuCount: 0, totalMain: 0, items: [] };
          map[box].skuCount++;
          map[box].totalMain += main;
          map[box].items.push(it);
        }
      } else {
        noBoxSku++;
        noBoxMain += main;
        itemsNoBox.push(it);
      }
    }
    const rows = Object.keys(map)
      .map(k => map[k])
      .sort((a, b) => a.box - b.box);
    return { rows, noBoxSku, noBoxMain, itemsNoBox };
  },

  _showInventoryBoxSummaryDetail(boxKey) {
    const panel = document.getElementById("inventory-box-summary-detail");
    if (!panel) return;
    const isNone = boxKey === "none";
    const list = isNone
      ? (this._boxSummaryNoBox || []).slice()
      : (this._boxSummaryByBox && this._boxSummaryByBox[boxKey]) ? this._boxSummaryByBox[boxKey].slice() : [];
    const sorted = list.sort((a, b) =>
      String(a.code || "").localeCompare(String(b.code || ""), undefined, { sensitivity: "base" })
    );
    const fmt = v => Utils.formatDecimalDisplay(v);
    const th = k => `<th>${this.esc(I18n.t(k))}</th>`;
    const detailTitle = isNone
      ? I18n.t("inventory.boxSummaryDetailTitleNone")
      : I18n.t("inventory.boxSummaryDetailTitle").replace("{n}", String(boxKey));
    const rowLines = sorted
      .map(
        it =>
          `<tr><td class="app-code-copy-cell"><strong>${this.esc(it.code)}</strong></td><td class="app-desc-copy-cell">${this.esc(it.description || "")}</td><td>${fmt(
            this._qtyInSummaryBoxForItem(it, isNone ? "none" : boxKey)
          )}</td><td>${fmt(
            it.mainStock || 0
          )}</td><td>${this.esc(it.location || "-")}</td></tr>`
      )
      .join("");
    panel.innerHTML = `
      <h4 class="inventory-box-summary-detail-title">${this.esc(detailTitle)}</h4>
      <div class="inventory-table-container inventory-table-container--nested">
        <table class="inventory-table">
          <thead><tr>${th("table.code")}${th("table.description")}${th("inventory.boxColQtyInBox")}${th("table.mainStock")}${th("table.location")}</tr></thead>
          <tbody>${
            sorted.length
              ? rowLines
              : `<tr><td colspan="5" class="muted">${this.esc(I18n.t("inventory.boxSummaryDetailEmpty"))}</td></tr>`
          }</tbody>
        </table>
      </div>`;
    panel.hidden = false;
    document.querySelectorAll("#inventory-box-summary-modal tr.inv-box-summary-row").forEach(tr => {
      const raw = tr.getAttribute("data-box-num");
      const match = isNone ? raw === "none" : raw === String(boxKey);
      tr.classList.toggle("is-selected", match);
    });
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  _syncBoxSummarySelectionUi() {
    const scope = document.getElementById("inventory-box-summary-export-scope")?.value || "all";
    const selectedMode = scope === "selected";
    document.querySelectorAll("#inventory-box-summary-modal .inv-box-summary-select").forEach(inp => {
      inp.disabled = !selectedMode;
      if (!selectedMode) inp.checked = false;
    });
    this._renderBoxContentListingPreview();
  },

  _itemMatchesBoxSummarySearch(item, rawQuery) {
    const q = String(rawQuery || "").trim().toLowerCase();
    if (!q) return false;
    const fields = [item?.code, item?.description, item?.category, item?.location];
    return fields.some(f => String(f || "").toLowerCase().includes(q));
  },

  _applyBoxSummarySearchSelection(rawQuery) {
    const q = String(rawQuery || "").trim();
    const scopeSel = document.getElementById("inventory-box-summary-export-scope");
    if (scopeSel) scopeSel.value = "selected";
    this._syncBoxSummarySelectionUi();

    let selectedCount = 0;
    let firstKey = null;
    document.querySelectorAll("#inventory-box-summary-modal .inv-box-summary-select").forEach(inp => {
      const key = String(inp.getAttribute("data-box-key") || "").trim();
      const items =
        key === "none"
          ? (Array.isArray(this._boxSummaryNoBox) ? this._boxSummaryNoBox : [])
          : (Array.isArray(this._boxSummaryByBox?.[key]) ? this._boxSummaryByBox[key] : []);
      const match = q ? items.some(it => this._itemMatchesBoxSummarySearch(it, q)) : false;
      inp.checked = match;
      if (match) {
        selectedCount++;
        if (firstKey == null) firstKey = key;
      }
    });
    this._renderBoxContentListingPreview();
    return selectedCount;
  },

  openWarehouseBoxSummaryModal() {
    const modal = document.getElementById("inventory-box-summary-modal");
    const body = document.getElementById("inventory-box-summary-body");
    const h = document.getElementById("inventory-box-summary-heading");
    if (!modal || !body) return;
    if (h) h.textContent = I18n.t("inventory.boxSummaryTitle");

    const items = this.getItemsWithOptionalAsOfStock();
    const { rows, noBoxSku, noBoxMain, itemsNoBox } = this.buildWarehouseBoxSummary(items);
    this._boxSummaryByBox = {};
    for (const r of rows) this._boxSummaryByBox[r.box] = r.items;
    this._boxSummaryNoBox = itemsNoBox.slice();

    const fmt = v => Utils.formatDecimalDisplay(v);
    const th = k => `<th>${this.esc(I18n.t(k))}</th>`;
    const rowHtml = rows
      .map(
        r =>
          `<tr class="inv-box-summary-row is-clickable" data-box-num="${r.box}" tabindex="0" role="button" aria-label="${this.esc(
            I18n.t("inventory.boxSummaryRowAria")
              .replace("{n}", String(r.box))
              .replace("{count}", String(r.skuCount))
          )}">
          <td><input type="checkbox" class="inv-box-summary-select" data-box-key="${this.esc(String(r.box))}" aria-label="${this.esc(
            I18n.t("inventory.boxSummarySelectRowAria").replace("{n}", String(r.box))
          )}" /></td>
          <td><strong>${r.box}</strong></td>
          <td>${r.skuCount}</td>
          <td>${fmt(r.totalMain)}</td>
        </tr>`
      )
      .join("");
    const noBoxRow =
      noBoxSku > 0
        ? `<tr class="inv-box-summary-row inv-box-summary-row--orphan is-clickable" data-box-num="none" tabindex="0" role="button" aria-label="${this.esc(
            I18n.t("inventory.boxSummaryRowAriaNone").replace("{count}", String(noBoxSku))
          )}">
          <td><input type="checkbox" class="inv-box-summary-select" data-box-key="none" aria-label="${this.esc(
            I18n.t("inventory.boxSummarySelectRowAriaNone")
          )}" /></td>
          <td><strong>${this.esc(I18n.t("inventory.boxUnassigned"))}</strong></td>
          <td>${noBoxSku}</td>
          <td>${fmt(noBoxMain)}</td>
        </tr>`
        : "";
    const tbodyRows =
      rows.length === 0 && noBoxSku === 0
        ? `<tr><td colspan="4">${this.esc(I18n.t("inventory.boxSummaryEmpty"))}</td></tr>`
        : rowHtml + noBoxRow;

    const exportContentLbl = this.esc(I18n.t("inventory.boxSummaryExportContent"));
    const printContentLbl = this.esc(I18n.t("inventory.boxSummaryPrintContent"));
    const searchInBoxesLbl = this.esc(I18n.t("inventory.boxSummarySearchInBoxes"));
    const searchPh = this.esc(I18n.t("inventory.boxSummarySearchPlaceholder"));
    const clearSearchLbl = this.esc(I18n.t("inventory.boxSummarySearchClear"));
    const scopeLbl = this.esc(I18n.t("inventory.boxSummaryScopeLabel"));
    const scopeAllLbl = this.esc(I18n.t("inventory.boxSummaryScopeAll"));
    const scopeSelLbl = this.esc(I18n.t("inventory.boxSummaryScopeSelected"));
    const toolbar = `<div class="inventory-insight-toolbar filter-actions">
      <input id="inventory-box-summary-item-search" class="search-input" type="text" placeholder="${searchPh}" aria-label="${searchInBoxesLbl}" title="${searchInBoxesLbl}" autocomplete="off" />
      <button type="button" id="inventory-box-summary-search-clear" class="btn btn-secondary btn-sm">${clearSearchLbl}</button>
      <span class="muted inventory-box-summary-scope-label">${scopeLbl}</span>
      <select id="inventory-box-summary-export-scope" class="filter-select inventory-box-summary-scope-select" aria-label="${scopeLbl}">
        <option value="all">${scopeAllLbl}</option>
        <option value="selected">${scopeSelLbl}</option>
      </select>
      <button type="button" id="inventory-box-summary-export-content" class="btn inventory-asof-icon-btn" title="${exportContentLbl}" aria-label="${exportContentLbl}">${INV_ICONS.download}</button>
      <button type="button" id="inventory-box-summary-print-content" class="btn inventory-asof-icon-btn" title="${printContentLbl}" aria-label="${printContentLbl}">${INV_ICONS.print}</button>
    </div>`;
    const intro = `<p class="muted inventory-box-summary-intro">${this.esc(I18n.t("inventory.boxSummaryIntro"))}</p>`;
    const orphan = `<p class="muted inventory-box-summary-orphan"><strong>${this.esc(I18n.t("inventory.boxUnassigned"))}</strong>: ${noBoxSku} · ${this.esc(I18n.t("inventory.boxUnassignedMain"))}: ${fmt(noBoxMain)}</p>`;
    const multiAssign = `<p class="muted inventory-box-summary-multi-assign">${this.esc(
      I18n.t("inventory.boxSummaryMultiAssignNote")
    )}</p>`;
    body.innerHTML = `${toolbar}${intro}${orphan}${multiAssign}
      <div class="inventory-table-container inventory-table-container--nested"><table class="inventory-table"><thead><tr>
        <th>${this.esc(I18n.t("inventory.boxSummaryColSelect"))}</th>${th("inventory.boxColNumber")}${th("inventory.boxColSkuCount")}${th("inventory.boxColTotalMain")}
      </tr></thead><tbody>${tbodyRows}</tbody></table></div>
      <div id="inventory-box-summary-content-preview" class="inventory-box-summary-detail"></div>`;
    this._syncBoxSummarySelectionUi();
    modal.classList.add("active");
  },

  _isMeObraItem(it) {
    const txt = `${it?.category || ""} ${it?.description || ""} ${it?.code || ""}`.toLowerCase();
    return (
      txt.includes("m.e. obra") ||
      txt.includes("me obra") ||
      txt.includes("mat elec obra") ||
      txt.includes("material electrico obra") ||
      txt.includes("material eléctrico obra")
    );
  },

  _buildMeObraBoxSummaryRows() {
    const base = this.getItemsWithOptionalAsOfStock();
    const meObraItems = (base || []).filter(it => this._isMeObraItem(it));
    return this.buildWarehouseBoxSummary(meObraItems);
  },

  _buildBoxContentListingRows(selectedOnly = false) {
    const selectedKeys = new Set();
    document.querySelectorAll("#inventory-box-summary-modal .inv-box-summary-select:checked").forEach(inp => {
      const k = String(inp.getAttribute("data-box-key") || "").trim();
      if (k) selectedKeys.add(k);
    });
    if (selectedOnly && selectedKeys.size === 0) return [];

    const out = [];
    const pushItem = (boxKey, item) => {
      if (!item) return;
      out.push({
        Caja: boxKey === "none" ? I18n.t("inventory.boxUnassigned") : String(boxKey),
        Codigo: String(item.code || ""),
        Descripcion: String(item.description || ""),
        CantidadEnCaja: this._qtyInSummaryBoxForItem(item, boxKey),
        StockPrincipal: Utils.roundDecimal(item.mainStock || 0),
        Ubicacion: String(item.location || "-")
      });
    };

    const boxKeys = Object.keys(this._boxSummaryByBox || {}).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
    boxKeys.forEach(k => {
      if (selectedOnly && !selectedKeys.has(String(k))) return;
      const items = Array.isArray(this._boxSummaryByBox[k]) ? this._boxSummaryByBox[k] : [];
      items.forEach(it => pushItem(k, it));
    });
    const noBox = Array.isArray(this._boxSummaryNoBox) ? this._boxSummaryNoBox : [];
    if ((!selectedOnly || selectedKeys.has("none")) && noBox.length) noBox.forEach(it => pushItem("none", it));
    return out;
  },

  _qtyInSummaryBoxForItem(item, boxKey) {
    const main = Math.max(0, Number(item?.mainStock) || 0);
    if (boxKey === "none") return Utils.roundDecimal(main);
    const n = parseInt(String(boxKey || ""), 10);
    if (!Number.isFinite(n)) return 0;
    const rows = Array.isArray(item?.boxStocks) ? item.boxStocks : [];
    let qty = 0;
    for (const b of rows) {
      if (parseInt(b?.boxNumber, 10) !== n) continue;
      qty += this._parseBoxStockQtyValue(b?.qty);
    }
    if (qty > 0) return Utils.roundDecimal(qty);
    const inferred = this._collectWarehouseBoxesFromItem(item);
    return inferred.includes(n) ? Utils.roundDecimal(main) : 0;
  },

  _renderBoxContentListingPreview() {
    const panel = document.getElementById("inventory-box-summary-content-preview");
    if (!panel) return;
    const scope = document.getElementById("inventory-box-summary-export-scope")?.value || "all";
    const selectedOnly = scope === "selected";
    const rows = this._buildBoxContentListingRows(selectedOnly);
    const title = this.esc(I18n.t("inventory.boxSummaryContentListTitle"));
    const emptyMsg = this.esc(
      selectedOnly ? I18n.t("inventory.boxSummarySelectAtLeastOne") : I18n.t("inventory.boxSummaryDetailEmpty")
    );
    if (!rows.length) {
      panel.innerHTML = `<h4 class="inventory-box-summary-detail-title">${title}</h4><p class="muted">${emptyMsg}</p>`;
      return;
    }
    const bodyRows = rows
      .map(
        r => `<tr>
      <td><strong>${this.esc(r.Caja)}</strong></td>
      <td>${this.esc(r.Codigo)}</td>
      <td>${this.esc(r.Descripcion)}</td>
      <td>${this.esc(Utils.formatDecimalDisplay(r.CantidadEnCaja))}</td>
      <td>${this.esc(Utils.formatDecimalDisplay(r.StockPrincipal))}</td>
      <td>${this.esc(r.Ubicacion)}</td>
    </tr>`
      )
      .join("");
    panel.innerHTML = `<h4 class="inventory-box-summary-detail-title">${title}</h4>
      <div class="inventory-table-container inventory-table-container--nested">
        <table class="inventory-table">
          <thead><tr>
            <th>${this.esc(I18n.t("inventory.boxColNumber"))}</th>
            <th>${this.esc(I18n.t("table.code"))}</th>
            <th>${this.esc(I18n.t("table.description"))}</th>
            <th>${this.esc(I18n.t("inventory.boxColQtyInBox"))}</th>
            <th>${this.esc(I18n.t("table.mainStock"))}</th>
            <th>${this.esc(I18n.t("table.location"))}</th>
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  },

  async exportBoxContentListing() {
    const scope = document.getElementById("inventory-box-summary-export-scope")?.value || "all";
    const selectedOnly = scope === "selected";
    const rows = this._buildBoxContentListingRows(selectedOnly);
    if (!rows.length) {
      Utils.showToast(
        selectedOnly ? I18n.t("inventory.boxSummarySelectAtLeastOne") : I18n.t("inventory.boxSummaryDetailEmpty"),
        "info"
      );
      return;
    }
    const headers = ["Caja", "Codigo", "Descripcion", "CantidadEnCaja", "StockPrincipal", "Ubicacion"];
    await Utils.exportStyledXlsxToInformFolder(`GNEEX_Cajas_Contenido_${this._fileStamp()}.xlsx`, headers, rows, {
      kind: "inventory_box_content_listing",
      title: I18n.t("inventory.boxSummaryContentListTitle"),
      details: [`${I18n.t("export.manifest.rows")}: ${rows.length}`]
    });
  },

  printBoxContentListing() {
    const scope = document.getElementById("inventory-box-summary-export-scope")?.value || "all";
    const selectedOnly = scope === "selected";
    const rows = this._buildBoxContentListingRows(selectedOnly);
    if (!rows.length) {
      Utils.showToast(
        selectedOnly ? I18n.t("inventory.boxSummarySelectAtLeastOne") : I18n.t("inventory.boxSummaryDetailEmpty"),
        "info"
      );
      return;
    }
    const tableRows = rows
      .map(
        r => `<tr><td><strong>${this.esc(r.Caja)}</strong></td><td>${this.esc(r.Codigo)}</td><td>${this.esc(
          r.Descripcion
        )}</td><td>${this.esc(Utils.formatDecimalDisplay(r.CantidadEnCaja))}</td><td>${this.esc(
          Utils.formatDecimalDisplay(r.StockPrincipal)
        )}</td><td>${this.esc(r.Ubicacion)}</td></tr>`
      )
      .join("");
    const tableHtml = `<table class="inventory-table"><thead><tr>
      <th>${this.esc(I18n.t("inventory.boxColNumber"))}</th>
      <th>${this.esc(I18n.t("table.code"))}</th>
      <th>${this.esc(I18n.t("table.description"))}</th>
      <th>${this.esc(I18n.t("inventory.boxColQtyInBox"))}</th>
      <th>${this.esc(I18n.t("table.mainStock"))}</th>
      <th>${this.esc(I18n.t("table.location"))}</th>
    </tr></thead><tbody>${tableRows}</tbody></table>`;
    this._printDocument(I18n.t("inventory.boxSummaryContentListTitle"), "", tableHtml);
  },

  async exportMeObraBoxSummary() {
    const { rows, noBoxSku, noBoxMain } = this._buildMeObraBoxSummaryRows();
    const outRows = [];
    rows.forEach(r => {
      outRows.push({
        Caja: String(r.box),
        Referencias: r.skuCount,
        StockPrincipalTotal: Utils.roundDecimal(r.totalMain || 0)
      });
    });
    if (noBoxSku > 0) {
      outRows.push({
        Caja: I18n.t("inventory.boxUnassigned"),
        Referencias: noBoxSku,
        StockPrincipalTotal: Utils.roundDecimal(noBoxMain || 0)
      });
    }
    if (!outRows.length) {
      Utils.showToast(I18n.t("inventory.boxExportEmpty"), "info");
      return;
    }
    await Utils.exportStyledXlsxToInformFolder(
      `GNEEX_ME_Obra_Cajas_${this._fileStamp()}.xlsx`,
      ["Caja", "Referencias", "StockPrincipalTotal"],
      outRows,
      {
        kind: "inventory_me_obra_box_summary",
        title: I18n.t("inventory.boxSummaryMeObraTitle"),
        details: [`${I18n.t("export.manifest.rows")}: ${outRows.length}`]
      }
    );
  },

  printMeObraBoxSummary() {
    const { rows, noBoxSku, noBoxMain } = this._buildMeObraBoxSummaryRows();
    const fmt = v => Utils.formatDecimalDisplay(v);
    const bodyRows = rows
      .map(
        r => `<tr><td><strong>${this.esc(String(r.box))}</strong></td><td>${this.esc(String(r.skuCount))}</td><td>${this.esc(
          fmt(r.totalMain)
        )}</td></tr>`
      )
      .join("");
    const noBoxRow =
      noBoxSku > 0
        ? `<tr><td><strong>${this.esc(I18n.t("inventory.boxUnassigned"))}</strong></td><td>${this.esc(
            String(noBoxSku)
          )}</td><td>${this.esc(fmt(noBoxMain))}</td></tr>`
        : "";
    const empty =
      rows.length === 0 && noBoxSku === 0
        ? `<tr><td colspan="3" class="muted">${this.esc(I18n.t("inventory.boxSummaryEmpty"))}</td></tr>`
        : "";
    const tableHtml = `<table class="inventory-table"><thead><tr>
      <th>${this.esc(I18n.t("inventory.boxColNumber"))}</th>
      <th>${this.esc(I18n.t("inventory.boxColSkuCount"))}</th>
      <th>${this.esc(I18n.t("inventory.boxColTotalMain"))}</th>
    </tr></thead><tbody>${bodyRows}${noBoxRow}${empty}</tbody></table>`;
    this._printDocument(I18n.t("inventory.boxSummaryMeObraTitle"), "", tableHtml);
  },

  openInsightModal(kind) {
    const modal = document.getElementById("inventory-insight-modal");
    const title = document.getElementById("inventory-insight-title");
    const body = document.getElementById("inventory-insight-body");
    if (!modal || !title || !body) return;
    const content = modal.querySelector(".modal-content");
    if (content) {
      content.style.width = "";
      content.style.height = "";
    }

    const base = this.getItemsWithOptionalAsOfStock();
    let items = [];
    let titleKey = "";
    if (kind === "low") {
      const showIgnored = !!this._insightLowShowIgnored;
      items = showIgnored
        ? base.filter(i => !!i.ignoreLowStockAlert)
        : base.filter(i => this.isItemLowStock(i));
      titleKey = showIgnored ? "inventory.insightTitleLowIgnored" : "inventory.insightTitleLow";
    } else if (kind === "negative") {
      items = base.filter(i => this.itemTotalStock(i) < 0);
      titleKey = "inventory.insightTitleNegative";
    } else if (kind === "expiration") {
      items = base.filter(i => {
        const x = this.getExpirationInsight(i);
        return x.has && (x.expired || x.soon);
      });
      titleKey = "inventory.insightTitleExpiration";
    } else if (kind === "overstock") {
      items = base.filter(i => this.isItemOverstock(i));
      titleKey = "inventory.insightTitleOverstock";
    } else if (kind === "zero") {
      items = base.filter(i => this.itemTotalStock(i) === 0);
      titleKey = "inventory.insightTitleZero";
    }

    title.textContent = I18n.t(titleKey);
    this._insightExportItems = items.slice();
    this._insightTitleKey = titleKey;

    const csvLbl = this.esc(I18n.t("inventory.exportCsv"));
    const printLbl = this.esc(I18n.t("inventory.printList"));
    const lowModeToggle =
      kind === "low"
        ? `<label class="checkbox-label" style="margin-right:0.5rem;display:inline-flex;align-items:center;gap:0.35rem;">
        <input type="checkbox" id="insight-low-show-ignored" ${this._insightLowShowIgnored ? "checked" : ""} />
        <span>${this.esc(I18n.t("inventory.lowStockShowIgnoredToggle"))}</span>
      </label>`
        : "";
    const toolbar =
      items.length > 0
        ? `<div class="inventory-insight-toolbar filter-actions">
        ${lowModeToggle}
        <button type="button" id="insight-export-csv" class="btn inventory-asof-icon-btn" title="${csvLbl}" aria-label="${csvLbl}">${INV_ICONS.download}</button>
        <button type="button" id="insight-print-list" class="btn inventory-asof-icon-btn" title="${printLbl}" aria-label="${printLbl}">${INV_ICONS.print}</button>
      </div>`
        : kind === "low"
          ? `<div class="inventory-insight-toolbar filter-actions">${lowModeToggle}</div>`
          : "";

    if (!items.length) {
      body.innerHTML = `${toolbar}<p class="muted" style="padding:1rem;">${this.esc(I18n.t("inventory.insightEmpty"))}</p>`;
      modal.classList.add("active");
      return;
    }

    const th = (k) => `<th>${this.esc(I18n.t(k))}</th>`;
    const fmt = v => Utils.formatDecimalDisplay(v);
    const canEditFromList = typeof Auth !== "undefined" && Auth.isAdmin();
    const canToggleLowIgnore = typeof Auth === "undefined" || Auth.hasPerm?.("editItems");
    const showLowIgnore = kind === "low";
    const showBuyAction = kind === "low";
    /* Solo el insight de caducidad gana una columna extra con el desglose de
       unidades afectadas (vencidas + próximas). En el resto de paneles seguiría
       siendo ruido — el dato no aplica. */
    const showAffectedQty = kind === "expiration";
    const rows = items
      .map(it => {
        const tot = this.itemTotalStock(it);
        const eff = this.getEffectiveExpirationDateForDisplay(it);
        const ins = this.getExpirationInsight(it);
        const days =
          ins.has && ins.days !== null
            ? ins.days < 0
              ? I18n.t("inventory.insightExpired")
              : String(ins.days)
            : "—";
        const minS = it.minStock != null && it.minStock !== "" ? fmt(parseFloat(it.minStock) || 0) : "—";
        const maxS = it.maxStock != null && it.maxStock !== "" ? fmt(parseFloat(it.maxStock) || 0) : "—";
        const rowClass = canEditFromList ? " class=\"inventory-insight-row inventory-insight-row--editable\"" : "";
        const rowAttrs = canEditFromList
          ? ` data-item-id="${Utils.escapeAttr(String(it.id || ""))}" title="${Utils.escapeAttr(I18n.t("inventory.insightRowEditAdminHint"))}"`
          : "";
        const lowIgnoreCell = showLowIgnore
          ? `<td><label class="checkbox-label" style="justify-content:center;"><input type="checkbox" class="insight-low-ignore-toggle" data-item-id="${Utils.escapeAttr(
              String(it.id || "")
            )}" ${it.ignoreLowStockAlert ? "checked" : ""} ${canToggleLowIgnore ? "" : "disabled"} /><span>${this.esc(
              I18n.t("inventory.lowStockIgnoreShort")
            )}</span></label></td>`
          : "";
        const buyActionCell = showBuyAction
          ? `<td><button type="button" class="btn btn-secondary btn-sm insight-add-purchase-btn" data-item-code="${Utils.escapeAttr(
              String(it.code || "")
            )}" title="${Utils.escapeAttr(I18n.t("inventory.addPurchaseTitle"))}" aria-label="${Utils.escapeAttr(
              I18n.t("inventory.addPurchaseFromRow").replace("{code}", String(it.code || ""))
            )}">🛒</button></td>`
          : "";
        let affectedCell = "";
        if (showAffectedQty) {
          const a = this.getExpirationAffectedBreakdown(it);
          const parts = [];
          if (a.expired > 0) {
            parts.push(
              `<span class="inv-lot-pill inv-lot-pill--expired" title="${Utils.escapeAttr(I18n.t("inventory.affectedExpiredTooltip") || "Unidades vencidas")}">${this.esc(fmt(a.expired))}</span>`
            );
          }
          if (a.soon > 0) {
            parts.push(
              `<span class="inv-lot-pill inv-lot-pill--soon" title="${Utils.escapeAttr(I18n.t("inventory.affectedSoonTooltip") || "Unidades próximas a vencer")}">${this.esc(fmt(a.soon))}</span>`
            );
          }
          const totLabel = a.total > 0 ? this.esc(fmt(a.total)) : "—";
          const detail = parts.length
            ? `<span class="inv-affected-detail">${parts.join("")}</span>`
            : "";
          affectedCell = `<td class="inv-affected-cell"><strong>${totLabel}</strong>${detail}</td>`;
        }
        return `<tr${rowClass}${rowAttrs}>
          ${lowIgnoreCell}
          ${buyActionCell}
          <td class="app-code-copy-cell"><strong>${this.esc(it.code)}</strong></td>
          <td class="app-desc-copy-cell">${this.esc(it.description)}</td>
          <td>${this.esc(it.category || "—")}</td>
          <td>${this._formatPriceDisplay(it.defaultPrice ?? 0, it.priceCurrency)}</td>
          <td>${fmt(it.mainStock ?? 0)}</td>
          <td>${fmt(tot)}</td>
          ${affectedCell}
          <td>${minS}</td>
          <td>${maxS}</td>
          <td>${it.expDate ? Utils.formatDate(it.expDate) : "—"}</td>
          <td>${eff ? Utils.formatDate(eff) : "—"}</td>
          <td>${this.esc(days)}</td>
          <td>${this.esc(it.location || "—")}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `${toolbar}
      <div class="inventory-table-container">
        <table class="inventory-table inventory-table--detail${kind === "low" ? " inventory-table--insight-low" : ""}">
          <thead><tr>
            ${showLowIgnore ? th("inventory.lowStockIgnoreCol") : ""}
            ${showBuyAction ? th("table.actions") : ""}
            ${th("table.code")}
            ${th("table.description")}
            ${th("table.category")}
            ${th("table.defaultPrice")}
            ${th("table.mainStock")}
            ${th("inventory.colTotal")}
            ${showAffectedQty ? th("inventory.affectedQtyCol") : ""}
            ${th("inventory.colMin")}
            ${th("inventory.colMax")}
            ${th("table.expDate")}
            ${th("table.expirationDate")}
            ${th("inventory.colDays")}
            ${th("table.location")}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    modal.classList.add("active");
  },

  // =========================================================
  // IMPORTACIÓN DE CSV INICIAL
  // =========================================================
  importInitialCSV(file) {
    const nameLc = file && file.name ? String(file.name).toLowerCase() : "";
    const finish = next => {
      const prevList = this.items || [];
      const prevMap = {};
      prevList.forEach(i => {
        prevMap[i.id] = {
          main: parseFloat(i.mainStock) || 0,
          prod: parseFloat(i.prodStock) || 0,
          trans: parseFloat(i.transStock) || 0
        };
      });
      this.items = next;
      this.save();
      if (typeof MovementManager !== "undefined" && MovementManager.recordAjusteInventoryCsvImportBatch) {
        MovementManager.recordAjusteInventoryCsvImportBatch({
          prevMap,
          items: next,
          notes: I18n.t("movements.configCsvImportAjusteNote")
        });
      }
      this.render();
      Utils.showToast(I18n.t("msg.initialInventoryLoaded"), "success");
    };

    if (nameLc.endsWith(".xlsx") || nameLc.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const XLSX = typeof window !== "undefined" ? window.XLSX : null;
          if (!XLSX || typeof XLSX.read !== "function") {
            Utils.showToast(I18n.t("msg.errorImportingData"), "error");
            return;
          }
          const buf = new Uint8Array(e.target.result);
          const wb = XLSX.read(buf, { type: "array" });
          const names = wb.SheetNames || [];
          let mainName = names.find(n => String(n).toLowerCase() === "datos");
          if (!mainName) {
            mainName = names.find(sn => {
              if (String(sn).toLowerCase() === "info") return false;
              const sh = wb.Sheets[sn];
              if (!sh) return false;
              const sample = XLSX.utils.sheet_to_json(sh, { defval: "", raw: false });
              return this._xlsxSheetLooksLikeMainInventory(sample);
            });
          }
          let items = [];
          let mainRows = [];
          if (!mainName) {
            // Si no hay hoja "principal", intentar modo overlay para libros legacy de cajas (p.ej. libro2.xlsx).
            items = (this.items || []).map(it => ({ ...(it || {}) }));
          } else {
            const mainSheet = wb.Sheets[mainName];
            if (!mainSheet) {
              Utils.showToast(I18n.t("msg.errorImportingData"), "error");
              return;
            }
            mainRows = XLSX.utils.sheet_to_json(mainSheet, { defval: "", raw: false });
            items = this._mergeInventoryImportRowsByCode(mainRows || []);
          }

          const codeMap = {};
          for (const it of items) {
            const k = this._normalizeImportCodeValue(it.code);
            if (k) codeMap[k] = it;
          }

          let mergedBoxSheets = 0;
          let mergedLocRows = 0;
          for (const sn of names) {
            const sl = String(sn).toLowerCase();
            if (sl === "info" || sn === mainName) continue;
            const sh = wb.Sheets[sn];
            if (!sh) continue;
            const subRows = XLSX.utils.sheet_to_json(sh, { defval: "", raw: false });
            if (!Array.isArray(subRows) || !subRows.length) continue;
            const isBoxSheet = this._xlsxSheetLooksLikeBoxStock(sn, subRows);
            const isLocSheet = this._xlsxSheetLooksLikeLocationStock(sn, subRows);

            const agg = this._aggregateBoxStockImportRows(subRows, codeMap);
            if (isBoxSheet || Object.keys(agg).length) {
              this._applyBoxStockAggToItems(items, agg);
              mergedBoxSheets++;
              continue;
            }
            if (isLocSheet) {
              mergedLocRows += this._mergeLocationStockSheetIntoItems(items, subRows);
            }
          }

          const next = items.map(it => this._normalizeItemForStorage(it));
          if (mergedBoxSheets || mergedLocRows) {
            console.info(
              `G-NEEX inventario XLSX: hojas caja fusionadas=${mergedBoxSheets}, filas ubicación aplicadas=${mergedLocRows}`
            );
          }
          finish(next);
        } catch (err) {
          console.error(err);
          Utils.showToast(I18n.t("msg.errorImportingData"), "error");
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Utils.importDataCSV(file, STORAGE_KEYS.INVENTORY, data => {
      const merged = this._mergeInventoryImportRowsByCode(data || []);
      const next = merged.map(it => this._normalizeItemForStorage(it));
      finish(next);
    });
  },

  _setupInventoryHeaderToolsMenu() {
    const btn = document.getElementById("inventory-header-tools-menu-btn");
    const menu = document.getElementById("inventory-header-tools-menu");
    if (!btn || !menu) return;
    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      this._syncInventoryProblemsMenuItemUi();
      this._syncInventoryLowStockIgnoredMenuItemUi();
      this._syncInventoryHeaderFiltersCollapseBtn();
    };
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (menu.hidden) open();
      else close();
    });
    document.addEventListener("click", e => {
      if (menu.hidden) return;
      if (btn.contains(e.target) || menu.contains(e.target)) return;
      close();
    });
    menu.addEventListener("click", e => {
      const lowIg = e.target.closest("[data-inv-toggle-lowstock-ignored]");
      if (lowIg) {
        e.preventDefault();
        this.toggleInventoryLowStockIgnoredFilter();
        close();
        return;
      }
      const prob = e.target.closest("[data-inv-toggle-problems]");
      if (prob) {
        e.preventDefault();
        this.toggleInventoryProblemsFilter();
        close();
        return;
      }
      const collapse = e.target.closest("[data-inv-collapse-filters]");
      if (collapse) {
        if (collapse.disabled) return;
        e.preventDefault();
        this.hideAllInventoryFilterPanels();
        close();
        return;
      }
      const item = e.target.closest("[data-inv-tool-trigger]");
      if (!item) return;
      e.preventDefault();
      const id = item.getAttribute("data-inv-tool-trigger");
      document.getElementById(id)?.click();
      close();
    });
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || menu.hidden) return;
      close();
      btn.focus();
    });
  },

  // =========================================================
  // EVENTOS
  // =========================================================
  setupEventListeners(){
    const s=document.getElementById("inventory-search");
    if(s){
      const runSearch = e => {
        this.render(this.search(e?.target?.value ?? s.value ?? ""));
      };
      s.addEventListener("input", Utils.debounce(runSearch, 300));
      // Respaldo no-debounced: evita sensación de bloqueo tras acciones de clic/filtros.
      s.addEventListener("search", runSearch);
      s.addEventListener("change", runSearch);
    }
    document.getElementById("inventory-search-reset-btn")?.addEventListener("click", () => {
      this.resetInventorySearchAndFilters();
    });
    document.querySelectorAll("[data-inv-insight]").forEach(el => {
      const open = () => this.openInsightModal(el.getAttribute("data-inv-insight"));
      el.addEventListener("click", open);
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });

    document.getElementById("close-inventory-insight")?.addEventListener("click", () => {
      document.getElementById("inventory-insight-modal")?.classList.remove("active");
    });
    document.getElementById("inventory-insight-modal")?.addEventListener("click", e => {
      if (e.target.id === "insight-export-csv") {
        e.stopPropagation();
        void this.exportInsightList();
      } else if (e.target.id === "insight-print-list") {
        e.stopPropagation();
        this.printInsightList();
      } else {
        const buyBtn = e.target.closest(".insight-add-purchase-btn[data-item-code]");
        if (buyBtn) {
          e.preventDefault();
          e.stopPropagation();
          this.markForPurchase(buyBtn.getAttribute("data-item-code") || "");
          this.openInsightModal("low");
          if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.renderPurchaseSuggestionsPanel) {
            OrderLinesManager.renderPurchaseSuggestionsPanel();
          }
          return;
        }
        const lowTg = e.target.closest(".insight-low-ignore-toggle[data-item-id]");
        if (lowTg) {
          e.stopPropagation();
          return;
        }
        const row = e.target.closest("tr.inventory-insight-row--editable[data-item-id]");
        if (row && typeof Auth !== "undefined" && Auth.isAdmin()) {
          const id = row.getAttribute("data-item-id");
          if (id && typeof ConfigManager !== "undefined" && ConfigManager.openItemEditorFromInventoryById) {
            e.preventDefault();
            ConfigManager.openItemEditorFromInventoryById(id);
          }
        }
      }
    });
    document.getElementById("inventory-insight-modal")?.addEventListener("change", e => {
      const lowMode = e.target?.id === "insight-low-show-ignored";
      if (lowMode) {
        this._insightLowShowIgnored = !!e.target.checked;
        this.openInsightModal("low");
        return;
      }
      const tg = e.target.closest(".insight-low-ignore-toggle[data-item-id]");
      if (!tg) return;
      const id = tg.getAttribute("data-item-id");
      if (!id) return;
      if (typeof Auth !== "undefined" && !Auth.hasPerm("editItems")) {
        tg.checked = !tg.checked;
        Utils.showToast(I18n.t("auth.noPermission"), "warning");
        return;
      }
      this.setIgnoreLowStockDetection(id, !!tg.checked);
      // Refresca de inmediato la lista de bajo stock: el artículo marcado desaparece al instante.
      this.openInsightModal("low");
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    });

    document.getElementById("inventory-export-csv")?.addEventListener("click", () => this.openInventoryExportModal());
    document.getElementById("close-inventory-export-modal")?.addEventListener("click", () => this.closeInventoryExportModal());
    document.getElementById("inventory-export-cancel")?.addEventListener("click", () => this.closeInventoryExportModal());
    document.getElementById("inventory-export-columns-all")?.addEventListener("click", () =>
      this._setAllInventoryExportColumns(true)
    );
    document.getElementById("inventory-export-columns-none")?.addEventListener("click", () =>
      this._setAllInventoryExportColumns(false)
    );
    document.getElementById("inventory-export-mode-default")?.addEventListener("change", e => {
      if (e.target.checked) this._setInventoryExportColumnsDisabled(true);
    });
    document.getElementById("inventory-export-mode-custom")?.addEventListener("change", e => {
      if (e.target.checked) this._setInventoryExportColumnsDisabled(false);
    });
    document.getElementById("inventory-export-run")?.addEventListener("click", () => {
      const mode = document.getElementById("inventory-export-mode-custom")?.checked ? "custom" : "default";
      this.exportCurrentInventoryView(mode);
      this.closeInventoryExportModal();
    });
    document.getElementById("inventory-print-list")?.addEventListener("click", () => this.printCurrentInventoryView());
    document.getElementById("inventory-clear-expiration-data")?.addEventListener("click", () => this.clearAllExpirationData());
    document.getElementById("inventory-box-summary-btn")?.addEventListener("click", () => this.openWarehouseBoxSummaryModal());
    document.getElementById("inventory-box-zero-total-btn")?.addEventListener("click", () =>
      this.openZeroTotalStockByBoxModal()
    );
    document.getElementById("inventory-box-manager-btn")?.addEventListener("click", () => this.openBoxManagerModal());
    document.getElementById("inventory-refresh-data-btn")?.addEventListener("click", () =>
      this.runRefreshInventoryDataAction()
    );
    this.setupLogoRefreshTrigger();
    document.getElementById("inventory-export-stock-template-btn")?.addEventListener("click", () =>
      void this.exportInventoryStockUpdateTemplate()
    );
    document.getElementById("inventory-import-stock-update-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardLoadInventoryCsv()) return;
      document.getElementById("inventory-stock-update-import-input")?.click();
    });
    document.getElementById("inventory-stock-update-import-input")?.addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (file) this.importInventoryStockUpdate(file);
      e.target.value = "";
    });
    document.getElementById("close-inventory-box-zero-total")?.addEventListener("click", () =>
      this.closeZeroTotalStockByBoxModal()
    );
    document.getElementById("inventory-box-zero-total-modal")?.addEventListener("click", e => {
      const tr = e.target.closest("tr.inv-box-zero-total-row[data-box-number]");
      if (!tr) return;
      const boxNum = parseInt(tr.getAttribute("data-box-number") || "", 10);
      const openItemId = String(tr.getAttribute("data-open-item-id") || "").trim();
      if (!this._isValidBoxNumber(boxNum)) return;
      this.closeZeroTotalStockByBoxModal();
      if (openItemId) {
        this._openBoxManagerAtItemBox(openItemId, boxNum);
        return;
      }
      if (this._setInventoryBoxFilterByNumber(boxNum)) {
        Utils.showToast(I18n.t("inventory.boxZeroTotalFilterToast").replace("{n}", String(boxNum)), "info");
      } else {
        Utils.showToast(I18n.t("inventory.boxZeroTotalNoJumpToast").replace("{n}", String(boxNum)), "warning");
      }
    });
    document.getElementById("inventory-box-zero-total-modal")?.addEventListener("keydown", e => {
      const tr = e.target.closest("tr.inv-box-zero-total-row[data-box-number]");
      if (!tr || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      tr.click();
    });
    document.getElementById("close-inventory-box-summary")?.addEventListener("click", () => {
      document.getElementById("inventory-box-summary-modal")?.classList.remove("active");
    });
    document.getElementById("inventory-box-summary-modal")?.addEventListener("click", e => {
      if (e.target.closest("#inventory-box-summary-export-content")) {
        void this.exportBoxContentListing();
        return;
      }
      if (e.target.closest("#inventory-box-summary-print-content")) {
        this.printBoxContentListing();
        return;
      }
      if (e.target.closest("#inventory-box-summary-search-clear")) {
        const searchInp = document.getElementById("inventory-box-summary-item-search");
        if (searchInp) searchInp.value = "";
        const scopeSel = document.getElementById("inventory-box-summary-export-scope");
        if (scopeSel) scopeSel.value = "all";
        this._syncBoxSummarySelectionUi();
        return;
      }
      if (e.target.closest(".inv-box-summary-select")) {
        e.stopPropagation();
        this._renderBoxContentListingPreview();
        return;
      }
      const tr = e.target.closest("tr.inv-box-summary-row[data-box-num]");
      if (!tr) return;
      e.stopPropagation();
      const cb = tr.querySelector(".inv-box-summary-select");
      if (!cb || cb.disabled) return;
      cb.checked = !cb.checked;
      this._renderBoxContentListingPreview();
    });
    document.getElementById("inventory-box-summary-modal")?.addEventListener("keydown", e => {
      const tr = e.target.closest("tr.inv-box-summary-row[data-box-num]");
      if (!tr || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      const cb = tr.querySelector(".inv-box-summary-select");
      if (!cb || cb.disabled) return;
      cb.checked = !cb.checked;
      this._renderBoxContentListingPreview();
    });
    document.getElementById("inventory-box-summary-modal")?.addEventListener("change", e => {
      if (e.target?.id === "inventory-box-summary-export-scope") {
        this._syncBoxSummarySelectionUi();
      }
    });
    document.getElementById("inventory-box-summary-modal")?.addEventListener("input", e => {
      if (e.target?.id !== "inventory-box-summary-item-search") return;
      const q = String(e.target.value || "");
      if (!q.trim()) {
        this._renderBoxContentListingPreview();
        return;
      }
      const n = this._applyBoxSummarySearchSelection(q);
      if (n <= 0) Utils.showToast(I18n.t("inventory.boxSummarySearchNoMatch"), "info");
    });
    document.getElementById("inventory-box-filter")?.addEventListener("change", () => {
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    });
    document.getElementById("inventory-depot-preset")?.addEventListener("change", () => {
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    });
    document.getElementById("inventory-consumable-filter")?.addEventListener("change", () => {
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    });
    document.getElementById("inventory-box-filter-toggle-btn")?.addEventListener("click", () => {
      this.toggleInventoryBoxFilterVisibility();
    });
    document.getElementById("inventory-depot-filter-toggle-btn")?.addEventListener("click", () => {
      this.toggleInventoryDepotFilterVisibility();
    });
    document.getElementById("inventory-consumable-filter-toggle-btn")?.addEventListener("click", () => {
      this.toggleInventoryConsumableFilterVisibility();
    });
    document.getElementById("inventory-problems-filter-toggle-btn")?.addEventListener("click", () => {
      this.toggleInventoryProblemsFilter();
    });
    document.getElementById("inventory-lowstock-ignored-filter-toggle-btn")?.addEventListener("click", () => {
      this.toggleInventoryLowStockIgnoredFilter();
    });
    const filterWrap = document.getElementById("inventory-box-filter-wrap");
    if (filterWrap) {
      filterWrap.hidden = true;
      filterWrap.style.display = "none";
    }
    this._syncInventoryBoxFilterToggleUi();
    const depotFilterWrap = document.getElementById("inventory-depot-filter-wrap");
    if (depotFilterWrap) {
      depotFilterWrap.hidden = true;
      depotFilterWrap.style.display = "none";
    }
    this._syncInventoryDepotFilterToggleUi();
    const consumableFilterWrap = document.getElementById("inventory-consumable-filter-wrap");
    if (consumableFilterWrap) {
      consumableFilterWrap.hidden = true;
      consumableFilterWrap.style.display = "none";
    }
    this._syncInventoryConsumableFilterToggleUi();
    this._syncInventoryProblemsFilterToggleUi();
    this._syncInventoryLowStockIgnoredFilterToggleUi();
    this._syncInventoryProblemsMenuItemUi();
    this._syncInventoryLowStockIgnoredMenuItemUi();
    this._syncInventoryHeaderFiltersCollapseBtn();
    document.getElementById("close-inventory-box-manager")?.addEventListener("click", () => this.closeBoxManagerModal());
    document.getElementById("inventory-box-item-search")?.addEventListener(
      "input",
      Utils.debounce(e => this._renderBoxManagerSearchResults(e.target.value), 180)
    );
    document.getElementById("inventory-box-item-search-results")?.addEventListener("click", e => {
      const row = e.target.closest(".search-result-item[data-item-id]");
      if (!row) return;
      const id = row.getAttribute("data-item-id");
      this._boxMgrItemId = id || "";
      this._resetBoxManagerBoxForm();
      this._applyBoxManagerItemSelection();
      const results = document.getElementById("inventory-box-item-search-results");
      const inp = document.getElementById("inventory-box-item-search");
      if (results) {
        results.classList.remove("active");
        results.innerHTML = "";
      }
      if (inp) inp.value = "";
    });
    document.getElementById("inventory-box-clear-article-btn")?.addEventListener("click", () =>
      this.clearBoxManagerArticleSelection()
    );
    document.getElementById("inventory-box-mark-empty")?.addEventListener("change", () => this._syncEmptyCheckboxUi());
    document.getElementById("inventory-box-save-btn")?.addEventListener("click", () => void this.saveBoxManagerBoxFromForm());
    document.getElementById("inventory-box-cancel-edit-btn")?.addEventListener("click", () => this._resetBoxManagerBoxForm());
    document.getElementById("inventory-box-transfer-btn")?.addEventListener("click", () => this.transferBoxManagerStock());
    document.getElementById("inventory-box-transfer-from")?.addEventListener("change", () => this._syncBoxTransferLocationVisibility());
    document.getElementById("inventory-box-transfer-to")?.addEventListener("change", () => this._syncBoxTransferLocationVisibility());
    document.getElementById("inventory-box-item-body")?.addEventListener("click", e => this.handleBoxManagerTableClick(e));
    document.getElementById("inventory-box-item-body")?.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row =
        e.target.closest("tr.inv-box-mgr-row[data-box-id]") || e.target.closest("tr[data-inferred-box]");
      if (!row) return;
      e.preventDefault();
      row.click();
    });
    document.getElementById("inventory-box-template-btn")?.addEventListener("click", () => void this.exportBoxStockTemplate());
    document.getElementById("inventory-box-export-btn")?.addEventListener("click", () => void this.exportBoxStockData());
    document.getElementById("inventory-box-import-btn")?.addEventListener("click", () => {
      document.getElementById("inventory-box-stock-import-input")?.click();
    });
    document.getElementById("inventory-box-stock-import-input")?.addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        if (typeof Auth !== "undefined" && !Auth.guardFineAction("invTools", "edit")) {
          e.target.value = "";
          return;
        }
        this.importBoxStockTemplate(file);
      }
      e.target.value = "";
    });

    const asofDate = document.getElementById("inventory-asof-date");
    document.getElementById("inventory-asof-open")?.addEventListener("click", () => this._openInventoryAsOfPicker());
    asofDate?.addEventListener("change", () => {
      const v = (asofDate.value || "").trim();
      if (!v) return;
      this._asOfDate = v;
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    });
    document.getElementById("inventory-asof-clear")?.addEventListener("click", () => {
      this._asOfDate = null;
      if (asofDate) asofDate.value = "";
      this.render(this.search(document.getElementById("inventory-search")?.value || ""));
    });

    const invBody = document.getElementById("inventory-body");
    if (invBody && !this._invNotesRowClickBound) {
      this._invNotesRowClickBound = true;
      invBody.addEventListener("click", e => {
        const toggle = e.target.closest(".inv-row-actions-toggle[data-item-id]");
        if (toggle) {
          e.preventDefault();
          const id = toggle.getAttribute("data-item-id");
          if (!id) return;
          invBody.querySelectorAll(".inv-row-actions.is-open").forEach(el => {
            if (el.getAttribute("data-item-id") !== id) {
              el.classList.remove("is-open");
              delete el.dataset.openByClick;
            }
          });
          const holder = toggle.closest(".inv-row-actions");
          if (holder) {
            const willOpen = !holder.classList.contains("is-open");
            holder.classList.toggle("is-open", willOpen);
            if (willOpen) holder.dataset.openByClick = "1";
            else delete holder.dataset.openByClick;
          }
          return;
        }
        if (this._handleInventoryLocationJump(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const btn = e.target.closest(".inv-notes-hit");
        if (btn && btn.dataset.itemId) {
          e.preventDefault();
          this.openItemNotesModal(btn.dataset.itemId);
          return;
        }
        const quickBtn = e.target.closest(".inv-quick-hit");
        if (quickBtn && quickBtn.dataset.itemId) {
          e.preventDefault();
          this.openItemQuickViewModal(quickBtn.dataset.itemId);
          invBody.querySelectorAll(".inv-row-actions.is-open").forEach(el => el.classList.remove("is-open"));
          return;
        }
        const purchaseBtn = e.target.closest(".inv-add-purchase-hit");
        if (purchaseBtn && purchaseBtn.dataset.itemCode) {
          e.preventDefault();
          this.markForPurchase(purchaseBtn.dataset.itemCode);
          invBody.querySelectorAll(".inv-row-actions.is-open").forEach(el => el.classList.remove("is-open"));
        }
      });
    }
    if (invBody && !this._invRowActionsHoverBound) {
      this._invRowActionsHoverBound = true;
      invBody.addEventListener("mouseout", e => {
        const holder = e.target.closest(".inv-row-actions");
        if (!holder) return;
        const rel = e.relatedTarget;
        if (rel && holder.contains(rel)) return;
        const key = String(holder.getAttribute("data-item-id") || "");
        if (!key) return;
        clearTimeout(this._invRowActionsCloseTimers[key]);
        this._invRowActionsCloseTimers[key] = setTimeout(() => {
          holder.classList.remove("is-open");
          delete holder.dataset.openByClick;
          delete this._invRowActionsCloseTimers[key];
        }, 260);
      });
      invBody.addEventListener("mouseover", e => {
        const holder = e.target.closest(".inv-row-actions");
        if (!holder) return;
        const key = String(holder.getAttribute("data-item-id") || "");
        if (!key) return;
        clearTimeout(this._invRowActionsCloseTimers[key]);
        delete this._invRowActionsCloseTimers[key];
      });
    }
    if (!this._invRowActionsOutsideCloseBound) {
      this._invRowActionsOutsideCloseBound = true;
      document.addEventListener("click", e => {
        const inInv = e.target && e.target.closest ? e.target.closest("#inventory-body") : null;
        if (inInv) return;
        document.querySelectorAll(".inv-row-actions.is-open").forEach(el => el.classList.remove("is-open"));
      });
    }
    if (invBody && !this._invCodeDblClickBound) {
      this._invCodeDblClickBound = true;
      invBody.addEventListener("dblclick", e => {
        if (typeof Auth === "undefined" || !Auth.isAdmin()) return;
        const td = e.target.closest("tr.inv-row td.inv-code-cell--admin");
        if (!td) return;
        const row = td.closest("tr.inv-row[data-id]");
        if (!row) return;
        const id = row.getAttribute("data-id");
        if (!id || typeof ConfigManager === "undefined" || !ConfigManager.openItemEditorFromInventoryById) return;
        e.preventDefault();
        ConfigManager.openItemEditorFromInventoryById(id);
      });
    }

    if (!this._invNotesModalUiBound) {
      this._invNotesModalUiBound = true;
      document.getElementById("close-inv-notes-modal")?.addEventListener("click", () => this.closeItemNotesModal());
      document.getElementById("inv-notes-cancel")?.addEventListener("click", () => this.closeItemNotesModal());
      document.getElementById("inv-notes-save")?.addEventListener("click", () => this.saveItemNotesFromModal());
    }
    if (!this._invQuickModalUiBound) {
      this._invQuickModalUiBound = true;
      document.getElementById("close-inv-quick-modal")?.addEventListener("click", () => this.closeItemQuickViewModal());
      document.getElementById("inv-quick-export-lots")?.addEventListener("click", () => this.exportQuickViewLotsTable());
      document.getElementById("inv-quick-print-lots")?.addEventListener("click", () => this.printQuickViewLotsTable());
      document.getElementById("inv-quick-close")?.addEventListener("click", () => this.closeItemQuickViewModal());
    }

    this._setupInventoryHeaderToolsMenu();
  }
};
