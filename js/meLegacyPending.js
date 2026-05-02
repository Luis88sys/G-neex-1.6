// meLegacyPending.js — Stock de cajas M.E. obra (semilla + movimientos MAT_ELEC_OBRA + registros manuales; tabla única).

/** Códigos únicos semilla (material ya preparado). */
const ME_LEGACY_SEED_UNIQUE = [
  "C215101",
  "C215101-02",
  "C235008",
  "C235070",
  "C235152",
  "C24169",
  "C245082",
  "C245155",
  "C255016",
  "C255040",
  "C255057",
  "C255086",
  "C255095",
  "C255122",
  "C255123",
  "C255124",
  "C255144",
  "C255149",
  "C255185",
  "C255205",
  "CNICHE SAMPLE 16-25",
  "CNICHE SAMPLE 26-35",
  "CNICHE SAMPLE 36-45",
  "CNICHE SAMPLE INV-45",
  "CNICHE SAMPLE LUIS 6",
  "CSAMPLE LUIS#1(X5)"
].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

const ME_LEGACY_SEED_SET = new Set(ME_LEGACY_SEED_UNIQUE.map(c => c.toLowerCase()));

const ME_LEGACY_STORE_VERSION = 3;

const MELegacyPendingManager = {
  /** @type {{ id: string, code: string, boxes: number, status: 'pending'|'expedited', source: 'seed'|'movement'|'manual', lastMovementId: string|null, lastMovementRef: string|null, expeditedAt: string|null, transportId: string|null, linkedFromHistory: boolean, linkedMovementIds: string[], linkedReferences: string[], updatedAt: string }[]} */
  rows: [],
  dismissedSeedCodes: [],
  _eventsBound: false,

  init() {
    try {
      this.load();
      this.bindDelegatedEvents();
    } catch (e) {
      console.error("MELegacyPendingManager init:", e);
    }
  },

  _newRow(partial) {
    const now = new Date().toISOString();
    return {
      id: Utils.generateId(),
      code: "",
      boxes: 1,
      status: "pending",
      source: "manual",
      lastMovementId: null,
      lastMovementRef: null,
      lastMovementProjectId: null,
      expeditedAt: null,
      transportId: null,
      linkedFromHistory: false,
      linkedMovementIds: [],
      linkedReferences: [],
      updatedAt: now,
      ...partial
    };
  },

  _migrateFromV2(d) {
    const rows = [];
    const pending = Array.isArray(d.pending) ? d.pending : [];
    const expeditions = Array.isArray(d.expeditions) ? d.expeditions : [];

    pending.forEach(code => {
      const c = String(code || "").trim();
      if (!c) return;
      rows.push(
        this._newRow({
          code: c,
          boxes: 1,
          status: "pending",
          source: ME_LEGACY_SEED_SET.has(c.toLowerCase()) ? "seed" : "manual"
        })
      );
    });

    expeditions.forEach(e => {
      const c = String(e.code || "").trim();
      if (!c) return;
      rows.push(
        this._newRow({
          code: c,
          boxes: Math.max(1, parseInt(e.boxes, 10) || 1),
          status: "expedited",
          source: ME_LEGACY_SEED_SET.has(c.toLowerCase()) ? "seed" : "manual",
          expeditedAt: e.expeditedAt || new Date().toISOString(),
          transportId: e.transportId || null,
          linkedFromHistory: !!e.linkedFromHistory,
          linkedMovementIds: Array.isArray(e.linkedMovementIds) ? [...e.linkedMovementIds] : [],
          linkedReferences: Array.isArray(e.linkedReferences) ? [...e.linkedReferences] : []
        })
      );
    });

    return rows;
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ME_LEGACY);
      if (!raw) {
        this.rows = ME_LEGACY_SEED_UNIQUE.map(code =>
          this._newRow({
            code,
            boxes: 1,
            status: "pending",
            source: "seed"
          })
        );
        this.dismissedSeedCodes = [];
        this.save();
        return;
      }
      const d = JSON.parse(raw);
      this.dismissedSeedCodes = Array.isArray(d.dismissedSeedCodes)
        ? [...d.dismissedSeedCodes]
        : [];

      if (d && d.version === ME_LEGACY_STORE_VERSION && Array.isArray(d.rows)) {
        this.rows = d.rows.map(r => ({
          ...this._newRow({}),
          ...r,
          boxes: Math.max(1, parseInt(r.boxes, 10) || 1),
          lastMovementProjectId: r.lastMovementProjectId != null ? String(r.lastMovementProjectId || "").trim() || null : null,
          linkedMovementIds: Array.isArray(r.linkedMovementIds) ? [...r.linkedMovementIds] : [],
          linkedReferences: Array.isArray(r.linkedReferences) ? [...r.linkedReferences] : []
        }));
      } else {
        this.rows = this._migrateFromV2(d || {});
      }

      this.ensureSeedIntegrated();
    } catch (e) {
      this.rows = ME_LEGACY_SEED_UNIQUE.map(code =>
        this._newRow({
          code,
          boxes: 1,
          status: "pending",
          source: "seed"
        })
      );
      this.dismissedSeedCodes = [];
      this.save();
    }
  },

  save() {
    try {
      localStorage.setItem(
        STORAGE_KEYS.ME_LEGACY,
        JSON.stringify({
          version: ME_LEGACY_STORE_VERSION,
          rows: this.rows,
          dismissedSeedCodes: this.dismissedSeedCodes
        })
      );
    } catch (e) {
      console.error(e);
    }
  },

  _normLegacyCode(c) {
    return String(c || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  },

  _findPendingRowForCode(code) {
    const n = this._normLegacyCode(code);
    return this.rows.find(r => r.status === "pending" && this._normLegacyCode(r.code) === n) || null;
  },

  _hasExpeditedRowForCode(code) {
    const n = this._normLegacyCode(code);
    return this.rows.some(r => r.status === "expedited" && this._normLegacyCode(r.code) === n);
  },

  /** Incorpora códigos nuevos de la semilla sin duplicar ni restaurar los quitados manualmente. */
  ensureSeedIntegrated() {
    const dismissSet = new Set(this.dismissedSeedCodes.map(c => String(c || "").toLowerCase()));
    let changed = false;
    for (const code of ME_LEGACY_SEED_UNIQUE) {
      const ck = code.toLowerCase();
      if (dismissSet.has(ck)) continue;
      if (this._findPendingRowForCode(code)) continue;
      if (this._hasExpeditedRowForCode(code)) continue;
      this.rows.push(
        this._newRow({
          code,
          boxes: 1,
          status: "pending",
          source: "seed"
        })
      );
      changed = true;
    }
    if (changed) this.save();
  },

  /**
   * Reparte un total de cajas del movimiento entre líneas (proporcional a |cantidad| de inventario; si todo 0, reparto equitativo).
   * @returns {number[]}
   */
  _allocateBoxesToMovementLines(activeItems, totalBoxes) {
    const n = activeItems.length;
    if (n === 0) return [];
    const tb = Math.max(1, Math.round(totalBoxes) || 1);
    const weights = activeItems.map(it => Math.max(0, Math.abs(parseFloat(it.quantity) || 0)));
    let sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) {
      const base = Math.floor(tb / n);
      let rem = tb - base * n;
      const out = Array(n).fill(base);
      for (let i = 0; i < rem; i++) out[i % n]++;
      return out;
    }
    const floats = weights.map(w => (tb * w) / sum);
    const ints = floats.map(x => Math.floor(x));
    let rem = tb - ints.reduce((a, b) => a + b, 0);
    const order = floats
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < rem; k++) ints[order[k].i]++;
    return ints;
  },

  recordFromMovement(movement) {
    if (!movement || movement.annulled || movement.pending || movement.type !== "MAT_ELEC_OBRA") return;
    const items = Array.isArray(movement.items) ? movement.items : [];
    let changed = false;
    const ref = String(movement.reference || "").trim();
    const mid = String(movement.id || "");
    const proj = String(movement.projectId || "").trim();

    const rawTotal =
      movement.elecObraBoxCount != null && movement.elecObraBoxCount !== ""
        ? parseFloat(movement.elecObraBoxCount)
        : NaN;
    const movementTotalBoxes = Number.isFinite(rawTotal) ? Math.max(1, Math.round(rawTotal)) : null;

    const activeItems = items.filter(it => it && !it.annulled && String(it.code || "").trim());
    let boxAlloc = null;
    if (movementTotalBoxes != null && activeItems.length) {
      boxAlloc = this._allocateBoxesToMovementLines(activeItems, movementTotalBoxes);
    }

    activeItems.forEach((item, idx) => {
      const codeRaw = String(item.code || "").trim().replace(/\s+/g, " ");
      if (!codeRaw) return;
      const addQty =
        boxAlloc && boxAlloc[idx] != null
          ? Math.max(1, Math.round(boxAlloc[idx]) || 1)
          : Math.max(1, Math.round(Math.abs(parseFloat(item.quantity) || 0)) || 1);

      let row = this._findPendingRowForCode(codeRaw);
      if (row) {
        row.boxes = Math.max(1, (parseInt(row.boxes, 10) || 1) + addQty);
        row.lastMovementId = mid || row.lastMovementId;
        row.lastMovementRef = ref || row.lastMovementRef;
        if (proj) row.lastMovementProjectId = proj;
        if (row.source !== "seed") row.source = "movement";
        row.updatedAt = new Date().toISOString();
      } else {
        this.rows.push(
          this._newRow({
            code: codeRaw,
            boxes: addQty,
            status: "pending",
            source: "movement",
            lastMovementId: mid || null,
            lastMovementRef: ref || null,
            lastMovementProjectId: proj || null
          })
        );
      }
      changed = true;
    });
    if (changed) this.save();
  },

  _projectIdForPendingRow(row) {
    let pid = String(row.lastMovementProjectId || "").trim();
    if (pid) return pid;
    const mid = row.lastMovementId;
    if (mid && typeof MovementManager !== "undefined" && Array.isArray(MovementManager.movements)) {
      const m = MovementManager.movements.find(x => x && x.id === mid);
      if (m) pid = String(m.projectId || "").trim();
    }
    return pid;
  },

  /** Transporte activo que ya incluye el movimiento M.E. obra en elecObraRefs. */
  findLinkedTransportForRow(row) {
    const mid = row.lastMovementId;
    const mref = row.lastMovementRef;
    if (!mid && !mref) return null;
    const ts =
      typeof TransportManager !== "undefined" && Array.isArray(TransportManager.transports)
        ? TransportManager.transports
        : [];
    for (const t of ts) {
      if (!t || t.expeditionAnnulled) continue;
      const hit = (t.elecObraRefs || []).some(
        r => r && (r.movementId === mid || (mref && r.ref === mref))
      );
      if (hit) return t;
    }
    return null;
  },

  /** Cola pendingElecObra del proyecto si el movimiento aún no tiene tarjeta. */
  findQueuedProjectForRow(row) {
    const mid = row.lastMovementId;
    const mref = row.lastMovementRef;
    if (!mid && !mref) return null;
    const po =
      typeof TransportManager !== "undefined" && TransportManager.pendingElecObra
        ? TransportManager.pendingElecObra
        : {};
    for (const pid of Object.keys(po)) {
      const arr = po[pid] || [];
      if (arr.some(r => r && (r.movementId === mid || (mref && r.ref === mref)))) return pid;
    }
    return null;
  },

  /** Busca una tarjeta de transporte por id (incluye expedidos), solo para mostrar proyecto. */
  _findTransportAny(transportId) {
    const tid = String(transportId || "").trim();
    if (!tid || typeof TransportManager === "undefined" || !Array.isArray(TransportManager.transports)) return null;
    return TransportManager.transports.find(x => x && x.id === tid) || null;
  },

  /**
   * Primera columna: número de proyecto (equivalente al transporte en la operativa).
   * Sin proyecto vinculado (lista inicial / alta manual), el código de artículo queda como referencia secundaria.
   */
  _primaryProjectTransportCell(row) {
    if (row.status === "expedited") return this._primaryCellExpedited(row);
    return this._primaryCellPending(row);
  },

  _primaryCellPending(row) {
    const t = this.findLinkedTransportForRow(row);
    if (t) {
      const pid = String(t.projectId || "").trim() || "—";
      const hint = `${I18n.t("meLegacy.transportLinkedHint")}: ${t.id}`;
      return `<div class="me-legacy-primary-block" title="${Utils.escapeAttr(hint)}"><code class="me-legacy-pid">${this._esc(pid)}</code></div>`;
    }
    const qpid = this.findQueuedProjectForRow(row);
    if (qpid) {
      return `<div class="me-legacy-primary-block" title="${Utils.escapeAttr(I18n.t("meLegacy.transportQueuedTitle"))}"><code class="me-legacy-pid">${this._esc(
        qpid
      )}</code> <span class="muted me-legacy-sub">${this._esc(I18n.t("meLegacy.labelQueued"))}</span></div>`;
    }
    const pid = this._projectIdForPendingRow(row);
    if (pid && (row.lastMovementRef || row.lastMovementId)) {
      return `<div class="me-legacy-primary-block"><code class="me-legacy-pid">${this._esc(pid)}</code></div>`;
    }
    const c = String(row.code || "").trim();
    const tip = String(I18n.t("meLegacy.fallbackCodeTitle") || "").trim();
    const titleAttr = tip ? ` title="${Utils.escapeAttr(tip)}"` : "";
    return `<div class="me-legacy-primary-block"${titleAttr}><code class="me-legacy-pid">${this._esc(c)}</code></div>`;
  },

  _primaryCellExpedited(row) {
    const tid = String(row.transportId || "").trim();
    const tr = tid ? this._findTransportAny(tid) : null;
    let pid = tr ? String(tr.projectId || "").trim() : "";
    const mainRaw = pid || tid;
    const head = mainRaw
      ? `<code class="me-legacy-pid">${this._esc(mainRaw)}</code>`
      : `<span class="muted">—</span>`;
    const subParts = [];
    if (row.linkedFromHistory && Array.isArray(row.linkedReferences) && row.linkedReferences.length) {
      const refs = row.linkedReferences.slice(0, 3).join(", ");
      const more = row.linkedReferences.length > 3 ? ` (+${row.linkedReferences.length - 3})` : "";
      subParts.push(`${this._esc(I18n.t("meLegacy.colLinkedHistory"))}: ${this._esc(refs)}${this._esc(more)}`);
    } else if (!tid && !row.linkedFromHistory) {
      subParts.push(this._esc(I18n.t("meLegacy.manualOnly")));
    }
    const sub = subParts.length ? `<div class="muted me-legacy-sub">${subParts.join("")}</div>` : "";
    return `<div class="me-legacy-primary-block">${head}${sub}</div>`;
  },

  setPendingBoxes(code, n) {
    const row = this._findPendingRowForCode(code);
    if (!row || row.status !== "pending") return;
    const qty = Math.max(1, Math.round(Math.abs(parseFloat(n) || 0)) || 1);
    row.boxes = qty;
    row.updatedAt = new Date().toISOString();
    this.save();
  },

  removeExpeditedRow(rowId) {
    const id = String(rowId || "").trim();
    if (!id) return;
    const ix = this.rows.findIndex(r => r.id === id && r.status === "expedited");
    if (ix < 0) return;
    this.rows.splice(ix, 1);
    this.save();
  },

  _esc(s) {
    return Utils.escapeHtml(s);
  },

  /**
   * Movimientos M.E. obra no anulados con el mismo número de proyecto que la fila (en operativa equivale a la referencia de transporte).
   * @param {{ excludeOwn?: boolean }} [options] Si excludeOwn (por defecto true), no cuenta el movimiento que originó esta fila (solo lectura más clara).
   * @returns {{ id: string, reference: string, type: string, date: string }[]}
   */
  findHistoryMatchesForRow(row, options = {}) {
    const excludeOwn = options.excludeOwn !== false;
    const normPid = String(this._projectIdForPendingRow(row) || "").trim();
    if (!normPid || typeof MovementManager === "undefined" || !Array.isArray(MovementManager.movements)) return [];
    const ownMid = String(row.lastMovementId || "").trim();
    const out = [];
    const seen = new Set();
    for (const m of MovementManager.movements) {
      if (!m || m.annulled || m.pending || m.type !== "MAT_ELEC_OBRA") continue;
      const mp = String(m.projectId || "").trim();
      if (mp !== normPid) continue;
      const id = String(m.id || "");
      if (excludeOwn && ownMid && id === ownMid) continue;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push({
        id,
        reference: String(m.reference || ""),
        type: String(m.type || ""),
        date: String(m.date || "")
      });
    }
    return out;
  },

  /**
   * Movimientos M.E. obra del mismo código que ya figuran como expedidos por transporte (camión salido).
   * Útil para marcar discrepancias con la cola física pendiente.
   */
  findTransportShippedEvidenceForCode(code) {
    const norm = this._normLegacyCode(code);
    if (!norm || typeof MovementManager === "undefined" || !Array.isArray(MovementManager.movements))
      return [];
    const movs = MovementManager.movements;
    const transports =
      typeof TransportManager !== "undefined" && Array.isArray(TransportManager.transports)
        ? TransportManager.transports
        : [];

    /** @type {Map<string, { movementRef: string, shippedAt: string, transportId: string, projectId: string }>} */
    const byMovId = new Map();

    const lineMatchesCode = m =>
      (m.items || []).some(it => !it.annulled && this._normLegacyCode(it.code) === norm);

    for (const m of movs) {
      if (!m || m.annulled || m.pending || m.type !== "MAT_ELEC_OBRA") continue;
      if (!lineMatchesCode(m)) continue;
      if (m.transportExpeditedAt) {
        byMovId.set(String(m.id), {
          movementRef: String(m.reference || ""),
          shippedAt: String(m.transportExpeditedAt),
          transportId: String(m.transportExpeditedByTransportId || ""),
          projectId: String(m.projectId || "").trim()
        });
      }
    }

    for (const t of transports) {
      if (!t || t.expeditionAnnulled || !t.expeditionShippedAt) continue;
      const refs = Array.isArray(t.elecObraRefs) ? t.elecObraRefs : [];
      for (const r of refs) {
        const m = movs.find(x => x && (x.id === r.movementId || x.reference === r.ref));
        if (!m || m.annulled || m.type !== "MAT_ELEC_OBRA") continue;
        if (!lineMatchesCode(m)) continue;
        const mid = String(m.id);
        if (!byMovId.has(mid)) {
          byMovId.set(mid, {
            movementRef: String(m.reference || ""),
            shippedAt: String(t.expeditionShippedAt),
            transportId: String(t.id || ""),
            projectId: String(t.projectId || "").trim()
          });
        }
      }
    }

    return [...byMovId.values()];
  },

  _attentionTooltip(evidence) {
    if (!evidence.length) return "";
    return evidence
      .map(
        e =>
          `${e.movementRef} · ${e.projectId || "—"} · ${typeof Utils.formatDateTime === "function" ? Utils.formatDateTime(e.shippedAt) : e.shippedAt}`
      )
      .join("\n");
  },

  /**
   * @param {string|null} transportId
   * @param {{ id: string, reference: string }[]|null} historyMatches Si hay coincidencias en Movimientos, se guardan como referencia (auditoría).
   */
  expedite(code, transportId, historyMatches = null) {
    const row = this._findPendingRowForCode(code);
    if (!row) return;
    row.status = "expedited";
    row.expeditedAt = new Date().toISOString();
    row.transportId = transportId || null;
    const hm = Array.isArray(historyMatches) ? historyMatches : [];
    if (hm.length) {
      row.linkedFromHistory = true;
      row.linkedMovementIds = hm.map(m => m.id).filter(Boolean);
      row.linkedReferences = hm.map(m => m.reference).filter(Boolean);
    } else {
      row.linkedFromHistory = false;
      row.linkedMovementIds = [];
      row.linkedReferences = [];
    }
    row.updatedAt = row.expeditedAt;
    this.save();
  },

  removePending(code) {
    const row = this._findPendingRowForCode(code);
    if (!row) return;
    this.rows = this.rows.filter(r => r.id !== row.id);
    const lk = String(code || "").toLowerCase();
    if (ME_LEGACY_SEED_SET.has(lk) && !this.dismissedSeedCodes.some(c => c.toLowerCase() === lk)) {
      this.dismissedSeedCodes.push(code);
    }
    this.save();
  },

  addPending(code) {
    const c = String(code || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!c) {
      Utils.showToast(I18n.t("meLegacy.msgEmptyCode"), "warning");
      return;
    }
    if (this._findPendingRowForCode(c)) {
      Utils.showToast(I18n.t("meLegacy.msgDuplicate"), "warning");
      return;
    }
    if (this._hasExpeditedRowForCode(c)) {
      Utils.showToast(I18n.t("meLegacy.msgAlreadyExpedited"), "warning");
      return;
    }
    this.rows.push(
      this._newRow({
        code: c,
        boxes: 1,
        status: "pending",
        source: "manual"
      })
    );
    this.save();
    const inp = document.getElementById("me-legacy-add-input");
    if (inp) inp.value = "";
    Utils.showToast(I18n.t("meLegacy.msgAdded"), "success");
  },

  _transportHintMessage() {
    const ts =
      typeof TransportManager !== "undefined" && TransportManager.transports
        ? TransportManager.transports.filter(t => !t.expeditionAnnulled && !t.expeditionShippedAt)
        : [];
    if (!ts.length) return I18n.t("meLegacy.promptTransportNone");
    const lines = ts.map(
      t =>
        `• ${t.projectId} — id: ${t.id}${typeof TransportManager.getTransportLabel === "function" ? TransportManager.getTransportLabel(t) : ""}`
    );
    return `${I18n.t("meLegacy.promptTransportIntro")}\n\n${lines.join("\n")}\n\n${I18n.t("meLegacy.promptTransportFooter")}`;
  },

  /** Id de transporte activo sugerido si el movimiento ya está en una tarjeta o hay un único camión abierto para el proyecto. */
  _suggestedTransportIdForCode(code) {
    const row = this._findPendingRowForCode(code);
    if (!row) return "";
    const linked = this.findLinkedTransportForRow(row);
    if (linked) return linked.id || "";
    const pid = this._projectIdForPendingRow(row);
    if (!pid || typeof TransportManager === "undefined" || !Array.isArray(TransportManager.transports))
      return "";
    const active = TransportManager.transports.filter(
      t => t && !t.expeditionAnnulled && !t.expeditionShippedAt && String(t.projectId || "").trim() === pid
    );
    return active.length === 1 ? active[0].id || "" : "";
  },

  async _runExpediteFlow(code) {
    if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
    const msg = this._transportHintMessage();
    const tidIn = await App.showPrompt({
      message: msg,
      defaultValue: this._suggestedTransportIdForCode(code),
      inputType: "text"
    });
    if (tidIn === null) return;
    const raw = String(tidIn || "").trim();
    let transportId = null;
    if (raw) {
      let t = null;
      if (typeof TransportManager !== "undefined" && TransportManager.transports) {
        t = TransportManager.transports.find(x => x.id === raw);
        if (!t) {
          t = TransportManager.transports.find(
            x => !x.expeditionAnnulled && !x.expeditionShippedAt && String(x.projectId || "").trim() === raw
          );
        }
      }
      if (!t) {
        Utils.showToast(I18n.t("meLegacy.transportNotFound"), "warning");
        return;
      }
      transportId = t.id;
    }
    const rowForExp = this._findPendingRowForCode(code);
    const matches = rowForExp ? this.findHistoryMatchesForRow(rowForExp, { excludeOwn: false }) : [];
    this.expedite(code, transportId, matches);
    if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
    const toast =
      matches.length > 0
        ? I18n.t("meLegacy.expeditedOkWithHistory").replace("{n}", String(matches.length))
        : I18n.t("meLegacy.expeditedOk");
    Utils.showToast(toast, "success");
  },

  bindDelegatedEvents() {
    const board = document.getElementById("transport-board");
    if (!board || this._eventsBound) return;
    this._eventsBound = true;

    board.addEventListener("change", e => {
      const inp = e.target.closest(".me-legacy-boxes-input");
      if (!inp) return;
      if (typeof Auth !== "undefined" && !Auth.hasPerm("transport")) return;
      const code = inp.getAttribute("data-code");
      if (!code) return;
      this.setPendingBoxes(code, inp.value);
      if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
    });

    board.addEventListener("click", e => {
      const exportBtn = e.target.closest("#me-legacy-export-list");
      if (exportBtn) {
        e.preventDefault();
        void this.exportCurrentList();
        return;
      }
      const printBtn = e.target.closest("#me-legacy-print-list");
      if (printBtn) {
        e.preventDefault();
        this.printCurrentList();
        return;
      }

      const openFull = e.target.closest("#me-legacy-open-full");
      if (openFull) {
        e.preventDefault();
        const det = document.querySelector(".transport-prepared-summary");
        if (det) det.open = true;
        document.getElementById("me-legacy-stock-section")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
        return;
      }

      const addBtn = e.target.closest("#me-legacy-add-btn");
      if (addBtn) {
        e.preventDefault();
        if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
        const inp = document.getElementById("me-legacy-add-input");
        this.addPending(inp ? inp.value : "");
        if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
        return;
      }

      const btn = e.target.closest("[data-me-legacy-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-me-legacy-action");

      if (action === "remove-expedited") {
        e.preventDefault();
        if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
        const rowId = btn.getAttribute("data-row-id");
        const code = btn.getAttribute("data-code") || "";
        if (!rowId) return;
        App.showConfirm(I18n.t("meLegacy.confirmRemoveExpedited").replace("{code}", code || "—"), () => {
          this.removeExpeditedRow(rowId);
          if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
          Utils.showToast(I18n.t("meLegacy.removedExpeditedOk"), "info");
        });
        return;
      }

      const code = btn.getAttribute("data-code");
      if (!code) return;

      if (action === "expedite") {
        e.preventDefault();
        App.showConfirm(I18n.t("meLegacy.confirmExpedite").replace("{code}", code), () => {
          void this._runExpediteFlow(code);
        });
        return;
      }

      if (action === "remove") {
        e.preventDefault();
        if (typeof Auth !== "undefined" && !Auth.guardPerm("transport")) return;
        App.showConfirm(I18n.t("meLegacy.confirmRemove").replace("{code}", code), () => {
          this.removePending(code);
          if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
          Utils.showToast(I18n.t("meLegacy.removedOk"), "info");
        });
        return;
      }
    });
  },

  _sourceLabel(row) {
    if (row.source === "seed") return I18n.t("meLegacy.sourceSeed");
    if (row.source === "movement") return I18n.t("meLegacy.sourceMovement");
    return I18n.t("meLegacy.sourceManual");
  },

  _originCell(row) {
    const src = this._sourceLabel(row);
    if (row.source === "movement" && row.lastMovementRef) {
      return `${this._esc(src)} — <code>${this._esc(row.lastMovementRef)}</code>`;
    }
    return this._esc(src);
  },

  _getOrderedRows() {
    const pending = this.rows.filter(r => r.status === "pending");
    const expedited = this.rows.filter(r => r.status === "expedited");
    pending.sort((a, b) => {
      const pa = this._projectIdForPendingRow(a) || "";
      const pb = this._projectIdForPendingRow(b) || "";
      const byProj = pa.localeCompare(pb, undefined, { sensitivity: "base" });
      if (byProj !== 0) return byProj;
      return a.code.localeCompare(b.code, undefined, { sensitivity: "base" });
    });
    expedited.sort((a, b) => String(b.expeditedAt || "").localeCompare(String(a.expeditedAt || "")));
    return { pending, expedited, ordered: [...pending, ...expedited] };
  },

  _plainPrimaryProjectTransport(row) {
    const html = String(this._primaryProjectTransportCell(row) || "");
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  },

  async exportCurrentList() {
    const { ordered } = this._getOrderedRows();
    if (!ordered.length) {
      Utils.showToast(I18n.t("meLegacy.emptyStock"), "info");
      return;
    }
    const headers = [
      I18n.t("meLegacy.colTransportProject"),
      I18n.t("meLegacy.colCode"),
      I18n.t("meLegacy.colBoxes"),
      I18n.t("meLegacy.colOrigin"),
      I18n.t("meLegacy.colStatus")
    ];
    const rows = ordered.map(r => ({
      [headers[0]]: this._plainPrimaryProjectTransport(r),
      [headers[1]]: r.code,
      [headers[2]]: Math.max(1, parseInt(r.boxes, 10) || 1),
      [headers[3]]: this._sourceLabel(r),
      [headers[4]]: r.status === "pending" ? I18n.t("meLegacy.statusPending") : I18n.t("meLegacy.statusExpedited")
    }));
    await Utils.exportStyledXlsxToInformFolder(
      `GNEEX_ME_Obra_Cajas_Lista_${Utils.formatDateForFilename(new Date())}.xlsx`,
      headers,
      rows,
      {
        kind: "me_obra_stock_list",
        title: I18n.t("meLegacy.panelTitle"),
        details: [`${I18n.t("export.manifest.rows")}: ${rows.length}`]
      }
    );
  },

  printCurrentList() {
    const { ordered } = this._getOrderedRows();
    if (!ordered.length) {
      Utils.showToast(I18n.t("meLegacy.emptyStock"), "info");
      return;
    }
    const h = k => this._esc(I18n.t(k));
    const body = ordered
      .map(
        r => `<tr>
      <td>${this._esc(this._plainPrimaryProjectTransport(r))}</td>
      <td><strong>${this._esc(r.code)}</strong></td>
      <td>${this._esc(String(Math.max(1, parseInt(r.boxes, 10) || 1)))}</td>
      <td>${this._esc(this._sourceLabel(r))}</td>
      <td>${this._esc(r.status === "pending" ? I18n.t("meLegacy.statusPending") : I18n.t("meLegacy.statusExpedited"))}</td>
    </tr>`
      )
      .join("");
    const table = `<table class="inventory-table"><thead><tr>
      <th>${h("meLegacy.colTransportProject")}</th>
      <th>${h("meLegacy.colCode")}</th>
      <th>${h("meLegacy.colBoxes")}</th>
      <th>${h("meLegacy.colOrigin")}</th>
      <th>${h("meLegacy.colStatus")}</th>
    </tr></thead><tbody>${body}</tbody></table>`;
    Utils.printHtmlDocument(I18n.t("meLegacy.panelTitle"), "", table);
  },

  _renderStockTableInner() {
    if (typeof I18n === "undefined") return "";
    this.ensureSeedIntegrated();
    const canEdit = typeof Auth === "undefined" || Auth.hasPerm("transport");

    const { pending, expedited, ordered } = this._getOrderedRows();

    const pendingAttentionCodes = pending.filter(
      r => this.findTransportShippedEvidenceForCode(r.code).length > 0
    );
    const hasAttentionLegend = pendingAttentionCodes.length > 0;

    const bodyRows = ordered
      .map(row => {
        const attrCode = Utils.escapeAttr(row.code);
        const attrRowId = Utils.escapeAttr(row.id);
        const boxes = Math.max(1, parseInt(row.boxes, 10) || 1);
        const boxesLabel = Utils.escapeAttr(I18n.t("meLegacy.colBoxes"));

        if (row.status === "pending") {
          const matches = this.findHistoryMatchesForRow(row);
          const histCell =
            matches.length > 0
              ? `<span class="me-legacy-match-badge" title="${Utils.escapeAttr(matches.map(m => m.reference).filter(Boolean).join(", "))}">${this._esc(
                  I18n.t("meLegacy.historyMatchSummary").replace("{n}", String(matches.length))
                )}</span>`
              : `<span class="muted">${this._esc(I18n.t("meLegacy.noHistoryMatch"))}</span>`;

          const shippedEv = this.findTransportShippedEvidenceForCode(row.code);
          const attentionCell =
            shippedEv.length > 0
              ? `<span class="me-legacy-attention-badge" title="${Utils.escapeAttr(this._attentionTooltip(shippedEv))}">${this._esc(
                  I18n.t("meLegacy.attentionTransportBadge")
                )}</span>`
              : `<span class="muted">${this._esc(I18n.t("meLegacy.attentionTransportNone"))}</span>`;

          const actions = canEdit
            ? `<td class="me-legacy-actions">
          <button type="button" class="btn btn-primary btn-sm" data-me-legacy-action="expedite" data-code="${attrCode}">${this._esc(I18n.t("meLegacy.btnExpedite"))}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-me-legacy-action="remove" data-code="${attrCode}">${this._esc(I18n.t("meLegacy.btnRemove"))}</button>
        </td>`
            : `<td class="muted">${this._esc(I18n.t("meLegacy.readOnly"))}</td>`;

          const boxesCell = canEdit
            ? `<input type="number" min="1" step="1" class="form-input me-legacy-boxes-input" data-code="${attrCode}" value="${boxes}" aria-label="${boxesLabel}" />`
            : `<span>${boxes}</span>`;

          return `<tr>
        <td class="me-legacy-primary-cell">${this._primaryProjectTransportCell(row)}</td>
        <td>${boxesCell}</td>
        <td>${this._originCell(row)}</td>
        <td class="me-legacy-hist-cell">${histCell}</td>
        <td class="me-legacy-attention-cell">${attentionCell}</td>
        <td>${this._esc(I18n.t("meLegacy.statusPending"))}</td>
        ${actions}
      </tr>`;
        }

        const expedActions = canEdit
          ? `<td class="me-legacy-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-me-legacy-action="remove-expedited" data-row-id="${attrRowId}" data-code="${attrCode}">${this._esc(I18n.t("meLegacy.btnRemoveExpedited"))}</button>
        </td>`
          : `<td class="muted">${this._esc(I18n.t("meLegacy.readOnly"))}</td>`;

        return `<tr>
        <td class="me-legacy-primary-cell">${this._primaryProjectTransportCell(row)}</td>
        <td>${boxes}</td>
        <td>${this._originCell(row)}</td>
        <td class="muted">—</td>
        <td class="muted">—</td>
        <td>${this._esc(I18n.t("meLegacy.statusExpedited"))}<br/><span class="muted">${this._esc(Utils.formatDateTime(row.expeditedAt))}</span></td>
        ${expedActions}
      </tr>`;
      })
      .join("");

    const addBlock = canEdit
      ? `<div class="me-legacy-add-row">
      <input type="text" id="me-legacy-add-input" class="form-input" placeholder="${Utils.escapeAttr(I18n.t("meLegacy.addPlaceholder"))}" autocomplete="off" />
      <button type="button" class="btn btn-secondary btn-sm" id="me-legacy-add-btn">${this._esc(I18n.t("meLegacy.btnAdd"))}</button>
    </div>`
      : "";

    const legendText = String(I18n.t("meLegacy.legendAttentionTransport") || "").trim();
    const attentionLegendBlock =
      hasAttentionLegend && ordered.length > 0 && legendText
        ? `<p class="me-legacy-attention-legend" role="note">${this._esc(legendText)}</p>`
        : "";

    const tableInner =
      ordered.length > 0
        ? `${attentionLegendBlock}<div class="me-legacy-table-wrap"><table class="inventory-table me-legacy-table transport-table--compact">
      <thead><tr>
        <th>${this._esc(I18n.t("meLegacy.colTransportProject"))}</th>
        <th>${this._esc(I18n.t("meLegacy.colBoxes"))}</th>
        <th>${this._esc(I18n.t("meLegacy.colOrigin"))}</th>
        <th>${this._esc(I18n.t("meLegacy.colImportedHistory"))}</th>
        <th>${this._esc(I18n.t("meLegacy.colAttentionTransport"))}</th>
        <th>${this._esc(I18n.t("meLegacy.colStatus"))}</th>
        <th>${this._esc(I18n.t("table.actions"))}</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`
        : `<p class="muted me-legacy-empty">${this._esc(I18n.t("meLegacy.emptyStock"))}</p>`;

    const summary = `${pending.length} ${this._esc(I18n.t("meLegacy.summaryPending"))} · ${expedited.length} ${this._esc(I18n.t("meLegacy.summaryExpedited"))}`;
    const panelIntro = String(I18n.t("meLegacy.panelIntro") || "").trim();
    const introBlock = panelIntro
      ? `<p class="muted me-legacy-intro">${this._esc(panelIntro)}</p>`
      : "";

    const icoDownload = typeof INV_ICONS !== "undefined" && INV_ICONS.download ? INV_ICONS.download : this._esc(I18n.t("btn.export"));
    const icoPrint = typeof INV_ICONS !== "undefined" && INV_ICONS.print ? INV_ICONS.print : this._esc(I18n.t("btn.print"));
    const toolbar = `<div class="inventory-insight-toolbar filter-actions">
      <button type="button" class="btn inventory-asof-icon-btn" id="me-legacy-export-list" title="${Utils.escapeAttr(
        I18n.t("meLegacy.btnExportList")
      )}" aria-label="${Utils.escapeAttr(I18n.t("meLegacy.btnExportList"))}">${icoDownload}</button>
      <button type="button" class="btn inventory-asof-icon-btn" id="me-legacy-print-list" title="${Utils.escapeAttr(
        I18n.t("meLegacy.btnPrintList")
      )}" aria-label="${Utils.escapeAttr(I18n.t("meLegacy.btnPrintList"))}">${icoPrint}</button>
    </div>`;

    return `
<div id="me-legacy-stock-section" class="me-legacy-stock-inline">
  <h4 class="me-legacy-inline-heading">${this._esc(I18n.t("meLegacy.panelTitle"))} — ${summary}</h4>
  ${toolbar}
  ${introBlock}
  ${addBlock}
  ${tableInner}
</div>`;
  },

  /** Stock M.E. obra para el panel único de Transporte. */
  renderStockBlockHtml() {
    return this._renderStockTableInner();
  },

  /** @deprecated Usar renderStockBlockHtml. */
  renderPanelHtml() {
    return this._renderStockTableInner();
  },

  renderPreparedSummaryEmbedHtml() {
    return "";
  }
};
