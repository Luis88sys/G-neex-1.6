// orderLines.js — Panel de líneas de pedido (órdenes de compra).
// Recepción parcial/total: abre Movimientos → COMPRA_STOCK (mismo formulario que una compra manual) vía openCompraStockFromOrderLine.
// createCompraStockProgrammatic sigue disponible para usos programáticos puntuales.

const OrderLinesManager = {
  lines: [],
  _searchTimer: null,
  _filterDebounceTimer: null,

  STATUS: {
    INACTIVA: "INACTIVA",
    PEDIDA: "PEDIDA",
    RECEPCION_PARCIAL: "RECEPCION_PARCIAL",
    RECEPCION_TOTAL: "RECEPCION_TOTAL",
    CANCELADA: "CANCELADA"
  },

  /** Recepción total: se puede quitar la línea desde la tabla sin periodo de espera. */
  _canOfferRemoveStaleReceived(line) {
    return !!(line && line.status === this.STATUS.RECEPCION_TOTAL);
  },

  /** Botones de acción en la tabla. */
  _orderLineActionsHtml(line, canMutate) {
    let actions = "";
    if (canMutate) {
      if (line.status === this.STATUS.INACTIVA) {
        actions = `
              <button type="button" class="btn btn-primary btn-sm orderline-act" data-act="order" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnMarkOrdered"))}</button>
              <button type="button" class="btn btn-secondary btn-sm orderline-act" data-act="delete" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnDelete"))}</button>`;
      } else if (line.status === this.STATUS.PEDIDA || line.status === this.STATUS.RECEPCION_PARCIAL) {
        actions = `
              <button type="button" class="btn btn-primary btn-sm orderline-act" data-act="partial" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnPartial"))}</button>
              <button type="button" class="btn btn-secondary btn-sm orderline-act" data-act="total" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnTotal"))}</button>
              <button type="button" class="btn btn-secondary btn-sm orderline-act" data-act="cancel" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnCancel"))}</button>`;
      } else if (line.status === this.STATUS.RECEPCION_TOTAL && this._canOfferRemoveStaleReceived(line)) {
        actions = `
              <button type="button" class="btn btn-secondary btn-sm orderline-act orderline-act--purge-stale" data-act="remove-stale-received" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnRemoveStaleReceived"))}</button>`;
      } else if (line.status === this.STATUS.CANCELADA) {
        actions = `
              <button type="button" class="btn btn-secondary btn-sm orderline-act" data-act="delete" data-id="${Utils.escapeAttr(line.id)}">${this.esc(I18n.t("orderLines.btnDelete"))}</button>`;
      }
    }
    return actions;
  },

  _orderLineTableRowHtml(line, canEditDraft, canMutate, canBatchLevel) {
    const remaining = Math.max(0, line.orderedQty - line.receivedQty);
    const editInactive = line.status === this.STATUS.INACTIVA && canEditDraft;
    const canBatchReceive =
      !!canBatchLevel &&
      (line.status === this.STATUS.PEDIDA || line.status === this.STATUS.RECEPCION_PARCIAL) &&
      remaining > 0;
    const qtyEditable = editInactive
      ? `<input type="number" min="0" step="0.01" class="form-input orderline-field" data-field="orderedQty" data-id="${Utils.escapeAttr(line.id)}" value="${line.orderedQty}" />`
      : `<span>${line.orderedQty}</span>`;
    const supEditable = this._supplierEditCell(line, editInactive);
    const poCell = editInactive ? "—" : this.esc(line.poNumber || "—");
    const actions = this._orderLineActionsHtml(line, canMutate);
    const naTitle = this.esc(I18n.t("orderLines.batchCheckboxNaTitle"));
    const safeLineKey = String(line.id ?? "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_{2,}/g, "_");
    const rowSelId = `orderline-sel-${safeLineKey || "row"}`;
    const rowAria = Utils.escapeAttr(I18n.t("orderLines.batchSelectRowAria"));
    const rowCb = canBatchReceive
      ? `<label class="orderline-select-cell-label" data-auth-act="ordBatchReceive" data-auth-act-level="edit"><input type="checkbox" id="${rowSelId}" class="orderline-select-cb orderline-select-cb--row" data-id="${Utils.escapeAttr(
          line.id
        )}" aria-label="${rowAria}" /></label>`
      : `<span class="orderline-select-placeholder muted" title="${naTitle}" aria-hidden="true">—</span>`;

    return `<tr data-id="${Utils.escapeAttr(line.id)}">
          <td class="orderline-col-select ${canBatchReceive ? "" : "orderline-col-select--na"}">${rowCb}</td>
          <td class="orderline-col-article"><span class="orderline-line-ref muted">${this.esc(this.formatLineRef(line))}</span><br><strong>${this.esc(line.code)}</strong><div class="orderline-desc">${this.esc(line.description)}</div></td>
          <td class="orderline-col-supplier">${supEditable}</td>
          <td>${poCell}</td>
          <td>${qtyEditable}</td>
          <td>${line.receivedQty}</td>
          <td>${remaining}</td>
          <td class="orderline-main-stock-cell"><span class="orderline-main-stock">${this.esc(String(this._mainStockForOrderLine(line)))}</span></td>
          <td><span class="orderline-status orderline-st-${line.status}">${this.esc(this.statusLabel(line.status))}</span></td>
          <td class="orderline-dates">${this.esc(Utils.formatDateTime(this._keyDate(line)))}</td>
          <td class="orderline-timeline-cell muted">${this.renderTimelineHtml(line)}</td>
          <td class="orderline-actions" data-auth-act="ordLineMutations" data-auth-act-level="edit">${actions}</td>
        </tr>`;
  },

  init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ORDER_LINES) || "[]";
      this.lines = JSON.parse(raw);
      if (!Array.isArray(this.lines)) this.lines = [];
    } catch (e) {
      this.lines = [];
    }
    this.lines.forEach(l => {
      if (l && !l.lineKind) {
        if (l.itemId) l.lineKind = "inventory";
        else if (l.consumableName) l.lineKind = "consumible";
      }
    });
    this.setupEventListeners();
    this.render();
    this.renderPurchaseSuggestionsPanel();
  },

  /** @returns {boolean} */
  _isConsumableLine(line) {
    return !!(line && line.lineKind === "consumible");
  },

  /**
   * Stock en almacén principal (main) para la línea. Pedido de consumible o artículo en modo
   * consumible de inventario → 0. Sin artículo vinculado → 0.
   * @returns {number}
   */
  _mainStockForOrderLine(line) {
    if (!line || this._isConsumableLine(line)) return 0;
    const itemId = line.itemId;
    if (!itemId) return 0;
    if (typeof InventoryManager === "undefined" || !Array.isArray(InventoryManager.items)) return 0;
    const it = InventoryManager.items.find(x => x && String(x.id) === String(itemId));
    if (!it || it.inventoryConsumable) return 0;
    return Utils.roundDecimal(parseFloat(it.mainStock) || 0);
  },

  /** Nombre desde select + input de alta de consumible. */
  _consumablePickNameRaw() {
    const sel = document.getElementById("orderline-consumible-select");
    const inp = document.getElementById("orderline-consumible-name");
    if (
      sel &&
      sel.style.display !== "none" &&
      String(sel.value || "").trim()
    )
      return String(sel.value || "").trim();
    return String(inp?.value || "").trim();
  },

  _consumSupplierPickRaw() {
    const sel = document.getElementById("orderline-consum-supplier-select");
    const inp = document.getElementById("orderline-consum-supplier");
    if (sel && sel.style.display !== "none" && String(sel.value || "").trim())
      return String(sel.value || "").trim();
    return String(inp?.value || "").trim();
  },

  _syncConsumibleAddFormPanels() {
    const on = !!document.getElementById("orderline-consumible-mode")?.checked;
    const inv = document.getElementById("orderlines-inventory-pick");
    const cp = document.getElementById("orderlines-consumible-pick");
    if (inv) {
      inv.hidden = on;
      inv.style.display = on ? "none" : "";
    }
    if (cp) {
      cp.hidden = !on;
      cp.style.display = on ? "" : "none";
    }
    if (on && typeof ConsumableManager !== "undefined") ConsumableManager.refreshDatalists();
  },

  save() {
    localStorage.setItem(STORAGE_KEYS.ORDER_LINES, JSON.stringify(this.lines));
    if (typeof Dashboard !== "undefined" && Dashboard.refresh) Dashboard.refresh();
  },

  esc(s) {
    return Utils.escapeHtml(s);
  },

  getLine(id) {
    return this.lines.find(l => l.id === id);
  },

  _supplierNames() {
    return typeof SupplierManager !== "undefined" && SupplierManager.getSortedNames
      ? SupplierManager.getSortedNames()
      : [];
  },

  _supplierEditCell(line, editInactive) {
    if (!editInactive) return this.esc(line.supplier || "—");
    const names = this._supplierNames();
    if (!names.length) {
      return `<input type="text" class="form-input orderline-field" data-field="supplier" data-id="${Utils.escapeAttr(line.id)}" value="${this.esc(line.supplier)}" />`;
    }
    const cur = String(line.supplier || "").trim();
    const ph = I18n.t("suppliers.selectPlaceholder");
    const parts = [`<option value="">${this.esc(ph)}</option>`];
    let matched = false;
    for (const n of names) {
      const sel = cur && n.toLowerCase() === cur.toLowerCase();
      if (sel) matched = true;
      parts.push(`<option value="${this.esc(n)}"${sel ? " selected" : ""}>${this.esc(n)}</option>`);
    }
    if (cur && !matched) {
      parts.push(`<option value="${this.esc(cur)}" selected>${this.esc(cur)}</option>`);
    }
    return `<select class="form-input orderline-field" data-field="supplier" data-id="${Utils.escapeAttr(line.id)}">${parts.join("")}</select>`;
  },

  /** Referencia legible para listas e historial (solo dígitos rellenados). */
  formatLineRef(line) {
    if (!line) return "—";
    const s = String(line.id ?? "");
    if (/^\d+$/.test(s)) return `#${s.padStart(8, "0")}`;
    return `#${s}`;
  },

  addLine(itemId, orderedQty, supplier, poNumber) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
    const item = InventoryManager.items.find(i => i.id === itemId);
    if (!item) {
      Utils.showToast(I18n.t("orderLines.msgSelectItem"), "warning");
      return;
    }
    if (item.inventoryConsumable) {
      Utils.showToast(I18n.t("orderLines.msgInventoryConsumableNoOrder"), "warning");
      return;
    }
    const q = Math.max(0, parseFloat(orderedQty) || 0);
    if (q <= 0) {
      Utils.showToast(I18n.t("orderLines.msgQtyPositive"), "warning");
      return;
    }
    const supplierNorm = String((supplier || item.supplier || "")).trim();
    const hasDuplicateActive = (this.lines || []).some(l =>
      l &&
      !this._isConsumableLine(l) &&
      l.itemId === item.id &&
      String(l.supplier || "").trim().toLowerCase() === supplierNorm.toLowerCase() &&
      (l.status === this.STATUS.INACTIVA || l.status === this.STATUS.PEDIDA || l.status === this.STATUS.RECEPCION_PARCIAL)
    );
    if (hasDuplicateActive) {
      Utils.showToast(I18n.t("orderLines.msgDuplicateActiveLine"), "warning");
      return;
    }
    const line = {
      id: Utils.generateId(),
      lineKind: "inventory",
      itemId: item.id,
      code: item.code || "",
      description: item.description || "",
      supplier: supplierNorm,
      poNumber: (poNumber || "").trim(),
      orderedQty: q,
      receivedQty: 0,
      status: this.STATUS.INACTIVA,
      createdAt: new Date().toISOString(),
      orderedAt: null,
      timeline: [{ type: "created", date: new Date().toISOString(), note: "" }],
      cancelledAt: null,
      completedAt: null,
      movementIds: []
    };
    this.lines.unshift(line);
    this.save();
    this.render();
    this.renderPurchaseSuggestionsPanel();
    Utils.showToast(I18n.t("orderLines.msgAdded"), "success");
    if (typeof Auth !== "undefined") Auth.logAudit("orderLine.add", line.id);
  },

  addConsumibleLine(orderedQty, supplier) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
    if (typeof ConsumableManager === "undefined") return;
    if (!ConsumableManager.hasList()) {
      Utils.showToast(I18n.t("consumables.configEmptyWarn"), "warning");
      return;
    }
    const nameRaw = this._consumablePickNameRaw();
    const canon = ConsumableManager.canonicalConsumable(nameRaw);
    if (!canon || !String(canon).trim()) {
      Utils.showToast(I18n.t("movements.compraConsumableInvalid"), "warning");
      return;
    }
    const q = Math.max(0, parseFloat(orderedQty) || 0);
    if (q <= 0) {
      Utils.showToast(I18n.t("orderLines.msgQtyPositive"), "warning");
      return;
    }
    const sup = String(supplier || "").trim();
    const hasDuplicateActive = (this.lines || []).some(l =>
      l &&
      this._isConsumableLine(l) &&
      String(l.consumableName || "").trim().toLowerCase() === canon.toLowerCase() &&
      String(l.supplier || "").trim().toLowerCase() === sup.toLowerCase() &&
      (l.status === this.STATUS.INACTIVA || l.status === this.STATUS.PEDIDA || l.status === this.STATUS.RECEPCION_PARCIAL)
    );
    if (hasDuplicateActive) {
      Utils.showToast(I18n.t("orderLines.msgDuplicateActiveLine"), "warning");
      return;
    }
    const line = {
      id: Utils.generateId(),
      lineKind: "consumible",
      consumableName: canon,
      itemId: null,
      code: `[${I18n.t("orderLines.consumableCodeTag")}]`,
      description: canon,
      supplier: sup,
      poNumber: "",
      orderedQty: q,
      receivedQty: 0,
      status: this.STATUS.INACTIVA,
      createdAt: new Date().toISOString(),
      orderedAt: null,
      timeline: [{ type: "created", date: new Date().toISOString(), note: "" }],
      cancelledAt: null,
      completedAt: null,
      movementIds: []
    };
    this.lines.unshift(line);
    this.save();
    this.render();
    const cName = document.getElementById("orderline-consumible-name");
    const cSel = document.getElementById("orderline-consumible-select");
    const cQty = document.getElementById("orderline-consum-qty");
    const cSup = document.getElementById("orderline-consum-supplier");
    const cSupSel = document.getElementById("orderline-consum-supplier-select");
    if (cName) cName.value = "";
    if (cSel && cSel.options.length) cSel.selectedIndex = 0;
    if (cQty) cQty.value = "1";
    if (cSup) cSup.value = "";
    if (cSupSel && cSupSel.options.length) cSupSel.selectedIndex = 0;
    Utils.showToast(I18n.t("orderLines.msgAdded"), "success");
    if (typeof Auth !== "undefined") Auth.logAudit("orderLine.addConsumable", line.id);
  },

  updateLineField(id, field, value) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
    const line = this.getLine(id);
    if (!line || line.status === this.STATUS.CANCELADA || line.status === this.STATUS.RECEPCION_TOTAL) return;
    if (field === "orderedQty") {
      const q = Math.max(0, parseFloat(value) || 0);
      if (q < line.receivedQty) {
        Utils.showToast(I18n.t("orderLines.msgQtyBelowReceived"), "warning");
        return;
      }
      line.orderedQty = q;
    } else if (field === "supplier") {
      line.supplier = String(value || "").trim();
    } else if (field === "poNumber") {
      line.poNumber = String(value || "").trim();
    }
    this.save();
    this.render();
  },

  markOrdered(id) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const line = this.getLine(id);
    if (!line || line.status !== this.STATUS.INACTIVA) return;
    const now = new Date().toISOString();
    line.status = this.STATUS.PEDIDA;
    line.orderedAt = now;
    line.timeline.push({
      type: "ordered",
      date: now,
      note: (line.supplier || "").trim() ? String(line.supplier).trim() : ""
    });
    this.save();
    this.render();
    Utils.showToast(I18n.t("orderLines.msgMarkedOrdered"), "success");
    if (typeof Auth !== "undefined") Auth.logAudit("orderLine.ordered", id);
  },

  cancelLine(id) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const line = this.getLine(id);
    if (!line || line.status === this.STATUS.CANCELADA || line.status === this.STATUS.RECEPCION_TOTAL) return;
    App.showConfirm(I18n.t("orderLines.confirmCancel"), () => {
      const now = new Date().toISOString();
      line.status = this.STATUS.CANCELADA;
      line.cancelledAt = now;
      line.timeline.push({ type: "cancelled", date: now, note: "" });
      this.save();
      this.render();
      Utils.showToast(I18n.t("orderLines.msgCancelled"), "info");
      if (typeof Auth !== "undefined") Auth.logAudit("orderLine.cancel", id);
    });
  },

  /**
   * Abre Movimientos → COMPRA_STOCK con datos de la línea; el stock se registra al pulsar Procesar (mismo flujo que una OC manual).
   */
  _receiveQty(id, qty) {
    if (typeof MovementManager === "undefined" || !MovementManager.openCompraStockFromOrderLine) return;
    MovementManager.openCompraStockFromOrderLine({ orderLineId: id, quantity: qty });
  },

  _batchEligibleLinesByIds(ids) {
    const set = new Set((ids || []).map(x => String(x || "").trim()).filter(Boolean));
    const out = [];
    for (const line of this.lines || []) {
      if (!set.has(String(line?.id || ""))) continue;
      if (line.status !== this.STATUS.PEDIDA && line.status !== this.STATUS.RECEPCION_PARCIAL) continue;
      const remaining = Math.max(0, (parseFloat(line.orderedQty) || 0) - (parseFloat(line.receivedQty) || 0));
      if (remaining <= 0) continue;
      out.push({ line, remaining });
    }
    return out;
  },

  _normOrdText(s) {
    return String(s ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  },

  /** Código artículo mostrado en pedido (normalizado). */
  _orderLineArticleCodeNorm(orderLine) {
    return this._normOrdText(orderLine?.code ?? "");
  },

  /** Código en línea de compra / inventario (normalizado). */
  _compraMovementArticleCodeNorm(movItem) {
    if (!movItem) return "";
    const raw = String(movItem.code ?? "").trim();
    const inv =
      movItem.itemId && typeof InventoryManager !== "undefined"
        ? InventoryManager.items.find(i => i.id === movItem.itemId)
        : null;
    return this._normOrdText(raw || inv?.code || "");
  },

  /**
   * Pedido ↔ compra (stock): mismo código de artículo y mismo proveedor.
   * El PO no filtra el vínculo; se aplica por línea de compra al confirmar recepción.
   */
  _codesAlignOrderLineAndCompra(orderLine, movItem) {
    if (!orderLine || !movItem) return false;
    const oc = this._orderLineArticleCodeNorm(orderLine);
    const mc = this._compraMovementArticleCodeNorm(movItem);
    const oid = String(orderLine.itemId ?? "").trim();
    const mid = String(movItem.itemId ?? "").trim();
    if (oc && mc) {
      if (oc !== mc) return false;
      if (oid && mid && oid !== mid) return false;
      return true;
    }
    if (oid && mid && oid === mid) return true;
    return false;
  },

  /**
   * Vínculo compra ↔ línea de pedido (inventario): código pedido = código compra y proveedor pedido = proveedor compra.
   */
  _orderLineMatchesCompraInventoryItem(orderLine, movItem, purchaseMeta) {
    const pm = purchaseMeta && typeof purchaseMeta === "object" ? purchaseMeta : {};
    if (!orderLine || !movItem || movItem.consumableReceipt) return false;
    if (!this._codesAlignOrderLineAndCompra(orderLine, movItem)) return false;
    const ms = String(movItem.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
    const ls = String(orderLine.supplier ?? "").trim().toLowerCase();
    return !!(ms && ls && ms === ls);
  },

  _movementInventoryReceiptMatchesOrderLine(it, orderLine, purchaseMeta) {
    return this._orderLineMatchesCompraInventoryItem(orderLine, it, purchaseMeta);
  },

  _consumableMovementLineMatchesOrderLine(it, orderLine, purchaseMeta) {
    const pm = purchaseMeta && typeof purchaseMeta === "object" ? purchaseMeta : {};
    if (!it || !it.consumableReceipt || !this._isConsumableLine(orderLine)) return false;
    const nameNorm = String(orderLine.consumableName || "").trim().toLowerCase();
    const b = String(it.description || it.code || "").trim().toLowerCase();
    if (!nameNorm || b !== nameNorm) return false;
    const ms = String(it.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
    const ls = String(orderLine.supplier ?? "").trim().toLowerCase();
    return !!ms && ms === ls;
  },

  receiveBatchSelected(ids) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordBatchReceive")) return;
    if (typeof MovementManager === "undefined" || !MovementManager.openCompraStockFromOrderLinesBatch) return;
    const rows = this._batchEligibleLinesByIds(ids);
    if (!rows.length) {
      Utils.showToast(I18n.t("orderLines.msgBatchSelectAtLeastOne"), "warning");
      return;
    }
    const suppliers = new Set(rows.map(r => String(r.line.supplier || "").trim().toLowerCase()).filter(Boolean));
    if (suppliers.size > 1) {
      Utils.showToast(I18n.t("orderLines.msgBatchSameSupplier"), "warning");
      return;
    }
    const entries = rows.map(r => ({
      orderLineId: r.line.id,
      itemId: r.line.itemId,
      quantity: r.remaining
    }));
    MovementManager.openCompraStockFromOrderLinesBatch({
      supplier: rows[0]?.line?.supplier || "",
      entries
    });
  },

  /**
   * Valida que el movimiento generado coincide con la línea pendiente (mismo artículo, cantidad ≤ pendiente).
   * @param {Set<number>} [usedMovementLineIdx] Índices de `movement.items` ya emparejados (compras en lote).
   */
  tryAttachOrderLineReceipt(movement, pen, usedMovementLineIdx) {
    if (!pen?.orderLineId) return false;
    const line = this.getLine(pen.orderLineId);
    if (!line) return false;
    if (line.status !== this.STATUS.PEDIDA && line.status !== this.STATUS.RECEPCION_PARCIAL) return false;
    const items = movement.items || [];
    const qExpected =
      pen && typeof pen.quantity !== "undefined" ? Math.max(0, Math.abs(parseFloat(pen.quantity) || 0)) : 0;
    const used = usedMovementLineIdx instanceof Set ? usedMovementLineIdx : null;

    let it = null;

    if (this._isConsumableLine(line) || pen.consumableReceipt) {
      const nameNorm = String(line.consumableName || "").trim().toLowerCase();
      const matchConsAt = (x, idx) => {
        if (used && used.has(idx)) return false;
        if (!x || !x.consumableReceipt) return false;
        const b = String(x.description || x.code || "").trim().toLowerCase();
        if (!nameNorm || nameNorm !== b) return false;
        const q = Math.abs(parseFloat(x.quantity) || 0);
        if (q <= 0) return false;
        if (qExpected > 0 && Math.abs(q - qExpected) > 1e-6) return false;
        return true;
      };
      let idxFound = -1;
      for (let idx = 0; idx < items.length; idx++) {
        if (matchConsAt(items[idx], idx)) {
          it = items[idx];
          idxFound = idx;
          break;
        }
      }
      if (!it || idxFound < 0) return false;
      const pm = movement.purchaseMeta || {};
      const movementSup = String(it.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
      const lineSup = String(line.supplier || "").trim().toLowerCase();
      if (!movementSup || !lineSup || movementSup !== lineSup) return false;
      const q = Math.abs(parseFloat(it.quantity) || 0);
      const remaining =
        Math.max(0, parseFloat(line.orderedQty) || 0) - Math.max(0, parseFloat(line.receivedQty) || 0);
      if (q <= 0 || q > remaining + 1e-6) return false;
      if (used) used.add(idxFound);
      return !!nameNorm;
    }

    const lineItemIdNorm = line.itemId == null ? "" : String(line.itemId);
    const penItemIdNorm =
      pen.lineItemId != null && String(pen.lineItemId).trim() !== ""
        ? String(pen.lineItemId)
        : lineItemIdNorm;

    if (items.length === 1) {
      if (used && used.has(0)) return false;
      it = items[0];
    } else if (pen && typeof pen.quantity !== "undefined") {
      for (let idx = 0; idx < items.length; idx++) {
        if (used && used.has(idx)) continue;
        const x = items[idx];
        if (!x || x.consumableReceipt) continue;
        if (String(x.itemId ?? "") !== penItemIdNorm) continue;
        if (!this._codesAlignOrderLineAndCompra(line, x)) continue;
        const q = Math.abs(parseFloat(x.quantity) || 0);
        if (q <= 0) continue;
        if (qExpected > 0 && Math.abs(q - qExpected) > 1e-6) continue;
        it = x;
        if (used) used.add(idx);
        break;
      }
    } else {
      return false;
    }
    if (!it || it.consumableReceipt) return false;

    if (!lineItemIdNorm) return false;
    if (String(it.itemId ?? "") !== lineItemIdNorm) return false;
    if (pen.lineItemId != null && String(pen.lineItemId).trim() !== "" && String(it.itemId ?? "") !== String(pen.lineItemId)) {
      return false;
    }
    const pm = movement.purchaseMeta || {};
    const movementSup = String(it.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
    const lineSup = String(line.supplier || "").trim().toLowerCase();
    if (!movementSup || !lineSup || movementSup !== lineSup) return false;
    if (!this._codesAlignOrderLineAndCompra(line, it)) return false;
    const q = Math.abs(parseFloat(it.quantity) || 0);
    const remaining =
      Math.max(0, parseFloat(line.orderedQty) || 0) - Math.max(0, parseFloat(line.receivedQty) || 0);
    if (q <= 0 || q > remaining + 1e-6) return false;
    if (used) {
      const ix = items.indexOf(it);
      if (ix >= 0) used.add(ix);
    }
    return true;
  },

  /** Tras guardar COMPRA_STOCK con orderLineId; actualiza la línea y el timeline. */
  /**
   * Compra de stock sin línea de pedido previa: ofrece crear una línea en Pedidos (recepción total o parcial),
   * alineado con el timeline y estados de recepción desde el panel.
   */
  async offerBackfillFromStandaloneCompra(movement) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    if (!movement || movement.type !== "COMPRA_STOCK" || movement.orderLineId) return;
    const items = Array.isArray(movement.items) ? movement.items : [];
    if (items.some(x => x.consumableReceipt)) return;
    if (typeof App === "undefined" || !App.showConfirmAsync) return;

    const pm = movement.purchaseMeta || {};
    const grouped = new Map();
    for (const x of items) {
      if (!x || x.consumableReceipt || x.transformationOutput) continue;
      if (!x.itemId) continue;
      const inv = InventoryManager.items.find(i => i.id === x.itemId);
      if (!inv || inv.inventoryConsumable) continue;
      const q = Math.max(0, Math.abs(parseFloat(x.quantity) || 0));
      if (q <= 0) continue;
      const supplierNorm = String(x.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
      const codeNorm = this._normOrdText(x.code || inv.code || "");
      if (!supplierNorm || !codeNorm) continue;
      const key = `${String(x.itemId)}|${codeNorm}|${supplierNorm}`;
      const prev = grouped.get(key);
      if (prev) {
        prev.received = Utils.roundDecimal(prev.received + q);
      } else {
        grouped.set(key, {
          itemId: x.itemId,
          codeNorm,
          code: String(x.code || inv.code || ""),
          description: String(x.description || inv.description || ""),
          received: Utils.roundDecimal(q),
          supplierNorm
        });
      }
    }

    const attachBatch = [];
    let changedOrderedQty = false;
    /** Grupo sin línea de pedido con mismo artículo+código+proveedor (solo ahí ofrecemos alta nueva). */
    let groupNeedsNewPedidoLine = null;
    const sortByOldest = arr =>
      [...arr].sort((a, b) => {
        const ta = new Date(String(a.orderedAt || a.createdAt || "")).getTime();
        const tb = new Date(String(b.orderedAt || b.createdAt || "")).getTime();
        const va = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY;
        const vb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
        if (va !== vb) return va - vb;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    for (const g of grouped.values()) {
      const baseList = (this.lines || []).filter(l => {
        if (!l || l.lineKind !== "inventory") return false;
        if (String(l.itemId ?? "") !== String(g.itemId ?? "")) return false;
        if (l.status !== this.STATUS.PEDIDA && l.status !== this.STATUS.RECEPCION_PARCIAL) return false;
        const lineSup = String(l.supplier || "").trim().toLowerCase();
        if (!lineSup || lineSup !== g.supplierNorm) return false;
        if (this._normOrdText(l.code || "") !== g.codeNorm) return false;
        return true;
      });
      if (!baseList.length) {
        groupNeedsNewPedidoLine = groupNeedsNewPedidoLine || g;
        continue;
      }
      const chosen = sortByOldest(baseList)[0];
      if (!chosen) continue;
      const remaining =
        Math.max(0, parseFloat(chosen.orderedQty) || 0) - Math.max(0, parseFloat(chosen.receivedQty) || 0);
      const itemLabel = [String(g.code || "").trim(), String(g.description || "").trim()].filter(Boolean).join(" — ");
      const itemDisp =
        itemLabel ||
        (typeof I18n !== "undefined" && I18n.t ? I18n.t("orderLines.compraMatchItemFallback") : "—");
      const supDisp = String(chosen.supplier || "").trim() || "—";
      const poDisp = String(chosen.poNumber || "").trim() || "—";
      const remDisp = String(Utils.roundDecimal(remaining));
      const sameOrder = await App.showConfirmAsync(
        I18n.t("orderLines.compraMatchPendingOrder")
          .replace("{item}", itemDisp)
          .replace("{supplier}", supDisp)
          .replace("{po}", poDisp),
        { yesNo: true }
      );
      if (!sameOrder) continue;
      if (g.received < remaining - 1e-9) {
        const partial = await App.showConfirmAsync(
          I18n.t("orderLines.compraMatchPartialReceipt")
            .replace("{received}", String(g.received))
            .replace("{remaining}", remDisp),
          { yesNo: true }
        );
        if (!partial) continue;
      } else if (g.received > remaining + 1e-9) {
        const suggested = Utils.roundDecimal(Math.max(0, parseFloat(chosen.receivedQty) || 0) + g.received);
        const grow = await App.showConfirmAsync(
          I18n.t("orderLines.compraMatchGrowOrdered")
            .replace("{received}", String(g.received))
            .replace("{remaining}", remDisp)
            .replace("{suggested}", String(suggested)),
          { yesNo: true }
        );
        if (!grow) continue;
        chosen.orderedQty = suggested;
        if (chosen.receivedQty >= chosen.orderedQty - 1e-9) chosen.status = this.STATUS.RECEPCION_TOTAL;
        changedOrderedQty = true;
      }
      attachBatch.push({
        orderLineId: chosen.id,
        lineItemId: chosen.itemId,
        quantity: g.received,
        consumableReceipt: false
      });
    }
    if (attachBatch.length) {
      if (changedOrderedQty) this.save();
      movement.orderLineBatchReceipts = attachBatch;
      if (typeof MovementManager !== "undefined" && MovementManager.save) MovementManager.save();
      this.commitBatchReceiptAfterCompra(movement);
      return;
    }

    if (!groupNeedsNewPedidoLine) {
      return;
    }

    const first = groupNeedsNewPedidoLine;
    const it = first
      ? items.find(x => {
          if (!x || String(x?.itemId ?? "") !== String(first.itemId ?? "")) return false;
          const pm = movement.purchaseMeta || {};
          const inv0 = InventoryManager.items.find(i => i.id === x.itemId);
          const cn = this._normOrdText(x.code || inv0?.code || "");
          const sup = String(x.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
          return cn === first.codeNorm && sup === first.supplierNorm;
        })
      : null;
    const inv = it ? InventoryManager.items.find(i => i.id === it.itemId) : null;
    const received = first ? first.received : 0;
    if (!it || !inv || received <= 0) return;

    const register = await App.showConfirmAsync(I18n.t("orderLines.backfillAskRegister"), { yesNo: true });
    if (!register) return;

    const fullReceipt = await App.showConfirmAsync(I18n.t("orderLines.backfillAskFullReceipt"), { yesNo: true });
    let orderedQty = received;
    if (!fullReceipt) {
      const raw = await App.showPrompt({
        message: I18n.t("orderLines.backfillPromptOrderedQty").replace("{min}", String(received)),
        defaultValue: String(received),
        inputType: "text"
      });
      if (raw == null) return;
      orderedQty = Math.max(0, parseFloat(String(raw).replace(",", ".")) || 0);
      if (orderedQty < received - 1e-9) {
        Utils.showToast(I18n.t("orderLines.backfillOrderedTooSmall"), "warning");
        return;
      }
    }

    this._createBackfillLineFromCompra(movement, it, inv, orderedQty, received);
  },

  _sumStandaloneCompraReceivedQtyForLine(movement, line) {
    const items = Array.isArray(movement?.items) ? movement.items : [];
    const pm = movement?.purchaseMeta && typeof movement.purchaseMeta === "object" ? movement.purchaseMeta : {};
    if (!line) return 0;
    if (this._isConsumableLine(line)) {
      const nameNorm = String(line.consumableName || "").trim().toLowerCase();
      if (!nameNorm) return 0;
      const lineSup = String(line.supplier || "").trim().toLowerCase();
      return Utils.roundDecimal(
        items.reduce((acc, x) => {
          if (!x || !x.consumableReceipt) return acc;
          const b = String(x.description || x.code || "").trim().toLowerCase();
          if (b !== nameNorm) return acc;
          const ms = String(x.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
          if (ms !== lineSup) return acc;
          return acc + Math.abs(parseFloat(x.quantity) || 0);
        }, 0)
      );
    }
    const itemIdNorm = String(line.itemId ?? "");
    if (!itemIdNorm) return 0;
    return Utils.roundDecimal(
      items.reduce((acc, x) => {
        if (!x || x.consumableReceipt || x.transformationOutput) return acc;
        if (String(x.itemId ?? "") !== itemIdNorm) return acc;
        if (!this._movementInventoryReceiptMatchesOrderLine(x, line, pm)) return acc;
        return acc + Math.abs(parseFloat(x.quantity) || 0);
      }, 0)
    );
  },

  /**
   * @param {object} movement
   * @param {object} lineItem
   * @param {object} invItem
   * @param {number} orderedQty
   * @param {number} receivedQty
   */
  _createBackfillLineFromCompra(movement, lineItem, invItem, orderedQty, receivedQty) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const pm = movement.purchaseMeta || {};
    const supplier =
      String(lineItem.compraLineSupplier ?? "").trim() ||
      String(pm.supplier || "").trim() ||
      String(invItem.supplier || "").trim();
    const poNumber = String(lineItem.compraLinePo ?? pm.poNumber ?? "").trim();
    const nowIso = new Date().toISOString();
    const pmYmd = String(pm.realReceiptDate || "").trim();
    let receiptInstantIso = movement.date || nowIso;
    if (/^\d{4}-\d{2}-\d{2}$/.test(pmYmd)) {
      const ts = new Date(`${pmYmd}T12:00:00`).getTime();
      if (Number.isFinite(ts)) receiptInstantIso = new Date(ts).toISOString();
    }
    const isTotal = orderedQty <= receivedQty + 1e-9;
    const line = {
      id: Utils.generateId(),
      lineKind: "inventory",
      itemId: invItem.id,
      code: invItem.code || "",
      description: invItem.description || "",
      supplier,
      poNumber,
      orderedQty,
      receivedQty,
      status: isTotal ? this.STATUS.RECEPCION_TOTAL : this.STATUS.RECEPCION_PARCIAL,
      createdAt: nowIso,
      orderedAt: movement.date || nowIso,
      timeline: [
        { type: "created", date: nowIso, note: I18n.t("orderLines.backfillTimelineCreated") },
        { type: "ordered", date: movement.date || nowIso, note: supplier || poNumber || "" },
        {
          type: "receipt",
          date: receiptInstantIso,
          qty: receivedQty,
          movementId: movement.id,
          movementRef: movement.reference || ""
        }
      ],
      cancelledAt: null,
      completedAt: isTotal ? receiptInstantIso : null,
      movementIds: [movement.id]
    };
    this.lines.unshift(line);
    movement.orderLineId = line.id;
    this.save();
    this.render();
    if (typeof MovementManager !== "undefined" && MovementManager.save) MovementManager.save();
    if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
    Utils.showToast(I18n.t("orderLines.backfillRegistered"), "success");
    if (typeof Auth !== "undefined") Auth.logAudit("orderLine.backfillFromCompra", line.id);
  },

  commitReceiptAfterCompra(movement) {
    const line = this.getLine(movement.orderLineId);
    if (!line || !movement.items?.length) return;
    const q = this._sumStandaloneCompraReceivedQtyForLine(movement, line);
    const remaining =
      Math.max(0, parseFloat(line.orderedQty) || 0) - Math.max(0, parseFloat(line.receivedQty) || 0);
    if (q <= 0 || q > remaining + 1e-6) return;

    if (this._isConsumableLine(line)) {
      const a = String(line.consumableName || "").trim().toLowerCase();
      if (!a) return;
    } else {
      if (!String(line.itemId ?? "").trim()) return;
    }

    if (!Array.isArray(line.movementIds)) line.movementIds = [];
    if (!Array.isArray(line.timeline)) line.timeline = [];

    line.receivedQty = Math.round((Math.max(0, parseFloat(line.receivedQty) || 0) + q) * 1000) / 1000;
    if (!line.movementIds.includes(movement.id)) line.movementIds.push(movement.id);
    const pm = movement.purchaseMeta || {};
    const matchIt = (movement.items || []).find(it => {
      if (!it) return false;
      return this._isConsumableLine(line)
        ? this._consumableMovementLineMatchesOrderLine(it, line, pm)
        : this._movementInventoryReceiptMatchesOrderLine(it, line, pm);
    });
    const poUpd = String(matchIt?.compraLinePo ?? pm.poNumber ?? "").trim();
    if (poUpd) line.poNumber = poUpd;
    const now = new Date().toISOString();
    const ymd = String(pm.realReceiptDate || "").trim();
    let receiptInstantIso = now;
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      const ts = new Date(`${ymd}T12:00:00`).getTime();
      if (Number.isFinite(ts)) receiptInstantIso = new Date(ts).toISOString();
    }
    line.timeline.push({
      type: "receipt",
      date: receiptInstantIso,
      qty: q,
      movementId: movement.id,
      movementRef: movement.reference || ""
    });
    if (line.receivedQty >= line.orderedQty - 1e-9) {
      line.status = this.STATUS.RECEPCION_TOTAL;
      line.completedAt = receiptInstantIso;
    } else {
      line.status = this.STATUS.RECEPCION_PARCIAL;
    }
    this.save();
    this.render();
    if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
    if (typeof Auth !== "undefined") Auth.logAudit("orderLine.receipt", `${line.id} qty ${q} (compra form)`);
  },

  /**
   * Filas de inventario del movimiento que corresponden a una entrada del batch:
   * una fila con la cantidad exacta, varias filas del mismo itemId que suman esa cantidad,
   * o un subconjunto pequeño que suma exactamente (evita fallar cuando el mismo SKU va en varias líneas).
   */
  _findInventoryMovementIndicesForReceipt(items, usedMovementLineIdx, targetId, qtyExpected) {
    const EPS = 1e-5;
    const qExp = Math.abs(parseFloat(qtyExpected) || 0);
    if (qExp <= 0) return null;
    const tid = String(targetId ?? "");
    const cand = [];
    for (let idx = 0; idx < items.length; idx++) {
      if (usedMovementLineIdx.has(idx)) continue;
      const it = items[idx];
      if (!it || it.consumableReceipt) continue;
      if (String(it.itemId ?? "") !== tid) continue;
      const qi = Math.abs(parseFloat(it.quantity) || 0);
      if (qi <= 0) continue;
      cand.push({ idx, qi });
    }
    if (!cand.length) return null;

    for (const { idx, qi } of cand) {
      if (Math.abs(qi - qExp) <= EPS) return { indices: [idx], totalQty: qi };
    }

    const sumAll = cand.reduce((s, c) => s + c.qi, 0);
    if (Math.abs(sumAll - qExp) <= EPS) {
      return { indices: cand.map(c => c.idx), totalQty: sumAll };
    }

    const n = cand.length;
    if (n <= 15) {
      const limit = 1 << n;
      for (let mask = 1; mask < limit; mask++) {
        let sum = 0;
        const indices = [];
        for (let b = 0; b < n; b++) {
          if (mask & (1 << b)) {
            sum += cand[b].qi;
            indices.push(cand[b].idx);
          }
        }
        if (indices.length && Math.abs(sum - qExp) <= EPS) {
          return { indices, totalQty: sum };
        }
      }
    }
    return null;
  },

  commitBatchReceiptAfterCompra(movement) {
    const batch = Array.isArray(movement?.orderLineBatchReceipts) ? movement.orderLineBatchReceipts : [];
    if (!batch.length || !Array.isArray(movement?.items) || !movement.items.length) return;
    let changed = 0;
    const usedMovementLineIdx = new Set();
    const items = movement.items || [];
    for (const rec of batch) {
      const line = this.getLine(rec?.orderLineId);
      if (!line) continue;
      if (line.status !== this.STATUS.PEDIDA && line.status !== this.STATUS.RECEPCION_PARCIAL) continue;
      const qtyExpected = Math.max(0, parseFloat(rec?.quantity) || 0);
      if (qtyExpected <= 0) continue;

      let item = null;
      let receiptQty = null;
      /** Índices de movement.items a reservar tras validar cantidad vs pedido (inventario multi-fila). */
      let pendingInvIndices = null;
      if (this._isConsumableLine(line) || rec.consumableReceipt) {
        const nameNorm = String(line.consumableName || "").trim().toLowerCase();
        for (let idx = 0; idx < items.length; idx++) {
          if (usedMovementLineIdx.has(idx)) continue;
          const it = items[idx];
          if (!it || !it.consumableReceipt) continue;
          const b = String(it.description || it.code || "").trim().toLowerCase();
          if (!nameNorm || nameNorm !== b) continue;
          const qi = Math.abs(parseFloat(it.quantity) || 0);
          if (Math.abs(qi - qtyExpected) > 1e-6) continue;
          item = it;
          usedMovementLineIdx.add(idx);
          break;
        }
      } else {
        const targetId =
          rec.lineItemId != null && String(rec.lineItemId).trim() !== ""
            ? String(rec.lineItemId)
            : String(line.itemId ?? "");
        const pm = movement.purchaseMeta || {};

        const match = this._findInventoryMovementIndicesForReceipt(items, usedMovementLineIdx, targetId, qtyExpected);
        if (!match) continue;
        const metaOk = match.indices.every(idx => {
          const it0 = items[idx];
          return it0 && this._movementInventoryReceiptMatchesOrderLine(it0, line, pm);
        });
        if (!metaOk) continue;
        receiptQty = Utils.roundDecimal(match.totalQty);
        if (Math.abs(receiptQty - qtyExpected) > 1e-5) continue;

        pendingInvIndices = match.indices;
        item = items[match.indices[0]] || null;
      }
      if (!item) continue;
      if (this._isConsumableLine(line) || rec.consumableReceipt) {
        const pm = movement.purchaseMeta || {};
        const movementSup = String(item.compraLineSupplier ?? pm.supplier ?? "").trim().toLowerCase();
        const lineSup = String(line.supplier || "").trim().toLowerCase();
        if (!movementSup || !lineSup || movementSup !== lineSup) continue;
        receiptQty = Math.abs(parseFloat(item.quantity) || 0);
      }
      const q = receiptQty != null ? receiptQty : Math.abs(parseFloat(item.quantity) || 0);
      const remaining = Math.max(0, (parseFloat(line.orderedQty) || 0) - (parseFloat(line.receivedQty) || 0));
      if (q <= 0 || q > remaining + 1e-6) continue;
      if (Math.abs(q - qtyExpected) > 1e-5) continue;

      if (pendingInvIndices && pendingInvIndices.length) {
        pendingInvIndices.forEach(i => usedMovementLineIdx.add(i));
      }

      line.receivedQty = Math.round((line.receivedQty + q) * 1000) / 1000;
      line.movementIds = Array.isArray(line.movementIds) ? line.movementIds : [];
      line.movementIds.push(movement.id);
      const pm = movement.purchaseMeta || {};
      const poFrom = String(item.compraLinePo ?? pm.poNumber ?? "").trim();
      if (poFrom) line.poNumber = poFrom;
      const now = new Date().toISOString();
      const ymd = String(pm.realReceiptDate || "").trim();
      let receiptInstantIso = now;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        const ts = new Date(`${ymd}T12:00:00`).getTime();
        if (Number.isFinite(ts)) receiptInstantIso = new Date(ts).toISOString();
      }
      line.timeline = Array.isArray(line.timeline) ? line.timeline : [];
      line.timeline.push({
        type: "receipt",
        date: receiptInstantIso,
        qty: q,
        movementId: movement.id,
        movementRef: movement.reference || ""
      });
      if (line.receivedQty >= line.orderedQty - 1e-9) {
        line.status = this.STATUS.RECEPCION_TOTAL;
        line.completedAt = receiptInstantIso;
      } else {
        line.status = this.STATUS.RECEPCION_PARCIAL;
      }
      changed += 1;
      if (typeof Auth !== "undefined") Auth.logAudit("orderLine.receipt.batch", `${line.id} qty ${q} (compra form)`);
    }
    if (!changed) return;
    this.save();
    this.render();
    if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
  },

  promptPartial(id) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const line = this.getLine(id);
    if (!line || (line.status !== this.STATUS.PEDIDA && line.status !== this.STATUS.RECEPCION_PARCIAL)) return;
    const remaining = line.orderedQty - line.receivedQty;
    App.showPrompt({
      message: I18n.t("orderLines.promptPartialQty").replace("{max}", String(remaining)),
      defaultValue: String(remaining),
      inputType: "text"
    }).then(val => {
      if (val == null) return;
      this._receiveQty(id, val);
    });
  },

  receiveTotalRemaining(id) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const line = this.getLine(id);
    if (!line || (line.status !== this.STATUS.PEDIDA && line.status !== this.STATUS.RECEPCION_PARCIAL)) return;
    const remaining = line.orderedQty - line.receivedQty;
    if (remaining <= 0) return;
    this._receiveQty(id, remaining);
  },

  deleteLine(id) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const line = this.getLine(id);
    if (!line) return;
    if (line.status !== this.STATUS.INACTIVA && line.status !== this.STATUS.CANCELADA) {
      Utils.showToast(I18n.t("orderLines.msgDeleteOnlyInactiveOrCancelled"), "warning");
      return;
    }
    const confirmKey =
      line.status === this.STATUS.CANCELADA ? "orderLines.confirmDeleteCancelled" : "orderLines.confirmDelete";
    App.showConfirm(I18n.t(confirmKey), () => {
      this.lines = this.lines.filter(l => l.id !== id);
      this.save();
      this.render();
      this.renderPurchaseSuggestionsPanel();
      if (line.status === this.STATUS.CANCELADA && typeof Auth !== "undefined") Auth.logAudit("orderLine.deleteCancelled", id);
    });
  },

  _inventoryPurchaseSuggestions() {
    const arr = (typeof InventoryManager !== "undefined" ? InventoryManager.purchaseList : []) || [];
    return Array.isArray(arr) ? arr : [];
  },

  createLineFromSuggestion(code) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
    const c = String(code || "").trim();
    if (!c) return;
    const item = (typeof InventoryManager !== "undefined" ? InventoryManager.items : []).find(
      i => String(i.code || "").trim().toLowerCase() === c.toLowerCase()
    );
    if (!item) {
      Utils.showToast(I18n.t("msg.itemNotFound"), "warning");
      return;
    }
    this.addLine(item.id, 1, item.supplier || "", "");
    if (typeof InventoryManager !== "undefined") {
      InventoryManager.purchaseList = (InventoryManager.purchaseList || []).filter(
        p => String(p.code || "").trim().toLowerCase() !== c.toLowerCase()
      );
      InventoryManager.save();
    }
    this.renderPurchaseSuggestionsPanel();
  },

  removeSuggestion(code) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const c = String(code || "").trim().toLowerCase();
    if (!c || typeof InventoryManager === "undefined") return;
    InventoryManager.purchaseList = (InventoryManager.purchaseList || []).filter(
      p => String(p.code || "").trim().toLowerCase() !== c
    );
    InventoryManager.save();
    this.renderPurchaseSuggestionsPanel();
  },

  renderPurchaseSuggestionsPanel() {
    const wrap = document.getElementById("orderlines-purchase-suggestions-list");
    const panel = document.getElementById("orderlines-purchase-suggestions-wrap");
    if (!wrap || !panel) return;
    const arr = this._inventoryPurchaseSuggestions();
    if (!arr.length) {
      wrap.innerHTML = `<p class="muted">${this.esc(I18n.t("msg.noPurchaseProducts"))}</p>`;
      if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
      return;
    }
    wrap.innerHTML = arr
      .map(p => {
        const code = String(p.code || "").trim();
        const desc = String(p.description || "").trim();
        const date = p.date ? Utils.formatDate(p.date) : "";
        const status = String(p.status || "pendiente");
        return `<div class="purchase-row">
          <strong>${this.esc(code)}</strong> — ${this.esc(desc)} <small>(${this.esc(date)})</small>
          <span class="status ${this.esc(status)}">${this.esc(status)}</span>
          <div class="purchase-actions">
            <button type="button" class="orderline-suggestion-act btn btn-primary btn-sm" data-act="create" data-code="${Utils.escapeAttr(code)}">${this.esc(I18n.t("orderLines.suggestionCreateLine"))}</button>
            <button type="button" class="orderline-suggestion-act btn btn-secondary btn-sm" data-act="remove" data-code="${Utils.escapeAttr(code)}">${this.esc(I18n.t("buttons.deleteItem"))}</button>
          </div>
        </div>`;
      })
      .join("");
    if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
  },

  removeStaleReceivedLine(id) {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
    const line = this.getLine(id);
    if (!line || line.status !== this.STATUS.RECEPCION_TOTAL) return;
    const ref = this.formatLineRef(line);
    App.showConfirm(I18n.t("orderLines.confirmRemoveStaleReceived").replace("{ref}", ref), () => {
      this.lines = this.lines.filter(l => l.id !== id);
      this.save();
      this.render();
      Utils.showToast(I18n.t("orderLines.msgRemoveStaleReceivedDone"), "success");
      if (typeof Auth !== "undefined") Auth.logAudit("orderLine.removeStaleReceived", id);
    });
  },

  async exportCsv() {
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordExportXlsx", "view")) return;
    const headers = [
      "lineKind",
      "consumableName",
      "id",
      "refDisplay",
      "code",
      "description",
      "supplier",
      "poNumber",
      "orderedQty",
      "receivedQty",
      "mainStock",
      "status",
      "createdAt",
      "orderedAt",
      "completedAt",
      "cancelledAt",
      "timelineJson"
    ];
    const rows = this.getFilteredLines().map(l => ({
      lineKind: l.lineKind || "inventory",
      consumableName: l.consumableName || "",
      id: l.id,
      refDisplay: this.formatLineRef(l).replace(/^#/, ""),
      code: l.code,
      description: l.description,
      supplier: l.supplier,
      poNumber: l.poNumber,
      orderedQty: l.orderedQty,
      receivedQty: l.receivedQty,
      mainStock: this._mainStockForOrderLine(l),
      status: l.status,
      createdAt: l.createdAt || "",
      orderedAt: l.orderedAt || "",
      completedAt: l.completedAt || "",
      cancelledAt: l.cancelledAt || "",
      timelineJson: JSON.stringify(l.timeline || [])
    }));
    const selected = await Utils.pickColumns(headers, I18n.t("orderLines.exportTableBtn"));
    if (!selected || !selected.length) return;
    const projected = rows.map(r => {
      const o = {};
      selected.forEach(h => {
        o[h] = r[h] ?? "";
      });
      return o;
    });
    const filename = `GNEEX_OrderLines_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await Utils.exportStyledXlsxToInformFolder(filename, selected, projected, {
      kind: "orderlines:filtered",
      title: I18n.t("export.manifest.orderLines"),
      details: [`${I18n.t("export.manifest.rows")}: ${projected.length}`]
    });
  },

  async printFilteredTable() {
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordPrint", "view")) return;
    const list = this.getFilteredLines();
    if (!list.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const esc = s => Utils.escapeHtml(s);
    const labels = {
      article: I18n.t("orderLines.colArticle"),
      supplier: I18n.t("table.supplier"),
      po: I18n.t("orderLines.poColReceipt"),
      ordered: I18n.t("orderLines.colOrdered"),
      received: I18n.t("orderLines.colReceived"),
      remaining: I18n.t("orderLines.colRemaining"),
      mainStock: I18n.t("orderLines.colMainStock"),
      status: I18n.t("table.status"),
      keyDate: I18n.t("orderLines.colKeyDate"),
      timeline: I18n.t("orderLines.colTimeline")
    };
    const allCols = Object.values(labels);
    const selected = await Utils.pickColumns(allCols, I18n.t("orderLines.printTableBtn"));
    if (!selected || !selected.length) return;
    const body = list.map(line => {
        const remaining = Math.max(0, (parseFloat(line.orderedQty) || 0) - (parseFloat(line.receivedQty) || 0));
        const article = this._isConsumableLine(line)
          ? `<span class="muted">${esc(this.formatLineRef(line))}</span><br><strong>${esc(line.consumableName || line.code || "—")}</strong>`
          : `<span class="muted">${esc(this.formatLineRef(line))}</span><br><strong>${esc(line.code || "")}</strong><br>${esc(line.description || "")}`;
        const po = line.status === this.STATUS.INACTIVA ? "—" : esc(line.poNumber || "—");
        const mainStock = this._mainStockForOrderLine(line);
        const map = {
          [labels.article]: `<td class="print-cell-code">${article}</td>`,
          [labels.supplier]: `<td>${esc(line.supplier || "—")}</td>`,
          [labels.po]: `<td>${po}</td>`,
          [labels.ordered]: `<td>${esc(String(line.orderedQty ?? ""))}</td>`,
          [labels.received]: `<td>${esc(String(line.receivedQty ?? ""))}</td>`,
          [labels.remaining]: `<td>${esc(String(remaining))}</td>`,
          [labels.mainStock]: `<td>${esc(String(mainStock))}</td>`,
          [labels.status]: `<td>${esc(this.statusLabel(line.status))}</td>`,
          [labels.keyDate]: `<td>${esc(Utils.formatDateTime(this._keyDate(line)))}</td>`,
          [labels.timeline]: `<td>${esc(this.renderTimeline(line))}</td>`
        };
        return `<tr>${selected.map(h => map[h] || `<td></td>`).join("")}</tr>`;
      }).join("");
    const table = `<table class="inventory-table"><thead><tr>${selected.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
    Utils.printHtmlDocument(
      I18n.t("orderLines.printTableTitle"),
      I18n.t("orderLines.printTableSubtitle"),
      table
    );
  },

  renderTimeline(line) {
    const t = line.timeline || [];
    if (!t.length) return "—";
    return t
      .map(ev => {
        const d = Utils.formatDateTime(ev.date);
        if (ev.type === "created") return `${d} · ${I18n.t("orderLines.evCreated")}`;
        if (ev.type === "ordered") return `${d} · ${I18n.t("orderLines.evOrdered")}`;
        if (ev.type === "receipt")
          return `${d} · ${I18n.t("orderLines.evReceipt")} ${ev.qty}${ev.movementId ? " · " + ev.movementId.slice(0, 8) : ""}`;
        if (ev.type === "cancelled") return `${d} · ${I18n.t("orderLines.evCancelled")}`;
        return `${d} · ${ev.type || ""}`;
      })
      .join(" · ");
  },

  /** Historial en tabla: una fecha por bloque (líneas separadas), sin texto corrido. */
  renderTimelineHtml(line) {
    const t = line.timeline || [];
    if (!t.length) return this.esc("—");
    const blocks = t.map(ev => {
      const d = Utils.formatDateTime(ev.date);
      let label = "";
      if (ev.type === "created") label = I18n.t("orderLines.evCreated");
      else if (ev.type === "ordered") label = I18n.t("orderLines.evOrdered");
      else if (ev.type === "receipt") {
        label = `${I18n.t("orderLines.evReceipt")} ${ev.qty}`;
        if (ev.movementId) label += ` · ${ev.movementId.slice(0, 8)}`;
      } else if (ev.type === "cancelled") label = I18n.t("orderLines.evCancelled");
      else label = String(ev.type || "");
      return `<div class="orderline-timeline-item"><div class="orderline-timeline-date">${this.esc(d)}</div><div class="orderline-timeline-label">${this.esc(label)}</div></div>`;
    });
    return `<div class="orderline-timeline-stack">${blocks.join("")}</div>`;
  },

  statusLabel(s) {
    const k = `orderLines.status.${s}`;
    const t = I18n.t(k);
    return t === k ? s : t;
  },

  _keyDate(line) {
    if (line.status === this.STATUS.INACTIVA) return line.createdAt;
    if (line.status === this.STATUS.CANCELADA) return line.cancelledAt || line.createdAt;
    if (line.status === this.STATUS.RECEPCION_TOTAL) return line.completedAt || line.orderedAt || line.createdAt;
    return line.orderedAt || line.createdAt;
  },

  /** Texto para el campo «buscar»: solo referencia, código, descripción, proveedor y cantidades. */
  _lineTextSearchHaystack(line) {
    const remaining = Math.max(0, (parseFloat(line.orderedQty) || 0) - (parseFloat(line.receivedQty) || 0));
    const parts = [
      this.formatLineRef(line),
      line.id,
      line.code,
      line.description,
      line.consumableName,
      line.supplier,
      String(line.orderedQty ?? ""),
      String(line.receivedQty ?? ""),
      String(remaining),
      String(this._mainStockForOrderLine(line))
    ];
    return parts
      .filter(v => v != null && String(v).trim() !== "")
      .map(v => String(v).toLowerCase())
      .join("\u0001");
  },

  _keyDateDay(line) {
    const kd = this._keyDate(line);
    return kd && String(kd).length >= 10 ? String(kd).slice(0, 10) : "";
  },

  _matchesDateRange(line, dateFrom, dateTo) {
    const day = this._keyDateDay(line);
    if (!day) {
      if (dateFrom || dateTo) return false;
      return true;
    }
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  },

  _timelineHasReceipt(line) {
    return (line.timeline || []).some(e => e && e.type === "receipt");
  },

  _timelineHasOrdered(line) {
    return (line.timeline || []).some(e => e && e.type === "ordered");
  },

  _timelineHasCancelEvent(line) {
    return (line.timeline || []).some(e => e && e.type === "cancelled");
  },

  _matchesTimelinePreset(line, preset) {
    if (!preset) return true;
    if (preset === "has_receipt") return this._timelineHasReceipt(line);
    if (preset === "no_receipt") return !this._timelineHasReceipt(line);
    if (preset === "has_ordered") return this._timelineHasOrdered(line);
    if (preset === "has_cancel") return this._timelineHasCancelEvent(line) || line.status === this.STATUS.CANCELADA;
    return true;
  },

  /** ms de cierre por recepción total (completedAt o última recepción en historial). */
  _receiptCompletionTimeMs(line) {
    if (line.status !== this.STATUS.RECEPCION_TOTAL) return null;
    if (line.completedAt) {
      const x = new Date(line.completedAt).getTime();
      if (Number.isFinite(x)) return x;
    }
    const t = line.timeline || [];
    const receipts = t
      .filter(e => e && e.type === "receipt" && e.date)
      .map(e => new Date(e.date).getTime())
      .filter(Number.isFinite);
    if (!receipts.length) return null;
    return Math.max(...receipts);
  },

  purgeReceivedOlderThanOneYear() {
    if (typeof Auth !== "undefined" && !Auth.guardOrderLinesEdit()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordPurgeOld")) return;
    const cutoff = Date.now() - 365 * 86400000;
    const removeIds = [];
    const next = this.lines.filter(l => {
      if (l.status !== this.STATUS.RECEPCION_TOTAL) return true;
      const t = this._receiptCompletionTimeMs(l);
      if (t == null || !Number.isFinite(t)) return true;
      if (t < cutoff) {
        removeIds.push(l.id);
        return false;
      }
      return true;
    });
    const n = this.lines.length - next.length;
    if (!n) {
      Utils.showToast(I18n.t("orderLines.purgeOldNone"), "info");
      return;
    }
    const proceed = () => {
      this.lines = next;
      this.save();
      this.render();
      Utils.showToast(I18n.t("orderLines.purgeOldDone").replace("{n}", String(n)), "success");
      if (typeof Auth !== "undefined") Auth.logAudit("orderLine.purgeOld", String(n));
    };
    if (typeof App !== "undefined" && App.showConfirm) {
      App.showConfirm(I18n.t("orderLines.purgeOldConfirm").replace("{n}", String(n)), proceed);
    } else if (window.confirm(I18n.t("orderLines.purgeOldConfirm").replace("{n}", String(n)))) {
      proceed();
    }
  },

  _readFiltersFromDom() {
    const searchEl = document.getElementById("orderlines-filter-search");
    const statusEl = document.getElementById("orderlines-filter-status");
    const fromEl = document.getElementById("orderlines-filter-date-from");
    const toEl = document.getElementById("orderlines-filter-date-to");
    const tlEl = document.getElementById("orderlines-filter-timeline");
    return {
      search: searchEl ? String(searchEl.value || "").trim().toLowerCase() : "",
      status: statusEl ? String(statusEl.value || "") : "",
      dateFrom: fromEl ? String(fromEl.value || "").trim() : "",
      dateTo: toEl ? String(toEl.value || "").trim() : "",
      timeline: tlEl ? String(tlEl.value || "").trim() : ""
    };
  },

  getFilteredLines() {
    const f = this._readFiltersFromDom();
    let list = [...this.lines];
    if (f.status) list = list.filter(l => l.status === f.status);
    if (f.dateFrom || f.dateTo) {
      list = list.filter(l => this._matchesDateRange(l, f.dateFrom, f.dateTo));
    }
    if (f.timeline) {
      list = list.filter(l => this._matchesTimelinePreset(l, f.timeline));
    }
    if (f.search) {
      const tokens = f.search.split(/\s+/).filter(Boolean);
      list = list.filter(l => {
        const hay = this._lineTextSearchHaystack(l);
        return tokens.every(t => hay.includes(t));
      });
    }
    return list;
  },

  render() {
    const tbody = document.getElementById("orderlines-body");
    const tablePane = document.getElementById("orderlines-view-table");
    const hint = document.getElementById("orderlines-empty");
    const hintF = document.getElementById("orderlines-empty-filter");
    if (!tbody) return;

    const filtered = this.getFilteredLines();

    const setPanesForEmpty = () => {
      if (tablePane) tablePane.hidden = false;
    };

    const syncAuthDom = () => {
      if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
    };

    if (!this.lines.length) {
      tbody.innerHTML = "";
      setPanesForEmpty();
      this._syncBatchReceiveButtonState();
      if (hint) hint.style.display = "block";
      if (hintF) hintF.style.display = "none";
      syncAuthDom();
      return;
    }
    if (hint) hint.style.display = "none";

    if (!filtered.length) {
      tbody.innerHTML = "";
      setPanesForEmpty();
      this._syncBatchReceiveButtonState();
      if (hintF) hintF.style.display = "block";
      syncAuthDom();
      return;
    }
    if (hintF) hintF.style.display = "none";

    const canEditDraft =
      typeof Auth === "undefined" || Auth.getSessionActionLevel("ordFormNewLine") === "edit";
    const canMutate =
      typeof Auth === "undefined" || Auth.getSessionActionLevel("ordLineMutations") === "edit";
    const canBatchLevel =
      typeof Auth === "undefined" || Auth.getSessionActionLevel("ordBatchReceive") === "edit";

    const rowsHtml = filtered
      .map(line => this._orderLineTableRowHtml(line, canEditDraft, canMutate, canBatchLevel))
      .join("");

    tbody.innerHTML = rowsHtml;
    if (tablePane) tablePane.hidden = false;
    this._syncBatchReceiveButtonState();
    this.renderPurchaseSuggestionsPanel();
    syncAuthDom();
    if (typeof Utils !== "undefined" && Utils.installTableBodyArrowNav) {
      Utils.installTableBodyArrowNav(tbody);
    }
  },

  setupEventListeners() {
    const form = document.getElementById("orderlines-add-form");
    if (form) {
      form.addEventListener("submit", e => {
        e.preventDefault();
        if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
        if (document.getElementById("orderline-consumible-mode")?.checked) {
          Utils.showToast(I18n.t("orderLines.msgUseConsumibleButton"), "info");
          return;
        }
        const itemId = document.getElementById("orderline-pick-id")?.value?.trim();
        const qty = document.getElementById("orderline-qty")?.value;
        const sel = document.getElementById("orderline-supplier-select");
        const inp = document.getElementById("orderline-supplier");
        let sup = "";
        if (sel && sel.style.display !== "none" && sel.offsetParent !== null) {
          sup = sel.value?.trim() || "";
        } else {
          sup = inp?.value?.trim() || "";
        }
        this.addLine(itemId, qty, sup, "");
        form.reset();
        const supSel = document.getElementById("orderline-supplier-select");
        if (supSel) supSel.selectedIndex = 0;
        const hid = document.getElementById("orderline-pick-id");
        if (hid) hid.value = "";
        const res = document.getElementById("orderline-search-results");
        if (res) res.innerHTML = "";
      });
    }

    const search = document.getElementById("orderline-item-search");
    const results = document.getElementById("orderline-search-results");
    if (search && results) {
      search.addEventListener("input", () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          const q = search.value.trim();
          if (q.length < 2) {
            results.innerHTML = "";
            results.classList.remove("active");
            return;
          }
          const list = InventoryManager.search(q).slice(0, 12);
          if (!list.length) {
            results.innerHTML = `<div class="search-result-item muted">${this.esc(I18n.t("msg.noResults"))}</div>`;
            results.classList.add("active");
            return;
          }
          results.innerHTML = list
            .map(it => {
              const sup = String(it.supplier || "").trim();
              const supHtml = sup
                ? `<span class="orderline-search-supplier"><span class="orderline-search-supplier-lbl">${this.esc(I18n.t("table.supplier"))}</span> · ${this.esc(sup)}</span>`
                : "";
              return `<button type="button" class="search-result-item orderline-search-hit" data-id="${Utils.escapeAttr(it.id)}" data-code="${Utils.escapeAttr(it.code)}" data-desc="${Utils.escapeAttr(it.description)}" data-supplier="${Utils.escapeAttr(it.supplier || "")}">
              <span class="result-code">${this.esc(it.code)}</span>
              <span class="result-description">${this.esc(it.description)}</span>
              ${supHtml}
            </button>`;
            })
            .join("");
          results.classList.add("active");
        }, 200);
      });
      document.addEventListener("click", e => {
        if (!e.target.closest(".orderline-search-wrap")) {
          if (results) {
            results.classList.remove("active");
          }
        }
      });
      results.addEventListener("click", e => {
        const btn = e.target.closest(".orderline-search-hit");
        if (!btn) return;
        document.getElementById("orderline-pick-id").value = btn.dataset.id;
        search.value = `${btn.dataset.code} — ${btn.dataset.desc}`;
        const supSel = document.getElementById("orderline-supplier-select");
        const supIn = document.getElementById("orderline-supplier");
        const ds = (btn.dataset.supplier || "").trim();
        if (supSel && supSel.style.display !== "none" && ds) {
          const opt = [...supSel.options].find(o => o.value && o.value.toLowerCase() === ds.toLowerCase());
          if (opt) supSel.value = opt.value;
          else {
            supSel.value = "";
            if (supIn) supIn.value = ds;
          }
        } else if (supIn && ds) supIn.value = ds;
        results.innerHTML = "";
        results.classList.remove("active");
      });
    }

    document.body.addEventListener("change", e => {
      const inp = e.target.closest(".orderline-field");
      if (!inp) return;
      const id = inp.dataset.id;
      const field = inp.dataset.field;
      if (id && field) this.updateLineField(id, field, inp.value);
    });

    const tbodyWrap = document.getElementById("orderlines-table-wrap");
    document.getElementById("orderline-consumible-mode")?.addEventListener("change", () =>
      this._syncConsumibleAddFormPanels()
    );
    document.getElementById("orderline-add-consumable-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
      const qty = document.getElementById("orderline-consum-qty")?.value;
      this.addConsumibleLine(qty, this._consumSupplierPickRaw());
    });
    this._syncConsumibleAddFormPanels();

    if (tbodyWrap) {
      tbodyWrap.addEventListener("click", e => {
        const btn = e.target.closest(".orderline-act");
        if (!btn) return;
        if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "order") this.markOrdered(id);
        else if (act === "delete") this.deleteLine(id);
        else if (act === "partial") this.promptPartial(id);
        else if (act === "total") this.receiveTotalRemaining(id);
        else if (act === "cancel") this.cancelLine(id);
        else if (act === "remove-stale-received") this.removeStaleReceivedLine(id);
      });
    }

    const batchBtn = document.getElementById("orderlines-batch-receive-btn");
    if (tbodyWrap && !this._orderLinesBatchUiBound) {
      this._orderLinesBatchUiBound = true;
      tbodyWrap.addEventListener("change", e => {
        const t = e.target;
        if (t && t.id === "orderlines-select-all") {
          const sel = /** @type {HTMLInputElement} */ (t);
          const on = !!sel.checked;
          sel.indeterminate = false;
          document.querySelectorAll("#orderlines-body .orderline-select-cb--row:not(:disabled)").forEach(cb => {
            cb.checked = on;
          });
          requestAnimationFrame(() => this._syncBatchReceiveButtonState());
          return;
        }
        if (
          t &&
          t.classList &&
          t.classList.contains("orderline-select-cb") &&
          t.classList.contains("orderline-select-cb--row") &&
          !t.disabled
        ) {
          requestAnimationFrame(() => this._syncBatchReceiveButtonState());
        }
      });
      batchBtn?.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordBatchReceive")) return;
        const ids = [...document.querySelectorAll("#orderlines-body .orderline-select-cb--row:checked")].map(
          el => el.getAttribute("data-id") || ""
        );
        this.receiveBatchSelected(ids);
      });
    }

    document.getElementById("orderlines-purchase-suggestions-list")?.addEventListener("click", e => {
      const btn = e.target.closest(".orderline-suggestion-act[data-act][data-code]");
      if (!btn) return;
      const code = btn.getAttribute("data-code") || "";
      const act = btn.getAttribute("data-act") || "";
      if (act === "create") {
        if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordFormNewLine")) return;
        this.createLineFromSuggestion(code);
      } else if (act === "remove") {
        if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordLineMutations")) return;
        this.removeSuggestion(code);
      }
    });

    document.getElementById("orderlines-export-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordExportXlsx", "view")) return;
      void this.exportCsv();
    });
    document.getElementById("orderlines-print-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardFineAction("ordPrint", "view")) return;
      this.printFilteredTable();
    });
    const fSearch = document.getElementById("orderlines-filter-search");
    const fStatus = document.getElementById("orderlines-filter-status");
    const fFrom = document.getElementById("orderlines-filter-date-from");
    const fTo = document.getElementById("orderlines-filter-date-to");
    const fTl = document.getElementById("orderlines-filter-timeline");
    const fReset = document.getElementById("orderlines-filter-reset");
    const onFilterChange = () => this.render();
    fStatus?.addEventListener("change", onFilterChange);
    fFrom?.addEventListener("change", onFilterChange);
    fTo?.addEventListener("change", onFilterChange);
    fTl?.addEventListener("change", onFilterChange);
    fSearch?.addEventListener("input", () => {
      clearTimeout(this._filterDebounceTimer);
      this._filterDebounceTimer = setTimeout(() => this.render(), 200);
    });
    fReset?.addEventListener("click", () => {
      if (fSearch) fSearch.value = "";
      if (fStatus) fStatus.value = "";
      if (fFrom) fFrom.value = "";
      if (fTo) fTo.value = "";
      if (fTl) fTl.value = "";
      this.render();
    });
  },

  _syncBatchReceiveButtonState() {
    const batchOk =
      typeof Auth === "undefined" || Auth.getSessionActionLevel("ordBatchReceive") === "edit";
    const btn = document.getElementById("orderlines-batch-receive-btn");
    const selectAll = /** @type {HTMLInputElement | null} */ (document.getElementById("orderlines-select-all"));
    if (!batchOk) {
      if (btn) btn.disabled = true;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        selectAll.disabled = true;
      }
      return;
    }
    const all = [...document.querySelectorAll("#orderlines-body .orderline-select-cb--row:not(:disabled)")];
    const checked = all.filter(cb => cb.checked);
    if (btn) btn.disabled = checked.length === 0;
    if (selectAll) {
      selectAll.disabled = all.length === 0;
      selectAll.checked = all.length > 0 && checked.length === all.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    }
  }
};
