// measureUnits.js — unidades de medida, equivalencias y conversión entre unidades enlazadas

const MeasureUnitsManager = {
  /** Símbolo reservado: se crea en el catálogo si no existe y se usa como unidad de stock por defecto en artículos. */
  DEFAULT_STOCK_UNIT_SYMBOL: "U",

  /** @type {{ units: { id: string, symbol: string, label: string }[], equivalences: { id: string, unitIdA: string, qtyA: number, unitIdB: string, qtyB: number }[] }} */
  catalog: { units: [], equivalences: [] },
  _configBound: false,

  init() {
    this.load();
    this.ensureDefaultStockUnit();
    this._bindConfig();
  },

  _measureUnitsStorageKeys() {
    return {
      primary: STORAGE_KEYS.MEASURE_UNITS_CATALOG,
      backup: STORAGE_KEYS.MEASURE_UNITS_CATALOG_BACKUP
    };
  },

  /**
   * Interpreta JSON guardado; devuelve null si falta, es inválido o está corrupto.
   * @returns {{ units: unknown[], equivalences: unknown[] } | null}
   */
  _parseCatalogRaw(raw) {
    if (raw == null || String(raw).trim() === "") return null;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      return {
        units: Array.isArray(o.units) ? o.units : [],
        equivalences: Array.isArray(o.equivalences) ? o.equivalences : []
      };
    } catch {
      return null;
    }
  },

  _persistCatalog() {
    try {
      const serialized = JSON.stringify(this.catalog);
      const { primary, backup } = this._measureUnitsStorageKeys();
      localStorage.setItem(primary, serialized);
      localStorage.setItem(backup, serialized);
    } catch {}
  },

  load() {
    const { primary, backup } = this._measureUnitsStorageKeys();
    const parsedPrimary = this._parseCatalogRaw(localStorage.getItem(primary));
    let recovered = false;
    let parsed = parsedPrimary;

    if (parsed === null) {
      const parsedBackup = this._parseCatalogRaw(localStorage.getItem(backup));
      if (parsedBackup !== null) {
        parsed = parsedBackup;
        recovered = true;
        try {
          localStorage.setItem(primary, JSON.stringify(parsed));
        } catch {}
      }
    }

    if (parsed === null) {
      parsed = { units: [], equivalences: [] };
    }

    this.catalog = parsed;
    this._normalizeCatalog();
    this._persistCatalog();

    if (recovered && typeof Utils !== "undefined" && Utils.showToast && typeof I18n !== "undefined") {
      Utils.showToast(I18n.t("measureUnits.recoveredFromBackup"), "info", 7000);
    }
  },

  save() {
    this._persistCatalog();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) {
      InventoryManager.render();
    }
  },

  /**
   * Garantiza una unidad con símbolo `U` en el catálogo (sin re-render de inventario).
   */
  ensureDefaultStockUnit() {
    this._normalizeCatalog();
    if (this.findUnitBySymbol(this.DEFAULT_STOCK_UNIT_SYMBOL)) return;
    this.catalog.units.push({
      id: Utils.generateId(),
      symbol: this.DEFAULT_STOCK_UNIT_SYMBOL,
      label: ""
    });
    this._normalizeCatalog();
    this._persistCatalog();
  },

  _normalizeCatalog() {
    const symSeen = new Set();
    const units = [];
    for (const u of this.catalog.units || []) {
      if (!u || typeof u !== "object") continue;
      const symbol = String(u.symbol || "").trim();
      if (!symbol) continue;
      const key = symbol.toLowerCase();
      if (symSeen.has(key)) continue;
      symSeen.add(key);
      units.push({
        id: u.id && String(u.id).trim() ? String(u.id) : Utils.generateId(),
        symbol,
        label: String(u.label || "").trim()
      });
    }
    units.sort((a, b) => a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" }));
    const idSet = new Set(units.map(x => x.id));
    const equivalences = [];
    for (const eq of this.catalog.equivalences || []) {
      if (!eq || typeof eq !== "object") continue;
      const unitIdA = String(eq.unitIdA || "").trim();
      const unitIdB = String(eq.unitIdB || "").trim();
      const qtyA = parseFloat(eq.qtyA);
      const qtyB = parseFloat(eq.qtyB);
      if (!unitIdA || !unitIdB || unitIdA === unitIdB) continue;
      if (!idSet.has(unitIdA) || !idSet.has(unitIdB)) continue;
      if (!Number.isFinite(qtyA) || !Number.isFinite(qtyB) || qtyA <= 0 || qtyB <= 0) continue;
      equivalences.push({
        id: eq.id && String(eq.id).trim() ? String(eq.id) : Utils.generateId(),
        unitIdA,
        qtyA: Utils.roundDecimal(qtyA, 8),
        unitIdB,
        qtyB: Utils.roundDecimal(qtyB, 8)
      });
    }
    this.catalog = { units, equivalences };
  },

  getUnit(id) {
    const sid = String(id || "").trim();
    if (!sid) return null;
    return this.catalog.units.find(u => u.id === sid) || null;
  },

  findUnitBySymbol(sym) {
    const s = String(sym || "").trim().toLowerCase();
    if (!s) return null;
    return this.catalog.units.find(u => u.symbol.toLowerCase() === s) || null;
  },

  resolveUnitIdFromImportSymbol(raw) {
    const u = this.findUnitBySymbol(raw);
    return u ? u.id : "";
  },

  /**
   * Convierte cantidad desde fromUnitId hacia toUnitId usando equivalencias (grafo no dirigido).
   * @returns {number|null}
   */
  convertQty(qty, fromUnitId, toUnitId) {
    const q = parseFloat(qty);
    if (!Number.isFinite(q)) return null;
    const a = String(fromUnitId || "").trim();
    const b = String(toUnitId || "").trim();
    if (!a || !b) return null;
    if (a === b) return Utils.roundDecimal(q, 8);
    const adj = this._buildAdjacency();
    const queue = [{ id: a, factor: 1 }];
    const visited = new Set([a]);
    while (queue.length) {
      const cur = queue.shift();
      const edges = adj.get(cur.id) || [];
      for (const { next, mult } of edges) {
        if (visited.has(next)) continue;
        const nf = cur.factor * mult;
        if (next === b) return Utils.roundDecimal(q * nf, 8);
        visited.add(next);
        queue.push({ id: next, factor: nf });
      }
    }
    return null;
  },

  _buildAdjacency() {
    const m = new Map();
    const add = (from, to, mult) => {
      if (!m.has(from)) m.set(from, []);
      m.get(from).push({ next: to, mult });
    };
    for (const eq of this.catalog.equivalences) {
      const fa = eq.qtyB / eq.qtyA;
      const fb = eq.qtyA / eq.qtyB;
      add(eq.unitIdA, eq.unitIdB, fa);
      add(eq.unitIdB, eq.unitIdA, fb);
    }
    return m;
  },

  getSelectOptionsHtml() {
    return this.catalog.units
      .map(u => {
        const lab = u.label ? `${this._esc(u.symbol)} — ${this._esc(u.label)}` : this._esc(u.symbol);
        return `<option value="${Utils.escapeAttr(u.id)}">${lab}</option>`;
      })
      .join("");
  },

  /** Fragmento HTML tras la cantidad en la celda de stock principal */
  itemStockUnitSuffixHtml(it, mainQtyShown) {
    if (typeof it !== "object" || !it) return "";
    const sid = String(it.measureStockUnitId || "").trim();
    const aid = String(it.measureAltUnitId || "").trim();
    const qtyBase = parseFloat(mainQtyShown);
    const u = sid ? this.getUnit(sid) : null;
    if (!u) return "";
    let html = ` <span class="inv-stock-uom">${this._esc(u.symbol)}</span>`;
    if (aid && aid !== sid && Number.isFinite(qtyBase)) {
      const conv = this.convertQty(qtyBase, sid, aid);
      const au = this.getUnit(aid);
      if (conv != null && au) {
        const approx =
          typeof I18n !== "undefined" && I18n.t ? I18n.t("measureUnits.approxShort") : "≈";
        html += ` <span class="inv-stock-uom-alt">${this._esc(approx)} ${this._esc(
          Utils.formatDecimalDisplay(conv)
        )} ${this._esc(au.symbol)}</span>`;
      }
    }
    return html;
  },

  conversionHintForEditor(stockUnitId, altUnitId, sampleQty) {
    const s = String(stockUnitId || "").trim();
    const a = String(altUnitId || "").trim();
    const q = parseFloat(sampleQty);
    if (!s || !a || s === a || !Number.isFinite(q)) return "";
    const conv = this.convertQty(q, s, a);
    const ua = this.getUnit(a);
    const us = this.getUnit(s);
    if (conv == null || !ua || !us) {
      return typeof I18n !== "undefined" && I18n.t ? I18n.t("measureUnits.noEquivalencePath") : "";
    }
    const fmt = Utils.formatDecimalDisplay;
    return `${fmt(q)} ${us.symbol} → ${fmt(conv)} ${ua.symbol}`;
  },

  _unitInUse(unitId) {
    const id = String(unitId || "").trim();
    if (!id || typeof InventoryManager === "undefined" || !Array.isArray(InventoryManager.items)) return false;
    return InventoryManager.items.some(
      it => String(it.measureStockUnitId || "").trim() === id || String(it.measureAltUnitId || "").trim() === id
    );
  },

  addUnit(symbolRaw, labelRaw) {
    if (!this._canEdit()) return;
    const symbol = String(symbolRaw || "").trim();
    if (!symbol) {
      Utils.showToast(I18n.t("measureUnits.symbolRequired"), "warning");
      return;
    }
    if (this.findUnitBySymbol(symbol)) {
      Utils.showToast(I18n.t("measureUnits.duplicateSymbol"), "warning");
      return;
    }
    const label = String(labelRaw || "").trim();
    this.catalog.units.push({
      id: Utils.generateId(),
      symbol,
      label
    });
    this._normalizeCatalog();
    this.save();
    this.renderConfigList();
    Utils.showToast(I18n.t("measureUnits.unitAdded"), "success");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("measureUnits.addUnit", symbol);
  },

  removeUnit(id) {
    if (!this._canEdit()) return;
    const sid = String(id || "").trim();
    if (!sid) return;
    const uDel = this.getUnit(sid);
    if (
      uDel &&
      String(uDel.symbol || "")
        .trim()
        .toUpperCase() === String(this.DEFAULT_STOCK_UNIT_SYMBOL).toUpperCase()
    ) {
      Utils.showToast(I18n.t("measureUnits.cannotRemoveDefaultUnit"), "warning");
      return;
    }
    if (this._unitInUse(sid)) {
      Utils.showToast(I18n.t("measureUnits.unitInUse"), "warning");
      return;
    }
    const sym = this.getUnit(sid)?.symbol || sid;
    this.catalog.units = this.catalog.units.filter(u => u.id !== sid);
    this.catalog.equivalences = this.catalog.equivalences.filter(
      e => e.unitIdA !== sid && e.unitIdB !== sid
    );
    this._normalizeCatalog();
    this.save();
    this.renderConfigList();
    Utils.showToast(I18n.t("measureUnits.unitRemoved"), "info");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("measureUnits.removeUnit", sym);
  },

  addEquivalence(unitIdA, qtyA, unitIdB, qtyB) {
    if (!this._canEdit()) return;
    const a = String(unitIdA || "").trim();
    const b = String(unitIdB || "").trim();
    const qa = parseFloat(qtyA);
    const qb = parseFloat(qtyB);
    if (!a || !b || a === b) {
      Utils.showToast(I18n.t("measureUnits.equivalenceUnitsInvalid"), "warning");
      return;
    }
    if (!Number.isFinite(qa) || !Number.isFinite(qb) || qa <= 0 || qb <= 0) {
      Utils.showToast(I18n.t("measureUnits.equivalenceQtyInvalid"), "warning");
      return;
    }
    if (!this.getUnit(a) || !this.getUnit(b)) {
      Utils.showToast(I18n.t("measureUnits.equivalenceUnitsInvalid"), "warning");
      return;
    }
    this.catalog.equivalences.push({
      id: Utils.generateId(),
      unitIdA: a,
      qtyA: Utils.roundDecimal(qa, 8),
      unitIdB: b,
      qtyB: Utils.roundDecimal(qb, 8)
    });
    this._normalizeCatalog();
    this.save();
    this.renderConfigList();
    Utils.showToast(I18n.t("measureUnits.equivalenceAdded"), "success");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("measureUnits.addEquivalence", `${a}|${b}`);
  },

  removeEquivalence(eqId) {
    if (!this._canEdit()) return;
    const id = String(eqId || "").trim();
    if (!id) return;
    this.catalog.equivalences = this.catalog.equivalences.filter(e => e.id !== id);
    this._normalizeCatalog();
    this.save();
    this.renderConfigList();
    Utils.showToast(I18n.t("measureUnits.equivalenceRemoved"), "info");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("measureUnits.removeEquivalence", id);
  },

  renderConfigList() {
    const unitsBody = document.getElementById("measureunits-units-tbody");
    const eqBody = document.getElementById("measureunits-eq-tbody");
    if (unitsBody) {
      if (!this.catalog.units.length) {
        unitsBody.innerHTML = `<tr><td colspan="4" class="muted">${this._esc(I18n.t("measureUnits.unitsEmpty"))}</td></tr>`;
      } else {
        const del = I18n.t("buttons.delete");
        unitsBody.innerHTML = this.catalog.units
          .map(u => {
            const lbl = u.label || "—";
            return `<tr data-unit-id="${Utils.escapeAttr(u.id)}">
              <td>${this._esc(u.symbol)}</td>
              <td>${this._esc(lbl)}</td>
              <td><code class="measureunits-id-chip">${this._esc(u.id.slice(0, 8))}…</code></td>
              <td><button type="button" class="btn btn-secondary btn-sm measureunits-remove-unit-btn" data-id="${Utils.escapeAttr(
                u.id
              )}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button></td>
            </tr>`;
          })
          .join("");
      }
    }
    if (eqBody) {
      if (!this.catalog.equivalences.length) {
        eqBody.innerHTML = `<tr><td colspan="2" class="muted">${this._esc(I18n.t("measureUnits.equivalencesEmpty"))}</td></tr>`;
      } else {
        const del = I18n.t("buttons.delete");
        eqBody.innerHTML = this.catalog.equivalences
          .map(eq => {
            const ua = this.getUnit(eq.unitIdA);
            const ub = this.getUnit(eq.unitIdB);
            const left = ua ? `${Utils.formatDecimalDisplay(eq.qtyA)} ${ua.symbol}` : eq.unitIdA;
            const right = ub ? `${Utils.formatDecimalDisplay(eq.qtyB)} ${ub.symbol}` : eq.unitIdB;
            return `<tr data-eq-id="${Utils.escapeAttr(eq.id)}">
              <td>${this._esc(left)} = ${this._esc(right)}</td>
              <td><button type="button" class="btn btn-secondary btn-sm measureunits-remove-eq-btn" data-id="${Utils.escapeAttr(
                eq.id
              )}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button></td>
            </tr>`;
          })
          .join("");
      }
    }
    this._repopulateEquivUnitSelects();
  },

  _repopulateEquivUnitSelects() {
    const selA = document.getElementById("measureunits-eq-unit-a");
    const selB = document.getElementById("measureunits-eq-unit-b");
    const blank = `<option value="">${this._esc(I18n.t("measureUnits.pickUnit"))}</option>`;
    const opts = this.getSelectOptionsHtml();
    const fill = el => {
      if (!el) return;
      const prev = el.value;
      el.innerHTML = blank + opts;
      if (prev && [...el.options].some(o => o.value === prev)) el.value = prev;
    };
    fill(selA);
    fill(selB);
  },

  _bindConfig() {
    if (this._configBound) return;
    this._configBound = true;

    document.getElementById("measureunits-add-unit-btn")?.addEventListener("click", () => {
      const sym = document.getElementById("measureunits-add-symbol")?.value ?? "";
      const lab = document.getElementById("measureunits-add-label")?.value ?? "";
      this.addUnit(sym, lab);
      const si = document.getElementById("measureunits-add-symbol");
      const li = document.getElementById("measureunits-add-label");
      if (si) si.value = "";
      if (li) li.value = "";
      si?.focus();
    });

    document.getElementById("measureunits-add-symbol")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("measureunits-add-unit-btn")?.click();
      }
    });

    document.getElementById("measureunits-add-eq-btn")?.addEventListener("click", () => {
      const a = document.getElementById("measureunits-eq-unit-a")?.value ?? "";
      const b = document.getElementById("measureunits-eq-unit-b")?.value ?? "";
      const qa = document.getElementById("measureunits-eq-qty-a")?.value ?? "";
      const qb = document.getElementById("measureunits-eq-qty-b")?.value ?? "";
      this.addEquivalence(a, qa, b, qb);
    });

    document.getElementById("measureunits-units-tbody")?.addEventListener("click", e => {
      const btn = e.target.closest(".measureunits-remove-unit-btn");
      if (btn?.dataset?.id) this.removeUnit(btn.dataset.id);
    });

    document.getElementById("measureunits-eq-tbody")?.addEventListener("click", e => {
      const btn = e.target.closest(".measureunits-remove-eq-btn");
      if (btn?.dataset?.id) this.removeEquivalence(btn.dataset.id);
    });
  },

  _canEdit() {
    return typeof Auth === "undefined" || Auth.isAdmin() || Auth.isElevated();
  },

  _esc(s) {
    return Utils.escapeHtml(String(s ?? ""));
  }
};
