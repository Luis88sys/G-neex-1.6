// reports.js — exportación XLSX (tablas con formato) de transportes, movimientos y consumo por artículo

const ReportExporter = {
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
    const inp = document.getElementById("report-item-needle");
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

    inp.addEventListener(
      "input",
      Utils.debounce(refresh, 180)
    );

    inp.addEventListener("focus", () => {
      if (inp.value.trim().length >= 1) refresh();
    });

    res.addEventListener("click", e => {
      const hit = e.target.closest(".report-item-suggestion-hit");
      if (!hit || hit.dataset.code == null) return;
      const code = hit.dataset.code;
      const cur = String(inp.value || "").trim();
      inp.value = cur ? `${cur.replace(/[\s,;]+$/, "")}, ${code}` : code;
      this._hideReportItemSuggestions();
      inp.focus();
    });

    document.addEventListener("click", e => {
      if (!e.target.closest(".report-item-search-wrap")) this._hideReportItemSuggestions();
      if (!e.target.closest(".report-project-search-wrap")) this._hideReportProjectSuggestions();
    });

    inp.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        this._hideReportItemSuggestions();
        this._hideReportProjectSuggestions();
      }
    });
  },

  closeModal() {
    this._hideReportItemSuggestions();
    this._hideReportProjectSuggestions();
    document.getElementById("report-modal")?.classList.remove("active");
  },

  openModal(presetType) {
    const m = document.getElementById("report-modal");
    const sel = document.getElementById("report-type");
    if (sel && presetType && [...sel.options].some(o => o.value === presetType)) {
      sel.value = presetType;
    }
    this.syncItemWrap();
    m?.classList.add("active");
  },

  syncItemWrap() {
    const v = document.getElementById("report-type")?.value || "";
    const wrap = document.getElementById("report-item-wrap");
    if (wrap) wrap.style.display = v === "item_consumption" ? "block" : "none";
    if (v !== "item_consumption") {
      this._hideReportItemSuggestions();
      this._hideReportProjectSuggestions();
    }
    this._setColumnPickerHeaders(this._headersForKind(v));
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

  _applyPickedReportProjectId(textarea, canonicalId) {
    const raw = String(textarea.value || "");
    const cut = Math.max(raw.lastIndexOf(","), raw.lastIndexOf(";"), raw.lastIndexOf("\n"));
    if (cut < 0) {
      textarea.value = canonicalId;
      return;
    }
    const left = raw.slice(0, cut + 1).replace(/\s+$/, "");
    textarea.value = `${left} ${canonicalId}`.replace(/\s+/g, " ").trim();
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
    const ta = document.getElementById("report-item-project-ids");
    const res = document.getElementById("report-project-suggestions");
    if (!ta || !res) return;
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
      const needle = this._lastReportProjectSegmentLower(ta.value);
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

    ta.addEventListener("input", Utils.debounce(refresh, 180));
    ta.addEventListener("focus", () => refresh());

    res.addEventListener("click", e => {
      const hit = e.target.closest(".report-project-suggestion-hit");
      if (!hit || hit.dataset.projectId == null) return;
      this._applyPickedReportProjectId(ta, hit.dataset.projectId);
      this._hideReportProjectSuggestions();
      ta.focus();
    });

    ta.addEventListener("keydown", e => {
      if (e.key === "Escape") this._hideReportProjectSuggestions();
    });
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
          const rawNeedle = document.getElementById("report-item-needle")?.value || "";
          const rawProjects = document.getElementById("report-item-project-ids")?.value || "";
          const itemTokens = this._parseReportItemTokens(rawNeedle);
          const projectIds = this._parseReportProjectIds(rawProjects);
          if (!itemTokens.length && !projectIds.length) {
            Utils.showToast(I18n.t("msg.reportExportNeedleOrProject"), "warning");
            return;
          }
          const built = this.buildItemConsumption({ itemTokens, projectIds });
          if (!built.rows.length) {
            Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
          }
          headers = built.headers;
          tableRows = built.rows;
          const allMov = (MovementManager.movements || []).filter(m => {
            const pset = new Set(projectIds);
            if (!this._movementMatchesReportProjectSet(m, pset)) return false;
            if (!itemTokens.length) return true;
            return (m.items || []).some(it => this._lineMatchesReportItemTokens(it, itemTokens));
          });
          const slug = [itemTokens.slice(0, 3).join("-") || "all", projectIds.slice(0, 3).join("-") || "all"]
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

  buildItemConsumption({ itemTokens, projectIds }) {
    const tokensLower = Array.isArray(itemTokens) ? itemTokens.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
    const projectSet = new Set((projectIds || []).map(p => String(p).trim().toLowerCase()).filter(Boolean));
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
      if (!this._movementMatchesReportProjectSet(m, projectSet)) continue;
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
