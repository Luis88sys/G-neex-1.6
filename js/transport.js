// transport.js — transporte por proyecto, líneas combinables, M.E. obra en cola, expedición

const TransportManager = {
  transports: [],
  /** @type {Record<string, Array<{ref:string, movementId:string, at:string}>>} */
  pendingElecObra: {},
  /** Filtro de texto por tarjeta de transporte (lista de recepciones). */
  _receptionFilterByTransport: {},
  /** M.E. producción pendiente de transporte (misma forma que pendingElecObra). */
  pendingElecProd: {},
  _boardEventsBound: false,
  /** Id del transporte con el panel de detalle abierto (null = todos plegados). */
  _expandedTransportId: null,

  _TRANSPORT_VIEWS: ["tiles", "list"],

  _getTransportView() {
    let v = localStorage.getItem(STORAGE_KEYS.VIEW_TRANSPORT_UI);
    if (!this._TRANSPORT_VIEWS.includes(v)) v = "tiles";
    return v;
  },

  _setTransportView(mode) {
    if (!this._TRANSPORT_VIEWS.includes(mode)) return;
    localStorage.setItem(STORAGE_KEYS.VIEW_TRANSPORT_UI, mode);
    this.render();
  },

  _syncTransportViewToolbar() {
    const mode = this._getTransportView();
    document.querySelectorAll("[data-transport-view]").forEach(btn => {
      const active = btn.getAttribute("data-transport-view") === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  },

  esc(s) {
    return Utils.escapeHtml(s);
  },

  /** Ya no se usa para bloquear merge: todas las líneas pueden fusionarse. */
  LOCKED_LINE_IDS: [],
  /** Paquete estándar cuando existe lista de chequeo (línea Hardware = checklist + M.E. obra): L × A × G. */
  CHECKLIST_DEFAULT_HARDWARE_DIMS: { l: "36", w: "32", t: "38" },

  DEFAULT_LINE_ORDER: [
    "HARDWARE",
    "CRATES_NICHES",
    "VIDRIO_PLANO",
    "VIDRIO_CURVO",
    "VIDRIO_PINTADO",
    "MARMOL",
    "GRANITO",
    "GRANITO_LACROIX",
    "BASE_TOP",
    "ESTRUCTURA_MADERA",
    "DOBLE_FONDOS",
    "TOLE_COIN",
    "KLADDING",
    "BRONCE",
    "ARTICULO_ESPECIAL"
  ],

  isLockedAtomicId(id) {
    return this.LOCKED_LINE_IDS.includes(id);
  },

  /** Líneas que solo llevan cantidad (sin medidas L/W/T por unidad). */
  lineSkipsDetailedDims(line) {
    if (line.mergedFrom && line.mergedFrom.length) return false;
    return ["DOBLE_FONDOS", "TOLE_COIN", "BRONCE", "ARTICULO_ESPECIAL"].includes(line.id);
  },

  isMergeLineId(id) {
    return typeof id === "string" && id.startsWith("MERGED:");
  },

  flattenPickedLines(lines, pickedIds) {
    const out = [];
    const seen = new Set();
    for (const pid of pickedIds) {
      const line = lines.find(l => l.id === pid);
      if (!line) continue;
      const atoms = line.mergedFrom && line.mergedFrom.length ? [...line.mergedFrom] : [line.id];
      for (const a of atoms) {
        if (!seen.has(a)) {
          seen.add(a);
          out.push(a);
        }
      }
    }
    return out;
  },

  createDefaultAtomicLines() {
    return this.DEFAULT_LINE_ORDER.map(id => this.emptyLine(id));
  },

  emptyLine(id, mergedFrom = null) {
    const line = { id, na: false, qty: null, dims: [] };
    if (mergedFrom && mergedFrom.length) line.mergedFrom = mergedFrom;
    return line;
  },

  lineTitle(line) {
    if (line.mergedFrom && line.mergedFrom.length) {
      return line.mergedFrom.map(id => I18n.t(`transport.line.${id}`)).join(" + ");
    }
    return I18n.t(`transport.line.${line.id}`);
  },

  padDims(line) {
    if (this.lineSkipsDetailedDims(line)) {
      line.dims = [];
      return;
    }
    const q = line.na ? 0 : Math.max(0, parseInt(line.qty, 10) || 0);
    if (!q) {
      line.dims = [];
      return;
    }
    line.dims = line.dims || [];
    while (line.dims.length < q) {
      line.dims.push({ l: "", w: "", t: "" });
    }
    if (line.dims.length > q) line.dims = line.dims.slice(0, q);
  },

  isLineResolved(line) {
    if (line.na) return true;
    const q = line.qty;
    if (q === null || q === undefined || !Number.isFinite(Number(q))) return false;
    const n = parseInt(q, 10);
    if (n < 0 || String(n) !== String(q)) return false;
    if (this.lineSkipsDetailedDims(line)) return true;
    if (!Array.isArray(line.dims) || line.dims.length !== n) return false;
    return true;
  },

  /**
   * Si la línea no está resuelta, mensaje breve (traducido) sobre qué falta.
   * @returns {string|null} null si ya está resuelta.
   */
  describeLineReadinessGap(line) {
    if (line.na) return null;
    const q = line.qty;
    if (q === null || q === undefined || !Number.isFinite(Number(q)))
      return I18n.t("dashboard.transportLineGapQtyMissing");
    const n = parseInt(q, 10);
    if (n < 0 || String(n) !== String(q)) return I18n.t("dashboard.transportLineGapQtyInvalid");
    if (this.lineSkipsDetailedDims(line)) return null;
    const len = Array.isArray(line.dims) ? line.dims.length : 0;
    if (len !== n) {
      return I18n.t("dashboard.transportLineGapDimsIncomplete")
        .replace("{expected}", String(n))
        .replace("{current}", String(len));
    }
    return null;
  },

  recomputeStatus(t) {
    (t.lines || []).forEach(l => this.padDims(l));
    const ok = (t.lines || []).every(l => this.isLineResolved(l));
    t.status = ok ? "Listo" : "Parcial";
    t.updated = new Date().toISOString();
  },

  loadPending() {
    try {
      this.pendingElecObra = JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_ELEC_OBRA) || "{}");
      if (!this.pendingElecObra || typeof this.pendingElecObra !== "object") this.pendingElecObra = {};
    } catch (e) {
      this.pendingElecObra = {};
    }
    try {
      this.pendingElecProd = JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_ELEC_PROD) || "{}");
      if (!this.pendingElecProd || typeof this.pendingElecProd !== "object") this.pendingElecProd = {};
    } catch (e) {
      this.pendingElecProd = {};
    }
  },

  savePending() {
    localStorage.setItem(STORAGE_KEYS.PENDING_ELEC_OBRA, JSON.stringify(this.pendingElecObra));
    localStorage.setItem(STORAGE_KEYS.PENDING_ELEC_PROD, JSON.stringify(this.pendingElecProd));
  },

  removePendingElectricalRef(movementId, kind = "") {
    const mid = String(movementId || "").trim();
    if (!mid) return false;
    const k = String(kind || "").trim().toLowerCase();
    let changed = false;
    const stripFrom = map => {
      Object.keys(map || {}).forEach(pid => {
        const list = Array.isArray(map[pid]) ? map[pid] : [];
        const next = list.filter(r => r && r.movementId !== mid);
        if (next.length !== list.length) {
          changed = true;
          if (next.length) map[pid] = next;
          else delete map[pid];
        }
      });
    };
    if (k === "obra") stripFrom(this.pendingElecObra);
    else if (k === "prod") stripFrom(this.pendingElecProd);
    else {
      stripFrom(this.pendingElecObra);
      stripFrom(this.pendingElecProd);
    }
    if (changed) this.savePending();
    return changed;
  },

  mergePendingObraInto(t) {
    const keysToMerge = Object.keys(this.pendingElecObra || {}).filter(k =>
      Utils.projectIdsEquivalent(k, t.projectId)
    );
    if (!keysToMerge.length) return;
    t.elecObraRefs = t.elecObraRefs || [];
    keysToMerge.forEach(key => {
      const pend = this.pendingElecObra[key];
      if (!pend || !pend.length) return;
      pend.forEach(entry => {
        if (!t.elecObraRefs.some(e => e.movementId === entry.movementId)) {
          t.elecObraRefs.push(entry);
        }
      });
      delete this.pendingElecObra[key];
    });
    this.savePending();
  },

  mergePendingProdInto(t) {
    const keysToMerge = Object.keys(this.pendingElecProd || {}).filter(k =>
      Utils.projectIdsEquivalent(k, t.projectId)
    );
    if (!keysToMerge.length) return;
    t.elecProdRefs = t.elecProdRefs || [];
    keysToMerge.forEach(key => {
      const pend = this.pendingElecProd[key];
      if (!pend || !pend.length) return;
      pend.forEach(entry => {
        if (!t.elecProdRefs.some(e => e.movementId === entry.movementId)) {
          t.elecProdRefs.push(entry);
        }
      });
      delete this.pendingElecProd[key];
    });
    this.savePending();
  },

  /** Colas M.E. obra/prod pendientes cuya clave coincide en forma laxa con el transporte. */
  _mergedPendingObraForTransport(projectId) {
    const seen = new Set();
    const out = [];
    for (const k of Object.keys(this.pendingElecObra || {})) {
      if (!Utils.projectIdsEquivalent(k, projectId)) continue;
      for (const r of this.pendingElecObra[k] || []) {
        if (!r || !r.movementId || seen.has(r.movementId)) continue;
        seen.add(r.movementId);
        out.push(r);
      }
    }
    return out;
  },

  _mergedPendingProdForTransport(projectId) {
    const seen = new Set();
    const out = [];
    for (const k of Object.keys(this.pendingElecProd || {})) {
      if (!Utils.projectIdsEquivalent(k, projectId)) continue;
      for (const r of this.pendingElecProd[k] || []) {
        if (!r || !r.movementId || seen.has(r.movementId)) continue;
        seen.add(r.movementId);
        out.push(r);
      }
    }
    return out;
  },

  /** Una fila por proyecto lógico (clave laxa) para el aviso de pendientes sin transporte activo. */
  _pendingTransportBannerGroups() {
    const groups = new Map();
    const bumpDisplay = (g, pid) => {
      const ps = String(pid || "");
      if (ps.length > String(g.displayPid || "").length) g.displayPid = pid;
    };
    const mergeRefs = (target, src) => {
      const seen = new Set(target.map(x => x.movementId));
      for (const r of src || []) {
        if (!r?.movementId || seen.has(r.movementId)) continue;
        seen.add(r.movementId);
        target.push(r);
      }
    };
    Object.keys(this.pendingElecObra || {}).forEach(pid => {
      const lk = Utils.projectIdLooseKey(pid);
      if (!lk) return;
      if (!groups.has(lk)) groups.set(lk, { displayPid: pid, obra: [], prod: [] });
      const g = groups.get(lk);
      bumpDisplay(g, pid);
      mergeRefs(g.obra, this.pendingElecObra[pid]);
    });
    Object.keys(this.pendingElecProd || {}).forEach(pid => {
      const lk = Utils.projectIdLooseKey(pid);
      if (!lk) return;
      if (!groups.has(lk)) groups.set(lk, { displayPid: pid, obra: [], prod: [] });
      const g = groups.get(lk);
      bumpDisplay(g, pid);
      mergeRefs(g.prod, this.pendingElecProd[pid]);
    });
    return [...groups.values()].filter(
      g =>
        (g.obra.length || g.prod.length) && !this.getActiveByProject(g.displayPid)
    );
  },

  migrateLegacyComboFlags(t) {
    const hadV = !!t.combineVidrios;
    const hadK = !!t.combineKbs;
    delete t.combineVidrios;
    delete t.combineKbs;
    if (!hadV && !hadK) return;

    let lines = [...(t.lines || [])];
    const glass = ["VIDRIO_PLANO", "VIDRIO_CURVO", "VIDRIO_PINTADO"];
    const kbs = ["KLADDING", "BRONCE", "ARTICULO_ESPECIAL"];

    if (hadV) {
      const comboRow = lines.find(l => l.id === "VIDRIO_COMBO");
      const parts = glass.map(id => lines.find(l => l.id === id)).filter(Boolean);
      lines = lines.filter(l => !glass.includes(l.id) && l.id !== "VIDRIO_COMBO");
      if (comboRow) {
        comboRow.id = `MERGED:${Utils.generateId()}`;
        comboRow.mergedFrom = [...glass];
        lines.push(comboRow);
      } else if (parts.length) {
        const na = parts.every(p => p.na);
        const qtyRow = parts.find(p => p.qty !== null && p.qty !== undefined);
        lines.push({
          id: `MERGED:${Utils.generateId()}`,
          mergedFrom: [...glass],
          na,
          qty: na ? null : qtyRow ? qtyRow.qty : null,
          dims: na ? [] : [...(qtyRow?.dims || [])]
        });
      }
    }

    if (hadK) {
      const comboRow = lines.find(l => l.id === "KBS_COMBO");
      const parts = kbs.map(id => lines.find(l => l.id === id)).filter(Boolean);
      lines = lines.filter(l => !kbs.includes(l.id) && l.id !== "KBS_COMBO");
      if (comboRow) {
        comboRow.id = `MERGED:${Utils.generateId()}`;
        comboRow.mergedFrom = [...kbs];
        lines.push(comboRow);
      } else if (parts.length) {
        const na = parts.every(p => p.na);
        const qtyRow = parts.find(p => p.qty !== null && p.qty !== undefined);
        lines.push({
          id: `MERGED:${Utils.generateId()}`,
          mergedFrom: [...kbs],
          na,
          qty: na ? null : qtyRow ? qtyRow.qty : null,
          dims: na ? [] : [...(qtyRow?.dims || [])]
        });
      }
    }

    t.lines = this.ensureAllAtoms(lines);
    this.normalizeLinesOrder(t);
  },

  ensureAllAtoms(lines) {
    const merged = [];
    const mergedAtoms = new Set();
    for (const l of lines || []) {
      if (this.isMergeLineId(l.id) && l.mergedFrom && l.mergedFrom.length) {
        merged.push(l);
        l.mergedFrom.forEach(a => mergedAtoms.add(a));
      }
    }
    const standaloneById = new Map();
    for (const l of lines || []) {
      if (this.isMergeLineId(l.id)) continue;
      if (mergedAtoms.has(l.id)) continue;
      if (!standaloneById.has(l.id)) standaloneById.set(l.id, l);
    }
    for (const id of this.DEFAULT_LINE_ORDER) {
      if (mergedAtoms.has(id)) continue;
      if (!standaloneById.has(id)) standaloneById.set(id, this.emptyLine(id));
    }
    const ordered = this.DEFAULT_LINE_ORDER.map(id => standaloneById.get(id)).filter(Boolean);
    return [...ordered, ...merged];
  },

  normalizeLinesOrder(t) {
    const lines = t.lines || [];
    const byFirstIndex = line => {
      if (line.mergedFrom && line.mergedFrom[0]) {
        const i = this.DEFAULT_LINE_ORDER.indexOf(line.mergedFrom[0]);
        return i === -1 ? 500 : i;
      }
      const i = this.DEFAULT_LINE_ORDER.indexOf(line.id);
      return i === -1 ? 500 : i;
    };
    t.lines = lines.slice().sort((a, b) => byFirstIndex(a) - byFirstIndex(b));
  },

  migrateTransport(t) {
    if (!t.lines || !Array.isArray(t.lines) || t.lines.length === 0) {
      const lines = this.createDefaultAtomicLines();
      const legacyMap = {
        Hardware: "HARDWARE",
        Marmol: "MARMOL",
        "Vidrio plano": "VIDRIO_PLANO",
        "Vidrio curbo": "VIDRIO_CURVO",
        "Vidrio de color Base y Tope": "VIDRIO_PINTADO",
        Granito: "GRANITO",
        "Granito Lacroix": "GRANITO_LACROIX",
        "Esquinas de aluminio": "CRATES_NICHES"
      };
      if (t.tasks && Array.isArray(t.tasks)) {
        t.tasks.forEach(tsk => {
          const id = legacyMap[tsk.name];
          const line = id ? lines.find(x => x.id === id) : null;
          if (line) {
            line.na = false;
            line.qty = tsk.done ? 1 : null;
            this.padDims(line);
          }
        });
      }
      t.lines = lines;
    }

    t.lines.forEach(l => {
      if (l.id === "VIDRIO_COMBO" && !l.mergedFrom) {
        l.mergedFrom = ["VIDRIO_PLANO", "VIDRIO_CURVO", "VIDRIO_PINTADO"];
        l.id = `MERGED:${Utils.generateId()}`;
      }
      if (l.id === "KBS_COMBO" && !l.mergedFrom) {
        l.mergedFrom = ["KLADDING", "BRONCE", "ARTICULO_ESPECIAL"];
        l.id = `MERGED:${Utils.generateId()}`;
      }
    });

    this.migrateLegacyComboFlags(t);
    t.lines = this.ensureAllAtoms(t.lines);
    this.normalizeLinesOrder(t);

    t.version = 3;
    if (!Array.isArray(t.checklistRefs)) {
      t.checklistRefs = t.checklistRef
        ? [{ ref: t.checklistRef, movementId: "", at: t.created || new Date().toISOString() }]
        : [];
    }
    if (!Array.isArray(t.elecObraRefs)) t.elecObraRefs = [];
    if (!Array.isArray(t.elecProdRefs)) t.elecProdRefs = [];
    delete t.checklistRef;
    delete t.tasks;
    delete t.electrical;

    if (typeof t.expeditionAnnulled !== "boolean") t.expeditionAnnulled = false;
    if (t.expeditionAnnulled && t.expeditionShippedAt) delete t.expeditionShippedAt;
    if (!t.shipmentDate && !t.expeditionAnnulled) {
      t.shipmentDate = new Date().toISOString().split("T")[0];
    }

    if (!["normal", "merge", "unmerge"].includes(t.mergeUiMode)) t.mergeUiMode = "normal";
    if (!Array.isArray(t.attachments)) t.attachments = [];

    this._ensureDefaultChecklistHardwarePackage(t);
    (t.lines || []).forEach(l => this.padDims(l));
    this.recomputeStatus(t);
    return t;
  },

  /**
   * Si hay lista de chequeo vinculada y la línea atómica «Hardware (checklist + M.E. obra)» sigue vacía,
   * precarga 1 paquete con medidas estándar. No pisa recepciones, N/A ni líneas tocadas a mano.
   * @returns {boolean} true si hubo cambio
   */
  _ensureDefaultChecklistHardwarePackage(t) {
    if (!t || t.expeditionAnnulled || t.expeditionShippedAt) return false;
    if (!(t.checklistRefs || []).length) return false;

    const line = (t.lines || []).find(l => l.id === "HARDWARE" && !this.isMergeLineId(l.id));
    if (!line || line.na) return false;
    if (line.receptionLineUserOverride) return false;

    const unsetQty =
      line.qty === null || line.qty === undefined || String(line.qty).trim() === "";
    if (!unsetQty) return false;

    const hasDims =
      Array.isArray(line.dims) &&
      line.dims.some(d => {
        if (!d) return false;
        return (
          String(d.l || "").trim() !== "" ||
          String(d.w || "").trim() !== "" ||
          String(d.t || "").trim() !== ""
        );
      });
    if (hasDims) return false;

    const D = this.CHECKLIST_DEFAULT_HARDWARE_DIMS;
    line.qty = 1;
    line.dims = [{ l: String(D.l), w: String(D.w), t: String(D.t) }];
    this.padDims(line);
    t.updated = new Date().toISOString();
    return true;
  },

  getByProject(projectId) {
    const pid = (projectId || "").trim();
    if (!pid) return null;
    return (
      this.transports.find(tr => Utils.projectIdsEquivalent(tr.projectId, pid)) || null
    );
  },

  getAllByProject(projectId) {
    const pid = (projectId || "").trim();
    if (!pid) return [];
    return this.transports.filter(tr => Utils.projectIdsEquivalent(tr.projectId, pid));
  },

  getActiveByProject(projectId) {
    const all = this.getAllByProject(projectId);
    return all.find(t => !t.expeditionAnnulled && !t.expeditionShippedAt) || null;
  },

  getTransportLabel(t) {
    const all = this.getAllByProject(t.projectId);
    if (all.length <= 1) return "";
    const idx = all
      .sort((a, b) => (a.created || "").localeCompare(b.created || ""))
      .findIndex(x => x.id === t.id);
    return ` — ${I18n.t("transport.truckLabel")} ${idx + 1}`;
  },

  /** Pulso rojo = expedición hoy; ámbar = primera fecha futura entre pendientes. */
  _shipmentUrgencyClass(t) {
    if (!t || t.expeditionAnnulled || t.expeditionShippedAt) return "";
    const sd = String(t.shipmentDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) return "";
    const todayIso = new Date().toISOString().slice(0, 10);
    if (sd === todayIso) return "transport-card--ship-today";
    const pend = (this.transports || []).filter(
      x => !x.expeditionAnnulled && !x.expeditionShippedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(x.shipmentDate || ""))
    );
    const nextDate = pend
      .map(x => x.shipmentDate)
      .filter(d => d > todayIso)
      .sort()[0];
    if (nextDate && sd === nextDate) return "transport-card--ship-next";
    return "";
  },

  /**
   * Rellena cantidad (y medidas por pieza) en líneas de transporte a partir de recepciones
   * con el mismo `materialCategory` que el id atómico de la línea (o categorías de una línea fusionada).
   * No toca líneas con N/A, expedición enviada/anulada, ni líneas que el usuario ya ajustó a mano (`receptionLineUserOverride`).
   */
  syncProjectTransportsFromReceptions(projectId) {
    const pid = (projectId || "").trim();
    if (!pid || typeof ReceptionsManager === "undefined") return;
    let changed = false;
    (this.transports || []).forEach(t => {
      if (!Utils.projectIdsEquivalent(t.projectId, pid)) return;
      if (t.expeditionAnnulled || t.expeditionShippedAt) return;
      if (this._syncTransportLinesFromReceptions(t)) changed = true;
    });
    if (changed) {
      this.save();
      this.render();
    }
  },

  _pushDimsForReception(dims, rec) {
    const q = Math.max(0, Math.floor(parseFloat(rec.quantity) || 0));
    if (q <= 0) return;
    const perUnit = Array.isArray(rec.dimensionsItems) ? rec.dimensionsItems : [];
    if (perUnit.length) {
      for (let i = 0; i < q; i++) {
        const d = perUnit[i] || {};
        const Lp = parseFloat(d?.L) || 0;
        const Wp = parseFloat(d?.W) || 0;
        const Hp = parseFloat(d?.H) || 0;
        const hasPerUnit = Lp > 0 || Wp > 0 || Hp > 0;
        dims.push({
          l: hasPerUnit ? String(Lp) : "",
          w: hasPerUnit ? String(Wp) : "",
          t: hasPerUnit ? String(Hp) : ""
        });
      }
      return;
    }
    const L = parseFloat(rec.dimensions?.L) || 0;
    const W = parseFloat(rec.dimensions?.W) || 0;
    const H = parseFloat(rec.dimensions?.H) || 0;
    const hasDim = L > 0 || W > 0 || H > 0;
    for (let i = 0; i < q; i++) {
      dims.push({
        l: hasDim ? String(L) : "",
        w: hasDim ? String(W) : "",
        t: hasDim ? String(H) : ""
      });
    }
  },

  _normalizeReceptionCategoryForTransport(rawCategory, recLike = null) {
    const raw = String(rawCategory || "").trim();
    const itemNameNorm = String(recLike?.itemName || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const itemCompact = itemNameNorm.replace(/[^A-Z0-9]/g, "");
    const looksLikeBaseTop =
      itemCompact.includes("BASETOP") ||
      /\bBASE\s*\/?\s*TOP\b/i.test(itemNameNorm);
    if (!raw) return looksLikeBaseTop ? "BASE_TOP" : "OTRO";
    const up = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
    if (up === "MARMO" || up === "MARMOL") return "MARMOL";
    if (up === "VIDRIO") return "VIDRIO";
    if (up === "VIDRIO PLANO" || up === "VIDRIO_PLANO") return "VIDRIO_PLANO";
    if (up === "VIDRIO CURVO" || up === "VIDRIO_CURBO") return "VIDRIO_CURVO";
    if (up === "VIDRIO PINTADO") return "VIDRIO_PINTADO";
    if (up === "GRANITO") return "GRANITO";
    if (up === "GRANITO LACROIX" || up === "GRANITO_LACROIX") return "GRANITO_LACROIX";
    if (up === "BASE TOP" || up === "BASE/TOP" || up === "BASE_TOP" || up === "BASETOP")
      return "BASE_TOP";
    if (up === "ESPECIAL" || up === "MATERIAL ESPECIAL" || up === "ARTICULO ESPECIAL") return "ESPECIAL";
    if (
      up === "OTRO" ||
      up === "OTHER" ||
      up === "OTRO / INVENTARIO" ||
      up === "OTRO/INVENTARIO" ||
      up === "INVENTARIO"
    ) {
      return looksLikeBaseTop ? "BASE_TOP" : "OTRO";
    }
    return up.replace(/\s+/g, "_");
  },

  _syncTransportLinesFromReceptions(t) {
    if (!t || t.expeditionAnnulled || t.expeditionShippedAt) return false;
    const pid = (t.projectId || "").trim();
    if (!pid) return false;
    const allRecs = (ReceptionsManager.receptions || []).filter(
      r =>
        Utils.projectIdsEquivalent(r.projectId, pid) &&
        !r.provisionalAnnulled &&
        !r.expeditedAt
    );
    /** Claves con las que se indexan recepciones: deben alinear con `line.id` o átomos en líneas fusionadas. */
    const byCat = {};
    allRecs.forEach(r => {
      const raw = this._normalizeReceptionCategoryForTransport(r.materialCategory || "OTRO", r);
      const keys = [raw];
      if (raw === "ESPECIAL") keys.push("ARTICULO_ESPECIAL");
      else if (raw === "VIDRIO") keys.push("VIDRIO_PLANO");
      keys.forEach(k => {
        if (!byCat[k]) byCat[k] = [];
        byCat[k].push(r);
      });
    });
    let changed = false;
    (t.lines || []).forEach(line => {
      if (line.na || line.receptionLineUserOverride) return;
      const cats = this.isMergeLineId(line.id) && line.mergedFrom?.length ? line.mergedFrom : [line.id];
      const rel = [];
      const seen = new Set();
      cats.forEach(c => {
        (byCat[c] || []).forEach(rec => {
          if (!seen.has(rec.id)) {
            seen.add(rec.id);
            rel.push(rec);
          }
        });
      });
      if (!rel.length) return;
      rel.sort((a, b) => String(a.dateReceived || "").localeCompare(String(b.dateReceived || "")));
      let totalQty = 0;
      rel.forEach(rec => {
        totalQty += Math.max(0, Math.floor(parseFloat(rec.quantity) || 0));
      });
      if (totalQty <= 0) return;
      const skipDetail = this.lineSkipsDetailedDims(line);
      line.qty = totalQty;
      if (skipDetail) {
        line.dims = [];
      } else {
        const dims = [];
        rel.forEach(rec => this._pushDimsForReception(dims, rec));
        line.dims = dims;
        this.padDims(line);
      }
      changed = true;
    });
    if (changed) {
      this.recomputeStatus(t);
      t.updated = new Date().toISOString();
    }
    if (this._ensureDefaultChecklistHardwarePackage(t)) {
      changed = true;
      this.recomputeStatus(t);
      t.updated = new Date().toISOString();
    }
    return changed;
  },

  init() {
    try {
      this.loadPending();
      this.transports = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSPORT) || "[]");
      if (!Array.isArray(this.transports)) this.transports = [];
      this.transports = this.transports.map(t => this.migrateTransport(t));
      this.save();
      this.bindBoardEvents();
      this.render();
    } catch (e) {
      console.error("❌ Error iniciando TransportManager:", e);
    }
  },

  save() {
    localStorage.setItem(STORAGE_KEYS.TRANSPORT, JSON.stringify(this.transports));
    if (typeof Dashboard !== "undefined" && Dashboard.updateTransportExpeditionUrgency) {
      Dashboard.updateTransportExpeditionUrgency();
    }
    if (typeof Dashboard !== "undefined" && Dashboard.updateTransportReadinessAttention) {
      Dashboard.updateTransportReadinessAttention();
    }
    if (typeof Dashboard !== "undefined" && Dashboard._updatePendingTransports) {
      Dashboard._updatePendingTransports();
    }
  },

  bindBoardEvents() {
    const board = document.getElementById("transport-board");
    if (!board || this._boardEventsBound) return;
    this._boardEventsBound = true;
    board.addEventListener("change", e => this.onBoardEvent(e));
    board.addEventListener("input", e => this.onBoardInput(e));
    board.addEventListener("click", e => this.onBoardClick(e));

    const createBtn = document.getElementById("transport-create-btn");
    if (createBtn) createBtn.addEventListener("click", () => this.createManualTransport());

    document.getElementById("transport-tab")?.addEventListener("click", e => {
      const btn = e.target.closest("[data-transport-view]");
      if (!btn) return;
      e.preventDefault();
      this._setTransportView(btn.getAttribute("data-transport-view"));
    });
  },

  async createManualTransport() {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("trnToolbar", "edit")) return;
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    const projectId = await App.showPrompt({
      message: I18n.t("prompt.transportProjectId"),
      defaultValue: "",
      inputType: "text"
    });
    if (projectId === null) return;
    const pid = (projectId || "").trim();
    if (!pid) {
      Utils.showToast(I18n.t("msg.projectIdRequired"), "error");
      return;
    }
    const existing = this.getAllByProject(pid);
    const active = this.getActiveByProject(pid);
    if (active) {
      Utils.showToast(
        `${I18n.t("msg.transportActiveExists")} (${existing.length} ${I18n.t("transport.truckLabel")}${existing.length > 1 ? "s" : ""})`,
        "info"
      );
    }
    const dateStr = await App.showPrompt({
      message: I18n.t("prompt.transportExpeditionDate"),
      defaultValue: new Date().toISOString().split("T")[0],
      inputType: "date"
    });
    if (dateStr === null) return;
    const ship = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())
      ? String(dateStr).trim()
      : new Date().toISOString().split("T")[0];

    const t = {
      id: Utils.generateId(),
      projectId: pid,
      checklistRefs: [],
      elecObraRefs: [],
      elecProdRefs: [],
      shipmentDate: ship,
      expeditionAnnulled: false,
      notes: "",
      lines: [],
      version: 3,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };
    this.migrateTransport(t);
    this.mergePendingObraInto(t);
    this.mergePendingProdInto(t);
    this._syncTransportLinesFromReceptions(t);
    this.transports.push(t);
    this.save();
    this._expandedTransportId = t.id;
    this.render();
    if (typeof Auth !== "undefined") Auth.logAudit("transport.create.manual", pid);
    const total = this.getAllByProject(pid).length;
    Utils.showToast(`${I18n.t("msg.transportCreated")} (${pid} — ${I18n.t("transport.truckLabel")} ${total})`, "success");
  },

  onBoardInput(e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains("transport-rec-search")) return;
    const tid = el.dataset?.tid;
    if (!tid) return;
    this._receptionFilterByTransport = this._receptionFilterByTransport || {};
    this._receptionFilterByTransport[tid] = el.value;
    this.refreshTransportReceptionsDom(tid);
  },

  refreshTransportReceptionsDom(tid) {
    const t = this.transports.find(x => x.id === tid);
    const panel = this._getTransportDetailPanelEl(tid);
    if (!t || !panel) return;
    const block = panel.querySelector(".t-receptions");
    if (!block) return;
    const active = document.activeElement;
    const restoreFocus =
      active &&
      active.classList &&
      active.classList.contains("transport-rec-search") &&
      active.dataset.tid === tid;
    const q = (this._receptionFilterByTransport && this._receptionFilterByTransport[tid]) || "";
    block.outerHTML = this.renderRecepSection(t).trim();
    const panel2 = this._getTransportDetailPanelEl(tid);
    const inp = panel2 && panel2.querySelector(".transport-rec-search");
    if (inp) {
      inp.value = q;
      if (restoreFocus) {
        inp.focus();
        try {
          const len = inp.value.length;
          inp.setSelectionRange(len, len);
        } catch (err) {}
      }
    }
  },

  onBoardClick(e) {
    const openAttEarly = e.target.closest("[data-transport-open-attachment]");
    if (openAttEarly) {
      const tid = openAttEarly.getAttribute("data-tid") || "";
      const aid = openAttEarly.getAttribute("data-aid") || "";
      const t = this.transports.find(x => x.id === tid);
      const meta = t && (t.attachments || []).find(a => a && a.id === aid);
      void Utils.openLinkedAttachment(meta);
      return;
    }
    const copyLegacyEarly = e.target.closest("[data-transport-copy-legacy]");
    if (copyLegacyEarly) {
      const path = copyLegacyEarly.getAttribute("data-copy-transport-rel") || "";
      if (path && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(path).then(
          () => Utils.showToast(I18n.t("attachments.pathCopied"), "success"),
          () => Utils.showToast(I18n.t("attachments.pathCopyFailed"), "warning")
        );
      } else if (path) {
        Utils.showToast(I18n.t("attachments.pathCopyFailed"), "warning");
      }
      return;
    }
    const btn = e.target.closest("[data-transport-action]");
    if (!btn) return;
    const tid = btn.dataset.tid;
    const action = btn.dataset.transportAction;
    if (action === "collapse-transport") {
      if (tid && this._expandedTransportId === tid) {
        this._expandedTransportId = null;
        this.render();
      }
      return;
    }
    if (action === "toggle-expand") {
      if (!tid) return;
      this._expandedTransportId = this._expandedTransportId === tid ? null : tid;
      this.render();
      requestAnimationFrame(() => {
        document.querySelector(".transport-detail-slot")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      return;
    }
    if (action === "pick-transport-attachments") {
      void this.addTransportAttachments(tid).then(ok => {
        if (ok) {
          Utils.showToast(I18n.t("attachments.saved"), "success");
          this.render();
        }
      });
      return;
    }
    if (action === "remove-transport-attachment") {
      const aid = btn.getAttribute("data-aid");
      if (tid && aid) {
        App.showConfirm(I18n.t("confirm.removeAttachment"), () => {
          void this.removeTransportAttachment(tid, aid).then(() => this.render());
        });
      }
      return;
    }
    if (action === "export-cargo-report") {
      if (tid) void this.exportTransportCargoReport(tid);
      return;
    }
    if (action === "print-cargo-report") {
      if (tid) this.printTransportCargoReport(tid);
      return;
    }
    if (action === "delete") this.deleteTransport(tid);
    if (action === "merge-lines") this.mergePickedLines(tid);
    if (action === "split-line") {
      const lid = btn.getAttribute("data-line");
      this.splitMergedLine(tid, lid);
    }
    if (action === "annul-expedition") this.annulExpedition(tid);
    if (action === "reactivate-expedition" || action === "define-expedition") this.reactivateExpedition(tid);
    if (action === "ship-transport") this.shipTransport(tid);
    if (action === "set-merge-mode") {
      if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
      const t = this.transports.find(x => x.id === tid);
      if (!t) return;
      const m = btn.getAttribute("data-mode");
      t.mergeUiMode = ["normal", "merge", "unmerge"].includes(m) ? m : "normal";
      t.updated = new Date().toISOString();
      this.save();
      this.render();
    }
    if (action === "remove-queued-me") {
      if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
      const mid = btn.getAttribute("data-mid") || "";
      const kind = btn.getAttribute("data-kind") || "";
      const ref = btn.getAttribute("data-ref") || "";
      if (!mid) return;
      const msg = I18n.t("transport.queueRemoveConfirm").replace("{ref}", ref ? ref : mid);
      App.showConfirm(msg, () => {
        const ok = this.removePendingElectricalRef(mid, kind);
        if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("transport.queue.remove", `${kind || "me"}:${ref || mid}`);
        Utils.showToast(I18n.t(ok ? "transport.queueRemovedOk" : "transport.queueRemoveMissing"), ok ? "success" : "warning");
        this.render();
        if (typeof Dashboard !== "undefined" && Dashboard._updatePendingTransports) Dashboard._updatePendingTransports();
      });
    }
  },

  async addTransportAttachments(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return false;
    const t = this.transports.find(x => x.id === tid);
    if (!t) return false;
    if (!Utils.canLinkLocalAttachments()) {
      Utils.showToast(I18n.t("msg.attachmentsLinkUnsupported"), "warning");
      return false;
    }
    let picked;
    try {
      picked = await window.showOpenFilePicker({ multiple: true });
    } catch (e) {
      if (e && e.name === "AbortError") return false;
      if (typeof window !== "undefined" && window.__GNEEX_DEBUG) {
        console.error(e);
      }
      Utils.showToast((e && e.message) || I18n.t("msg.attachmentsLinkError"), "error");
      return false;
    }
    const handles = Array.isArray(picked) ? picked : [picked];
    if (!handles.length) return false;
    if (!Array.isArray(t.attachments)) t.attachments = [];
    const { saved } = await Utils.saveLinkedAttachmentHandles(handles);
    if (saved && saved.length) {
      t.attachments.push(...saved);
      t.updated = new Date().toISOString();
      this.save();
      if (typeof Auth !== "undefined" && Auth.logAudit) {
        Auth.logAudit("transport.attach", `${t.projectId}: +${saved.length} file(s) linked`);
      }
      return true;
    }
    Utils.showToast(I18n.t("msg.attachmentsLinkError"), "warning");
    return false;
  },

  async removeTransportAttachment(tid, attachmentId) {
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return false;
    const t = this.transports.find(x => x.id === tid);
    if (!t || !Array.isArray(t.attachments)) return false;
    const idx = t.attachments.findIndex(a => a && a.id === attachmentId);
    if (idx < 0) return false;
    const att = t.attachments[idx];
    await Utils.removeLinkedAttachmentHandle(att.id);
    t.attachments.splice(idx, 1);
    t.updated = new Date().toISOString();
    this.save();
    if (typeof Auth !== "undefined" && Auth.logAudit) {
      Auth.logAudit("transport.attach.remove", `${t.projectId}: ${att.fileName || attachmentId}`);
    }
    return true;
  },

  mergePickedLines(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t) return;
    const board = document.getElementById("transport-board");
    if (!board) return;
    const picks = Array.from(board.querySelectorAll(`.line-merge-pick[data-tid="${tid}"]:checked`)).map(
      el => el.dataset.line
    );
    if (picks.length < 2) {
      Utils.showToast(I18n.t("msg.transportMergePickTwo"), "warning");
      return;
    }
    const atoms = this.flattenPickedLines(t.lines, picks);
    const uniqSet = new Set(atoms);
    const uniqFinal = [];
    this.DEFAULT_LINE_ORDER.forEach(id => {
      if (uniqSet.has(id)) uniqFinal.push(id);
    });
    atoms.forEach(a => {
      if (!uniqFinal.includes(a)) uniqFinal.push(a);
    });
    if (uniqFinal.length < 2) {
      Utils.showToast(I18n.t("msg.transportMergePickTwo"), "warning");
      return;
    }

    const orig = [...(t.lines || [])];
    const indices = picks.map(id => orig.findIndex(l => l.id === id)).filter(i => i >= 0);
    if (!indices.length) {
      Utils.showToast(I18n.t("msg.transportMergePickTwo"), "warning");
      return;
    }
    const firstPick = Math.min(...indices);
    const insertPos = orig.slice(0, firstPick).filter(l => !picks.includes(l.id)).length;
    let allNa = true;
    picks.forEach(pid => {
      const ln = orig.find(l => l.id === pid);
      if (ln && !ln.na) allNa = false;
    });

    t.lines = orig.filter(l => !picks.includes(l.id));
    const newLine = {
      id: `MERGED:${Utils.generateId()}`,
      mergedFrom: uniqFinal,
      na: allNa,
      qty: allNa ? null : null,
      dims: []
    };
    this.padDims(newLine);
    t.lines.splice(insertPos, 0, newLine);
    this.normalizeLinesOrder(t);
    t.lines = this.ensureAllAtoms(t.lines);
    this.recomputeStatus(t);
    this.save();
    this.render();
    Utils.showToast(I18n.t("msg.transportMerged"), "success");
  },

  splitMergedLine(tid, mergedLineId) {
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t || !mergedLineId) return;
    const line = t.lines.find(l => l.id === mergedLineId);
    if (!line || !line.mergedFrom || !line.mergedFrom.length) return;
    const idx = t.lines.findIndex(l => l.id === mergedLineId);
    if (idx < 0) return;
    t.lines.splice(idx, 1);
    const replacements = line.mergedFrom.map(id => this.emptyLine(id));
    t.lines.splice(idx, 0, ...replacements);
    this.normalizeLinesOrder(t);
    t.lines = this.ensureAllAtoms(t.lines);
    this.recomputeStatus(t);
    this.save();
    this.render();
    Utils.showToast(I18n.t("msg.transportSplit"), "info");
  },

  annulExpedition(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    App.showConfirm(I18n.t("confirm.annulExpedition"), () => {
      const t = this.transports.find(x => x.id === tid);
      if (!t) return;
      this.clearCargoExpeditionMarks(tid);
      t.expeditionAnnulled = true;
      t.expeditionAnnulledAt = new Date().toISOString();
      delete t.expeditionShippedAt;
      t.shipmentDate = "";
      t.lines = this.createDefaultAtomicLines();
      let removed = 0;
      if (typeof ReceptionsManager !== "undefined" && ReceptionsManager.removeProvisionalByProject) {
        removed = ReceptionsManager.removeProvisionalByProject(t.projectId);
      }
      this.recomputeStatus(t);
      t.updated = new Date().toISOString();
      this.save();
      this.render();
      if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
      if (typeof Auth !== "undefined") Auth.logAudit("transport.annul", t.projectId);
      Utils.showToast(
        removed > 0
          ? `${I18n.t("msg.transportExpeditionAnnulled")} (${removed} ${I18n.t("reception.provisionalRemoved")})`
          : I18n.t("msg.transportExpeditionAnnulled"),
        "warning"
      );
    });
  },

  reactivateExpedition(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t) return;
    this.clearCargoExpeditionMarks(tid);
    t.expeditionAnnulled = false;
    delete t.expeditionAnnulledAt;
    delete t.expeditionShippedAt;
    if (!t.shipmentDate) t.shipmentDate = new Date().toISOString().split("T")[0];
    t.updated = new Date().toISOString();
    this.save();
    this.render();
    if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
    Utils.showToast(I18n.t("msg.transportExpeditionReactivated"), "info");
  },

  _transportIdCssEscape(id) {
    const s = String(id ?? "");
    try {
      return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    } catch {
      return s;
    }
  },

  /** Panel de detalle expandido debajo de la franja de camiones. */
  _getTransportDetailPanelEl(tid) {
    const e = this._transportIdCssEscape(tid);
    return document.querySelector(`.transport-detail-slot [data-transport-id="${e}"]`);
  },

  /** Celda compacta del camión en la franja superior. */
  _getTransportStripEl(tid) {
    const e = this._transportIdCssEscape(tid);
    return document.querySelector(`.transport-card--strip[data-transport-id="${e}"]`);
  },

  _syncTransportCardChrome(t, card) {
    const strip = this._getTransportStripEl(t.id);
    if (strip) {
      strip.classList.remove("transport-card--listo", "transport-card--parcial", "transport-card--annulled");
      strip.classList.add(
        t.expeditionAnnulled ? "transport-card--annulled" : t.status === "Listo" ? "transport-card--listo" : "transport-card--parcial"
      );
      const sumStatus = strip.querySelector(".transport-cell-status");
      if (sumStatus) {
        const lbl = t.expeditionAnnulled
          ? I18n.t("transport.cellStatusAnnulled")
          : t.status === "Listo"
            ? I18n.t("transport.cellStatusListo")
            : I18n.t("transport.cellStatusParcial");
        sumStatus.textContent = lbl;
        const scls = t.expeditionAnnulled ? "annulled" : (t.status || "Parcial").toLowerCase();
        sumStatus.className = `transport-cell-status ${scls}`;
      }
      const sumDate = strip.querySelector(".transport-cell-date");
      if (sumDate) {
        sumDate.textContent = t.expeditionAnnulled ? "—" : t.shipmentDate || I18n.t("transport.noExpeditionDate");
      }
    }

    const root = card || this._getTransportDetailPanelEl(t.id);
    if (!root) return;
    const statusEl = root.querySelector(".t-header .status");
    if (statusEl) {
      statusEl.textContent = t.expeditionAnnulled
        ? I18n.t("transport.cellStatusAnnulled")
        : t.status === "Listo"
          ? I18n.t("transport.cellStatusListo")
          : I18n.t("transport.cellStatusParcial");
      const cls = t.expeditionAnnulled
        ? "annulled"
        : (t.status || "Parcial").toLowerCase().replace(/\s+/g, "");
      statusEl.className = `status ${cls}`;
    }
    root.classList.remove("transport-card--listo", "transport-card--parcial", "transport-card--annulled");
    root.classList.add(
      t.expeditionAnnulled ? "transport-card--annulled" : t.status === "Listo" ? "transport-card--listo" : "transport-card--parcial"
    );
    const footer = root.querySelector(".t-footer-hint");
    if (footer) {
      footer.textContent = t.expeditionAnnulled
        ? I18n.t("transport.footerAnnulled")
        : t.expeditionShippedAt
          ? `${I18n.t("transport.footerShipped")} ${Utils.formatDateTime(t.expeditionShippedAt)}`
          : t.status === "Listo"
            ? I18n.t("transport.readyToShip")
            : I18n.t("transport.notReadyToShip");
    }
    (t.lines || []).forEach(ln => {
      const row = [...root.querySelectorAll(".transport-line")].find(r => r.dataset.line === ln.id);
      if (row) {
        row.classList.toggle("resolved", this.isLineResolved(ln));
        row.classList.toggle("is-na", !!ln.na);
      }
    });
  },

  /** Actualiza una fila sin re-renderizar toda la tarjeta (evita perder el foco al teclear cantidades). */
  updateSingleTransportLineInDom(t, line) {
    const panel = this._getTransportDetailPanelEl(t.id);
    if (!panel) {
      this.render();
      return;
    }
    const oldRow = [...panel.querySelectorAll(".transport-line")].find(row => row.dataset.line === line.id);
    if (!oldRow) {
      this.render();
      return;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = this.renderLineRow(t, line).trim();
    const next = wrap.firstElementChild;
    if (next) oldRow.replaceWith(next);
    this._syncTransportCardChrome(t, panel);
  },

  onBoardEvent(e) {
    const el = e.target;
    const tid = el.dataset?.tid;
    if (!tid) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t) return;

    if (el.classList.contains("transport-expedition") && !t.expeditionAnnulled) {
      t.shipmentDate = el.value || t.shipmentDate;
      t.updated = new Date().toISOString();
      this.save();
      const panel = this._getTransportDetailPanelEl(t.id);
      this._syncTransportCardChrome(t, panel);
      return;
    }

    const lineId = el.dataset?.line;
    if (!lineId) return;
    const line = (t.lines || []).find(l => l.id === lineId);
    if (!line) return;

    if (el.classList.contains("line-na")) {
      line.na = el.checked;
      if (line.na) {
        line.qty = null;
        line.dims = [];
      }
      this.padDims(line);
      this.recomputeStatus(t);
      this.save();
      this.updateSingleTransportLineInDom(t, line);
      return;
    }

    if (el.classList.contains("line-qty")) {
      line.receptionLineUserOverride = true;
      const raw = el.value;
      if (raw === "" || raw === null) line.qty = null;
      else line.qty = Math.max(0, parseInt(raw, 10) || 0);
      this.padDims(line);
      this.recomputeStatus(t);
      this.save();
      this.updateSingleTransportLineInDom(t, line);
      return;
    }

    const dimIdx = el.dataset.dimIdx;
    if (dimIdx !== undefined && el.classList.contains("dim-field")) {
      line.receptionLineUserOverride = true;
      const i = parseInt(dimIdx, 10);
      const axis = el.dataset.axis;
      if (!line.dims[i]) line.dims[i] = { l: "", w: "", t: "" };
      line.dims[i][axis] = el.value;
      t.updated = new Date().toISOString();
      this.padDims(line);
      this.recomputeStatus(t);
      this.save();
      const panel = this._getTransportDetailPanelEl(t.id);
      this._syncTransportCardChrome(t, panel);
    }
  },

  hardwareItemsCount(t) {
    let n = 0;
    const movs = typeof MovementManager !== "undefined" ? MovementManager.movements || [] : [];
    (t.checklistRefs || []).forEach(r => {
      const mov = movs.find(m => m.id === r.movementId || m.reference === r.ref);
      if (mov && mov.items && !mov.annulled) {
        n += mov.items.filter(it => !it.annulled).length;
      }
    });
    (t.elecObraRefs || []).forEach(r => {
      const mov = movs.find(m => m.id === r.movementId || m.reference === r.ref);
      if (mov && mov.items && !mov.annulled) {
        n += mov.items.filter(it => !it.annulled).length;
      }
    });
    (t.elecProdRefs || []).forEach(r => {
      const mov = movs.find(m => m.id === r.movementId || m.reference === r.ref);
      if (mov && mov.items && !mov.annulled) {
        n += mov.items.filter(it => !it.annulled).length;
      }
    });
    return n;
  },

  ensureFromChecklist(mov, expeditionDate) {
    const pid = Utils.projectIdForTransportLink(mov);
    if (!pid) return;
    const today = new Date().toISOString().split("T")[0];
    const dateOk = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
    const ship = dateOk(expeditionDate) ? expeditionDate.trim() : today;

    const refEntry = {
      ref: mov.reference,
      movementId: mov.id,
      at: mov.date || new Date().toISOString()
    };

    let t = this.getActiveByProject(pid);

    if (!t) {
      t = {
        id: Utils.generateId(),
        projectId: pid,
        checklistRefs: [refEntry],
        elecObraRefs: [],
        elecProdRefs: [],
        shipmentDate: ship,
        expeditionAnnulled: false,
        notes: mov.notes || "",
        lines: [],
        version: 3,
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      };
      this.migrateTransport(t);
      this.mergePendingObraInto(t);
      this.mergePendingProdInto(t);
      this._syncTransportLinesFromReceptions(t);
      this.transports.push(t);
      const total = this.getAllByProject(pid).length;
      const label = total > 1 ? ` — ${I18n.t("transport.truckLabel")} ${total}` : "";
      Utils.showToast(`${I18n.t("msg.transportCreated")} (${pid}${label})`, "success");
    } else {
      t.checklistRefs = t.checklistRefs || [];
      if (!t.checklistRefs.some(r => r.movementId === mov.id)) {
        t.checklistRefs.push(refEntry);
      }
      this.mergePendingObraInto(t);
      this.mergePendingProdInto(t);
      t.updated = new Date().toISOString();
      this.migrateTransport(t);
      this._syncTransportLinesFromReceptions(t);
      Utils.showToast(`${I18n.t("msg.transportChecklistLinked")} (${pid})`, "info");
    }
    this.save();
    this.render();
  },

  attachElecObra(mov) {
    const pid = Utils.projectIdForTransportLink(mov);
    if (!pid) return;
    const entry = {
      ref: mov.reference,
      movementId: mov.id,
      at: mov.date || new Date().toISOString()
    };
    const t = this.getActiveByProject(pid) || this.getByProject(pid);
    if (t) {
      t.elecObraRefs = t.elecObraRefs || [];
      if (!t.elecObraRefs.some(r => r.movementId === mov.id)) {
        t.elecObraRefs.push(entry);
      }
      t.updated = new Date().toISOString();
      this.migrateTransport(t);
      this.save();
      this.render();
      Utils.showToast(I18n.t("msg.elecObraLinkedToTransport"), "success");
    } else {
      this.pendingElecObra[pid] = this.pendingElecObra[pid] || [];
      if (!this.pendingElecObra[pid].some(r => r.movementId === mov.id)) {
        this.pendingElecObra[pid].push(entry);
      }
      this.savePending();
      Utils.showToast(I18n.t("msg.elecObraQueuedForTransport"), "info");
    }
  },

  attachElecProd(mov) {
    const pid = Utils.projectIdForTransportLink(mov);
    if (!pid) return;
    const entry = {
      ref: mov.reference,
      movementId: mov.id,
      at: mov.date || new Date().toISOString()
    };
    const t = this.getActiveByProject(pid) || this.getByProject(pid);
    if (t) {
      t.elecProdRefs = t.elecProdRefs || [];
      if (!t.elecProdRefs.some(r => r.movementId === mov.id)) {
        t.elecProdRefs.push(entry);
      }
      t.updated = new Date().toISOString();
      this.migrateTransport(t);
      this.save();
      this.render();
      Utils.showToast(I18n.t("msg.elecProdLinkedToTransport"), "success");
    } else {
      this.pendingElecProd[pid] = this.pendingElecProd[pid] || [];
      if (!this.pendingElecProd[pid].some(r => r.movementId === mov.id)) {
        this.pendingElecProd[pid].push(entry);
      }
      this.savePending();
      Utils.showToast(I18n.t("msg.elecProdQueuedForTransport"), "info");
    }
  },

  /** Marca movimientos y recepciones como expedidos al salir el camión (ya no están en planta). */
  markCargoExpeditedForTransport(t) {
    const movMgr = typeof MovementManager !== "undefined" ? MovementManager : null;
    const recMgr = typeof ReceptionsManager !== "undefined" ? ReceptionsManager : null;
    if (!movMgr?.movements || !recMgr?.receptions) return;

    const now = new Date().toISOString();
    const refs = [...(t.checklistRefs || []), ...(t.elecObraRefs || []), ...(t.elecProdRefs || [])];
    let movChanged = false;

    refs.forEach(r => {
      const m = movMgr.movements.find(x => x.id === r.movementId || x.reference === r.ref);
      if (m && !m.annulled) {
        m.transportExpeditedAt = now;
        m.transportExpeditedByTransportId = t.id;
        movChanged = true;
      }
    });

    let recChanged = false;
    recMgr.receptions.forEach(rec => {
      if (
        Utils.projectIdsEquivalent(rec.projectId, t.projectId) &&
        !rec.provisionalAnnulled &&
        !rec.expeditedAt
      ) {
        rec.expeditedAt = now;
        rec.expeditedTransportId = t.id;
        recChanged = true;
      }
    });

    if (movChanged) movMgr.save();
    if (recChanged) recMgr.save();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
  },

  /** Revoca marcas de expedición ligadas a un transporte (anular expedición, reactivar o borrar). */
  clearCargoExpeditionMarks(transportId) {
    const tid = transportId;
    const movMgr = typeof MovementManager !== "undefined" ? MovementManager : null;
    const recMgr = typeof ReceptionsManager !== "undefined" ? ReceptionsManager : null;
    let movChanged = false;
    let recChanged = false;

    if (movMgr?.movements) {
      movMgr.movements.forEach(m => {
        if (m.transportExpeditedByTransportId === tid) {
          delete m.transportExpeditedAt;
          delete m.transportExpeditedByTransportId;
          movChanged = true;
        }
      });
    }
    if (recMgr?.receptions) {
      recMgr.receptions.forEach(rec => {
        if (rec.expeditedTransportId === tid) {
          delete rec.expeditedAt;
          delete rec.expeditedTransportId;
          recChanged = true;
        }
      });
    }
    if (movChanged) movMgr.save();
    if (recChanged) recMgr.save();
  },

  onMovementAnnulled(mov) {
    if (!mov) return;
    const pid = Utils.projectIdForTransportLink(mov);
    if (!pid) return;
    if (mov.type === "MAT_ELEC_OBRA") {
      Object.keys(this.pendingElecObra || {}).forEach(storeKey => {
        if (!Utils.projectIdsEquivalent(storeKey, pid)) return;
        const pend = this.pendingElecObra[storeKey];
        if (!pend) return;
        const next = pend.filter(r => r.movementId !== mov.id && r.ref !== mov.reference);
        if (next.length) this.pendingElecObra[storeKey] = next;
        else delete this.pendingElecObra[storeKey];
      });
      this.savePending();
    }
    if (mov.type === "MAT_ELEC_PROD") {
      Object.keys(this.pendingElecProd || {}).forEach(storeKey => {
        if (!Utils.projectIdsEquivalent(storeKey, pid)) return;
        const pend = this.pendingElecProd[storeKey];
        if (!pend) return;
        const next = pend.filter(r => r.movementId !== mov.id && r.ref !== mov.reference);
        if (next.length) this.pendingElecProd[storeKey] = next;
        else delete this.pendingElecProd[storeKey];
      });
      this.savePending();
    }
    const all = this.getAllByProject(pid);
    if (!all.length) return;
    let changed = false;
    all.forEach(t => {
      if (mov.type === "LISTA_CHEQUEO") {
        const before = (t.checklistRefs || []).length;
        t.checklistRefs = (t.checklistRefs || []).filter(
          r => r.movementId !== mov.id && r.ref !== mov.reference
        );
        if (t.checklistRefs.length !== before) changed = true;
      }
      if (mov.type === "MAT_ELEC_OBRA") {
        const before = (t.elecObraRefs || []).length;
        t.elecObraRefs = (t.elecObraRefs || []).filter(
          r => r.movementId !== mov.id && r.ref !== mov.reference
        );
        if (t.elecObraRefs.length !== before) changed = true;
      }
      if (mov.type === "MAT_ELEC_PROD") {
        const before = (t.elecProdRefs || []).length;
        t.elecProdRefs = (t.elecProdRefs || []).filter(
          r => r.movementId !== mov.id && r.ref !== mov.reference
        );
        if (t.elecProdRefs.length !== before) changed = true;
      }
      t.updated = new Date().toISOString();
      this.recomputeStatus(t);
    });
    if (changed) {
      this.save();
      this.render();
    }
  },

  shipTransport(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t || t.expeditionAnnulled || t.status !== "Listo" || t.expeditionShippedAt) return;
    App.showConfirm(I18n.t("confirm.shipTransport"), () => {
      t.expeditionShippedAt = new Date().toISOString();
      t.updated = new Date().toISOString();
      this.markCargoExpeditedForTransport(t);
      this.save();
      this.render();
      if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
      if (typeof Auth !== "undefined") Auth.logAudit("transport.ship", t.projectId);
      Utils.showToast(`${I18n.t("msg.transportShipped")} (${t.projectId})`, "success");
    });
  },

  deleteTransport(id) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    if (typeof Auth !== "undefined" && !Auth.guardTransportMutation()) return;
    App.showConfirm(I18n.t("confirm.deleteTransport"), () => {
      this.clearCargoExpeditionMarks(id);
      this.transports = this.transports.filter(t => t.id !== id);
      this.save();
      this.render();
      if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
      if (typeof Auth !== "undefined") Auth.logAudit("transport.delete", id);
      Utils.showToast(I18n.t("msg.transportDeleted"), "warning");
    });
  },

  renderRecepListContent(t) {
    const projectId = t.projectId;
    const tid = t.id;
    let list = (ReceptionsManager.receptions || []).filter(
      r => Utils.projectIdsEquivalent(r.projectId, projectId) && !r.provisionalAnnulled
    );
    if (t.expeditionShippedAt) {
      list = list.filter(r => r.expeditedTransportId === tid);
    } else {
      list = list.filter(r => !r.expeditedAt);
    }
    const fq = (
      (this._receptionFilterByTransport && tid && this._receptionFilterByTransport[tid]) ||
      ""
    )
      .trim()
      .toLowerCase();
    const filtered = !fq
      ? list
      : list.filter(r => {
          const cat = r.materialCategory || "";
          const catLab = I18n.t(`reception.mat.${cat}`);
          const catLabOk = catLab !== `reception.mat.${cat}` ? catLab : "";
          const pack = [
            r.itemName,
            r.quantity,
            cat,
            catLabOk,
            r.purchaseOrder,
            r.supplier,
            r.provisional ? "provisional" : "",
            I18n.t("reception.provisional"),
            Utils.formatDate(r.dateReceived),
            r.dateReceived,
            r.id
          ]
            .map(x => String(x ?? "").toLowerCase())
            .join(" ");
          const tokens = fq.split(/\s+/).filter(Boolean);
          return !tokens.length || tokens.every(tok => pack.indexOf(tok) >= 0);
        });
    if (!filtered.length) {
      return `<small class="transport-rec-empty">${this.esc(
        I18n.t(fq ? "msg.transportRecFilterEmpty" : "transport.noReceptions")
      )}</small>`;
    }
    return `
      <ul class="rec-mini-list">
        ${filtered
          .map(r => {
            const po = r.purchaseOrder ? ` · PO ${this.esc(r.purchaseOrder)}` : "";
            const sup = r.supplier ? ` · ${this.esc(r.supplier)}` : "";
            const prov = r.provisional ? ` [${this.esc(I18n.t("reception.provisional"))}]` : "";
            const cat = r.materialCategory ? ` (${this.esc(r.materialCategory)})` : "";
            const dim = r.dimensions || {};
            const dL = parseFloat(dim.L) || 0;
            const dW = parseFloat(dim.W) || 0;
            const dH = parseFloat(dim.H) || 0;
            const unitDims = Array.isArray(r.dimensionsItems) ? r.dimensionsItems : [];
            const hasDim = dL > 0 || dW > 0 || dH > 0;
            const fmtDim = v => {
              if (!(v > 0)) return "0";
              return String(Utils.roundDecimal(v, 4)).replace(/\.?0+$/, "");
            };
            const perUnit = unitDims
              .map((d, i) => {
                const l = parseFloat(d?.L) || 0;
                const w = parseFloat(d?.W) || 0;
                const h = parseFloat(d?.H) || 0;
                if (!(l > 0 || w > 0 || h > 0)) return "";
                return `${i + 1}) ${fmtDim(l)}×${fmtDim(w)}×${fmtDim(h)}`;
              })
              .filter(Boolean)
              .join(" | ");
            const dimSuffix = perUnit
              ? ` · ${this.esc(I18n.t("transport.dimsLwh"))}: ${this.esc(perUnit)}`
              : hasDim
                ? ` · ${this.esc(I18n.t("transport.dimsLwh"))}: ${this.esc(
                    [fmtDim(dL), fmtDim(dW), fmtDim(dH)].join("×")
                  )}`
                : "";
            let packSuffix = "";
            if (
              typeof ReceptionsManager !== "undefined" &&
              ReceptionsManager.isGlassPackingCategory &&
              ReceptionsManager.isGlassPackingCategory(r.materialCategory)
            ) {
              if (r.glassPacking === "standard_box") {
                packSuffix = ` · ${this.esc(I18n.t("reception.glassPackingStandard"))}`;
              } else if (r.glassPacking === "loose_mixed") {
                packSuffix = ` · ${this.esc(I18n.t("reception.glassPackingLoose"))}`;
              }
            }
            return `<li>${this.esc(r.itemName)} (${this.esc(r.quantity)})${cat}${po}${sup}${prov}${dimSuffix}${packSuffix} — ${Utils.formatDate(
              r.dateReceived
            )}</li>`;
          })
          .join("")}
      </ul>`;
  },

  renderRecepSection(t) {
    const tid = t.id;
    const q = (this._receptionFilterByTransport && this._receptionFilterByTransport[tid]) || "";
    const ph = this.esc(I18n.t("config.receptionsSearchPlaceholder"));
    return `
        <div class="t-receptions">
          <div class="t-rec-title">${this.esc(I18n.t("transport.receptionsTitle"))}</div>
          <div class="transport-rec-search-row">
            <input type="search" class="form-input transport-rec-search" data-tid="${tid}" placeholder="${ph}" value="${this.esc(
      q
    )}" />
          </div>
          ${this.renderRecepListContent(t)}
        </div>`;
  },

  showMergeCheckbox(line) {
    if (this.isLockedAtomicId(line.id)) return false;
    return true;
  },

  renderLineRow(t, line) {
    const na = line.na;
    const qtyVal = line.qty === null || line.qty === undefined ? "" : line.qty;
    const dims = line.dims || [];
    const skipDims = this.lineSkipsDetailedDims(line);
    const dimRows = skipDims
      ? `<span class="transport-dim-hint">${this.esc(I18n.t("transport.qtyOnlyDimsHint"))}</span>`
      : !na && line.qty > 0
        ? dims
            .map(
              (d, i) => `
          <div class="transport-dim-row" data-tid="${t.id}" data-line="${line.id}">
            <span class="dim-label">${this.esc(I18n.t("transport.dimUnit"))} ${i + 1}</span>
            <input type="text" class="dim-field" data-axis="l" data-dim-idx="${i}" data-tid="${t.id}" data-line="${line.id}" placeholder="${Utils.escapeAttr(I18n.t("transport.dimL"))}" value="${(d.l || "").replace(/"/g, "&quot;")}" ${na ? "disabled" : ""} />
            <input type="text" class="dim-field" data-axis="w" data-dim-idx="${i}" data-tid="${t.id}" data-line="${line.id}" placeholder="${Utils.escapeAttr(I18n.t("transport.dimW"))}" value="${(d.w || "").replace(/"/g, "&quot;")}" ${na ? "disabled" : ""} />
            <input type="text" class="dim-field" data-axis="t" data-dim-idx="${i}" data-tid="${t.id}" data-line="${line.id}" placeholder="${Utils.escapeAttr(I18n.t("transport.dimT"))}" value="${(d.t || "").replace(/"/g, "&quot;")}" ${na ? "disabled" : ""} />
          </div>`
            )
            .join("")
        : `<span class="transport-dim-hint">${this.esc(I18n.t("transport.dimsHint"))}</span>`;

    const resolved = this.isLineResolved(line);
    const mode = ["normal", "merge", "unmerge"].includes(t.mergeUiMode) ? t.mergeUiMode : "normal";
    const mergeCb =
      mode !== "unmerge" && this.showMergeCheckbox(line)
        ? `<label class="line-merge-wrap" title="${Utils.escapeAttr(I18n.t("transport.mergePickHint"))}"><input type="checkbox" class="line-merge-pick" data-tid="${t.id}" data-line="${line.id}" /></label>`
        : "";
    const splitBtn =
      line.mergedFrom && line.mergedFrom.length && mode !== "merge"
        ? `<button type="button" class="btn btn-secondary btn-split-merge" data-transport-action="split-line" data-tid="${t.id}" data-line="${line.id}">${this.esc(I18n.t("transport.unmerge"))}</button>`
        : "";

    return `
      <div class="transport-line ${resolved ? "resolved" : ""} ${na ? "is-na" : ""}" data-tid="${t.id}" data-line="${line.id}">
        <div class="transport-line-head">
          <strong>${this.esc(this.lineTitle(line))}</strong>
          <div class="transport-line-actions">
            ${mergeCb}
            ${splitBtn}
            <label class="transport-na-label">
              <input type="checkbox" class="line-na" data-tid="${t.id}" data-line="${line.id}" ${na ? "checked" : ""} />
              ${this.esc(I18n.t("transport.na"))}
            </label>
          </div>
        </div>
        <div class="transport-line-body">
          <label class="transport-qty-label">${this.esc(I18n.t("transport.qty"))}
            <input type="number" min="0" step="1" class="line-qty" data-tid="${t.id}" data-line="${line.id}" value="${qtyVal}" ${na ? "disabled" : ""} />
          </label>
          <div class="transport-dims">${dimRows}</div>
        </div>
      </div>`;
  },

  _transportReportFileStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  },

  _lineDimsText(line) {
    const dims = Array.isArray(line?.dims) ? line.dims : [];
    if (!dims.length) return "";
    return dims
      .map((d, i) => {
        const l = String(d?.l || "").trim();
        const w = String(d?.w || "").trim();
        const t = String(d?.t || "").trim();
        if (!l && !w && !t) return "";
        return `${i + 1}) ${l || "-"} x ${w || "-"} x ${t || "-"}`;
      })
      .filter(Boolean)
      .join(" | ");
  },

  buildTransportCargoReportRows(t) {
    if (!t) return [];
    return (t.lines || [])
      .filter(line => !line.na && (parseInt(line.qty, 10) || 0) > 0)
      .map(line => ({
        projectId: t.projectId || "",
        truck: this.getTransportLabel(t).replace(/^ \u2014 /, "") || I18n.t("transport.truckLabel"),
        material: this.lineTitle(line),
        quantity: parseInt(line.qty, 10) || 0,
        dimensions: this._lineDimsText(line),
        unit: "in",
        dims: Array.isArray(line?.dims) ? line.dims : []
      }));
  },

  _buildTransportCargoDataset(t) {
    const rows = this.buildTransportCargoReportRows(t);
    const colProject = I18n.t("reception.project");
    const colTruck = I18n.t("transport.truckLabel");
    const colDesc = I18n.t("table.description");
    const colQty = I18n.t("transport.qty");
    const colDimsSum = I18n.t("transport.dimsLwh");
    const colUnit = I18n.t("transport.dimUnit");
    const colPkg = I18n.t("transport.cargoPackageCol");
    const colL = I18n.t("transport.cargoAxisL");
    const colW = I18n.t("transport.cargoAxisW");
    const colH = I18n.t("transport.cargoAxisH");
    const headers = [colProject, colTruck, colDesc, colQty, colDimsSum, colUnit, colPkg, colL, colW, colH];
    const data = [];
    for (const r of rows) {
      const dims = Array.isArray(r.dims) ? r.dims : [];
      const n = Math.max(dims.length, 1);
      for (let i = 0; i < n; i++) {
        const d = dims[i] || {};
        data.push({
          [colProject]: r.projectId,
          [colTruck]: r.truck,
          [colDesc]: r.material,
          [colQty]: r.quantity,
          [colDimsSum]: r.dimensions,
          [colUnit]: r.unit,
          [colPkg]: dims.length ? String(i + 1) : "",
          [colL]: d.l || "",
          [colW]: d.w || "",
          [colH]: d.t || ""
        });
      }
    }
    return { headers, data };
  },

  async exportTransportCargoReport(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t) return;
    const ds = this._buildTransportCargoDataset(t);
    if (!ds.data.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const selected = await Utils.pickColumns(ds.headers, I18n.t("transport.exportCargoReport"));
    if (!selected || !selected.length) return;
    const data = ds.data.map(r => {
      const o = {};
      selected.forEach(h => {
        o[h] = r[h] ?? "";
      });
      return o;
    });
    const fileName = `GNEEX_Transport_Cargo_${(t.projectId || "PROJECT").replace(/[^\w-]+/g, "_")}_${this._transportReportFileStamp()}.xlsx`;
    await Utils.exportStyledXlsxToInformFolder(fileName, selected, data, {
      kind: "report:transport-cargo",
      title: `${I18n.t("transport.title")} - ${I18n.t("transport.cargoReportTitle")}`,
      details: [
        `${I18n.t("reception.project")}: ${t.projectId || ""}`,
        `${I18n.t("export.manifest.rows")}: ${data.length}`
      ]
    });
  },

  async printTransportCargoReport(tid) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    const t = this.transports.find(x => x.id === tid);
    if (!t) return;
    const ds = this._buildTransportCargoDataset(t);
    if (!ds.data.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const selected = await Utils.pickColumns(ds.headers, I18n.t("transport.printCargoReport"));
    if (!selected || !selected.length) return;
    const esc = s => Utils.escapeHtml(String(s ?? ""));
    const body = ds.data
      .map(
        r => `<tr>${selected.map(h => `<td>${esc(r[h] ?? "")}</td>`).join("")}</tr>`
      )
      .join("");
    Utils.printHtmlDocument(
      I18n.t("transport.cargoReportTitle"),
      `${I18n.t("reception.project")}: ${esc(t.projectId || "")}`,
      `<table class="inventory-table"><thead><tr>${selected.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`
    );
  },

  /** Contenido expandido (líneas, recepciones, botones). Siempre debajo de la franja de camiones. */
  _renderTransportDetailBodyHtml(t) {
    const hwCount = this.hardwareItemsCount(t);
    const truckLabel = this.getTransportLabel(t);
    const checklistTxt = (t.checklistRefs || []).map(r => this.esc(r.ref)).join(", ") || "—";
    const obraTxt = (t.elecObraRefs || []).map(r => this.esc(r.ref)).join(", ") || "—";
    const prodTxt = (t.elecProdRefs || []).map(r => this.esc(r.ref)).join(", ") || "—";
    const statusClass = t.expeditionAnnulled ? "annulled" : (t.status || "Parcial").toLowerCase();
    const statusLabel = t.expeditionAnnulled
      ? I18n.t("transport.cellStatusAnnulled")
      : t.status === "Listo"
        ? I18n.t("transport.cellStatusListo")
        : I18n.t("transport.cellStatusParcial");
    const canShip = !t.expeditionAnnulled && t.status === "Listo" && !t.expeditionShippedAt;
    const shipDisabledTitle = t.expeditionShippedAt && !t.expeditionAnnulled
      ? I18n.t("transport.shipBtnTitleShipped")
      : t.expeditionAnnulled
        ? I18n.t("transport.shipBtnTitleAnnulled")
        : t.status !== "Listo"
          ? I18n.t("transport.notReadyToShip")
          : "";
    const pending = this._mergedPendingObraForTransport(t.projectId);
    const pendingProd = this._mergedPendingProdForTransport(t.projectId);
    const pendingTxt =
      pending.length > 0
        ? `<div class="t-pending-obra"><span class="muted">${this.esc(I18n.t("transport.pendingObra"))}</span> ${pending.map(p => this.esc(p.ref)).join(", ")}</div>`
        : "";
    const pendingProdTxt =
      pendingProd.length > 0
        ? `<div class="t-pending-prod"><span class="muted">${this.esc(I18n.t("transport.pendingProd"))}</span> ${pendingProd.map(p => this.esc(p.ref)).join(", ")}</div>`
        : "";

    const tAtts = Array.isArray(t.attachments) ? t.attachments : [];
    const canTrAtt =
      typeof Auth !== "undefined" &&
      Auth.hasPerm &&
      Auth.hasPerm("transport") &&
      (Auth.isAdmin() || Auth.isElevated());
    const trAttBlock =
      canTrAtt || tAtts.length
        ? `<div class="gneex-attachments-block gneex-transport-attachments">
          <h4 class="gneex-attachments-title">📎 ${this.esc(I18n.t("attachments.title"))} (${tAtts.length})</h4>
          ${
            canTrAtt
              ? `<div class="gneex-attachments-toolbar">
            <button type="button" class="btn btn-sm btn-secondary" data-transport-action="pick-transport-attachments" data-tid="${Utils.escapeAttr(t.id)}">📎 ${this.esc(I18n.t("attachments.add"))}</button>
          </div>`
              : ""
          }
          ${
            tAtts.length
              ? `<ul class="gneex-attachments-list">${tAtts
                  .map(a => {
                    const nm = a.originalName || a.fileName || "—";
                    const kb = Math.max(0, Math.round((a.size || 0) / 1024));
                    const isLegacy = !!(a.relPath && a.linkKind !== "localHandle");
                    const openBtn = !isLegacy
                      ? `<button type="button" class="btn btn-sm btn-secondary" data-transport-open-attachment="1" data-tid="${Utils.escapeAttr(t.id)}" data-aid="${Utils.escapeAttr(a.id)}">${this.esc(I18n.t("attachments.open"))}</button>`
                      : "";
                    const legacyCopy =
                      isLegacy && a.relPath
                        ? `<button type="button" class="btn btn-sm btn-secondary" data-transport-copy-legacy="1" data-copy-transport-rel="${Utils.escapeAttr(a.relPath)}">${this.esc(I18n.t("attachments.copyLegacyPath"))}</button>`
                        : "";
                    return `<li class="gneex-attachment-row">
              <span class="gneex-att-name" title="${this.esc(nm)}">${this.esc(nm)}</span>
              <span class="muted gneex-att-meta">${this.esc(Utils.formatDateTime(a.addedAt))} · ${kb} KB</span>
              <div class="gneex-att-actions">
                ${openBtn}${legacyCopy}
                ${
                  canTrAtt
                    ? `<button type="button" class="btn btn-sm btn-danger" data-transport-action="remove-transport-attachment" data-aid="${Utils.escapeAttr(a.id)}" data-tid="${Utils.escapeAttr(t.id)}">${this.esc(I18n.t("attachments.remove"))}</button>`
                    : ""
                }
              </div>
            </li>`;
                  })
                  .join("")}</ul>`
              : `<p class="muted">${this.esc(I18n.t("attachments.empty"))}</p>`
          }
        </div>`
        : "";

    const expBlock = t.expeditionAnnulled
      ? `<div class="t-expedition annulled">
          <p class="exp-annulled-msg">${this.esc(I18n.t("transport.expeditionAnnulledMsg"))}</p>
          <div class="t-annulled-actions">
            <button type="button" class="btn btn-primary" data-transport-action="define-expedition" data-tid="${t.id}">${this.esc(
        I18n.t("transport.defineExpeditionAgain")
      )}</button>
          </div>
        </div>`
      : `<div class="t-expedition">
          <label>${this.esc(I18n.t("transport.expeditionDate"))}
            <input type="date" class="transport-expedition" data-tid="${t.id}" value="${t.shipmentDate || ""}" />
          </label>
          <button type="button" class="btn btn-secondary btn-annul-exp" data-transport-action="annul-expedition" data-tid="${t.id}">${this.esc(I18n.t("transport.annulExpedition"))}</button>
        </div>`;

    const mode = ["normal", "merge", "unmerge"].includes(t.mergeUiMode) ? t.mergeUiMode : "normal";
    const showMergePair = !t.expeditionAnnulled && (mode === "normal" || mode === "merge");
    const modeRow = !t.expeditionAnnulled
      ? `<div class="t-line-mode-toolbar t-line-mode-toolbar--row">
        <div class="t-line-mode-left">
          <span class="t-line-mode-label">${this.esc(I18n.t("transport.lineModeHint"))}</span>
          <div class="t-line-mode-buttons">
            <button type="button" class="btn btn-sm ${mode === "normal" ? "btn-primary" : "btn-secondary"}" data-transport-action="set-merge-mode" data-mode="normal" data-tid="${t.id}">${this.esc(
        I18n.t("transport.lineModeNormal")
      )}</button>
            <button type="button" class="btn btn-sm ${mode === "merge" ? "btn-primary" : "btn-secondary"}" data-transport-action="set-merge-mode" data-mode="merge" data-tid="${t.id}">${this.esc(
        I18n.t("transport.lineModeMerge")
      )}</button>
            <button type="button" class="btn btn-sm ${mode === "unmerge" ? "btn-primary" : "btn-secondary"}" data-transport-action="set-merge-mode" data-mode="unmerge" data-tid="${t.id}">${this.esc(
        I18n.t("transport.lineModeUnmerge")
      )}</button>
          </div>
        </div>
        ${
          showMergePair
            ? `<div class="t-merge-toolbar-inline">
          <span class="merge-toolbar-hint merge-toolbar-hint--inline">${this.esc(
            I18n.t(mode === "merge" ? "transport.mergeToolbarHintActive" : "transport.mergeToolbarHint")
          )}</span>
          <button type="button" class="btn btn-primary btn-sm btn-merge-lines" data-transport-action="merge-lines" data-tid="${t.id}">${this.esc(
            I18n.t("transport.mergeSelected")
          )}</button>
        </div>`
            : ""
        }
      </div>`
      : "";

    const mergedLines = (t.lines || []).filter(l => l.mergedFrom && l.mergedFrom.length);
    const unmergeBulk =
      !t.expeditionAnnulled && mode === "unmerge" && mergedLines.length
        ? `<div class="t-unmerge-toolbar">
            <span class="merge-toolbar-hint">${this.esc(I18n.t("transport.unmergeToolbarHint"))}</span>
            <div class="t-unmerge-toolbar-buttons">
              ${mergedLines
                .map(
                  l => `<button type="button" class="btn btn-secondary btn-unmerge-bulk" data-transport-action="split-line" data-tid="${t.id}" data-line="${l.id}">${this.esc(
                    I18n.t("transport.unmerge")
                  )}: ${this.esc(this.lineTitle(l))}</button>`
                )
                .join("")}
            </div>
          </div>`
        : "";

    const footerHint = t.expeditionAnnulled
      ? this.esc(I18n.t("transport.footerAnnulled"))
      : t.expeditionShippedAt
        ? `${this.esc(I18n.t("transport.footerShipped"))} ${Utils.formatDateTime(t.expeditionShippedAt)}`
        : t.status === "Listo"
          ? this.esc(I18n.t("transport.readyToShip"))
          : this.esc(I18n.t("transport.notReadyToShip"));

    const shipBtn = canShip
      ? `<button type="button" class="btn btn-primary" data-transport-action="ship-transport" data-tid="${t.id}">${this.esc(I18n.t("transport.shipTransport"))}</button>`
      : `<button type="button" class="btn btn-primary" disabled title="${this.esc(shipDisabledTitle)}">${this.esc(I18n.t("transport.shipTransport"))}</button>`;

    return `
        <div class="transport-card-body">
        <div class="t-header">
          <div>
            <strong>${this.esc(t.projectId)}${this.esc(truckLabel)}</strong>
            <span class="t-sub">${this.esc(I18n.t("transport.hardwareBundle"))}</span>
          </div>
          <div class="t-header-status-block">
            <span class="status ${statusClass}">${this.esc(statusLabel)}</span>
            <div class="t-cargo-report-icon-actions" role="toolbar" aria-label="${Utils.escapeAttr(I18n.t("transport.cargoReportTitle"))}">
              <button type="button" class="btn inventory-asof-icon-btn" data-transport-action="export-cargo-report" data-tid="${Utils.escapeAttr(t.id)}" title="${Utils.escapeAttr(I18n.t("transport.exportCargoReport"))}" aria-label="${Utils.escapeAttr(I18n.t("transport.exportCargoReport"))}"><svg class="inv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg></button>
              <button type="button" class="btn inventory-asof-icon-btn" data-transport-action="print-cargo-report" data-tid="${Utils.escapeAttr(t.id)}" title="${Utils.escapeAttr(I18n.t("transport.printCargoReport"))}" aria-label="${Utils.escapeAttr(I18n.t("transport.printCargoReport"))}"><svg class="inv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg></button>
            </div>
          </div>
        </div>
        ${expBlock}
        ${modeRow}
        ${unmergeBulk}
        ${pendingTxt}
        ${pendingProdTxt}
        <div class="t-hardware-summary">
          <div><span class="muted">${this.esc(I18n.t("transport.checklists"))}</span> ${checklistTxt}</div>
          <div><span class="muted">${this.esc(I18n.t("transport.elecObra"))}</span> ${obraTxt}</div>
          <div><span class="muted">${this.esc(I18n.t("transport.elecProd"))}</span> ${prodTxt}</div>
          <div><span class="muted">${this.esc(I18n.t("transport.hardwarePieces"))}</span> ${hwCount}</div>
        </div>
        ${trAttBlock}
        <div class="t-lines">
          ${(t.lines || []).map(line => this.renderLineRow(t, line)).join("")}
        </div>
        ${this.renderRecepSection(t)}
        <div class="t-footer-hint">${footerHint}</div>
        <div class="t-buttons">
          ${shipBtn}
          <button type="button" class="btn btn-secondary delete-btn" data-transport-action="delete" data-tid="${t.id}">${this.esc(I18n.t("buttons.deleteTransport"))}</button>
        </div>
        </div>`;
  },

  /** Celda compacta del camión: siempre en la franja superior. */
  renderTransportStripRow(t) {
    const truckLabel = this.getTransportLabel(t);
    const statusClass = t.expeditionAnnulled ? "annulled" : (t.status || "Parcial").toLowerCase();
    const statusLabel = t.expeditionAnnulled
      ? I18n.t("transport.cellStatusAnnulled")
      : t.status === "Listo"
        ? I18n.t("transport.cellStatusListo")
        : I18n.t("transport.cellStatusParcial");
    const dateCell = t.expeditionAnnulled ? "—" : t.shipmentDate || I18n.t("transport.noExpeditionDate");
    const cardTone = t.expeditionAnnulled ? "transport-card--annulled" : t.status === "Listo" ? "transport-card--listo" : "transport-card--parcial";
    const selected = this._expandedTransportId === t.id;
    const minimizeBtn = selected
      ? `<button type="button" class="btn btn-sm btn-secondary transport-minimize-btn" data-transport-action="collapse-transport" data-tid="${t.id}" title="${this.esc(I18n.t("transport.minimizeDetail"))}">${this.esc(I18n.t("buttons.minimize"))}</button>`
      : "";
    const shipPulse = this._shipmentUrgencyClass(t);
    return `
      <div class="transport-card transport-card--strip ${cardTone} ${shipPulse} ${selected ? "transport-card--strip-active" : ""}" data-transport-id="${Utils.escapeAttr(t.id)}">
        <div class="transport-summary-wrap">
        <button type="button" class="transport-cell-summary" data-transport-action="toggle-expand" data-tid="${t.id}" aria-expanded="${selected}" title="${this.esc(I18n.t("transport.cellExpandHint"))}">
          <span class="transport-cell-icon" aria-hidden="true">🚚</span>
          <span class="transport-cell-ref">${this.esc(t.projectId)}${this.esc(truckLabel)}</span>
          <span class="transport-cell-type">${this.esc(I18n.t("transport.cellKind"))}</span>
          <span class="transport-cell-status ${statusClass}">${this.esc(statusLabel)}</span>
          <span class="transport-cell-date">${this.esc(dateCell)}</span>
          ${
            t.expeditionShippedAt && !t.expeditionAnnulled
              ? `<span class="transport-cell-shipped-badge" title="${this.esc(I18n.t("transport.shippedBadge"))}">✓</span>`
              : ""
          }
        </button>
        ${minimizeBtn}
        </div>
      </div>`;
  },

  renderTransportDetailPanel(t) {
    const cardTone = t.expeditionAnnulled ? "transport-card--annulled" : t.status === "Listo" ? "transport-card--listo" : "transport-card--parcial";
    const shipPulse = this._shipmentUrgencyClass(t);
    const body = this._renderTransportDetailBodyHtml(t);
    return `<div class="transport-detail-panel transport-card is-expanded ${cardTone} ${shipPulse}" data-transport-id="${Utils.escapeAttr(t.id)}">${body}</div>`;
  },

  renderPreparedSummaryHtml() {
    const recs = typeof ReceptionsManager !== "undefined" ? ReceptionsManager.receptions || [] : [];
    const active = this.transports.filter(tr => !tr.expeditionAnnulled && !tr.expeditionShippedAt);
    const queueGroupsPrepared = this._pendingTransportBannerGroups();

    const rowHtml = active
      .map(t => {
        const cn = (t.checklistRefs || []).length;
        const eo = (t.elecObraRefs || []).length;
        const ep = (t.elecProdRefs || []).length;
        const rp = recs.filter(
          r =>
            Utils.projectIdsEquivalent(r.projectId, t.projectId) &&
            !r.expeditedAt &&
            !r.provisionalAnnulled
        ).length;
        const lbl = `${this.esc(t.projectId)}${this.esc(this.getTransportLabel(t))}`;
        return `<tr>
          <td><strong>${lbl}</strong></td>
          <td>${cn}</td>
          <td>${eo}</td>
          <td>${ep}</td>
          <td>${rp}</td>
        </tr>`;
      })
      .join("");

    const rmBtn = (r, kind) =>
      `<button type="button" class="btn btn-xs btn-danger" data-transport-action="remove-queued-me" data-kind="${Utils.escapeAttr(
        kind
      )}" data-mid="${Utils.escapeAttr(r.movementId)}" data-ref="${Utils.escapeAttr(r.ref || "")}" title="${Utils.escapeAttr(
        I18n.t("transport.queueRemoveBtn")
      )}">${this.esc(I18n.t("transport.queueRemoveBtn"))}</button>`;
    const renderRefs = (arr, kind) =>
      (arr || [])
        .filter(r => r && r.movementId)
        .map(r => `<span class="transport-queued-ref">${this.esc(r.ref || r.movementId)} ${rmBtn(r, kind)}</span>`)
        .join(" ");

    const queueLines = queueGroupsPrepared.map(g => {
      const o = renderRefs(g.obra, "obra");
      const p = renderRefs(g.prod, "prod");
      const parts = [];
      if (o) parts.push(`${this.esc(I18n.t("transport.elecObra"))} ${o}`);
      if (p) parts.push(`${this.esc(I18n.t("transport.elecProd"))} ${p}`);
      return `<li><strong>${this.esc(g.displayPid)}</strong> — ${parts.join(" · ")}</li>`;
    });

    const stockMeObra = "";

    if (!rowHtml && !queueLines.length && !stockMeObra) return "";

    const queueBlock =
      queueLines.length > 0
        ? `<div class="transport-prepared-queue muted">
          <span class="transport-prepared-queue-title">${this.esc(I18n.t("transport.preparedQueueTitle"))}</span>
          <ul>${queueLines.join("")}</ul>
        </div>`
        : "";

    const intro = `<p class="transport-prepared-intro muted">${this.esc(I18n.t("transport.preparedIntro"))}</p>`;

    const thead = `<thead><tr>
      <th>${this.esc(I18n.t("transport.preparedColProject"))}</th>
      <th>${this.esc(I18n.t("transport.preparedColLc"))}</th>
      <th>${this.esc(I18n.t("transport.preparedColMeo"))}</th>
      <th>${this.esc(I18n.t("transport.preparedColMep"))}</th>
      <th>${this.esc(I18n.t("transport.preparedColRec"))}</th>
    </tr></thead>`;

    const tbody = rowHtml || `<tr><td colspan="5" class="muted" style="text-align:center;">${this.esc(I18n.t("transport.preparedNoActiveRows"))}</td></tr>`;

    return `<details class="transport-prepared-summary">
      <summary>${this.esc(I18n.t("transport.preparedSummaryTitle"))}</summary>
      <div class="transport-prepared-bundle">
      ${intro}
      <div class="transport-prepared-table-wrap">
        <table class="inventory-table transport-prepared-table transport-table--compact">${thead}<tbody>${tbody}</tbody></table>
      </div>
      ${queueBlock}
      ${stockMeObra}
      </div>
    </details>`;
  },

  render() {
    const board = document.getElementById("transport-board");
    if (!board) return;
    const pendingBannerGroups = this._pendingTransportBannerGroups();
    const pendingBanner =
      pendingBannerGroups.length > 0
        ? `<div class="transport-pending-banner">${this.esc(I18n.t("transport.pendingBannerIntroBoth"))} ${pendingBannerGroups
            .map(g => {
              const o = g.obra.map(p => this.esc(p.ref)).join(", ");
              const p = g.prod.map(x => this.esc(x.ref)).join(", ");
              const bits = [];
              if (o) bits.push(`${this.esc(I18n.t("transport.pendingObraShort"))}: ${o}`);
              if (p) bits.push(`${this.esc(I18n.t("transport.pendingProdShort"))}: ${p}`);
              return `<strong>${this.esc(g.displayPid)}</strong>: ${bits.join(" · ")}`;
            })
            .join(" · ")}</div>`
        : "";

    const preparedPanel = this.renderPreparedSummaryHtml();

    if (!this.transports.length && !pendingBanner) {
      board.innerHTML =
        preparedPanel + `<p class="transport-empty">${Utils.escapeHtml(I18n.t("msg.noTransports"))}</p>`;
      this._syncTransportViewToolbar();
      return;
    }

    const view = this._getTransportView();
    const sorted = this.transports
      .sort((a, b) => {
        if (!!a.expeditionAnnulled !== !!b.expeditionAnnulled) return a.expeditionAnnulled ? 1 : -1;
        const da = a.shipmentDate && !a.expeditionAnnulled ? a.shipmentDate : "9999-12-31";
        const db = b.shipmentDate && !b.expeditionAnnulled ? b.shipmentDate : "9999-12-31";
        return da.localeCompare(db);
      });
    const stripHtml = sorted.map(t => this.renderTransportStripRow(t)).join("");
    const expT = this._expandedTransportId ? this.transports.find(x => x.id === this._expandedTransportId) : null;
    const detailHtml = expT ? this.renderTransportDetailPanel(expT) : "";
    const grid =
      stripHtml || detailHtml
        ? `<div class="transport-board-stack">
            <div class="transport-cells-container transport-cells--${view}">${stripHtml}</div>
            ${detailHtml ? `<div class="transport-detail-slot">${detailHtml}</div>` : ""}
          </div>`
        : "";
    board.innerHTML = preparedPanel + pendingBanner + grid;
    this._syncTransportViewToolbar();
  }
};
