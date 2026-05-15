// reports.js — exportación XLSX (tablas con formato) de transportes, movimientos y consumo por artículo

const ReportExporter = {
  /** Términos de artículo elegidos (lista en chips); se sincroniza en `#report-item-needle`. */
  _reportItemChipTokens: [],
  /** IDs de proyecto elegidos; se sincroniza en `#report-item-project-ids`. */
  _reportProjectChipIds: [],
  /** Claves de `MOVEMENT_TYPES` elegidas; se sincroniza en `#report-item-movement-types`. */
  _reportMovementTypeKeys: [],

  init() {
    document.getElementById("open-report-modal")?.addEventListener("click", () => this.openModal("movements_filtered"));
    document.getElementById("transport-export-summary-btn")?.addEventListener("click", () => void this.exportTransportsQuick());
    document.getElementById("transport-print-summary-btn")?.addEventListener("click", () => this.printTransportsQuick());
    document.getElementById("close-report-modal")?.addEventListener("click", () => this.closeModal());
    document.getElementById("report-export-btn")?.addEventListener("click", () => void this.runExport());
    document.getElementById("report-type")?.addEventListener("change", () => this.syncItemWrap());
    document.getElementById("report-columns-all")?.addEventListener("click", () => this._setAllColumnsChecked(true));
    document.getElementById("report-columns-none")?.addEventListener("click", () => this._setAllColumnsChecked(false));
    this.syncItemWrap();
    this._setupReportItemSuggestions();
    this._setupReportProjectSuggestions();
    this._setupReportMovementTypeSuggestions();
    this._setupReportConsumptionChipUi();
    document.getElementById("report-item-chips-clear")?.addEventListener("click", () => {
      this._reportItemChipTokens = [];
      this._renderReportConsumptionChips();
      this._syncReportConsumptionHiddenFields();
    });
    document.getElementById("report-project-chips-clear")?.addEventListener("click", () => {
      this._reportProjectChipIds = [];
      this._renderReportConsumptionChips();
      this._syncReportConsumptionHiddenFields();
    });
    document.getElementById("report-movtype-chips-clear")?.addEventListener("click", () => {
      this._reportMovementTypeKeys = [];
      this._renderReportConsumptionChips();
      this._syncReportConsumptionHiddenFields();
    });
  },

  _setColumnPickerHeaders(headers) {
    const list = document.getElementById("report-columns-list");
    if (!list) return;
    const arr = Array.isArray(headers) ? headers : [];
    list.innerHTML = arr
      .map(
        h => `<label class="report-col-opt"><input type="checkbox" class="report-col-check" value="${Utils.escapeAttr(h)}" checked> <span>${Utils.escapeHtml(h)}</span></label>`
      )
      .join("");
  },

  _setAllColumnsChecked(checked) {
    document.querySelectorAll("#report-columns-list .report-col-check").forEach(el => {
      el.checked = !!checked;
    });
  },

  _getSelectedHeaders(allHeaders) {
    const selected = Array.from(document.querySelectorAll("#report-columns-list .report-col-check:checked")).map(
      el => String(el.value || "")
    );
    const allowed = new Set(selected);
    const out = (allHeaders || []).filter(h => allowed.has(h));
    return out.length ? out : (allHeaders || []);
  },

  _headersForKind(kind) {
    if (kind === "transports") return this.buildTransportsSummary().headers;
    if (kind === "transports_lines") return this.buildTransportsLines().headers;
    if (kind === "movements_filtered" || kind === "movements_all") return this.buildMovementsSummary([]).headers;
    if (kind === "movements_lines_filtered" || kind === "item_consumption") return this.buildMovementItemRows([]).headers;
    if (kind === "consumo_recipient_all") {
      if (
        typeof HistoryManager !== "undefined" &&
        HistoryManager.buildConsumoRecipientLedgerCsvPayload
      ) {
        return HistoryManager.buildConsumoRecipientLedgerCsvPayload([]).headers || [];
      }
      return [];
    }
    return [];
  },

  _hideReportProjectSuggestions() {
    const res = document.getElementById("report-project-suggestions");
    if (!res) return;
    res.innerHTML = "";
    res.classList.remove("active");
    res.setAttribute("aria-hidden", "true");
  },

  _hideReportItemSuggestions() {
    const res = document.getElementById("report-item-suggestions");
    if (!res) return;
    res.innerHTML = "";
    res.classList.remove("active");
    res.setAttribute("aria-hidden", "true");
  },

  /** Coincidencias del inventario mientras escribe (informe «Líneas por artículo»). */
  _setupReportItemSuggestions() {
    if (this._reportItemSuggestBound) return;
    const inp = document.getElementById("report-item-search-input");
    const res = document.getElementById("report-item-suggestions");
    if (!inp || !res) return;
    this._reportItemSuggestBound = true;

    const esc = s => (typeof Utils !== "undefined" && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s ?? ""));
    const escAttr = s => (typeof Utils !== "undefined" && Utils.escapeAttr ? Utils.escapeAttr(s) : String(s ?? ""));

    const refresh = () => {
      const wrap = document.getElementById("report-item-wrap");
      if (!wrap || wrap.style.display === "none") {
        this._hideReportItemSuggestions();
        return;
      }
      const q0 = this._firstReportItemTokenForSuggest(inp.value);
      if (q0.length < 1) {
        this._hideReportItemSuggestions();
        return;
      }
      if (typeof InventoryManager === "undefined" || !InventoryManager.search) {
        return;
      }
      const found = InventoryManager.search(q0).slice(0, 25);
      if (!found.length) {
        res.innerHTML = `<div class="search-result-item muted">${esc(I18n.t("msg.noResults"))}</div>`;
      } else {
        res.innerHTML = found
          .map(
            item => `
            <div class="search-result-item report-item-suggestion-hit" role="option" tabindex="-1"
              data-code="${escAttr(item.code)}">
              <span class="result-code">${esc(item.code)}</span>
              <span class="result-description">${esc(item.description)}</span>
              <span class="result-meta muted">${esc(item.category || "")} · ${esc(item.location || "")}</span>
            </div>`
          )
          .join("");
      }
      res.classList.add("active");
      res.setAttribute("aria-hidden", "false");
    };

    inp.addEventListener("input", Utils.debounce(refresh, 180));

    inp.addEventListener("focus", () => {
      if (inp.value.trim().length >= 1) refresh();
    });

    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._addReportItemChipFromSearchInput();
      }
      if (e.key === "Escape") {
        this._hideReportItemSuggestions();
        this._hideReportProjectSuggestions();
        this._hideReportMovementTypeSuggestions();
      }
    });

    res.addEventListener("click", e => {
      const hit = e.target.closest(".report-item-suggestion-hit");
      if (!hit || hit.dataset.code == null) return;
      this._addReportItemToken(hit.dataset.code);
      inp.value = "";
      this._hideReportItemSuggestions();
      inp.focus();
    });

    document.addEventListener("click", e => {
      if (!e.target.closest(".report-item-search-wrap")) this._hideReportItemSuggestions();
      if (!e.target.closest(".report-project-search-wrap")) this._hideReportProjectSuggestions();
      if (!e.target.closest(".report-movtype-search-wrap")) this._hideReportMovementTypeSuggestions();
    });
  },

  closeModal() {
    this._hideReportItemSuggestions();
    this._hideReportProjectSuggestions();
    this._hideReportMovementTypeSuggestions();
    document.getElementById("report-modal")?.classList.remove("active");
  },

  openModal(presetType) {
    const m = document.getElementById("report-modal");
    const sel = document.getElementById("report-type");
    if (sel && presetType && [...sel.options].some(o => o.value === presetType)) {
      sel.value = presetType;
    }
    this.syncItemWrap();
    if (typeof I18n !== "undefined" && I18n.apply) I18n.apply(m || document);
    m?.classList.add("active");
  },

  syncItemWrap() {
    const v = document.getElementById("report-type")?.value || "";
    const wrap = document.getElementById("report-item-wrap");
    if (wrap) wrap.style.display = v === "item_consumption" ? "block" : "none";
    if (v !== "item_consumption") {
      this._hideReportItemSuggestions();
      this._hideReportProjectSuggestions();
      this._hideReportMovementTypeSuggestions();
    } else {
      this._ingestConsumptionSelectionFromHiddenFields();
      this._renderReportConsumptionChips();
      this._syncReportConsumptionHiddenFields();
    }
    this._setColumnPickerHeaders(this._headersForKind(v));
    const modal = document.getElementById("report-modal");
    if (modal && typeof I18n !== "undefined" && I18n.apply) I18n.apply(modal);
  },

  fileStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  },

  /** Separa términos de búsqueda de artículo (coma, punto y coma o salto de línea). */
  _parseReportItemTokens(raw) {
    return String(raw || "")
      .split(/[\n,;]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  },

  /** Separa IDs de proyecto; la comparación ignora mayúsculas. */
  _parseReportProjectIds(raw) {
    return String(raw || "")
      .split(/[\n,;]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  },

  /** Primer término no vacío para sugerencias de inventario mientras escribe. */
  _firstReportItemTokenForSuggest(raw) {
    const t = this._parseReportItemTokens(raw);
    return t.length ? t[0] : String(raw || "").trim().toLowerCase();
  },

  /** Fragmento tras el último separador (para filtrar sugerencias de proyecto). */
  _lastReportProjectSegmentLower(raw) {
    const s = String(raw || "");
    const cut = Math.max(s.lastIndexOf(","), s.lastIndexOf(";"), s.lastIndexOf("\n"));
    return (cut >= 0 ? s.slice(cut + 1) : s).trim().toLowerCase();
  },

  /** IDs de proyecto ya vistos en historial (movimientos, transportes, recepciones). */
  _collectReportHistoryProjectIds() {
    const seen = new Map();
    const add = pid => {
      const t = String(pid || "").trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    };
    if (typeof MovementManager !== "undefined" && Array.isArray(MovementManager.movements)) {
      MovementManager.movements.forEach(m => add(m && m.projectId));
    }
    if (typeof TransportManager !== "undefined" && Array.isArray(TransportManager.transports)) {
      TransportManager.transports.forEach(t => add(t && t.projectId));
    }
    if (typeof ReceptionsManager !== "undefined" && Array.isArray(ReceptionsManager.receptions)) {
      ReceptionsManager.receptions.forEach(r => add(r && r.projectId));
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  },

  _setupReportProjectSuggestions() {
    if (this._reportProjectSuggestBound) return;
    const inp = document.getElementById("report-project-search-input");
    const res = document.getElementById("report-project-suggestions");
    if (!inp || !res) return;
    this._reportProjectSuggestBound = true;

    const esc = s => (typeof Utils !== "undefined" && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s ?? ""));
    const escAttr = s => (typeof Utils !== "undefined" && Utils.escapeAttr ? Utils.escapeAttr(s) : String(s ?? ""));

    const refresh = () => {
      const wrap = document.getElementById("report-item-wrap");
      if (!wrap || wrap.style.display === "none") {
        this._hideReportProjectSuggestions();
        return;
      }
      const all = this._collectReportHistoryProjectIds();
      const needle = this._lastReportProjectSegmentLower(inp.value);
      let list = all;
      if (needle) list = all.filter(id => id.toLowerCase().includes(needle));
      if (!all.length) {
        res.innerHTML = `<div class="search-result-item muted">${esc(I18n.t("reports.projectPredictEmpty"))}</div>`;
      } else if (!list.length) {
        res.innerHTML = `<div class="search-result-item muted">${esc(I18n.t("msg.noResults"))}</div>`;
      } else {
        const cap = needle ? 45 : 40;
        res.innerHTML = list
          .slice(0, cap)
          .map(
            id => `
            <div class="search-result-item report-project-suggestion-hit" role="option" tabindex="-1"
              data-project-id="${escAttr(id)}">
              <span class="result-code">${esc(id)}</span>
            </div>`
          )
          .join("");
      }
      res.classList.add("active");
      res.setAttribute("aria-hidden", "false");
    };

    inp.addEventListener("input", Utils.debounce(refresh, 180));
    inp.addEventListener("focus", () => refresh());

    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._addReportProjectChipFromSearchInput();
      }
      if (e.key === "Escape") {
        this._hideReportProjectSuggestions();
        this._hideReportMovementTypeSuggestions();
      }
    });

    res.addEventListener("click", e => {
      const hit = e.target.closest(".report-project-suggestion-hit");
      if (!hit || hit.dataset.projectId == null) return;
      this._addReportProjectChip(hit.dataset.projectId);
      inp.value = "";
      this._hideReportProjectSuggestions();
      inp.focus();
    });
  },

  _hideReportMovementTypeSuggestions() {
    const res = document.getElementById("report-movtype-suggestions");
    if (!res) return;
    res.innerHTML = "";
    res.classList.remove("active");
    res.setAttribute("aria-hidden", "true");
  },

  _allReportMovementTypeKeys() {
    return typeof MOVEMENT_TYPES !== "undefined" && MOVEMENT_TYPES ? Object.keys(MOVEMENT_TYPES) : [];
  },

  _movementTypeChipLabel(key) {
    const k = String(key || "").trim();
    if (!k) return "";
    const lab =
      typeof I18n !== "undefined" && I18n.t ? String(I18n.t(`movType.${k}`) || "").trim() : "";
    return lab || k;
  },

  _foldForMovTypeMatch(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  },

  _resolveReportMovementTypeFromUserText(raw) {
    const s0 = String(raw || "").trim();
    if (!s0) return { key: null, reason: "none" };
    const keys = this._allReportMovementTypeKeys();
    if (!keys.length) return { key: null, reason: "invalid" };

    const up = s0.replace(/[\s\-]+/g, "_").toUpperCase();
    if (MOVEMENT_TYPES[up]) return { key: up, reason: "ok" };

    const lowSp = s0.toLowerCase().replace(/\s+/g, "_");
    const lowTight = s0.toLowerCase().replace(/[\s_]+/g, "");
    const fr = this._foldForMovTypeMatch(s0);
    if (!fr) return { key: null, reason: "invalid" };

    const labelFold = k =>
      this._foldForMovTypeMatch(typeof I18n !== "undefined" && I18n.t ? I18n.t(`movType.${k}`) : "");
    const keyFold = k => this._foldForMovTypeMatch(k.replace(/_/g, " "));

    const scoreOf = new Map();
    const add = (k, sc) => {
      scoreOf.set(k, Math.max(scoreOf.get(k) || 0, sc));
    };

    for (const k of keys) {
      const kLow = k.toLowerCase();
      const kf = keyFold(k);
      const lf = labelFold(k);
      if (kLow === lowSp) add(k, 100);
      if (kLow.replace(/_/g, "") === lowTight) add(k, 100);
      if (kf === fr) add(k, 95);
      if (lf && lf === fr) add(k, 95);
      if (fr.length >= 2 && kf.startsWith(fr)) add(k, 72);
      if (lf && fr.length >= 2 && lf.startsWith(fr)) add(k, 70);
      const words = s0.split(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_]+/).filter(w => w.length >= 2);
      if (words.length) {
        const okAll = words.every(w => {
          const wf = this._foldForMovTypeMatch(w);
          return wf && (kf.includes(wf) || (lf && lf.includes(wf)));
        });
        if (okAll) add(k, 58 + Math.min(words.length, 4));
      }
      if (fr.length >= 4 && kf.includes(fr)) add(k, 42);
      else if (fr.length >= 3 && kf.includes(fr)) add(k, 36);
      if (lf && fr.length >= 4 && lf.includes(fr)) add(k, 40);
      else if (lf && fr.length >= 3 && lf.includes(fr)) add(k, 34);
    }

    let best = 0;
    for (const v of scoreOf.values()) if (v > best) best = v;
    if (!best) return { key: null, reason: "invalid" };

    let tops = keys.filter(k => (scoreOf.get(k) || 0) === best);
    tops = [...new Set(tops)];
    if (tops.length === 1) return { key: tops[0], reason: "ok" };

    const pref = tops.filter(k => {
      const kf = keyFold(k);
      const lf = labelFold(k);
      return (fr.length >= 2 && kf.startsWith(fr)) || (lf && fr.length >= 2 && lf.startsWith(fr));
    });
    if (pref.length === 1) return { key: pref[0], reason: "ok" };

    const words = s0.split(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_]+/).filter(w => w.length >= 2);
    if (words.length) {
      const wordHits = tops.filter(k => {
        const kf = keyFold(k);
        const lf = labelFold(k);
        return words.every(w => {
          const wf = this._foldForMovTypeMatch(w);
          return wf && (kf.includes(wf) || (lf && lf.includes(wf)));
        });
      });
      if (wordHits.length === 1) return { key: wordHits[0], reason: "ok" };
    }

    return { key: null, reason: "ambiguous" };
  },

  _setupReportMovementTypeSuggestions() {
    if (this._reportMovTypeSuggestBound) return;
    const inp = document.getElementById("report-movtype-search-input");
    const res = document.getElementById("report-movtype-suggestions");
    if (!inp || !res) return;
    this._reportMovTypeSuggestBound = true;

    const esc = s => (typeof Utils !== "undefined" && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s ?? ""));
    const escAttr = s => (typeof Utils !== "undefined" && Utils.escapeAttr ? Utils.escapeAttr(s) : String(s ?? ""));

    const refresh = () => {
      const wrap = document.getElementById("report-item-wrap");
      if (!wrap || wrap.style.display === "none") {
        this._hideReportMovementTypeSuggestions();
        return;
      }
      const needleRaw = String(inp.value || "").trim().toLowerCase();
      const needle = this._foldForMovTypeMatch(inp.value || "");
      const keys = this._allReportMovementTypeKeys().slice().sort((a, b) => a.localeCompare(b));
      let list = keys;
      if (needleRaw.length || needle.length) {
        list = keys.filter(k => {
          if (needle && k.toLowerCase().includes(needleRaw)) return true;
          if (needle && k.toLowerCase().replace(/_/g, "").includes(needle)) return true;
          const lab =
            typeof I18n !== "undefined" && I18n.t ? String(I18n.t(`movType.${k}`) || "").toLowerCase() : "";
          if (needleRaw && lab.includes(needleRaw)) return true;
          const labF = this._foldForMovTypeMatch(lab);
          return needle && labF.includes(needle);
        });
      }
      if (!list.length) {
        res.innerHTML = `<div class="search-result-item muted">${esc(I18n.t("msg.noResults"))}</div>`;
      } else {
        const cap = needle ? 50 : 40;
        res.innerHTML = list
          .slice(0, cap)
          .map(k => {
            const lab =
              typeof I18n !== "undefined" && I18n.t ? String(I18n.t(`movType.${k}`) || "").trim() : k;
            return `
            <div class="search-result-item report-movtype-suggestion-hit" role="option" tabindex="-1"
              data-mov-type="${escAttr(k)}" title="${escAttr(k)}">
              <span class="result-description">${esc(lab || k)}</span>
            </div>`;
          })
          .join("");
      }
      res.classList.add("active");
      res.setAttribute("aria-hidden", "false");
    };

    inp.addEventListener("input", Utils.debounce(refresh, 180));
    inp.addEventListener("focus", () => refresh());

    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._addReportMovementTypeFromSearchInput();
      }
      if (e.key === "Escape") this._hideReportMovementTypeSuggestions();
    });

    res.addEventListener("click", e => {
      const hit = e.target.closest(".report-movtype-suggestion-hit");
      if (!hit || hit.dataset.movType == null) return;
      this._addReportMovementTypeKey(hit.dataset.movType);
      inp.value = "";
      this._hideReportMovementTypeSuggestions();
      inp.focus();
    });
  },

  _setupReportConsumptionChipUi() {
    if (this._reportConsumptionChipUiBound) return;
    const wrap = document.getElementById("report-item-wrap");
    if (!wrap) return;
    this._reportConsumptionChipUiBound = true;
    wrap.addEventListener("click", e => {
      const bItem = e.target.closest("[data-report-remove-item]");
      if (bItem) {
        const idx = parseInt(bItem.getAttribute("data-report-remove-item"), 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < this._reportItemChipTokens.length) {
          this._reportItemChipTokens.splice(idx, 1);
          this._renderReportConsumptionChips();
          this._syncReportConsumptionHiddenFields();
        }
        return;
      }
      const bProj = e.target.closest("[data-report-remove-project]");
      if (bProj) {
        const idx = parseInt(bProj.getAttribute("data-report-remove-project"), 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < this._reportProjectChipIds.length) {
          this._reportProjectChipIds.splice(idx, 1);
          this._renderReportConsumptionChips();
          this._syncReportConsumptionHiddenFields();
        }
        return;
      }
      const bMov = e.target.closest("[data-report-remove-movtype]");
      if (bMov) {
        const idx = parseInt(bMov.getAttribute("data-report-remove-movtype"), 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < this._reportMovementTypeKeys.length) {
          this._reportMovementTypeKeys.splice(idx, 1);
          this._renderReportConsumptionChips();
          this._syncReportConsumptionHiddenFields();
        }
        return;
      }
    });
  },

  _itemTokenListHasLower(list, lower) {
    return list.some(t => String(t).trim().toLowerCase() === lower);
  },

  _projectIdListHasLower(list, lower) {
    return list.some(t => String(t).trim().toLowerCase() === lower);
  },

  _movTypeKeyListHas(list, keyUpper) {
    const u = String(keyUpper || "").trim().toUpperCase();
    if (!u) return false;
    return list.some(t => String(t).trim().toUpperCase() === u);
  },

  _addReportMovementTypeKey(key) {
    const k = String(key || "").trim().toUpperCase();
    if (!k || typeof MOVEMENT_TYPES === "undefined" || !MOVEMENT_TYPES[k]) return;
    if (this._movTypeKeyListHas(this._reportMovementTypeKeys, k)) return;
    this._reportMovementTypeKeys.push(k);
    this._renderReportConsumptionChips();
    this._syncReportConsumptionHiddenFields();
  },

  _addReportMovementTypeFromSearchInput() {
    const inp = document.getElementById("report-movtype-search-input");
    const raw = String(inp?.value || "").trim();
    if (!raw) return;
    const r = this._resolveReportMovementTypeFromUserText(raw);
    if (r.reason === "ambiguous") {
      Utils.showToast(I18n.t("reports.movementTypeAmbiguous"), "warning");
      return;
    }
    if (!r.key) {
      Utils.showToast(I18n.t("reports.movementTypeUnknown"), "warning");
      return;
    }
    this._addReportMovementTypeKey(r.key);
    if (inp) inp.value = "";
    this._hideReportMovementTypeSuggestions();
  },

  _addReportItemToken(code) {
    const c = String(code || "").trim();
    if (!c) return;
    const low = c.toLowerCase();
    if (this._itemTokenListHasLower(this._reportItemChipTokens, low)) return;
    this._reportItemChipTokens.push(c);
    this._renderReportConsumptionChips();
    this._syncReportConsumptionHiddenFields();
  },

  _addReportItemChipFromSearchInput() {
    const inp = document.getElementById("report-item-search-input");
    const raw = String(inp?.value || "").trim();
    if (!raw) return;
    this._addReportItemToken(raw);
    if (inp) inp.value = "";
    this._hideReportItemSuggestions();
  },

  _addReportProjectChip(canonicalId) {
    const c = String(canonicalId || "").trim();
    if (!c) return;
    const low = c.toLowerCase();
    if (this._projectIdListHasLower(this._reportProjectChipIds, low)) return;
    this._reportProjectChipIds.push(c);
    this._renderReportConsumptionChips();
    this._syncReportConsumptionHiddenFields();
  },

  _addReportProjectChipFromSearchInput() {
    const inp = document.getElementById("report-project-search-input");
    const raw = String(inp?.value || "").trim();
    if (!raw) return;
    this._addReportProjectChip(raw);
    if (inp) inp.value = "";
    this._hideReportProjectSuggestions();
  },

  _syncReportConsumptionHiddenFields() {
    const hItem = document.getElementById("report-item-needle");
    const hProj = document.getElementById("report-item-project-ids");
    const hMov = document.getElementById("report-item-movement-types");
    if (hItem) hItem.value = this._reportItemChipTokens.join(", ");
    if (hProj) hProj.value = this._reportProjectChipIds.join(", ");
    if (hMov) hMov.value = this._reportMovementTypeKeys.join(", ");
  },

  /** Al mostrar el informe por consumo, la lista sale de los campos ocultos (import / coherencia con export). */
  _ingestConsumptionSelectionFromHiddenFields() {
    const hItem = document.getElementById("report-item-needle")?.value || "";
    const hProj = document.getElementById("report-item-project-ids")?.value || "";
    const hMov = document.getElementById("report-item-movement-types")?.value || "";
    this._reportItemChipTokens = hItem
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    this._reportProjectChipIds = hProj
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    this._reportMovementTypeKeys = [];
    hMov.split(/[\n,;]+/).forEach(s => {
      const k = String(s || "").trim().toUpperCase();
      if (k && typeof MOVEMENT_TYPES !== "undefined" && MOVEMENT_TYPES[k] && !this._movTypeKeyListHas(this._reportMovementTypeKeys, k)) {
        this._reportMovementTypeKeys.push(k);
      }
    });
  },

  _renderReportConsumptionChips() {
    const esc = s => (typeof Utils !== "undefined" && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s ?? ""));
    const escAttr = s => (typeof Utils !== "undefined" && Utils.escapeAttr ? Utils.escapeAttr(s) : String(s ?? ""));
    const ariaRemove =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.chipRemoveAria") : "Remove";
    const emptyItem =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.itemChipListEmpty") : "No items yet. Search or pick from the list.";
    const emptyProj =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.projectChipListEmpty") : "No projects yet. Search or pick from the list.";
    const emptyMov =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.movementTypeChipListEmpty") : "No movement types yet. Search or pick from the list.";

    const listItem = document.getElementById("report-item-chip-list");
    if (listItem) {
      listItem.innerHTML = this._reportItemChipTokens.length
        ? this._reportItemChipTokens
            .map(
              (tok, idx) => `
        <span class="report-chip" role="listitem">
          <span class="report-chip-text">${esc(tok)}</span>
          <button type="button" class="report-chip-remove" data-report-remove-item="${idx}" aria-label="${escAttr(ariaRemove)}">×</button>
        </span>`
            )
            .join("")
        : `<div class="report-chip-list-empty muted">${esc(emptyItem)}</div>`;
    }
    const listProj = document.getElementById("report-project-chip-list");
    if (listProj) {
      listProj.innerHTML = this._reportProjectChipIds.length
        ? this._reportProjectChipIds
            .map(
              (pid, idx) => `
        <span class="report-chip" role="listitem">
          <span class="report-chip-text">${esc(pid)}</span>
          <button type="button" class="report-chip-remove" data-report-remove-project="${idx}" aria-label="${escAttr(ariaRemove)}">×</button>
        </span>`
            )
            .join("")
        : `<div class="report-chip-list-empty muted">${esc(emptyProj)}</div>`;
    }
    const listMov = document.getElementById("report-movtype-chip-list");
    if (listMov) {
      listMov.innerHTML = this._reportMovementTypeKeys.length
        ? this._reportMovementTypeKeys
            .map(
              (mk, idx) => `
        <span class="report-chip" role="listitem" title="${escAttr(mk)}">
          <span class="report-chip-text">${esc(this._movementTypeChipLabel(mk))}</span>
          <button type="button" class="report-chip-remove" data-report-remove-movtype="${idx}" aria-label="${escAttr(ariaRemove)}">×</button>
        </span>`
            )
            .join("")
        : `<div class="report-chip-list-empty muted">${esc(emptyMov)}</div>`;
    }
  },

  _movementTypeSetFromKeys(movementTypes) {
    return new Set(
      (Array.isArray(movementTypes) ? movementTypes : [])
        .map(t => String(t || "").trim().toUpperCase())
        .filter(t => t && typeof MOVEMENT_TYPES !== "undefined" && MOVEMENT_TYPES[t])
    );
  },

  /** Proyecto + tipos (excluye consumo diario si hay filtro de proyecto, como antes). */
  _movementMatchesConsumptionHead(m, projectSet, movementTypeSet) {
    if (movementTypeSet.size) {
      const typ = String((m && m.type) || "")
        .trim()
        .toUpperCase();
      if (!movementTypeSet.has(typ)) return false;
    }
    return this._movementMatchesReportProjectSet(m, projectSet);
  },

  _movementAppearsInConsumptionExport(m, { itemTokens, projectIds, movementTypes }) {
    const tokensLower = Array.isArray(itemTokens)
      ? itemTokens.map(t => String(t).trim().toLowerCase()).filter(Boolean)
      : [];
    const projectSet = new Set((projectIds || []).map(p => String(p).trim().toLowerCase()).filter(Boolean));
    const movementTypeSet = this._movementTypeSetFromKeys(movementTypes);
    if (!this._movementMatchesConsumptionHead(m, projectSet, movementTypeSet)) return false;
    if (!tokensLower.length) return true;
    return (m.items || []).some(it => this._lineMatchesReportItemTokens(it, tokensLower));
  },

  _movementMatchesReportProjectSet(m, projectSet) {
    if (!projectSet.size) return true;
    if (m && m.type === "CONSUMO_DIARIO") return false;
    const pid = String((m && m.projectId) || "")
      .trim()
      .toLowerCase();
    return projectSet.has(pid);
  },

  _lineMatchesReportItemTokens(it, tokensLower) {
    if (!tokensLower.length) return true;
    const code = (it.code || "").toLowerCase();
    const desc = (it.description || "").toLowerCase();
    const recipient = (it.recipientName || "").toLowerCase();
    const iid = String(it.itemId || "").toLowerCase();
    const name = (it.itemName || it.name || "").toLowerCase();
    return tokensLower.some(
      tok =>
        tok &&
        (code.includes(tok) ||
          desc.includes(tok) ||
          recipient.includes(tok) ||
          iid.includes(tok) ||
          name.includes(tok))
    );
  },

  async exportTransportsQuick() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
    const built = this.buildTransportsSummary();
    if (!built.rows.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const selected = await Utils.pickColumns(built.headers, I18n.t("reports.transportQuickExport"));
    if (!selected || !selected.length) return;
    const projected = built.rows.map(r => {
      const o = {};
      selected.forEach(h => {
        o[h] = r[h] ?? "";
      });
      return o;
    });
    const tr = (typeof TransportManager !== "undefined" ? TransportManager.transports : []) || [];
    const rng = this.dateRange(tr, "createdAt");
    const name = `GNEEX_Transports_Summary_${rng || this.fileStamp()}.xlsx`;
    await Utils.exportStyledXlsxToInformFolder(name, selected, projected, {
      kind: "report:transports",
      title: I18n.t("export.manifest.report.transportsSummary"),
      details: [`${I18n.t("export.manifest.rows")}: ${projected.length}`]
    });
  },

  async printTransportsQuick() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
    const built = this.buildTransportsSummary();
    if (!built.rows.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const selected = await Utils.pickColumns(built.headers, I18n.t("reports.transportQuickPrint"));
    if (!selected || !selected.length) return;
    const esc = s => Utils.escapeHtml(String(s ?? ""));
    const head = selected.map(h => `<th>${esc(h)}</th>`).join("");
    const body = built.rows
      .map(row => `<tr>${selected.map(h => `<td>${esc(row[h])}</td>`).join("")}</tr>`)
      .join("");
    Utils.printHtmlDocument(
      I18n.t("reports.typeTransports"),
      "",
      `<table class="inventory-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    );
  },

  dateRange(list, dateField) {
    const field = dateField || "date";
    const dates = list.map(m => m[field]).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
    if (!dates.length) return "";
    dates.sort((a, b) => a - b);
    const fmt = d => d.toISOString().slice(0, 10);
    return `${fmt(dates[0])}_to_${fmt(dates[dates.length - 1])}`;
  },

  async runExport() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
    const kind = document.getElementById("report-type")?.value || "movements_all";
      /** @type {string[]|undefined} */
      let headers;
      /** @type {Record<string, unknown>[]|undefined} */
      let tableRows;
      let name = "report.xlsx";
      /** @type {{ kind: string, title: string, details?: string[] }} */
      let manifest;

      try {
        if (kind === "transports") {
          const built = this.buildTransportsSummary();
          if (!built.rows.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          headers = built.headers;
          tableRows = built.rows;
          const tr = (typeof TransportManager !== "undefined" ? TransportManager.transports : []) || [];
          const rng = this.dateRange(tr, "createdAt");
          name = `GNEEX_Transports_Summary_${rng || this.fileStamp()}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.transportsSummary"),
            details: [`${I18n.t("export.manifest.rows")}: ${built.rows.length}`]
          };
        } else if (kind === "transports_lines") {
          const built = this.buildTransportsLines();
          if (!built.rows.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          headers = built.headers;
          tableRows = built.rows;
          const tr = (typeof TransportManager !== "undefined" ? TransportManager.transports : []) || [];
          const rng = this.dateRange(tr, "createdAt");
          name = `GNEEX_Transport_Lines_${rng || this.fileStamp()}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.transportsLines"),
            details: [`${I18n.t("export.manifest.rows")}: ${built.rows.length}`]
          };
        } else if (kind === "movements_filtered") {
          const list =
            typeof HistoryManager !== "undefined" && HistoryManager.getFilteredMovements
              ? HistoryManager.getFilteredMovements()
              : [];
          if (!list.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          const built = this.buildMovementsSummary(list);
          headers = built.headers;
          tableRows = built.rows;
          name = `GNEEX_Movements_Filtered_${this.dateRange(list)}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.movementsFiltered"),
            details: [
              `${I18n.t("export.manifest.rows")}: ${built.rows.length}`,
              `${I18n.t("export.manifest.movementsCount")}: ${list.length}`
            ]
          };
        } else if (kind === "movements_lines_filtered") {
          const list =
            typeof HistoryManager !== "undefined" && HistoryManager.getFilteredMovements
              ? HistoryManager.getFilteredMovements()
              : [];
          if (!list.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          const built = this.buildMovementItemRows(list);
          headers = built.headers;
          tableRows = built.rows;
          name = `GNEEX_Movements_Filtered_Lines_${this.dateRange(list)}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.movementsFilteredLines"),
            details: [
              `${I18n.t("export.manifest.rows")}: ${built.rows.length}`,
              `${I18n.t("export.manifest.movementsCount")}: ${list.length}`
            ]
          };
        } else if (kind === "movements_all") {
          const list = [...(MovementManager.movements || [])].reverse();
          if (!list.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          const built = this.buildMovementsSummary(list);
          headers = built.headers;
          tableRows = built.rows;
          name = `GNEEX_All_Movements_${this.dateRange(list)}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.movementsAll"),
            details: [`${I18n.t("export.manifest.rows")}: ${built.rows.length}`]
          };
        } else if (kind === "item_consumption") {
          this._syncReportConsumptionHiddenFields();
          const rawNeedle = document.getElementById("report-item-needle")?.value || "";
          const rawProjects = document.getElementById("report-item-project-ids")?.value || "";
          const itemTokens = this._parseReportItemTokens(rawNeedle);
          const projectIds = this._parseReportProjectIds(rawProjects);
          const movementTypes = [...this._reportMovementTypeKeys];
          if (!itemTokens.length && !projectIds.length && !movementTypes.length) {
            Utils.showToast(I18n.t("msg.reportExportNeedleOrProject"), "warning");
            return;
          }
          const built = this.buildItemConsumption({ itemTokens, projectIds, movementTypes });
          if (!built.rows.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          headers = built.headers;
          tableRows = built.rows;
          const allMov = (MovementManager.movements || []).filter(m =>
            this._movementAppearsInConsumptionExport(m, { itemTokens, projectIds, movementTypes })
          );
          const slug = [
            itemTokens.slice(0, 3).join("-") || "",
            projectIds.slice(0, 3).join("-") || "",
            movementTypes.slice(0, 4).join("-") || ""
          ]
            .filter(Boolean)
            .join("_")
            .replace(/[^\w\-]+/g, "")
            .slice(0, 80);
          name = `GNEEX_Item_Consumption_${slug || "export"}_${this.dateRange(allMov) || this.fileStamp()}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.itemConsumption"),
            details: [
              itemTokens.length ? `${I18n.t("export.manifest.searchNeedle")}: ${itemTokens.join(", ")}` : "",
              projectIds.length ? `${I18n.t("movements.projectId")}: ${projectIds.join(", ")}` : "",
              movementTypes.length
                ? `${I18n.t("history.filterType")}: ${movementTypes.map(t => I18n.t(`movType.${t}`) || t).join(", ")}`
                : "",
              `${I18n.t("export.manifest.rows")}: ${built.rows.length}`
            ].filter(Boolean)
          };
        } else if (kind === "consumo_recipient_all") {
          if (
            typeof HistoryManager === "undefined" ||
            !HistoryManager.getConsumoRecipientLedgerRows ||
            !HistoryManager.buildConsumoRecipientLedgerCsvPayload
          ) {
            Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
            return;
          }
          const raw = HistoryManager.getConsumoRecipientLedgerRows(false);
          if (!raw.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          const payload = HistoryManager.buildConsumoRecipientLedgerCsvPayload(raw);
          headers = payload.headers;
          tableRows = payload.rowObjects;
          name = `GNEEX_Consumo_destinatario_all_${this.fileStamp()}.xlsx`;
          manifest = {
            kind: `report:${kind}`,
            title: I18n.t("export.manifest.report.consumoRecipients"),
            details: [`${I18n.t("export.manifest.rows")}: ${payload.rowObjects.length}`]
          };
        } else {
          Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
          return;
        }

        if (!headers || !tableRows) {
          Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
          return;
        }
        const selectedHeaders = this._getSelectedHeaders(headers);
        const projectedRows = (tableRows || []).map(row => {
          const out = {};
          selectedHeaders.forEach(h => {
            out[h] = row[h];
          });
          return out;
        });
        const r = await Utils.exportStyledXlsxToInformFolder(name, selectedHeaders, projectedRows, manifest);
        if (r !== "cancelled") this.closeModal();
    } catch (err) {
      console.error(err);
      Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
    }
  },

  buildTransportsSummary() {
    const transports = TransportManager.transports || [];
    const headers = [
      I18n.t("movements.projectId"),
      I18n.t("table.status"),
      I18n.t("transport.expeditionDate"),
      I18n.t("transport.annulExpedition"),
      I18n.t("transport.shippedBadge"),
      I18n.t("transport.checklists"),
      I18n.t("transport.elecObra"),
      I18n.t("reception.dateShort")
    ];
    const rows = transports.map(t => {
      const o = {};
      o[headers[0]] = t.projectId || "";
      o[headers[1]] = t.status === "Listo" ? I18n.t("transport.cellStatusListo") : I18n.t("transport.cellStatusParcial");
      o[headers[2]] = t.shipmentDate || "";
      o[headers[3]] = t.expeditionAnnulled ? I18n.t("history.yes") : I18n.t("history.no");
      o[headers[4]] = t.expeditionShippedAt ? Utils.formatDateTime(t.expeditionShippedAt) : "";
      o[headers[5]] = (t.checklistRefs || []).map(r => r.ref).join(", ");
      o[headers[6]] = (t.elecObraRefs || []).map(r => r.ref).join(", ");
      o[headers[7]] = t.updated ? Utils.formatDate(t.updated) : "";
      return o;
    });
    return { headers, rows };
  },

  buildTransportsLines() {
    const headers = [
      I18n.t("movements.projectId"),
      I18n.t("table.category"),
      I18n.t("transport.na"),
      I18n.t("table.quantity"),
      I18n.t("transport.expeditionDate"),
      I18n.t("table.status")
    ];
    const rows = [];
    for (const t of TransportManager.transports || []) {
      for (const line of t.lines || []) {
        const o = {};
        o[headers[0]] = t.projectId || "";
        o[headers[1]] = TransportManager.lineTitle(line);
        o[headers[2]] = line.na ? I18n.t("history.yes") : I18n.t("history.no");
        o[headers[3]] = line.qty == null ? "" : line.qty;
        o[headers[4]] = t.shipmentDate || "";
        o[headers[5]] = t.status === "Listo" ? I18n.t("transport.cellStatusListo") : I18n.t("transport.cellStatusParcial");
        rows.push(o);
      }
    }
    return { headers, rows };
  },

  _fmtStockBefore(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "";
    const x = Number(v);
    if (Number.isInteger(x)) return String(x);
    return String(Math.round(x * 100) / 100);
  },

  buildMovementItemRows(movements) {
    const headers = [
      I18n.t("standby.reference"),
      I18n.t("standby.date"),
      I18n.t("history.filterType"),
      I18n.t("movements.projectId"),
      I18n.t("table.code"),
      I18n.t("table.description"),
      I18n.t("movements.recipientName"),
      I18n.t("history.stockBefore"),
      I18n.t("table.quantity"),
      I18n.t("history.stockAfter"),
      I18n.t("table.target"),
      I18n.t("table.status")
    ];
    const rows = [];
    for (const m of movements) {
      const items = m.items || [];
      const pair =
        typeof MovementManager !== "undefined" && MovementManager.computeMovementLineStockBeforeAfter
          ? MovementManager.computeMovementLineStockBeforeAfter(m)
          : { before: [], after: [] };
      const stockBeforeList = pair.before;
      const stockAfterList = pair.after;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const o = {};
        o[headers[0]] = m.reference || "";
        o[headers[1]] = m.date ? Utils.formatDateTime(m.date) : "";
        o[headers[2]] = I18n.t(`movType.${m.type}`) || m.type || "";
        o[headers[3]] = m.type === "CONSUMO_DIARIO" ? "" : m.projectId || "";
        o[headers[4]] = it.code || "";
        o[headers[5]] = it.description || "";
        o[headers[6]] = it.recipientName != null && String(it.recipientName).trim() ? String(it.recipientName).trim() : "";
        o[headers[7]] = this._fmtStockBefore(stockBeforeList[i]);
        o[headers[8]] = it.quantity == null ? "" : it.quantity;
        o[headers[9]] = this._fmtStockBefore(stockAfterList[i]);
        o[headers[10]] = it.target ? I18n.t(`target.${it.target}`) : "";
        o[headers[11]] = it.annulled ? I18n.t("status.annulled") : I18n.t("status.active");
        rows.push(o);
      }
    }
    return { headers, rows };
  },

  buildMovementsSummary(movements) {
    const headers = [
      I18n.t("standby.reference"),
      I18n.t("standby.date"),
      I18n.t("history.filterType"),
      I18n.t("movements.projectId"),
      I18n.t("table.status"),
      I18n.t("history.overdraft"),
      I18n.t("movements.notes"),
      I18n.t("standby.items")
    ];
    const rows = movements.map(m => {
      const items = m.items || [];
      const statusMov =
        m.annulled
          ? I18n.t("status.annulled")
          : items.some(it => it && it.annulled)
            ? I18n.t("history.statusPartiallyAnnulled")
            : I18n.t("status.active");
      const o = {};
      o[headers[0]] = m.reference || "";
      o[headers[1]] = m.date ? Utils.formatDateTime(m.date) : "";
      o[headers[2]] = I18n.t(`movType.${m.type}`) || m.type || "";
      o[headers[3]] = m.type === "CONSUMO_DIARIO" ? "" : m.projectId || "";
      o[headers[4]] = statusMov;
      o[headers[5]] = MovementManager.effectiveHadOverdraft(m)
        ? I18n.t("history.yes")
        : I18n.t("history.no");
      o[headers[6]] = (m.notes || "").replace(/\r?\n/g, " ");
      o[headers[7]] = items.length;
      return o;
    });
    return { headers, rows };
  },

  buildItemConsumption({ itemTokens, projectIds, movementTypes }) {
    const tokensLower = Array.isArray(itemTokens) ? itemTokens.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
    const projectSet = new Set((projectIds || []).map(p => String(p).trim().toLowerCase()).filter(Boolean));
    const movementTypeSet = this._movementTypeSetFromKeys(movementTypes);
    const movements = [...(MovementManager.movements || [])].reverse();
    const headers = [
      I18n.t("standby.date"),
      I18n.t("standby.reference"),
      I18n.t("history.filterType"),
      I18n.t("movements.projectId"),
      I18n.t("table.code"),
      I18n.t("table.description"),
      I18n.t("movements.recipientName"),
      I18n.t("history.stockBefore"),
      I18n.t("table.quantity"),
      I18n.t("history.stockAfter"),
      I18n.t("table.target"),
      I18n.t("table.status")
    ];
    const rows = [];
    for (const m of movements) {
      if (!this._movementMatchesConsumptionHead(m, projectSet, movementTypeSet)) continue;
      const items = m.items || [];
      const pair =
        typeof MovementManager !== "undefined" && MovementManager.computeMovementLineStockBeforeAfter
          ? MovementManager.computeMovementLineStockBeforeAfter(m)
          : { before: [], after: [] };
      const stockBeforeList = pair.before;
      const stockAfterList = pair.after;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!this._lineMatchesReportItemTokens(it, tokensLower)) continue;
        const o = {};
        o[headers[0]] = m.date ? Utils.formatDateTime(m.date) : "";
        o[headers[1]] = m.reference || "";
        o[headers[2]] = I18n.t(`movType.${m.type}`) || m.type || "";
        o[headers[3]] = m.type === "CONSUMO_DIARIO" ? "" : m.projectId || "";
        o[headers[4]] = it.code || "";
        o[headers[5]] = it.description || "";
        o[headers[6]] = it.recipientName != null && String(it.recipientName).trim() ? String(it.recipientName).trim() : "";
        o[headers[7]] = this._fmtStockBefore(stockBeforeList[i]);
        o[headers[8]] = it.quantity == null ? "" : it.quantity;
        o[headers[9]] = this._fmtStockBefore(stockAfterList[i]);
        o[headers[10]] = it.target ? I18n.t(`target.${it.target}`) : "";
        o[headers[11]] = it.annulled ? I18n.t("status.annulled") : I18n.t("status.active");
        rows.push(o);
      }
    }
    return { headers, rows };
  }
};
