// movements.js - Gestión de Movimientos

const MovementManager = {
    movements: [],
    currentType: null,
    selectedItems: [],
    editingStandbyId: null,
    selectedStandbyId: null,
    /** Si existe, el próximo COMPRA_STOCK procesado puede vincularse a una línea del panel Pedidos. */
    pendingOrderLineReceipt: null,
    /** Si existe, el próximo COMPRA_STOCK se vincula en lote a varias líneas de Pedidos. */
    pendingOrderLineBatchReceipts: null,
    /** Artículo resultado elegido en Transformación (modo inventario). */
    transformationTargetItemId: null,
    /** Líneas pendientes de Consumo diario (persistente; un solo movimiento al procesar). */
    consumoCart: [],
    /** Opción del select para escribir destinatario fuera de las listas. */
    CONSUMO_RECIPIENT_OTHER: "__GNEEX_OTHER__",
    /** Marca día (YYYY-MM-DD) si el cierre automático 23:00 está en curso (éxito → guardar en LS). */
    _consumoAutoDayMark: null,
    /** Formulario modal minimizado pero borrador vivo (selectedItems / campos siguen en DOM). */
    _movementFormMinimized: false,
    /** Mientras se rellenan líneas desde Pedidos en lote: `addItem` usa `unshift` (nuevo = índice 0) y puede repetir el mismo artículo. */
    _compraBatchFromOrdersBuilding: false,
    /** Último par origen/destino elegido en Transferencia. */
    _transferDraftFrom: '',
    _transferDraftTo: '',

    init() {
        try {
            this.pendingOrderLineReceipt = null;
            this.pendingOrderLineBatchReceipts = null;
            const stored = localStorage.getItem(STORAGE_KEYS.MOVEMENTS);
            this.movements = stored ? JSON.parse(stored) : [];
            const mig = Utils.applyImportedMovementReferencePrefixing(this.movements);
            if (mig.changed) {
                Utils.patchLinkedRefsAfterMovementRefMigrate(mig.refMap);
                this.save();
            }
            Utils.syncMovementRefCounterFromMovements(this.movements);
            let migAttachments = false;
            let migOverdraftFlags = false;
            (this.movements || []).forEach(m => {
                if (!Array.isArray(m.attachments)) {
                    m.attachments = [];
                    migAttachments = true;
                }
                const t = m && m.type;
                if (t && typeof MOVEMENT_TYPES !== 'undefined' && MOVEMENT_TYPES[t]) {
                    const c = MOVEMENT_TYPES[t];
                    if (
                        (c.specialForm === 'compra' || c.specialForm === 'recepcion') &&
                        m.hadOverdraft
                    ) {
                        m.hadOverdraft = false;
                        delete m.overdraftReason;
                        delete m.overdraftAt;
                        migOverdraftFlags = true;
                    }
                }
            });
            if (migAttachments || migOverdraftFlags) this.save();
            this.purgeZeroStockMovementsNow();
            this._loadConsumoCartFromStorage();
            this._migrateConsumoCartActivityDay();
            this._bindSessionDayOnPageHide();
            this._trackedCalendarDay = Utils.localDateKey();
            this._maybeCatchUpConsumoAfterClosedSession();
            this.renderMovementTypes();
            this.renderRecentMovements();
            this.renderStandbyList();
            this.renderStandbyFloat();
            this.renderConsumoCartFloat();
            this.setupEventListeners();
            this.updateMovementDraftBar();
            this.refreshMovementTypeIndicators();
            if (typeof Dashboard !== "undefined" && Dashboard.updatePendingMovementAlerts) {
                Dashboard.updatePendingMovementAlerts();
            }
            if (!this._consumoSchedulerBound) {
                this._consumoSchedulerBound = true;
                this._consumo2300Interval = setInterval(() => this._maybeAutoProcessConsumoAt2300(), 45000);
                setTimeout(() => this._maybeAutoProcessConsumoAt2300(), 8000);
                setInterval(() => {
                    const d = Utils.localDateKey();
                    if (d > this._trackedCalendarDay) {
                        this._trackedCalendarDay = d;
                        this._maybeCatchUpConsumoAfterCalendarRoll();
                        this._maybeAutoProcessConsumoAt2300();
                    }
                }, 60000);
            }
            const thCol = document.getElementById('mov-selected-target-col');
            if (thCol && typeof I18n !== 'undefined' && I18n.t) {
                thCol.textContent = I18n.t('table.target');
            }
            const initSearchLbl = document.getElementById('mov-item-search-label');
            if (initSearchLbl && typeof I18n !== 'undefined' && I18n.t) {
                initSearchLbl.textContent = I18n.t('movements.searchItems');
            }
            const initSelTitle = document.getElementById('mov-selected-items-title');
            if (initSelTitle && typeof I18n !== 'undefined' && I18n.t) {
                initSelTitle.textContent = I18n.t('movements.selectedItems');
            }
            this._syncMovementSearchPlaceholder(null);
        } catch (err) {
            console.error('❌ Error inicializando MovementManager:', err);
        }
    },

    save() {
        localStorage.setItem(STORAGE_KEYS.MOVEMENTS, JSON.stringify(this.movements));
        this.renderStandbyList();
        this.renderStandbyFloat();
        this.renderConsumoCartFloat();
        this.refreshMovementTypeIndicators();
        this.renderRecentMovements();
        if (typeof Dashboard !== "undefined" && Dashboard.refresh) Dashboard.refresh();
        if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
    },

    /**
     * Crea un movimiento COMPRA_STOCK sin pasar por el formulario (p. ej. panel de líneas de pedido).
     * La compra de stock habitual sigue siendo desde Movimientos → tipo COMPRA_STOCK (formulario `specialForm: compra`);
     * ese flujo no usa ni requiere `orderLineId`. Aquí `orderLineId` es opcional solo para enlazar una recepción del panel.
     */
    createCompraStockProgrammatic({ itemId, quantity, supplier, poNumber, packingSlip, notes, orderLineId, realReceiptDate }) {
        if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return null;
        const item = InventoryManager.items.find(i => i.id === itemId);
        const qty = Math.abs(parseFloat(quantity) || 0);
        if (!item || qty <= 0) return null;

        const ymdOpt = String(realReceiptDate || "").trim();
        const purchaseMeta = {
            poNumber: (poNumber || "").trim(),
            packingSlip: (packingSlip || "").trim(),
            supplier: (supplier || "").trim()
        };
        if (/^\d{4}-\d{2}-\d{2}$/.test(ymdOpt)) purchaseMeta.realReceiptDate = ymdOpt;

        const reference = Utils.generateRef("COMPRA_STOCK");
        const movement = {
            id: Utils.generateId(),
            reference,
            type: "COMPRA_STOCK",
            projectId: "",
            notes: notes || "",
            date: new Date().toISOString(),
            items: [
                {
                    itemId: item.id,
                    code: item.code,
                    description: item.description,
                    quantity: qty,
                    target: "main",
                    location: item.location || "",
                    annulled: false,
                    compraLinePo: (poNumber || "").trim(),
                    compraLineSupplier: (supplier || "").trim()
                }
            ],
            hadOverdraft: false,
            annulled: false,
            attachments: [],
            purchaseMeta
        };
        if (typeof Auth !== "undefined") movement.createdBy = Auth.getDisplayName();
        if (orderLineId) movement.orderLineId = orderLineId;

        const poNum = (poNumber || "").trim();
        if (poNum && typeof ConfigManager !== "undefined" && ConfigManager.getPurchaseOrders) {
            const orders = ConfigManager.getPurchaseOrders();
            const exists = orders.some(
                o => (o.poNumber || "").trim().toLowerCase() === poNum.toLowerCase()
            );
            if (!exists) {
                orders.push({
                    id: Utils.generateId(),
                    poNumber: poNum,
                    projectId: "",
                    supplier: (supplier || "").trim(),
                    notes: notes || "",
                    status: "open",
                    created: new Date().toISOString()
                });
                ConfigManager.savePurchaseOrders(orders);
            }
        }

        const receiptDate = purchaseMeta.realReceiptDate || new Date().toISOString().slice(0, 10);
        if (item.inventoryConsumable) {
            const prevMain = Math.max(0, Utils.roundDecimal(parseFloat(item.mainStock) || 0));
            InventoryManager.updateItem(item.id, {
                lastOrder: receiptDate,
                mainStock: Utils.roundDecimal(prevMain + Math.max(0, Utils.roundDecimal(qty))),
                prodStock: 0,
                transStock: 0
            });
        } else {
            InventoryManager.updateStock(item.id, "main", qty);
        }
        this.movements.push(movement);
        this.save();
        if (typeof Auth !== "undefined") Auth.logAudit("movement.create", `COMPRA_STOCK ${reference} (order panel)`);
        if (
            movement.orderLineId &&
            typeof OrderLinesManager !== "undefined" &&
            OrderLinesManager.commitReceiptAfterCompra
        ) {
            OrderLinesManager.commitReceiptAfterCompra(movement);
        }
        if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
        InventoryManager.render();
        return movement;
    },

    /**
     * Fecha opcional «cuando llegó el material» (YYYY-MM-DD). No debe ser futura.
     * @returns {{ label: string, isFuture: boolean } | null}
     */
    _parseHistoricalReceiptDateStrict(raw) {
        const str = String(raw || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
        const t = new Date(`${str}T12:00:00`).getTime();
        if (!Number.isFinite(t)) return null;
        const endToday = new Date();
        endToday.setHours(23, 59, 59, 999);
        return { label: str, isFuture: t > endToday.getTime() };
    },

    _setHistoricalReceiptDateInputsMax() {
        const d = new Date();
        const max = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        document.getElementById("mov-compra-receipt-historical-date")?.setAttribute("max", max);
        document.getElementById("mov-rec-receipt-historical-date")?.setAttribute("max", max);
    },

    _buildAjusteLinesFromDeltas(item, deltaMain, deltaProd, deltaTrans) {
        if (!item || !item.id) return [];
        const lines = [];
        const pushLine = (target, d) => {
            const q = parseFloat(d);
            if (!Number.isFinite(q) || q === 0) return;
            lines.push({
                itemId: item.id,
                code: item.code,
                description: item.description,
                quantity: q,
                target,
                location: item.location || "",
                annulled: false
            });
        };
        pushLine("main", deltaMain);
        pushLine("production", deltaProd);
        pushLine("transformation", deltaTrans);
        return lines;
    },

    /**
     * Igual que linesWouldOverdraft pero usando stock «antes» explícito (p. ej. import CSV ya aplicado al ítem).
     */
    linesWouldOverdraftWithBaseline(lines, getBaselineStock) {
        if (!lines || !lines.length || typeof getBaselineStock !== "function") return false;
        return lines.some(item => getBaselineStock(item.itemId, item.target) + item.quantity < 0);
    },

    /**
     * @param {object} opts
     * @param {boolean} opts.applyDeltas - si true, aplica updateStock por línea (editor de artículo).
     * @param {boolean} opts.deferSave - si true, no guarda movimientos ni repinta (lote CSV).
     * @param {boolean} opts.logMovementAudit - si false, no escribe movement.create por fila (lote).
     */
    _appendAjusteMovement({ lines, notes, hadOverdraft, applyDeltas, auditDetail, deferSave, logMovementAudit }) {
        const effectiveLines = (lines || []).filter(li => Math.abs(parseFloat(li.quantity) || 0) > 1e-12);
        if (!effectiveLines.length) return null;
        const reference = Utils.generateRef("AJUSTE");
        const movement = {
            id: Utils.generateId(),
            reference,
            type: "AJUSTE",
            projectId: "",
            notes: (notes || "").trim(),
            date: new Date().toISOString(),
            items: effectiveLines,
            hadOverdraft: !!hadOverdraft,
            annulled: false,
            attachments: []
        };
        if (typeof Auth !== "undefined") movement.createdBy = Auth.getDisplayName();

        if (applyDeltas) {
            effectiveLines.forEach(li => {
                InventoryManager.updateStock(li.itemId, li.target, li.quantity, { bypassInventoryConsumable: true });
            });
        }

        this.movements.push(movement);

        if (!deferSave) {
            this.save();
            if (typeof Auth !== "undefined" && logMovementAudit !== false) {
                Auth.logAudit("movement.create", `AJUSTE ${reference} (${auditDetail || "ajuste"})`);
            }
            if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
            InventoryManager.render();
        }
        return movement;
    },

    /**
     * Registra un movimiento AJUSTE al guardar cambios de stock desde Configuración → editor de artículo.
     * @returns {object|null|{skipped:true}} Movimiento creado, skipped, o null si no hay permiso o el artículo no existe.
     */
    recordAjusteFromConfigEditor({ itemId, deltaMain, deltaProd, deltaTrans, notes }) {
        if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return null;
        const item = InventoryManager.items.find(i => i.id === itemId);
        if (!item) return null;

        const lines = this._buildAjusteLinesFromDeltas(item, deltaMain, deltaProd, deltaTrans);
        if (!lines.length) return { skipped: true };

        const hadOverdraft = this.linesWouldOverdraft(lines, 'AJUSTE');
        return this._appendAjusteMovement({
            lines,
            notes,
            hadOverdraft,
            applyDeltas: true,
            auditDetail: "config editor",
            deferSave: false,
            logMovementAudit: true
        });
    },

    /**
     * Tras importar inventario por CSV: un AJUSTE por artículo cuyo stock cambió (inventario ya guardado con valores finales).
     * @returns {number} Cantidad de movimientos añadidos.
     */
    recordAjusteInventoryCsvImportBatch({ prevMap, items, notes }) {
        const prev = prevMap || {};
        const baseline = (itemId, target) => {
            const o = prev[itemId];
            if (!o) return 0;
            if (target === "production") return o.prod;
            if (target === "transformation") return o.trans;
            return o.main;
        };

        let count = 0;
        for (const it of items || []) {
            const o = prev[it.id];
            const oM = o ? o.main : 0;
            const oP = o ? o.prod : 0;
            const oT = o ? o.trans : 0;
            const nM = parseFloat(it.mainStock) || 0;
            const nP = parseFloat(it.prodStock) || 0;
            const nT = parseFloat(it.transStock) || 0;
            const dM = nM - oM;
            const dP = nP - oP;
            const dT = nT - oT;
            if (Math.abs(dM) < 1e-9 && Math.abs(dP) < 1e-9 && Math.abs(dT) < 1e-9) continue;

            const lines = this._buildAjusteLinesFromDeltas(it, dM, dP, dT);
            if (!lines.length) continue;

            const hadOverdraft = this.linesWouldOverdraftWithBaseline(lines, baseline);
            this._appendAjusteMovement({
                lines,
                notes: (notes || "").trim(),
                hadOverdraft,
                applyDeltas: false,
                auditDetail: "inventory CSV import",
                deferSave: true,
                logMovementAudit: false
            });
            count++;
        }

        if (count > 0) {
            this.save();
            if (typeof Auth !== "undefined") {
                Auth.logAudit("movement.import.csv", `${count} AJUSTE (inventario CSV)`);
            }
            if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
            InventoryManager.render();
        }
        return count;
    },

    /**
     * Stock inicial al crear un artículo con cantidades distintas de cero (inventario ya contiene esas cantidades).
     */
    recordAjusteNewItemInitialStock(item, notes) {
        if (!item || !item.id) return null;
        const dM = parseFloat(item.mainStock) || 0;
        const dP = parseFloat(item.prodStock) || 0;
        const dT = parseFloat(item.transStock) || 0;
        if (Math.abs(dM) < 1e-9 && Math.abs(dP) < 1e-9 && Math.abs(dT) < 1e-9) return { skipped: true };

        const lines = this._buildAjusteLinesFromDeltas(item, dM, dP, dT);
        if (!lines.length) return { skipped: true };

        const hadOverdraft = this.linesWouldOverdraftWithBaseline(lines, () => 0);
        return this._appendAjusteMovement({
            lines,
            notes: (notes || "").trim(),
            hadOverdraft,
            applyDeltas: false,
            auditDetail: "new item initial stock",
            deferSave: false,
            logMovementAudit: true
        });
    },

    /**
     * Desde el panel Pedidos: cambia a Movimientos, selecciona COMPRA_STOCK y pre-rellena el mismo formulario
     * que una compra manual. El usuario pulsa «Procesar»; al guardar se vincula la línea de pedido si coincide.
     */
    openCompraStockFromOrderLine({ orderLineId, quantity }) {
        if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
        if (typeof OrderLinesManager === "undefined") return;
        const line = OrderLinesManager.getLine(orderLineId);
        if (!line) {
            Utils.showToast(I18n.t("orderLines.msgSelectItem"), "warning");
            return;
        }
        if (line.status !== OrderLinesManager.STATUS.PEDIDA && line.status !== OrderLinesManager.STATUS.RECEPCION_PARCIAL) {
            Utils.showToast(I18n.t("orderLines.msgInvalidReceiptQty"), "warning");
            return;
        }

        const isConsum =
            typeof OrderLinesManager._isConsumableLine === "function" && OrderLinesManager._isConsumableLine(line);
        let item = null;
        if (!isConsum) {
            item = InventoryManager.items.find(i => i.id === line.itemId);
            if (!item) {
                Utils.showToast(I18n.t("orderLines.msgSelectItem"), "warning");
                return;
            }
        }

        const remaining = Math.max(
            0,
            (parseFloat(line.orderedQty) || 0) - (parseFloat(line.receivedQty) || 0)
        );
        const q = Math.min(Math.abs(parseFloat(quantity) || 0), remaining);
        if (q <= 0) {
            Utils.showToast(I18n.t("orderLines.msgInvalidReceiptQty"), "warning");
            return;
        }
        this.pendingOrderLineBatchReceipts = null;

        if (isConsum) {
            this.pendingOrderLineReceipt = { orderLineId: line.id, consumableReceipt: true, quantity: q };
        } else {
            this.pendingOrderLineReceipt = { orderLineId: line.id, lineItemId: line.itemId, quantity: q };
        }
        App.switchTab("movements");
        this.selectType("COMPRA_STOCK");

        const poEl = document.getElementById("mov-compra-po");
        const slipEl = document.getElementById("mov-compra-slip");
        const supEl = document.getElementById("mov-compra-supplier");
        const notesEl = document.getElementById("movement-notes");
        if (poEl) poEl.value = "";
        if (slipEl) slipEl.value = "";
        if (supEl) supEl.value = (line.supplier || "").trim();

        const consOnly = document.getElementById("mov-compra-consumible-only");
        const qtyEl = document.getElementById("mov-compra-consumible-qty");
        const cSel = document.getElementById("mov-compra-consumible-select");
        const cInp = document.getElementById("mov-compra-consumible-name");

        if (isConsum) {
            if (typeof ConsumableManager !== "undefined") ConsumableManager.refreshDatalists();
            if (consOnly) consOnly.checked = true;
            if (qtyEl) qtyEl.value = String(q);
            const cpEl = document.getElementById("mov-compra-consumible-po");
            const csEl = document.getElementById("mov-compra-consumible-supplier");
            if (cpEl) cpEl.value = String(line.poNumber || "").trim();
            if (csEl) csEl.value = String(line.supplier || "").trim();
            const canon = String(line.consumableName || "").trim();
            if (cSel && cSel.style.display !== "none") {
                const hit = [...(cSel.options || [])].find(
                    o => (o.value || "").trim().toLowerCase() === canon.toLowerCase()
                );
                if (hit) cSel.value = hit.value;
                else if (cInp) cInp.value = canon;
            } else if (cInp) cInp.value = canon;
            if (notesEl) {
                notesEl.value = I18n.t("orderLines.movementNoteConsumible").replace("{name}", canon);
            }
        } else {
            if (consOnly) consOnly.checked = false;
            if (qtyEl) qtyEl.value = "1";
            if (cInp) cInp.value = "";
            if (notesEl)
                notesEl.value = I18n.t("orderLines.movementNote").replace("{ref}", line.code || "");
            this.addItem(item);
            this.updateItemQuantity(0, q);
            const row0 = this.selectedItems[0];
            if (row0) {
                row0.compraLinePo = String(line.poNumber || "").trim();
                row0.compraLineSupplier = String(line.supplier || "").trim();
            }
        }

        /* Importante: marcar `consOnly.checked = true/false` por código NO dispara
           el evento `change`, así que el handler `_onCompraConsumibleToggle` no
           corre y el bloque `#mov-compra-consumible-fields` (PO, proveedor,
           cantidad) se queda en `display:none`. Por eso antes había que apagar y
           encender el checkbox manualmente para que apareciera el PO. Llamamos al
           toggle directamente: él se encarga de mostrar/ocultar el bloque y
           además invoca `_syncCompraConsumibleInventoryVisibility` por dentro. */
        if (typeof this._onCompraConsumibleToggle === "function")
            this._onCompraConsumibleToggle();
        else if (typeof this._syncCompraConsumibleInventoryVisibility === "function")
            this._syncCompraConsumibleInventoryVisibility();

        setTimeout(() => document.getElementById("process-movement")?.focus({ preventScroll: true }), 400);
        Utils.showToast(I18n.t("orderLines.msgOpenCompraForm"), "info");
    },

    openCompraStockFromOrderLinesBatch({ supplier, entries }) {
        if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return;
        if (typeof OrderLinesManager === "undefined") return;
        const src = Array.isArray(entries) ? entries : [];
        const valid = [];
        for (const e of src) {
            const line = OrderLinesManager.getLine(e?.orderLineId);
            if (!line) continue;
            if (line.status !== OrderLinesManager.STATUS.PEDIDA && line.status !== OrderLinesManager.STATUS.RECEPCION_PARCIAL) continue;
            const remaining = Math.max(0, (parseFloat(line.orderedQty) || 0) - (parseFloat(line.receivedQty) || 0));
            const q = Math.min(Math.max(0, Math.abs(parseFloat(e?.quantity) || 0)), remaining);
            if (q <= 0) continue;
            if (OrderLinesManager._isConsumableLine && OrderLinesManager._isConsumableLine(line)) {
                valid.push({ line, consumibleLine: true, quantity: q });
                continue;
            }
            const item = InventoryManager.items.find(i => i.id === line.itemId);
            if (!item) continue;
            valid.push({ line, item, quantity: q });
        }
        if (!valid.length) {
            Utils.showToast(I18n.t("orderLines.msgBatchSelectAtLeastOne"), "warning");
            return;
        }

        this.pendingOrderLineReceipt = null;
        this.pendingOrderLineBatchReceipts = valid.map(v => ({
            orderLineId: v.line.id,
            lineItemId: v.line.itemId,
            quantity: v.quantity,
            consumableReceipt: !!v.consumibleLine
        }));
        App.switchTab("movements");
        this.selectType("COMPRA_STOCK");

        const poEl = document.getElementById("mov-compra-po");
        const slipEl = document.getElementById("mov-compra-slip");
        const supEl = document.getElementById("mov-compra-supplier");
        const notesEl = document.getElementById("movement-notes");
        if (poEl) poEl.value = "";
        if (slipEl) slipEl.value = "";
        if (supEl) supEl.value = String(supplier || valid[0]?.line?.supplier || "").trim();
        if (notesEl) notesEl.value = I18n.t("orderLines.movementNoteBatch").replace("{n}", String(valid.length));

        const consOnly = document.getElementById("mov-compra-consumible-only");
        const qtyEl = document.getElementById("mov-compra-consumible-qty");
        const cInp = document.getElementById("mov-compra-consumible-name");
        if (consOnly) consOnly.checked = false;
        if (qtyEl) qtyEl.value = "1";
        if (cInp) cInp.value = "";

        this.selectedItems = [];
        this._compraBatchFromOrdersBuilding = true;
        try {
            valid.forEach(v => {
                if (v.consumibleLine) {
                    const tag = I18n.t("orderLines.consumableCodeTag");
                    const canon = String(v.line.consumableName || "").trim();
                    this.selectedItems.unshift({
                        consumableReceipt: true,
                        itemId: null,
                        code: `[${tag}]`,
                        description: canon,
                        quantity: Utils.roundDecimal(v.quantity),
                        target: "main",
                        location: "",
                        stockSourceId: "",
                        boxId: "",
                        locationStockKey: "",
                        compraPlace: { kind: "main" },
                        annulled: false,
                        compraLinePo: String(v.line.poNumber || "").trim(),
                        compraLineSupplier: String(v.line.supplier || "").trim()
                    });
                    return;
                }
                this.addItem(v.item);
                // `addItem` hace `unshift`: la línea recién añadida está siempre en el índice 0 (no en length-1).
                this.updateItemQuantity(0, v.quantity);
                const r0 = this.selectedItems[0];
                if (r0) {
                    r0.compraLinePo = String(v.line.poNumber || "").trim();
                    r0.compraLineSupplier = String(v.line.supplier || "").trim();
                }
            });
        } finally {
            this._compraBatchFromOrdersBuilding = false;
        }

        this.renderSelectedItems();
        /* Mismo motivo que en `openCompraStockFromOrderLine`: si el usuario venía
           de recibir un consumible single, el checkbox podría haber quedado
           marcado y `selectType` habría mostrado el bloque consumible aunque
           ahora lo dejamos en `false`. Llamar al toggle con el checkbox ya en
           false cierra el bloque sin tocar los `selectedItems` recién armados
           (la rama que vacía `selectedItems` solo corre cuando `on === true`). */
        if (typeof this._onCompraConsumibleToggle === "function")
            this._onCompraConsumibleToggle();
        else if (typeof this._syncCompraConsumibleInventoryVisibility === "function")
            this._syncCompraConsumibleInventoryVisibility();
        setTimeout(() => document.getElementById("process-movement")?.focus({ preventScroll: true }), 400);
        Utils.showToast(I18n.t("orderLines.msgOpenCompraFormBatch"), "info");
    },

    isCompraConsumibleReceiptMode() {
        return (
            this.currentType === "COMPRA_STOCK" &&
            !!document.getElementById("mov-compra-consumible-only")?.checked
        );
    },

    _getCompraConsumibleNameRaw() {
        const sel = document.getElementById("mov-compra-consumible-select");
        const inp = document.getElementById("mov-compra-consumible-name");
        if (sel && sel.style.display !== "none" && String(sel.value || "").trim())
            return String(sel.value || "").trim();
        return String(inp?.value || "").trim();
    },

    _syncCompraConsumibleInventoryVisibility() {
        const on = this.isCompraConsumibleReceiptMode();
        const search = document.getElementById("mov-standard-item-search-wrap");
        const sec = document.querySelector("#movement-inventory-lines .selected-items-section");
        const sug = document.getElementById("mov-compra-suggestions-wrap");
        const invTbl = document.getElementById("movement-inventory-lines");
        if (search) search.style.display = on ? "none" : "";
        if (sec) sec.style.display = on ? "none" : "";
        if (sug) {
            if (this.currentType !== "COMPRA_STOCK") sug.style.display = "";
            else sug.style.display = on ? "none" : "block";
        }
        if (invTbl && !on) invTbl.style.display = "";
    },

    _onCompraConsumibleToggle() {
        if (this.currentType !== "COMPRA_STOCK") return;
        const on = this.isCompraConsumibleReceiptMode();
        if (on) {
            this.selectedItems = [];
            this.renderSelectedItems();
        }
        const fields = document.getElementById("mov-compra-consumible-fields");
        if (fields) fields.style.display = on ? "grid" : "none";
        this._syncCompraConsumibleInventoryVisibility();
    },

    updateEditingBadge() {
        const badge = document.getElementById('standby-editing-badge');
        if (!badge) return;
        if (this.editingStandbyId) {
            const movement = this.movements.find(m => m.id === this.editingStandbyId);
            badge.textContent = movement
                ? `${I18n.t('msg.standbyEditing')}: ${movement.reference}`
                : I18n.t('msg.standbyEditing');
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    },

    renderStandbyList() {
        const container = document.getElementById("standby-list");
        if (!container) return;

        const esc = s => this._escHtml(s);

        const standbyMovements = (this.movements || [])
            .filter(m => m.type === "STANDBY" && !m.annulled)
            .slice()
            .reverse();

        if (!standbyMovements.length) {
            container.innerHTML = `<p style="color:var(--text-muted);">${this._escHtml(I18n.t('msg.noStandbyMovements'))}</p>`;
            return;
        }

        container.innerHTML = `
            <div class="standby-list-head">
                <span>${this._escHtml(I18n.t('standby.reference'))}</span>
                <span>${this._escHtml(I18n.t('standby.date'))}</span>
                <span>${this._escHtml(I18n.t('standby.project'))}</span>
                <span>${this._escHtml(I18n.t('standby.items'))}</span>
                <span>${this._escHtml(I18n.t('standby.releaseAsNote'))}</span>
                <span>${this._escHtml(I18n.t('standby.actions'))}</span>
            </div>
            <div class="standby-list-body">
                ${standbyMovements
            .map(mov => {
                const itemsCount = mov.items?.length || 0;
                const project = mov.projectId || "-";
                const notes = mov.notes ? mov.notes : I18n.t('msg.noNotes');
                const releaseType = mov.standbyReleaseType || "AJUSTE";
                const releaseTypeLabel = I18n.t(`movType.${releaseType}`);
                return `
                    <div class="standby-row standby-card type-${releaseType}" data-id="${this._escAttr(mov.id)}">
                        <span class="standby-col ref">${esc(mov.reference)}</span>
                        <span class="standby-col">${Utils.formatDateTime(mov.date)}</span>
                        <span class="standby-col">${esc(project)}</span>
                        <span class="standby-col">${itemsCount}</span>
                        <span class="standby-col note">
                            <span class="standby-release-chip type-${releaseType}">${esc(releaseTypeLabel)}</span>
                            ${esc(notes)}
                        </span>
                        <div class="standby-actions">
                            <button type="button" class="btn btn-secondary standby-edit-btn" data-id="${this._escAttr(mov.id)}">${this._escHtml(I18n.t('buttons.edit'))}</button>
                            <button type="button" class="btn btn-primary standby-process-btn" data-id="${this._escAttr(mov.id)}">${this._escHtml(I18n.t('buttons.processStandby'))}</button>
                            <button type="button" class="btn btn-secondary standby-cancel-btn" data-id="${this._escAttr(mov.id)}">${this._escHtml(I18n.t('buttons.cancelStandby'))}</button>
                        </div>
                    </div>
                `;
            })
            .join("")}
            </div>
        `;

        if (this.selectedStandbyId) {
            const selectedRow = container.querySelector(`.standby-row[data-id="${this.selectedStandbyId}"]`);
            if (selectedRow) selectedRow.classList.add("selected");
        }
    },

    /** Globo flotante Stand-by: acceso rápido desde cualquier pestaña. */
    renderStandbyFloat() {
        const wrap = document.getElementById("standby-float-wrap");
        const badge = document.getElementById("standby-float-badge");
        const body = document.getElementById("standby-float-body");
        if (!wrap || !badge || !body) return;

        if (typeof Auth !== "undefined" && Auth.hasPerm && !Auth.hasPerm("movements")) {
            wrap.hidden = true;
            return;
        }
        wrap.hidden = false;
        this._applyStandbyFloatDismissState();

        const list = (this.movements || [])
            .filter(m => m.type === "STANDBY" && !m.annulled)
            .slice()
            .reverse();

        const n = list.length;
        if (n > 99) {
            badge.textContent = "99+";
            badge.style.display = "";
        } else if (n > 0) {
            badge.textContent = String(n);
            badge.style.display = "";
        } else {
            badge.textContent = "";
            badge.style.display = "none";
        }

        const panel = document.getElementById("standby-float-panel");
        if (!panel || !panel.classList.contains("standby-float-panel--open")) return;

        const esc = s => Utils.escapeHtml(s);
        const escA = s => Utils.escapeAttr(s);
        if (!list.length) {
            body.innerHTML = `<p class="standby-float-empty muted">${esc(I18n.t("movements.standbyFloatEmpty"))}</p>`;
            return;
        }

        body.innerHTML = list
            .map(mov => {
                const releaseType = mov.standbyReleaseType || "AJUSTE";
                const releaseLabel = esc(I18n.t(`movType.${releaseType}`));
                const itemsCount = mov.items?.length || 0;
                const project = esc(mov.projectId || "—");
                const idAttr = escA(mov.id);
                const ref = esc(mov.reference);
                return `
                    <div class="standby-float-item" data-id="${idAttr}">
                        <div class="standby-float-item-row">
                            <span class="standby-float-ref">${ref}</span>
                            <span class="standby-float-chip type-${releaseType}">${releaseLabel}</span>
                        </div>
                        <div class="standby-float-meta">${project} · ${itemsCount} ${esc(I18n.t("standby.items").toLowerCase())}</div>
                        <div class="standby-float-quick-actions">
                            <button type="button" class="btn btn-sm btn-secondary standby-float-edit" data-id="${idAttr}">${esc(I18n.t("buttons.edit"))}</button>
                            <button type="button" class="btn btn-sm btn-primary standby-float-process" data-id="${idAttr}">${esc(I18n.t("buttons.processStandby"))}</button>
                        </div>
                    </div>
                `;
            })
            .join("");
    },

    _setStandbyFloatOpen(open) {
        const panel = document.getElementById("standby-float-panel");
        const fab = document.getElementById("standby-float-fab");
        if (!panel || !fab) return;
        panel.classList.toggle("standby-float-panel--open", open);
        panel.hidden = !open;
        fab.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) this.renderStandbyFloat();
    },

    _toggleStandbyFloatPanel() {
        const panel = document.getElementById("standby-float-panel");
        if (!panel) return;
        this._setStandbyFloatOpen(!panel.classList.contains("standby-float-panel--open"));
    },

    _applyStandbyFloatDismissState() {
        const wrap = document.getElementById("standby-float-wrap");
        if (!wrap) return;
        /** Oculto por defecto; solo visible si el usuario eligió mostrarlo ("0"). "1" = ocultar de nuevo. */
        let dismissed = true;
        try {
            dismissed = localStorage.getItem(STORAGE_KEYS.FLOAT_STANDBY_DISMISSED) !== "0";
        } catch (e) {}
        wrap.classList.toggle("standby-float-wrap--dismissed", dismissed);
    },

    _applyConsumoCartFloatDismissState() {
        const wrap = document.getElementById("consumo-cart-float-wrap");
        if (!wrap) return;
        let dismissed = true;
        try {
            dismissed = localStorage.getItem(STORAGE_KEYS.FLOAT_CONSUMO_DISMISSED) !== "0";
        } catch (e) {}
        wrap.classList.toggle("consumo-cart-float-wrap--dismissed", dismissed);
    },

    dismissStandbyFloatUser() {
        try {
            localStorage.setItem(STORAGE_KEYS.FLOAT_STANDBY_DISMISSED, "1");
        } catch (e) {}
        this._setStandbyFloatOpen(false);
        this._applyStandbyFloatDismissState();
    },

    dismissConsumoCartFloatUser() {
        try {
            localStorage.setItem(STORAGE_KEYS.FLOAT_CONSUMO_DISMISSED, "1");
        } catch (e) {}
        this._setConsumoCartFloatOpen(false);
        this._applyConsumoCartFloatDismissState();
    },

    refreshMovementTypeIndicators() {
        const grid = document.getElementById("movement-types-grid");
        if (!grid) return;
        const nStandby = (this.movements || []).filter(m => m.type === "STANDBY" && !m.annulled).length;
        const nConsumo = (this.consumoCart || []).length;
        grid.querySelectorAll(".movement-type-btn").forEach(btn => {
            const t = btn.dataset.type;
            const on =
                (t === "STANDBY" && nStandby > 0) || (t === "CONSUMO_DIARIO" && nConsumo > 0);
            btn.classList.toggle("movement-type-btn--attention", on);
        });
    },

    /** Guarda el día local al cerrar o ocultar la pestaña (no corre JS con el navegador totalmente cerrado; al reabrir se recupera). */
    _bindSessionDayOnPageHide() {
        if (this._sessionDayPagehideBound) return;
        this._sessionDayPagehideBound = true;
        const persist = () => {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, Utils.localDateKey());
            } catch (e) {}
        };
        window.addEventListener("pagehide", persist);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") persist();
        });
    },

    /**
     * Si la última vez que se guardó sesión fue en un día anterior y el carrito tiene líneas,
     * procesa un movimiento al volver a abrir (equivalente al cierre 23:00 cuando la app estaba cerrada).
     */
    _maybeCatchUpConsumoAfterClosedSession() {
        if (typeof Auth === "undefined" || !Auth.sessionUserId || !Auth.hasPerm("movements")) return;
        if (this._isConsumoDiarioFormActive()) return;
        this._loadConsumoCartFromStorage();
        const today = Utils.localDateKey();
        let last = null;
        try {
            last = localStorage.getItem(STORAGE_KEYS.LAST_APP_SESSION_DAY);
        } catch (e) {}
        if (!last || last >= today) return;
        if (!this.consumoCart.length) {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
            } catch (e) {}
            return;
        }
        if (!this._consumoNeedsCatchUpForDay(today)) {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
            } catch (e) {}
            return;
        }
        Utils.showToast(I18n.t("movements.consumoCatchUpToast"), "info");
        void this._runAutomaticConsumoCloseForDay(today).finally(() => {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
            } catch (e) {}
        });
    },

    /** Pestaña abierta: al pasar la medianoche (día local), mismo tratamiento que cierre nocturno. */
    _maybeCatchUpConsumoAfterCalendarRoll() {
        if (typeof Auth === "undefined" || !Auth.sessionUserId || !Auth.hasPerm("movements")) return;
        if (this._isConsumoDiarioFormActive()) return;
        this._loadConsumoCartFromStorage();
        const today = Utils.localDateKey();
        if (!this.consumoCart.length) {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
            } catch (e) {}
            return;
        }
        if (!this._consumoNeedsCatchUpForDay(today)) {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
            } catch (e) {}
            return;
        }
        Utils.showToast(I18n.t("movements.consumoCatchUpToast"), "info");
        void this._runAutomaticConsumoCloseForDay(today).finally(() => {
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
            } catch (e) {}
        });
    },

    /**
     * Carrito con líneas de un día anterior al calendario local → hay que intentar cierre automático.
     * Sin `CONSUMO_CART_ACTIVITY_DAY` (datos viejos), se usa `LAST_APP_SESSION_DAY` como respaldo.
     */
    _consumoNeedsCatchUpForDay(today) {
        if (!this.consumoCart.length) return false;
        let act = null;
        try {
            act = localStorage.getItem(STORAGE_KEYS.CONSUMO_CART_ACTIVITY_DAY);
        } catch (e) {}
        if (act && act < today) return true;
        let last = null;
        try {
            last = localStorage.getItem(STORAGE_KEYS.LAST_APP_SESSION_DAY);
        } catch (e) {}
        if (!act && last && last < today) return true;
        return false;
    },

    _migrateConsumoCartActivityDay() {
        if (!this.consumoCart.length) return;
        let act = null;
        try {
            act = localStorage.getItem(STORAGE_KEYS.CONSUMO_CART_ACTIVITY_DAY);
        } catch (e) {}
        if (act) return;
        let last = null;
        try {
            last = localStorage.getItem(STORAGE_KEYS.LAST_APP_SESSION_DAY);
        } catch (e) {}
        const t = Utils.localDateKey();
        let seed = last;
        if (!seed || seed > t) seed = t;
        try {
            localStorage.setItem(STORAGE_KEYS.CONSUMO_CART_ACTIVITY_DAY, seed);
        } catch (e) {}
    },

    /** Mantiene el día de actividad del carrito y coherencia con CONSUMO_AUTO_DAY al añadir líneas hoy. */
    _touchConsumoCartActivityDay() {
        const t = Utils.localDateKey();
        try {
            if (this.consumoCart && this.consumoCart.length) {
                localStorage.setItem(STORAGE_KEYS.CONSUMO_CART_ACTIVITY_DAY, t);
                if (localStorage.getItem(STORAGE_KEYS.CONSUMO_AUTO_DAY) === t) {
                    localStorage.removeItem(STORAGE_KEYS.CONSUMO_AUTO_DAY);
                }
            } else {
                localStorage.removeItem(STORAGE_KEYS.CONSUMO_CART_ACTIVITY_DAY);
            }
        } catch (e) {}
    },

    /**
     * Usuario componiendo Consumo diario: no interrumpir con cierre 23:00 ni recuperación.
     * Incluye comprobación DOM por si `currentType` y la UI quedan desalineados (otra pestaña, refresco parcial).
     */
    _isConsumoDiarioFormActive() {
        if (this.currentType === "CONSUMO_DIARIO") return true;
        const w = document.getElementById("movement-form-window");
        if (!w || !w.classList.contains("active")) return false;
        const sel = document.querySelector("#movement-types-grid .movement-type-btn.selected");
        return sel?.dataset?.type === "CONSUMO_DIARIO";
    },

    /**
     * Tras salir del formulario Consumo diario, intenta el cierre automático que se omitió
     * (ventana 23:00 o carrito de día anterior) sin forzar mientras el usuario editaba.
     */
    _maybeRunDeferredConsumoAutoClose() {
        if (typeof Auth === "undefined" || !Auth.sessionUserId || !Auth.hasPerm("movements")) return;
        if (this._isConsumoDiarioFormActive()) return;
        this._loadConsumoCartFromStorage();
        if (!this.consumoCart.length) return;
        const now = new Date();
        const today = Utils.localDateKey(now);
        if (now.getHours() === 23) {
            void this._runAutomaticConsumoCloseForDay(today);
            return;
        }
        if (this._consumoNeedsCatchUpForDay(today)) {
            Utils.showToast(I18n.t("movements.consumoCatchUpToast"), "info");
            void this._runAutomaticConsumoCloseForDay(today).finally(() => {
                try {
                    localStorage.setItem(STORAGE_KEYS.LAST_APP_SESSION_DAY, today);
                } catch (e) {}
            });
        }
    },

    /**
     * Cierre automático del carrito consumo para un día local dado (ventana 23:00 o recuperación tras app cerrada).
     * Sin modal de sobregiro: si lo requiere, omite y marca el día.
     */
    async _runAutomaticConsumoCloseForDay(day) {
        if (typeof Auth === "undefined" || !Auth.sessionUserId || !Auth.hasPerm("movements")) return;
        this._loadConsumoCartFromStorage();
        if (this._isConsumoDiarioFormActive()) return;
        if (!this.consumoCart.length) {
            try {
                localStorage.setItem(STORAGE_KEYS.CONSUMO_AUTO_DAY, day);
            } catch (e) {}
            return;
        }
        try {
            if (localStorage.getItem(STORAGE_KEYS.CONSUMO_AUTO_DAY) === day) return;
        } catch (e) {}
        const lines = this._cloneConsumoCartLines();
        if (this.linesWouldOverdraft(lines, 'CONSUMO_DIARIO')) {
            try {
                localStorage.setItem(STORAGE_KEYS.CONSUMO_AUTO_DAY, day);
            } catch (e) {}
            Utils.showToast(I18n.t("movements.consumoAutoSkippedOverdraft"), "warning");
            return;
        }
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
        this.selectType("CONSUMO_DIARIO");
        this.syncSelectedItemQuantitiesFromDom();
        if (!this.validateMovement()) {
            try {
                localStorage.setItem(STORAGE_KEYS.CONSUMO_AUTO_DAY, day);
            } catch (e) {}
            return;
        }
        this._consumoAutoDayMark = day;
        try {
            await this._executeProcessMovement("");
        } finally {
            if (this._consumoAutoDayMark) {
                try {
                    localStorage.setItem(STORAGE_KEYS.CONSUMO_AUTO_DAY, day);
                } catch (e) {}
                this._consumoAutoDayMark = null;
            }
        }
    },

    /**
     * A las 23:00 (hora local), si el carrito tiene líneas y no hubo cierre hoy, procesa.
     * Con pestaña cerrada no hay ejecución en segundo plano; use la recuperación al abrir.
     */
    _maybeAutoProcessConsumoAt2300() {
        if (typeof Auth === "undefined" || !Auth.sessionUserId || !Auth.hasPerm("movements")) return;
        if (this._isConsumoDiarioFormActive()) return;
        const now = new Date();
        if (now.getHours() !== 23) return;
        const day = Utils.localDateKey(now);
        void this._runAutomaticConsumoCloseForDay(day);
    },

    _loadConsumoCartFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.CONSUMO_CART);
            const parsed = raw ? JSON.parse(raw) : [];
            const arr = Array.isArray(parsed) ? parsed : [];
            this.consumoCart = arr.map(line => this._normalizeConsumoLine(line));
        } catch (e) {
            this.consumoCart = [];
        }
    },

    /** Normaliza línea de carrito / formulario Consumo diario (destinatario archivado en el movimiento). */
    _normalizeConsumoLine(line) {
        const o = line && typeof line === "object" ? { ...line } : {};
        o.recipientName = o.recipientName != null ? String(o.recipientName).trim() : "";
        if (o.consumoRecipientEntry !== "free" && o.consumoRecipientEntry !== "list") {
            delete o.consumoRecipientEntry;
        }
        delete o.recipientClass;
        if (o.consumoAddedAt != null) {
            const t = Date.parse(String(o.consumoAddedAt));
            if (!Number.isFinite(t)) delete o.consumoAddedAt;
        }
        return o;
    },

    /** Con listas en Configuración: si el usuario eligió «Otro» o el nombre no está en plantilla/ocasionales → campo de texto. */
    _consumoLineShowsFreeRecipientInput(item, staffNames, occNames) {
        const all = [...(staffNames || []), ...(occNames || [])];
        if (all.length === 0) return true;
        if (item.consumoRecipientEntry === "free") return true;
        if (item.consumoRecipientEntry === "list") return false;
        const n = String(item.recipientName || "").trim();
        if (!n) return false;
        return !all.some(x => x.toLowerCase() === n.toLowerCase());
    },

    setConsumoRecipientListMode(index) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== "CONSUMO_DIARIO") return;
        this.selectedItems[index].consumoRecipientEntry = "list";
        this.selectedItems[index].recipientName = "";
        this.renderSelectedItems();
    },

    updateConsumoRecipientFreeText(index, value) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== "CONSUMO_DIARIO") return;
        this.selectedItems[index].consumoRecipientEntry = "free";
        this.selectedItems[index].recipientName = String(value ?? "").trim();
        this._persistConsumoCartFromForm();
    },

    /**
     * Antes de re-renderizar la tabla, copia del DOM el destinatario elegido (select o texto).
     * Evita perder la selección si el usuario cambió cantidad y el <select> aún no disparó `change`.
     */
    _syncConsumoRecipientsFromDom() {
        if (this.currentType !== "CONSUMO_DIARIO" || !this.selectedItems?.length) return;
        const rows = document.querySelectorAll("#selected-items-body tr");
        const n = Math.min(rows.length, this.selectedItems.length);
        for (let i = 0; i < n; i++) {
            const row = rows[i];
            const freeInp = row.querySelector(".consumo-recipient-input");
            const sel = row.querySelector(".consumo-recipient-select");
            if (freeInp) {
                this.selectedItems[i].consumoRecipientEntry = "free";
                this.selectedItems[i].recipientName = String(freeInp.value ?? "").trim();
            } else if (sel) {
                const v = String(sel.value ?? "").trim();
                if (v === this.CONSUMO_RECIPIENT_OTHER) {
                    this.selectedItems[i].consumoRecipientEntry = "free";
                    this.selectedItems[i].recipientName = "";
                } else {
                    this.selectedItems[i].consumoRecipientEntry = "list";
                    this.selectedItems[i].recipientName = v;
                }
            }
        }
    },

    _escAttr(s) {
        return Utils.escapeAttr(s);
    },

    /** Texto seguro dentro de HTML (delegado en Utils.escapeHtml). */
    _escHtml(s) {
        return Utils.escapeHtml(s);
    },

    /** Sugerencias: lista de empleados (Configuración) + nombres ya usados en historial / carrito. */
    _refreshConsumoRecipientDatalist() {
        const dl = document.getElementById("consumo-recipient-datalist");
        if (!dl) return;
        const set = new Set();
        if (typeof EmployeeManager !== "undefined" && EmployeeManager.getSortedNames) {
            for (const n of EmployeeManager.getSortedNames()) {
                if (n) set.add(n);
            }
        }
        if (typeof EmployeeManager !== "undefined" && EmployeeManager.getOccasionalSortedNames) {
            for (const n of EmployeeManager.getOccasionalSortedNames()) {
                if (n) set.add(n);
            }
        }
        for (const m of this.movements || []) {
            if (m.type !== "CONSUMO_DIARIO" || m.annulled) continue;
            for (const it of m.items || []) {
                const n = String(it.recipientName || "").trim();
                if (n) set.add(n);
            }
        }
        for (const line of this.consumoCart || []) {
            const n = String(line.recipientName || "").trim();
            if (n) set.add(n);
        }
        for (const line of this.selectedItems || []) {
            const n = String(line.recipientName || "").trim();
            if (n) set.add(n);
        }
        const sorted = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        dl.innerHTML = sorted.map(n => `<option value="${this._escAttr(n)}"></option>`).join("");
    },

    updateItemRecipient(index, value) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== "CONSUMO_DIARIO") return;
        const v = String(value ?? "").trim();
        if (v === this.CONSUMO_RECIPIENT_OTHER) {
            this.selectedItems[index].consumoRecipientEntry = "free";
            this.selectedItems[index].recipientName = "";
            this.renderSelectedItems();
            setTimeout(() => {
                const row = document.querySelector(`#selected-items-body tr:nth-child(${index + 1})`);
                const inp = row && row.querySelector(".consumo-recipient-input");
                if (inp) inp.focus();
            }, 0);
            return;
        }
        this.selectedItems[index].consumoRecipientEntry = "list";
        this.selectedItems[index].recipientName = v;
        this.renderSelectedItems();
    },

    _cloneConsumoCartLines() {
        try {
            return JSON.parse(JSON.stringify(this.consumoCart || []));
        } catch (e) {
            return [];
        }
    },

    /** Sincroniza `consumoCart` con `selectedItems` (solo en Consumo diario) y actualiza el FAB. */
    _persistConsumoCartFromForm() {
        if (this.currentType !== "CONSUMO_DIARIO") return;
        try {
            this.consumoCart = JSON.parse(JSON.stringify(this.selectedItems || []));
            localStorage.setItem(STORAGE_KEYS.CONSUMO_CART, JSON.stringify(this.consumoCart));
        } catch (e) {}
        this._touchConsumoCartActivityDay();
        this.renderConsumoCartFloat();
        this.refreshMovementTypeIndicators();
        if (typeof Dashboard !== "undefined" && Dashboard.updatePendingMovementAlerts) {
            Dashboard.updatePendingMovementAlerts();
        }
    },

    clearConsumoCart() {
        this.consumoCart = [];
        try {
            localStorage.setItem(STORAGE_KEYS.CONSUMO_CART, "[]");
        } catch (e) {}
        this._touchConsumoCartActivityDay();
        if (this.currentType === "CONSUMO_DIARIO") {
            this.selectedItems = [];
            this.renderSelectedItems();
        } else {
            this.renderConsumoCartFloat();
            this.refreshMovementTypeIndicators();
        }
        if (typeof Dashboard !== "undefined" && Dashboard.updatePendingMovementAlerts) {
            Dashboard.updatePendingMovementAlerts();
        }
    },

    removeConsumoCartLine(index) {
        if (index < 0 || index >= (this.consumoCart || []).length) return;
        this.consumoCart.splice(index, 1);
        try {
            localStorage.setItem(STORAGE_KEYS.CONSUMO_CART, JSON.stringify(this.consumoCart));
        } catch (e) {}
        this._touchConsumoCartActivityDay();
        if (this.currentType === "CONSUMO_DIARIO") {
            this.selectedItems = this._cloneConsumoCartLines();
            this.renderSelectedItems();
        } else {
            this.renderConsumoCartFloat();
            this.refreshMovementTypeIndicators();
            if (typeof Dashboard !== "undefined" && Dashboard.updatePendingMovementAlerts) {
                Dashboard.updatePendingMovementAlerts();
            }
        }
    },

    /** Panel flotante del carrito de Consumo diario (líneas pendientes → un movimiento). */
    renderConsumoCartFloat() {
        const wrap = document.getElementById("consumo-cart-float-wrap");
        const badge = document.getElementById("consumo-cart-float-badge");
        const body = document.getElementById("consumo-cart-float-body");
        if (!wrap || !badge || !body) return;

        if (typeof Auth !== "undefined" && Auth.hasPerm && !Auth.hasPerm("movements")) {
            wrap.hidden = true;
            return;
        }
        wrap.hidden = false;
        this._applyConsumoCartFloatDismissState();

        const lines = this.consumoCart || [];
        const n = lines.length;
        if (n > 99) {
            badge.textContent = "99+";
            badge.style.display = "";
        } else if (n > 0) {
            badge.textContent = String(n);
            badge.style.display = "";
        } else {
            badge.textContent = "";
            badge.style.display = "none";
        }

        const panel = document.getElementById("consumo-cart-float-panel");
        if (!panel || !panel.classList.contains("consumo-cart-float-panel--open")) return;

        const esc = s => Utils.escapeHtml(s);
        if (!lines.length) {
            body.innerHTML = `<p class="consumo-cart-float-empty muted">${esc(I18n.t("movements.consumoCartFloatEmpty"))}</p>`;
            return;
        }

        body.innerHTML = lines
            .map((line, idx) => {
                const q = Utils.formatDecimalDisplay(Math.abs(parseFloat(line.quantity) || 0));
                const tgtLabel = esc(this._formatStockSourceAsDestLabel(line));
                const rec = String(line.recipientName || "").trim();
                const recPart = rec
                    ? ` · ${esc(I18n.t("movements.recipientShort"))}: ${esc(rec)}`
                    : "";
                return `
                    <div class="consumo-cart-float-line" data-index="${idx}">
                        <div class="consumo-cart-float-line-main">
                            <div class="consumo-cart-float-line-code">${esc(line.code)}</div>
                            <div>${esc(line.description)}</div>
                            <div class="consumo-cart-float-line-meta">${esc(I18n.t("table.quantity"))}: ${esc(q)} · ${tgtLabel}${recPart}</div>
                        </div>
                        <button type="button" class="consumo-cart-float-line-remove consumo-cart-float-remove" data-index="${idx}" title="${esc(I18n.t("buttons.deleteItem"))}" aria-label="${esc(I18n.t("buttons.deleteItem"))}">✕</button>
                    </div>`;
            })
            .join("");
    },

    _setConsumoCartFloatOpen(open) {
        const panel = document.getElementById("consumo-cart-float-panel");
        const fab = document.getElementById("consumo-cart-float-fab");
        if (!panel || !fab) return;
        panel.classList.toggle("consumo-cart-float-panel--open", open);
        panel.hidden = !open;
        fab.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) this.renderConsumoCartFloat();
    },

    _toggleConsumoCartFloatPanel() {
        const panel = document.getElementById("consumo-cart-float-panel");
        if (!panel) return;
        this._setConsumoCartFloatOpen(!panel.classList.contains("consumo-cart-float-panel--open"));
    },

    /** Desde el FAB: va a Movimientos, carga el carrito y ejecuta un solo proceso. */
    processConsumoCartFromFloat() {
        if (!Auth.guardPerm("movements")) return;
        if (!(this.consumoCart && this.consumoCart.length)) {
            Utils.showToast(I18n.t("movements.consumoCartEmptyToast"), "warning");
            return;
        }
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
        this.selectType("CONSUMO_DIARIO");
        this._setConsumoCartFloatOpen(false);
        setTimeout(() => this.processMovement(), 80);
    },

    renderMovementTypes() {
        const grid = document.getElementById('movement-types-grid');
        if (!grid) return;

        const helpHint =
            typeof I18n !== 'undefined' && I18n.t ? I18n.t('movements.movTypeHelpButtonHint') : '';
        const helpAria =
            typeof I18n !== 'undefined' && I18n.t ? I18n.t('movements.movTypeHelpButtonAria') : 'Help';
        const escAttr = s => Utils.escapeAttr(s);
        const escHtml = s => Utils.escapeHtml(s);

        grid.innerHTML = Object.keys(MOVEMENT_TYPES).map(type => {
            const conf = MOVEMENT_TYPES[type];
            const extra =
                type === 'COMPRA_STOCK' ? ' mov-type-compra' : type === 'RECEPCION_MATERIAL' ? ' mov-type-recepcion' : '';
            const label = I18n.t(`movType.${type}`);
            const canUseType =
                typeof Auth === "undefined" || !Auth.hasMovementTypeProcess
                    ? true
                    : Auth.hasMovementTypeProcess(type);
            return `
                <div class="movement-type-cell">
                    <button type="button" class="movement-type-btn${extra}" data-type="${type}" ${canUseType ? "" : "disabled"}
                            style="border-color:${conf.color}"
                            title="${escAttr(label)}">
                        <span class="mov-type-btn-icon" aria-hidden="true">${conf.icon}</span>${escHtml(label)}
                    </button>
                    <button type="button" class="mov-type-help-btn" data-mov-help="${type}"
                            aria-label="${escAttr(helpAria)}" title="${escAttr(helpHint)}">
                        <span class="mov-type-help-icon" aria-hidden="true">ⓘ</span>
                    </button>
                </div>
            `;
        }).join('');
        if (this.currentType) {
            grid.querySelectorAll(".movement-type-btn").forEach(btn => {
                btn.classList.toggle("selected", btn.dataset.type === this.currentType);
            });
        }
        this.refreshMovementTypeIndicators();
        if (typeof App !== "undefined" && App.refreshActiveTabTableExportButton) App.refreshActiveTabTableExportButton();
    },

    showMovementTypeHelp(type) {
        if (!MOVEMENT_TYPES[type] || typeof I18n === 'undefined' || !I18n.t) return;
        const modal = document.getElementById('mov-type-help-modal');
        const titleEl = document.getElementById('mov-type-help-title');
        const bodyEl = document.getElementById('mov-type-help-body');
        if (!modal || !titleEl || !bodyEl) return;
        titleEl.textContent = I18n.t(`movType.${type}`);
        bodyEl.textContent = I18n.t(`movTypeHelp.${type}`);
        modal.classList.add('active');
    },

    /** Lista compacta en la pestaña Movimientos (incluye AJUSTE desde editor/CSV). */
    renderRecentMovements() {
        const wrap = document.getElementById("movements-recent-list");
        if (!wrap || typeof I18n === "undefined" || !I18n.t) return;

        if (typeof Auth !== "undefined" && Auth.getSessionActionLevel && Auth.getSessionActionLevel("movRecent") === "none") {
            wrap.innerHTML = "";
            return;
        }

        const esc = s => Utils.escapeHtml(s);
        const escA = s => Utils.escapeAttr(s);

        const all = (this.movements || []).filter(m => !m.annulled && !m.pending);
        if (!all.length) {
            wrap.innerHTML = `<p class="muted movements-recent-empty">${esc(I18n.t("movements.recentEmpty"))}</p>`;
            return;
        }

        const sorted = all.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const slice = sorted.slice(0, 24);

        wrap.innerHTML = slice
            .map(m => {
                const cfg = MOVEMENT_TYPES[m.type] || { icon: "📦", color: "#666" };
                const typeLabel = I18n.t(`movType.${m.type}`);
                const rawNote = (m.notes || "").replace(/\s+/g, " ").trim();
                const vendorLine =
                    m.type === "TRANSFORMACION" && (m.transformationVendor || "").trim()
                        ? `\n${I18n.t("movements.transformationVendor")}: ${(m.transformationVendor || "").trim()}`
                        : "";
                const tgtCode = (m.transformationTargetCode || "").trim();
                const tgtDesc = (m.transformationTargetDescription || "").trim();
                const outN = parseFloat(m.transformationOutputQuantity);
                const outPart =
                    m.type === "TRANSFORMACION" && Number.isFinite(outN) && outN > 0
                        ? `\n${I18n.t("movements.transformationOutputQty")}: ${outN} → ${I18n.t("target.main")}`
                        : "";
                const targetLine =
                    m.type === "TRANSFORMACION" && (tgtCode || tgtDesc)
                        ? `\n${I18n.t("movements.transformationTarget")}: ${tgtCode}${tgtDesc ? ` — ${tgtDesc}` : ""}`
                        : "";
                const ref = m.reference || "—";
                const when = Utils.formatDateTime(m.date);
                const by = m.createdBy ? ` · ${m.createdBy}` : "";
                const noteLine = rawNote ? `\n${rawNote}` : "";
                const tip = `${typeLabel}\n${ref}\n${when}${by}${vendorLine}${targetLine}${outPart}${noteLine}`;
                const ajusteCls = m.type === "AJUSTE" ? " movements-recent-tile--ajuste" : "";
                return `
                <button type="button" class="movements-recent-tile${ajusteCls}" data-movement-id="${escA(
                    m.id
                )}" role="listitem"
                    style="--mov-recent-accent:${cfg.color}"
                    title="${esc(tip)}">
                    <span class="movements-recent-tile-icon" aria-hidden="true">${cfg.icon}</span>
                    <span class="movements-recent-tile-ref">${esc(ref)}</span>
                    <span class="movements-recent-tile-type">${esc(typeLabel)}</span>
                </button>`;
            })
            .join("");
    },

    /** Muestra el formulario de movimiento en la ventana modal interna (no debajo de la cuadrícula). */
    openMovementFormWindow(type) {
        if (!MOVEMENT_TYPES[type]) return;
        const w = document.getElementById("movement-form-window");
        const titleEl = document.getElementById("movement-form-window-title");
        if (titleEl && typeof I18n !== "undefined" && I18n.t) {
            titleEl.textContent = I18n.t(`movType.${type}`);
        }
        if (w) w.classList.add("active");
        document.body.style.overflow = "hidden";
        this._movementFormMinimized = false;
        this.updateMovementDraftBar();
    },

    _closeMovementFormWindow() {
        const w = document.getElementById("movement-form-window");
        if (w) w.classList.remove("active");
        document.body.style.overflow = "";
    },

    _isMovementFormDraftDirty() {
        const type = this.currentType;
        if (!type || !MOVEMENT_TYPES[type]) return false;
        const proj = document.getElementById("project-id")?.value?.trim() || "";
        const notes = document.getElementById("movement-notes")?.value?.trim() || "";
        if (proj || notes) return true;
        if (this.pendingOrderLineReceipt || this.pendingOrderLineBatchReceipts) return true;
        if (this.editingStandbyId) return true;
        if ((this.selectedItems?.length || 0) > 0) return true;
        if (this.transformationTargetItemId) return true;

        const itemSearch = document.getElementById("item-search")?.value?.trim() || "";
        if (itemSearch.length >= 1) return true;

        const conf = MOVEMENT_TYPES[type];

        const movTfVendor = document.getElementById("mov-transformacion-vendor")?.value?.trim() || "";
        const movTfOut = this._parseQuantityInputValue(document.getElementById("mov-transformacion-output-qty")?.value);
        const movTfSel = document.getElementById("mov-tf-target-selected")?.style?.display !== "none";
        const tfTargetSearch = document.getElementById("mov-tf-target-search")?.value?.trim() || "";
        const movTfNewC = document.getElementById("mov-tf-new-code")?.value?.trim() || "";
        const movTfNewD = document.getElementById("mov-tf-new-desc")?.value?.trim() || "";
        if (
            type === "TRANSFORMACION" &&
            (movTfVendor || movTfSel || tfTargetSearch.length >= 1 || movTfNewC || movTfNewD || movTfOut > 1)
        ) {
            return true;
        }

        const movPo = document.getElementById("mov-compra-po")?.value?.trim() || "";
        const movSlip = document.getElementById("mov-compra-slip")?.value?.trim() || "";
        const movSup = document.getElementById("mov-compra-supplier")?.value?.trim() || "";
        if (conf.specialForm === "compra" && (movPo || movSlip || movSup)) return true;
        if (
            conf.specialForm === "compra" &&
            (this.selectedItems || []).some(
                it => String(it?.compraLinePo || "").trim() || String(it?.compraLineSupplier || "").trim()
            )
        )
            return true;
        if (conf.specialForm === "compra" && document.getElementById("mov-compra-consumible-po")?.value?.trim())
            return true;
        if (conf.specialForm === "compra" && document.getElementById("mov-compra-consumible-supplier")?.value?.trim())
            return true;
        if (
            conf.specialForm === "compra" &&
            document.getElementById("mov-compra-receipt-historical-date")?.value?.trim()
        )
            return true;

        if (conf.specialForm === "compra" && typeof this.isCompraConsumibleReceiptMode === "function") {
            const cons = document.getElementById("mov-compra-consumible-only")?.checked;
            const qRaw = this._parseQuantityInputValue(document.getElementById("mov-compra-consumible-qty")?.value);
            const q = Number.isFinite(qRaw) ? qRaw : 0;
            const nm = String(document.getElementById("mov-compra-consumible-name")?.value || "").trim();
            if (cons || nm || (q > 0 && Math.abs(q - 1) > 1e-9)) return true;
        }

        if (conf.specialForm === "recepcion") {
            const mrp = document.getElementById("mov-rec-po")?.value?.trim() || "";
            const mrs = document.getElementById("mov-rec-supplier")?.value?.trim() || "";
            const mrprov = document.getElementById("mov-rec-provisional")?.checked || false;
            const gp = document.getElementById("mov-rec-glass-packing")?.value?.trim() || "";
            const lines = this._getReceptionDraftLines();
            const hasAnyLineData = lines.some(li =>
                li.itemName ||
                (parseFloat(li.quantity) || 0) > 0 ||
                (parseFloat(li.dimensions?.L) || 0) > 0 ||
                (parseFloat(li.dimensions?.W) || 0) > 0 ||
                (parseFloat(li.dimensions?.H) || 0) > 0
            );
            if (hasAnyLineData || mrp || mrs || mrprov || gp) return true;
            if (document.getElementById("mov-rec-receipt-historical-date")?.value?.trim()) return true;
        }

        if (type === "CONSUMO_DIARIO" && (this.consumoCart?.length || 0) > 0) return true;

        return false;
    },

    updateMovementDraftBar() {
        const wrap = document.getElementById("movement-draft-float-wrap");
        const subtype = document.getElementById("movement-draft-float-subtype");
        if (!wrap || !subtype) return;
        const ct = this.currentType;
        const ok = !!(ct && MOVEMENT_TYPES[ct]);
        wrap.hidden = !(this._movementFormMinimized && ok);
        wrap.classList.toggle("draft-float-bar-wrap--active", !!(this._movementFormMinimized && ok));
        subtype.textContent = this._movementFormMinimized && ok && typeof I18n !== "undefined" && I18n.t ? I18n.t(`movType.${ct}`) : "";
    },

    minimizeMovementFormWindow() {
        if (!this.currentType || !MOVEMENT_TYPES[this.currentType]) return;
        this._movementFormMinimized = true;
        this._closeMovementFormWindow();
        this.updateMovementDraftBar();
    },

    resumeMovementFormWindow() {
        const type = this.currentType;
        if (!type || !MOVEMENT_TYPES[type]) {
            this._movementFormMinimized = false;
            this.updateMovementDraftBar();
            return;
        }
        this._movementFormMinimized = false;
        this.openMovementFormWindow(type);
        this.updateMovementDraftBar();
        if (typeof App !== "undefined" && App.switchTab) {
            App.switchTab("movements");
        }
    },

    promptDiscardMovementForm() {
        this.resetForm();
    },

    selectType(type) {
        if (!MOVEMENT_TYPES[type]) return;
        if (typeof Auth !== "undefined" && Auth.guardMovementTypeProcess && !Auth.guardMovementTypeProcess(type)) return;
        if (this._movementFormMinimized) {
            if (type !== this.currentType) {
                Utils.showToast(I18n.t("movements.draftSwitchBlockedHint"), "info");
            }
            this.resumeMovementFormWindow();
            return;
        }

        const prevType = this.currentType;

        if (prevType === "CONSUMO_DIARIO" && type !== "CONSUMO_DIARIO") {
            this._persistConsumoCartFromForm();
        }

        this.currentType = type;
        if (type === "CONSUMO_DIARIO") {
            this.selectedItems = this._cloneConsumoCartLines();
        } else {
            this.selectedItems = [];
        }

        if (this.pendingOrderLineReceipt && prevType === "COMPRA_STOCK" && type !== "COMPRA_STOCK") {
            this.pendingOrderLineReceipt = null;
        }
        if (this.pendingOrderLineBatchReceipts && prevType === "COMPRA_STOCK" && type !== "COMPRA_STOCK") {
            this.pendingOrderLineBatchReceipts = null;
        }

        document.querySelectorAll('.movement-type-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.type === type);
        });

        const details = document.getElementById('movement-details');
        if (details) details.style.display = 'block';

        const conf = MOVEMENT_TYPES[type];
        const hint = document.getElementById('project-id-hint');
        const input = document.getElementById('project-id');

        const projGroup = document.getElementById('movement-project-group');
        if (projGroup) {
            if (type === 'CONSUMO_DIARIO') {
                projGroup.style.display = 'none';
                if (input) input.value = '';
            } else {
                projGroup.style.display = '';
            }
        }

        if (hint && input) {
            const fmt = I18n.t('hint.projectIdFormat');
            if (conf.projectRequired) {
                hint.textContent = `${I18n.t('hint.required')} · ${fmt}`;
                hint.className = 'field-hint required';
                input.required = true;
            } else if (conf.projectAutoAssign) {
                hint.textContent = `${I18n.t('hint.autoAssign')} · ${fmt}`;
                hint.className = 'field-hint optional';
                input.required = false;
            } else {
                hint.textContent = `${I18n.t('hint.optional')} · ${fmt}`;
                hint.className = 'field-hint optional';
                input.required = false;
            }
        }

        const standbyConfig = document.getElementById('standby-release-config');
        if (standbyConfig) {
            standbyConfig.style.display = type === 'STANDBY' ? 'grid' : 'none';
        }
        if (type === 'STANDBY') {
            this.populateStandbyReleaseTypes();
        }

        const compraBlock = document.getElementById('movement-compra-fields');
        const compraSug = document.getElementById('mov-compra-suggestions-wrap');
        const movConsExtra = document.getElementById("mov-compra-consumible-extra");
        const movConsFields = document.getElementById("mov-compra-consumible-fields");
        if (movConsExtra)
            movConsExtra.style.display = type === "COMPRA_STOCK" ? "flex" : "none";
        if (movConsFields) {
            if (type !== "COMPRA_STOCK") movConsFields.style.display = "none";
            else movConsFields.style.display = document.getElementById("mov-compra-consumible-only")?.checked ? "grid" : "none";
        }
        if (type !== "COMPRA_STOCK") {
            const mcc = document.getElementById("mov-compra-consumible-only");
            if (mcc) mcc.checked = false;
        }
        const recBlock = document.getElementById('movement-recepcion-fields');
        const tfBlock = document.getElementById('movement-transformacion-fields');
        const invLines = document.getElementById('movement-inventory-lines');
        if (compraBlock) compraBlock.style.display = conf.specialForm === 'compra' ? 'grid' : 'none';
        if (compraSug) compraSug.style.display = conf.specialForm === 'compra' ? 'block' : 'none';
        if (recBlock) recBlock.style.display = conf.specialForm === 'recepcion' ? 'block' : 'none';
        if (type !== "COMPRA_STOCK") {
            const hCompra = document.getElementById("mov-compra-receipt-historical-date");
            if (hCompra) hCompra.value = "";
        }
        if (conf.specialForm !== "recepcion") {
            const hRec = document.getElementById("mov-rec-receipt-historical-date");
            if (hRec) hRec.value = "";
        }
        if (tfBlock) tfBlock.style.display = type === 'TRANSFORMACION' ? 'block' : 'none';
        if (invLines) invLines.style.display = conf.specialForm === 'recepcion' ? 'none' : 'block';

        const stdSearchWrap = document.getElementById('mov-standard-item-search-wrap');
        const tfStockTablesWrap = document.getElementById('mov-tf-stock-tables-wrap');
        if (stdSearchWrap) stdSearchWrap.style.display = type === 'TRANSFORMACION' ? 'none' : '';
        if (tfStockTablesWrap) tfStockTablesWrap.style.display = type === 'TRANSFORMACION' ? 'block' : 'none';

        const thTargetCol = document.getElementById('mov-selected-target-col');
        if (thTargetCol && typeof I18n !== 'undefined' && I18n.t) {
            thTargetCol.textContent =
                type === 'TRANSFERENCIA'
                    ? I18n.t('movements.transferColumn')
                    : type === 'TRANSFORMACION'
                      ? I18n.t('movements.transformationInsumoDepotCol')
                      : I18n.t('table.target');
        }

        const thRecipient = document.getElementById('mov-recipient-th');
        if (thRecipient) {
            thRecipient.style.display = type === 'CONSUMO_DIARIO' ? '' : 'none';
        }
        const thBox = document.getElementById('mov-selected-box-th');
        if (thBox) {
            const showSrc = conf.behavior === 'negative' && conf.id !== 'TRANSFERENCIA' && conf.id !== 'TRANSFORMACION';
            thBox.style.display = showSrc ? '' : 'none';
            if (showSrc && typeof I18n !== 'undefined' && I18n.t) {
                thBox.textContent = I18n.t('movements.stockSourceColumn');
            }
        }
        const thCompraPl = document.getElementById('mov-compra-dest-th');
        if (thCompraPl) {
            thCompraPl.style.display = type === 'COMPRA_STOCK' ? '' : 'none';
            if (type === 'COMPRA_STOCK' && typeof I18n !== 'undefined' && I18n.t) {
                thCompraPl.textContent = I18n.t('movCompra.stockPlacement');
            }
        }
        const thCompraLinePo = document.getElementById('mov-compra-line-po-th');
        const thCompraLineSup = document.getElementById('mov-compra-line-supplier-th');
        if (thCompraLinePo) thCompraLinePo.style.display = type === 'COMPRA_STOCK' ? '' : 'none';
        if (thCompraLineSup) thCompraLineSup.style.display = type === 'COMPRA_STOCK' ? '' : 'none';
        if (type === 'COMPRA_STOCK') {
            const dl = document.getElementById('mov-compra-loc-datalist');
            if (dl && typeof Utils !== 'undefined' && Utils.getEffectiveWarehouseLocationSlots) {
                const list = Utils.getEffectiveWarehouseLocationSlots() || [];
                dl.innerHTML = list
                    .map(s => (s ? `<option value="${Utils.escapeAttr(String(s))}"></option>` : ''))
                    .join('');
            }
            if (typeof ConsumableManager !== "undefined") ConsumableManager.refreshDatalists();
        }

        this._syncMovementSearchPlaceholder(type);

        const searchLbl = document.getElementById('mov-item-search-label');
        if (searchLbl && typeof I18n !== 'undefined' && I18n.t && type !== 'TRANSFORMACION') {
            searchLbl.textContent = I18n.t('movements.searchItems');
        }

        const selTitle = document.getElementById('mov-selected-items-title');
        if (selTitle && typeof I18n !== 'undefined' && I18n.t) {
            selTitle.textContent =
                type === 'TRANSFORMACION'
                    ? I18n.t('movements.transformationSelectedItemsTitle')
                    : I18n.t('movements.selectedItems');
        }

        const thQty = document.getElementById('mov-selected-qty-th');
        if (thQty && typeof I18n !== 'undefined' && I18n.t) {
            thQty.textContent = I18n.t('table.quantity');
        }

        if (type === 'TRANSFORMACION') {
            this.resetTransformationTargetForm();
        } else {
            this.transformationTargetItemId = null;
        }

        if (conf.specialForm === 'compra') {
            this.renderMovPurchaseSuggestions();
        }
        if (conf.specialForm === "recepcion") {
            this._ensureReceptionLineRows();
            this.syncMovRecProvisional();
            this.syncMovRecGlassPackingUI();
        }

        if (type === "COMPRA_STOCK" || conf.specialForm === "recepcion") {
            this._setHistoricalReceiptDateInputsMax();
        }

        if (type === "STANDBY") {
            try {
                localStorage.setItem(STORAGE_KEYS.FLOAT_STANDBY_DISMISSED, "0");
            } catch (e) {}
        }
        if (type === "CONSUMO_DIARIO") {
            try {
                localStorage.setItem(STORAGE_KEYS.FLOAT_CONSUMO_DISMISSED, "0");
            } catch (e) {}
        }

        this.renderSelectedItems();
        this.renderStandbyFloat();
        this.renderConsumoCartFloat();
        this.refreshMovementTypeIndicators();
        if (typeof Dashboard !== "undefined" && Dashboard.updatePendingMovementAlerts) {
            Dashboard.updatePendingMovementAlerts();
        }

        if (type === "COMPRA_STOCK" && typeof this._syncCompraConsumibleInventoryVisibility === "function") {
            this._syncCompraConsumibleInventoryVisibility();
        }

        this.openMovementFormWindow(type);

        if (prevType === "CONSUMO_DIARIO" && type !== "CONSUMO_DIARIO") {
            setTimeout(() => this._maybeRunDeferredConsumoAutoClose(), 0);
        }
    },

    populateStandbyReleaseTypes() {
        const select = document.getElementById('standby-release-type');
        if (!select) return;
        const realTypes = Object.keys(MOVEMENT_TYPES).filter(
            t => t !== 'STANDBY' && !MOVEMENT_TYPES[t].specialForm
        );
        select.innerHTML = realTypes
            .map(type => `<option value="${type}">${this._escHtml(I18n.t(`movType.${type}`))}</option>`)
            .join('');
    },

    syncMovRecProvisional() {
        const cat = document.getElementById('mov-rec-category');
        const prov = document.getElementById('mov-rec-provisional');
        if (!cat || !prov) return;
        const req = typeof ReceptionsManager !== 'undefined' && ReceptionsManager.requiresPurchaseOrder
            ? ReceptionsManager.requiresPurchaseOrder(cat.value)
            : false;
        if (req) {
            prov.checked = true;
            prov.disabled = true;
        } else {
            prov.disabled = false;
        }
        this.syncMovRecGlassPackingUI();
    },

    _makeReceptionLineRowHtml() {
        return `
            <div class="mov-rec-line-row">
                <div class="form-row">
                    <div class="form-group">
                        <label data-i18n="reception.item">Artículo / descripción *</label>
                        <input type="text" class="form-input mov-rec-line-item" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label data-i18n="reception.quantity">Cantidad *</label>
                        <input type="number" step="1" min="0" class="form-input mov-rec-line-qty" value="1">
                    </div>
                </div>
                <div class="form-row mov-rec-dimensions-row">
                    <div class="form-group">
                        <label data-i18n="reception.dimL">Largo (L)</label>
                        <input type="number" step="0.0001" min="0" class="form-input mov-rec-line-dim-l" placeholder="0" autocomplete="off" />
                    </div>
                    <div class="form-group">
                        <label data-i18n="reception.dimW">Ancho (W)</label>
                        <input type="number" step="0.0001" min="0" class="form-input mov-rec-line-dim-w" placeholder="0" autocomplete="off" />
                    </div>
                    <div class="form-group">
                        <label data-i18n="reception.dimH">Alto (H)</label>
                        <input type="number" step="0.0001" min="0" class="form-input mov-rec-line-dim-h" placeholder="0" autocomplete="off" />
                    </div>
                </div>
                <div class="mov-rec-line-actions">
                    <button type="button" class="btn btn-secondary btn-sm mov-rec-remove-line-btn" data-i18n="reception.removeLineBtn">Quitar artículo</button>
                </div>
            </div>
        `;
    },

    _ensureReceptionLineRows() {
        const wrap = document.getElementById("mov-rec-lines-wrap");
        if (!wrap) return;
        if (!wrap.querySelector(".mov-rec-line-row")) {
            wrap.innerHTML = this._makeReceptionLineRowHtml();
            if (typeof I18n !== "undefined" && I18n.apply) I18n.apply();
        }
        this._syncReceptionRemoveButtons();
    },

    _addReceptionLineRow(seed = null) {
        const wrap = document.getElementById("mov-rec-lines-wrap");
        if (!wrap) return;
        const tmp = document.createElement("div");
        tmp.innerHTML = this._makeReceptionLineRowHtml().trim();
        const row = tmp.firstElementChild;
        if (!row) return;
        wrap.appendChild(row);
        if (seed) {
            row.querySelector(".mov-rec-line-item").value = seed.itemName || "";
            row.querySelector(".mov-rec-line-qty").value = String(seed.quantity || 1);
            row.querySelector(".mov-rec-line-dim-l").value = seed.dimensions?.L || "";
            row.querySelector(".mov-rec-line-dim-w").value = seed.dimensions?.W || "";
            row.querySelector(".mov-rec-line-dim-h").value = seed.dimensions?.H || "";
        }
        if (typeof I18n !== "undefined" && I18n.apply) I18n.apply();
        this._syncReceptionRemoveButtons();
    },

    _syncReceptionRemoveButtons() {
        const wrap = document.getElementById("mov-rec-lines-wrap");
        if (!wrap) return;
        const rows = wrap.querySelectorAll(".mov-rec-line-row");
        rows.forEach((r, idx) => {
            const btn = r.querySelector(".mov-rec-remove-line-btn");
            if (!btn) return;
            btn.disabled = rows.length <= 1;
            btn.style.visibility = rows.length <= 1 ? "hidden" : "";
            btn.dataset.rowIndex = String(idx);
        });
    },

    _getReceptionDraftLines() {
        const wrap = document.getElementById("mov-rec-lines-wrap");
        if (!wrap) return [];
        return Array.from(wrap.querySelectorAll(".mov-rec-line-row")).map(row => ({
            itemName: String(row.querySelector(".mov-rec-line-item")?.value || "").trim(),
            quantity: Math.max(0, Math.floor(parseFloat(row.querySelector(".mov-rec-line-qty")?.value) || 0)),
            dimensions: {
                L: Math.max(0, parseFloat(row.querySelector(".mov-rec-line-dim-l")?.value) || 0),
                W: Math.max(0, parseFloat(row.querySelector(".mov-rec-line-dim-w")?.value) || 0),
                H: Math.max(0, parseFloat(row.querySelector(".mov-rec-line-dim-h")?.value) || 0)
            }
        }));
    },

    /** Muestra «Caja estándar / Suelto combinar» solo para los tres tipos de vidrio. */
    syncMovRecGlassPackingUI() {
        const wrap = document.getElementById("mov-rec-glass-packing-wrap");
        const sel = document.getElementById("mov-rec-glass-packing");
        const cat = document.getElementById("mov-rec-category");
        if (!wrap || !cat) return;
        const RM = typeof ReceptionsManager !== "undefined" ? ReceptionsManager : null;
        const isGlass = RM && RM.isGlassPackingCategory
            ? RM.isGlassPackingCategory(cat.value)
            : ["VIDRIO_PLANO", "VIDRIO_CURVO", "VIDRIO_PINTADO"].includes(cat.value);
        wrap.style.display = isGlass ? "" : "none";
        if (!isGlass && sel) sel.value = "";
    },

    renderMovPurchaseSuggestions() {
        const div = document.getElementById('mov-purchase-list');
        if (!div) return;
        const arr = (typeof InventoryManager !== 'undefined' && InventoryManager.purchaseList) || [];
        const esc = s => Utils.escapeHtml(s);
        if (!arr.length) {
            div.innerHTML = `<p style="color:var(--text-muted)">${this._escHtml(I18n.t('msg.noPurchaseProducts'))}</p>`;
            return;
        }
        div.innerHTML = arr
            .map(
                p => `
      <div class="purchase-row">
        <strong>${esc(p.code)}</strong> — ${esc(p.description)}
        <small>(${Utils.formatDate(p.date)})</small>
        <span class="status ${esc(p.status)}">${esc(p.status)}</span>
        <div class="purchase-actions">
          <button type="button" class="mov-purchase-action" data-action="recibido" data-code="${esc(p.code)}">✅ ${this._escHtml(I18n.t('config.purchaseMarkReceived'))}</button>
          <button type="button" class="mov-purchase-action" data-action="eliminar" data-code="${esc(p.code)}">🗑 ${this._escHtml(I18n.t('buttons.deleteItem'))}</button>
        </div>
      </div>`
            )
            .join('');
    },

    getDefaultTarget(type) {
        const conf = MOVEMENT_TYPES[type];
        if (!conf) return 'main';
        if (conf.target === 'production') return 'production';
        if (conf.target === 'transformation') return 'transformation';
        return 'main';
    },

    /** Insumos de Transformación: solo artículos con stock en transformación o producción. */
    _itemEligibleForTransformationInsumo(item) {
        if (!item) return false;
        const t = parseFloat(item.transStock) || 0;
        const p = parseFloat(item.prodStock) || 0;
        return t > 0 || p > 0;
    },

    /**
     * Insumo de transformación elegido desde la tabla de stock (clic o teclado).
     * @param {'transformation'|'production'} depot
     */
    pickTransformationInsumo(itemId, depot) {
        if (this.currentType !== 'TRANSFORMACION') return;
        const item = InventoryManager.items.find(i => String(i.id) === String(itemId));
        if (!item) return;
        if (item.inventoryConsumable) {
            Utils.showToast(I18n.t("msg.inventoryConsumableNoMovement"), "warning");
            return;
        }
        const stock =
            depot === 'production'
                ? parseFloat(item.prodStock) || 0
                : parseFloat(item.transStock) || 0;
        if (stock <= 0) {
            Utils.showToast(I18n.t('msg.transformationInsumoNoStock'), 'error');
            return;
        }
        const target = depot === 'production' ? 'production' : 'transformation';
        const exists = this.selectedItems.find(i => i.itemId === item.id && i.target === target);
        if (exists) {
            Utils.showToast(I18n.t('msg.itemAlreadyAdded'), 'warning');
            return;
        }
        this.selectedItems.unshift({
            itemId: item.id,
            code: item.code,
            description: item.description,
            quantity: -1,
            target,
            location: item.location || ''
        });
        this.renderSelectedItems();
    },

    renderTransformationStockTables() {
        if (this.currentType !== 'TRANSFORMACION' || typeof InventoryManager === 'undefined') return;
        const transBody = document.getElementById('mov-tf-stock-trans-body');
        const prodBody = document.getElementById('mov-tf-stock-prod-body');
        const emptyT = document.getElementById('mov-tf-stock-trans-empty');
        const emptyP = document.getElementById('mov-tf-stock-prod-empty');
        if (!transBody || !prodBody) return;

        const esc = s => Utils.escapeHtml(s);
        const escA = s => Utils.escapeAttr(s);

        const items = InventoryManager.items || [];
        const transItems = items
            .filter(i => (parseFloat(i.transStock) || 0) > 0)
            .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { sensitivity: 'base' }));
        const prodItems = items
            .filter(i => (parseFloat(i.prodStock) || 0) > 0)
            .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { sensitivity: 'base' }));

        const isSelected = (id, depot) =>
            this.selectedItems.some(
                si =>
                    String(si.itemId) === String(id) &&
                    si.target === (depot === 'production' ? 'production' : 'transformation')
            );

        const rowHtml = (item, depot, qtyVal) => {
            const sel = isSelected(item.id, depot) ? ' mov-tf-stock-row--selected' : '';
            const qv = typeof qtyVal === 'number' ? qtyVal : parseFloat(qtyVal) || 0;
            const q = Utils.formatDecimalDisplay(qv);
            const title = esc(I18n.t('movements.transformationStockRowTitle'));
            return `<tr class="mov-tf-stock-row${sel}" data-item-id="${escA(String(item.id))}" data-depot="${depot}" role="button" tabindex="0" title="${title}">
                <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                <td class="app-desc-copy-cell">${esc(item.description)}</td>
                <td>${esc(q)}</td>
            </tr>`;
        };

        transBody.innerHTML = transItems.map(i => rowHtml(i, 'transformation', parseFloat(i.transStock) || 0)).join('');
        prodBody.innerHTML = prodItems.map(i => rowHtml(i, 'production', parseFloat(i.prodStock) || 0)).join('');

        if (emptyT) emptyT.style.display = transItems.length ? 'none' : 'block';
        if (emptyP) emptyP.style.display = prodItems.length ? 'none' : 'block';
    },

    _syncMovementSearchPlaceholder(type) {
        const is = document.getElementById('item-search');
        if (!is || typeof I18n === 'undefined' || !I18n.t) return;
        if (type === 'TRANSFORMACION') {
            is.setAttribute('placeholder', I18n.t('movements.transformationInsumoSearchPh'));
        } else {
            is.setAttribute('placeholder', I18n.t('movements.searchPlaceholder'));
        }
    },

    getTransformationTargetMode() {
        const r = document.querySelector('input[name="mov-tf-target-mode"]:checked');
        return r && r.value === 'new' ? 'new' : 'existing';
    },

    toggleTransformationTargetMode() {
        const mode = this.getTransformationTargetMode();
        const ex = document.getElementById('mov-tf-target-existing-wrap');
        const nw = document.getElementById('mov-tf-target-new-wrap');
        if (ex) ex.style.display = mode === 'existing' ? 'block' : 'none';
        if (nw) nw.style.display = mode === 'new' ? 'block' : 'none';
        if (mode === 'new') {
            this.transformationTargetItemId = null;
            this.renderTransformationTargetSelected();
        }
    },

    resetTransformationTargetForm() {
        this.transformationTargetItemId = null;
        const r = document.querySelector('input[name="mov-tf-target-mode"][value="existing"]');
        if (r) r.checked = true;
        const s = document.getElementById('mov-tf-target-search');
        if (s) s.value = '';
        const res = document.getElementById('mov-tf-target-results');
        if (res) {
            res.innerHTML = '';
            res.classList.remove('active');
        }
        const c = document.getElementById('mov-tf-new-code');
        const d = document.getElementById('mov-tf-new-desc');
        const cat = document.getElementById('mov-tf-new-category');
        if (c) c.value = '';
        if (d) d.value = '';
        if (cat) cat.value = '';
        const outQty = document.getElementById('mov-transformacion-output-qty');
        if (outQty) outQty.value = '1';
        this.renderTransformationTargetSelected();
        this.toggleTransformationTargetMode();
    },

    setTransformationTargetFromItem(item) {
        if (!item || !item.id) return;
        if (item.inventoryConsumable) {
            Utils.showToast(I18n.t("msg.inventoryConsumableNoTransformationTarget"), "warning");
            return;
        }
        this.transformationTargetItemId = item.id;
        const s = document.getElementById('mov-tf-target-search');
        if (s) s.value = '';
        const res = document.getElementById('mov-tf-target-results');
        if (res) {
            res.innerHTML = '';
            res.classList.remove('active');
        }
        this.renderTransformationTargetSelected();
    },

    clearTransformationTarget() {
        this.transformationTargetItemId = null;
        this.renderTransformationTargetSelected();
    },

    renderTransformationTargetSelected() {
        const wrap = document.getElementById('mov-tf-target-selected');
        if (!wrap) return;
        const id = this.transformationTargetItemId;
        if (!id) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        const item = InventoryManager.items.find(i => i.id === id);
        if (!item) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        wrap.style.display = 'flex';
        const esc = s => Utils.escapeHtml(s);
        wrap.innerHTML = `
            <span><strong>${esc(item.code)}</strong> — ${esc(item.description)}</span>
            <button type="button" class="btn btn-sm btn-secondary mov-tf-clear-btn" onclick="MovementManager.clearTransformationTarget()">${esc(
                I18n.t('movements.transformationTargetClear')
            )}</button>
        `;
    },

    addItem(item) {
        if (!item || !this.currentType) return;
        // En COMPRA_STOCK, al agregar otra línea se re-renderiza la tabla.
        // Sincronizamos primero inputs visibles (cantidades + fechas de lote)
        // para no perder lo escrito en filas previas.
        if (this.currentType === "COMPRA_STOCK") {
            this.syncSelectedItemQuantitiesFromDom();
        }
        if (item.inventoryConsumable && this.currentType !== "COMPRA_STOCK") {
            Utils.showToast(I18n.t("msg.inventoryConsumableNoMovement"), "warning");
            return;
        }

        const conf = MOVEMENT_TYPES[this.currentType];
        const allowDuplicateSku =
            this.currentType === 'COMPRA_STOCK' ||
            this.currentType === 'TRANSFERENCIA' ||
            this.currentType === 'TRANSFORMACION' ||
            this.currentType === 'CONSUMO_DIARIO' ||
            conf.behavior === 'negative';
        const allowDupCompraOrdersBatch =
            this.currentType === "COMPRA_STOCK" && !!this._compraBatchFromOrdersBuilding;
        if (!allowDuplicateSku && !allowDupCompraOrdersBatch) {
            const exists = this.selectedItems.find(i => String(i.itemId ?? "") === String(item.id ?? ""));
            if (exists) {
                Utils.showToast(I18n.t('msg.itemAlreadyAdded'), 'warning');
                return;
            }
        }

        const target = this.getDefaultTarget(this.currentType);
        
        let qty = 0;

        if (this.currentType === 'TRANSFERENCIA') {
            qty = 0;
            const transferDefaults = this._getPreferredTransferEndpoints(item.id);
            this.selectedItems.unshift({
                itemId: item.id,
                code: item.code,
                description: item.description,
                quantity: qty,
                transferFrom: transferDefaults.from,
                transferTo: transferDefaults.to,
                transferFromBoxId: '',
                transferToBoxId: '',
                target: 'main',
                location: item.location || ''
            });
        } else if (this._isMainToProductionMovement(this.currentType)) {
            qty = 0;
            this.selectedItems.unshift({
                itemId: item.id,
                code: item.code,
                description: item.description,
                quantity: qty,
                transferFrom: 'main',
                transferTo: 'production',
                target: 'production',
                location: item.location || ''
            });
        } else if (this.currentType === 'TRANSFORMACION') {
            if (!this._itemEligibleForTransformationInsumo(item)) {
                Utils.showToast(I18n.t('msg.transformationInsumoNoStock'), 'error');
                return;
            }
            const trans = parseFloat(item.transStock) || 0;
            const prod = parseFloat(item.prodStock) || 0;
            const defaultTarget = trans > 0 ? 'transformation' : 'production';
            const dup = this.selectedItems.find(
                i => i.itemId === item.id && i.target === defaultTarget
            );
            if (dup) {
                Utils.showToast(I18n.t('msg.itemAlreadyAdded'), 'warning');
                return;
            }
            this.selectedItems.unshift({
                itemId: item.id,
                code: item.code,
                description: item.description,
                quantity: 0,
                target: defaultTarget,
                location: item.location || ''
            });
        } else {
            const base = {
                itemId: item.id,
                code: item.code,
                description: item.description,
                quantity: qty,
                target: target,
                location: item.location || '',
                stockSourceId: '',
                boxId: '',
                locationStockKey: ''
            };
            if (this.currentType === 'CONSUMO_DIARIO') {
                base.recipientName = '';
                base.consumoAddedAt = new Date().toISOString();
            }
            if (this.currentType === 'COMPRA_STOCK') {
                base.compraPlace = { kind: 'main' };
                base.compraLotExpiry = '';
                base.compraLotExpedition = '';
                base.compraLinePo = '';
                base.compraLineSupplier = '';
            }
            this.selectedItems.unshift(base);
            if (this._movementTypeStockSourceDestMirror()) {
                this._syncFerreteriaMermaTargetFromSource(this.selectedItems[0]);
            }
        }

        this.renderSelectedItems();
        
        // Limpiar búsqueda
        const searchInput = document.getElementById('item-search');
        const searchResults = document.getElementById('item-search-results');
        if (searchInput) searchInput.value = '';
        if (searchResults) searchResults.classList.remove('active');
    },

    /**
     * Lee los `<input class="quantity-input">` de la tabla de líneas y actualiza `selectedItems`
     * antes de procesar el movimiento. Evita que quede la cantidad antigua (p. ej. 1) si el usuario
     * escribió otra (p. ej. 200) y pulsó Procesar sin disparar `change` en el input.
     */
    syncSelectedItemQuantitiesFromDom() {
        if (!this.currentType || !this.selectedItems?.length) return;
        const conf = MOVEMENT_TYPES[this.currentType];
        if (conf?.specialForm === "recepcion") return;
        if (this.currentType === "COMPRA_STOCK" && this.isCompraConsumibleReceiptMode()) return;
        if (this.currentType === "CONSUMO_DIARIO") this._syncConsumoRecipientsFromDom();
        if (this.currentType === "COMPRA_STOCK" && !this.isCompraConsumibleReceiptMode()) {
            this._pullCompraPurchaseFieldsFromDom();
        }
        const inputs = document.querySelectorAll("#selected-items-body tr .quantity-input");
        if (!inputs.length) return;
        const n = Math.min(inputs.length, this.selectedItems.length);
        for (let i = 0; i < n; i++) {
            const item = this.selectedItems[i];
            if (!item) continue;
            const raw = inputs[i].value;
            if (this.currentType === "TRANSFERENCIA") {
                item.quantity = Utils.roundDecimal(Math.abs(this._parseQuantityInputValue(raw)));
                const row = document.querySelectorAll("#selected-items-body tr")[i];
                const fromSel = row ? row.querySelector('.transfer-depot-cell .target-select[data-transfer-role="from"]') : null;
                const toSel = row ? row.querySelector('.transfer-depot-cell .target-select[data-transfer-role="to"]') : null;
                const sels = row ? row.querySelectorAll(".transfer-depot-cell .target-select") : [];
                if ((fromSel && toSel) || (sels && sels.length >= 2)) {
                    const fromRaw = String((fromSel ? fromSel.value : sels[0].value) || "").trim();
                    const toRaw = String((toSel ? toSel.value : sels[1].value) || "").trim();
                    const pf = this._parseTransferSelectValue(fromRaw);
                    const pt = this._parseTransferSelectValue(toRaw);
                    item.transferFrom = pf.depot;
                    item.transferFromBoxId = pf.boxId;
                    item.transferTo = pt.depot;
                    item.transferToBoxId = pt.boxId;
                    this._transferDraftFrom = item.transferFrom;
                    this._transferDraftTo = item.transferTo;
                }
            } else {
                let qty = this._parseQuantityInputValue(raw);
                if (conf.behavior === "negative") qty = -Math.abs(qty);
                else if (conf.behavior === "positive") qty = Math.abs(qty);
                item.quantity = Utils.roundDecimal(qty);
            }
        }
        this.renderSelectedItems();
    },

    _parseQuantityInputValue(raw) {
        if (raw == null || raw === "") return 0;
        if (typeof raw === "number" && Number.isFinite(raw)) return raw;
        let s = String(raw).trim().replace(/\s+/g, "");
        if (!s) return 0;

        const sign = s.startsWith("-") ? -1 : 1;
        if (s.startsWith("+") || s.startsWith("-")) s = s.slice(1);
        if (!s) return 0;

        if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
            s = s.replace(/\./g, "");
        } else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
            s = s.replace(/,/g, "");
        } else {
            const hasComma = s.includes(",");
            const hasDot = s.includes(".");
            if (hasComma && !hasDot) s = s.replace(",", ".");
            else if (hasComma && hasDot) {
                const lastComma = s.lastIndexOf(",");
                const lastDot = s.lastIndexOf(".");
                if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
                else s = s.replace(/,/g, "");
            }
        }

        const v = parseFloat(s);
        return Number.isFinite(v) ? sign * v : 0;
    },

    updateItemQuantity(index, value) {
        if (index < 0 || index >= this.selectedItems.length || !this.currentType) return;
        if (this.currentType === "CONSUMO_DIARIO") this._syncConsumoRecipientsFromDom();

        const conf = MOVEMENT_TYPES[this.currentType];
        if (this.currentType === 'TRANSFERENCIA') {
            const qty = Utils.roundDecimal(Math.abs(this._parseQuantityInputValue(value)));
            this.selectedItems[index].quantity = qty;
            this.renderSelectedItems();
            return;
        }

        let qty = this._parseQuantityInputValue(value);

        // Aplicar comportamiento según tipo
        if (conf.behavior === 'negative') {
            qty = -Math.abs(qty);
        } else if (conf.behavior === 'positive') {
            qty = Math.abs(qty);
        }

        qty = Utils.roundDecimal(qty);
        this.selectedItems[index].quantity = qty;
        this.renderSelectedItems();
    },

    _renderQuantityInputWithCalc(index, value, opts = {}) {
        const min =
            Object.prototype.hasOwnProperty.call(opts, "min") && opts.min !== null && opts.min !== undefined
                ? String(opts.min)
                : null;
        const step = opts.step != null ? String(opts.step) : "any";
        const v = value != null && value !== "" ? String(value) : "";
        const calcTitle = this._escHtml(I18n.t("movements.qtyCalcBtn"));
        const minAttr = min != null ? ` min="${this._escAttr(min)}"` : "";
        return `<div class="mov-qty-input-wrap">
          <input type="number" class="quantity-input"
                 value="${this._escAttr(v)}"${minAttr} step="${this._escAttr(step)}"
                 data-index="${index}" onchange="MovementManager.updateItemQuantity(${index}, this.value)">
          <button type="button" class="btn btn-sm btn-secondary mov-qty-calc-btn"
                  data-calc-index="${index}" onclick="MovementManager.openQuantityCalculator(${index}); return false;"
                  title="${calcTitle}" aria-label="${calcTitle}">🧮</button>
        </div>`;
    },

    /** Para tipos "any" (AJUSTE), el input conserva signo; el resto trabaja en magnitud positiva. */
    _movementQtyInputUi(item, conf) {
        const raw = parseFloat(item?.quantity);
        const signed = Number.isFinite(raw) ? Utils.roundDecimal(raw) : 0;
        if (conf && conf.behavior === "any") {
            return { value: Math.abs(signed) > 0 ? signed : "", min: null };
        }
        const absV = Utils.roundDecimal(Math.abs(signed));
        return { value: absV > 0 ? absV : "", min: 0 };
    },

    _evaluateQuantityExpression(raw) {
        const txt = String(raw || "")
            .replace(/×/g, "*")
            .replace(/÷/g, "/")
            .replace(/,/g, ".")
            .trim();
        if (!txt) return null;
        if (!/^[0-9+\-*/().\s]+$/.test(txt)) return null;
        const compact = txt.replace(/\s+/g, "");
        const tokens = compact.match(/\d*\.?\d+|[()+\-*/]/g);
        if (!tokens || tokens.join("") !== compact) return null;
        const out = [];
        const ops = [];
        const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
        const isOp = t => t === "+" || t === "-" || t === "*" || t === "/";

        let prev = null;
        for (const t of tokens) {
            const isNum = /^\d*\.?\d+$/.test(t);
            if (isNum) {
                out.push(parseFloat(t));
                prev = "num";
                continue;
            }
            if (t === "(") {
                ops.push(t);
                prev = "(";
                continue;
            }
            if (t === ")") {
                while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop());
                if (!ops.length) return null;
                ops.pop();
                prev = ")";
                continue;
            }
            if (isOp(t)) {
                // Soporte para operador unario (ej: -5, 2*(-3))
                if (t === "-" && (prev == null || prev === "(" || prev === "op")) {
                    out.push(0);
                } else if (prev == null || prev === "(" || prev === "op") {
                    return null;
                }
                while (ops.length && isOp(ops[ops.length - 1]) && prec[ops[ops.length - 1]] >= prec[t]) {
                    out.push(ops.pop());
                }
                ops.push(t);
                prev = "op";
                continue;
            }
            return null;
        }
        while (ops.length) {
            const top = ops.pop();
            if (top === "(" || top === ")") return null;
            out.push(top);
        }

        const st = [];
        for (const tk of out) {
            if (typeof tk === "number") {
                st.push(tk);
                continue;
            }
            if (st.length < 2) return null;
            const b = st.pop();
            const a = st.pop();
            let r = 0;
            if (tk === "+") r = a + b;
            else if (tk === "-") r = a - b;
            else if (tk === "*") r = a * b;
            else if (tk === "/") {
                if (Math.abs(b) < 1e-12) return null;
                r = a / b;
            } else return null;
            if (!Number.isFinite(r)) return null;
            st.push(r);
        }
        if (st.length !== 1 || !Number.isFinite(st[0])) return null;
        return Utils.roundDecimal(st[0]);
    },

    async openQuantityCalculator(index) {
        if (!Number.isFinite(index) || index < 0 || index >= this.selectedItems.length) return;
        const promptMsg = I18n.t("movements.qtyCalcPrompt");
        const currentAbs = Math.abs(parseFloat(this.selectedItems[index]?.quantity) || 0);
        let raw = null;
        if (typeof App !== "undefined" && App.showPrompt) {
            raw = await App.showPrompt({
                message: promptMsg,
                defaultValue: currentAbs > 0 ? String(currentAbs) : "",
                inputType: "text"
            });
        } else {
            raw = window.prompt(promptMsg, currentAbs > 0 ? String(currentAbs) : "");
        }
        if (raw == null) return;
        const val = this._evaluateQuantityExpression(raw);
        if (val == null) {
            Utils.showToast(I18n.t("movements.qtyCalcInvalid"), "warning");
            return;
        }
        this.updateItemQuantity(index, String(val));
    },

    updateItemTarget(index, target) {
        if (index < 0 || index >= this.selectedItems.length) return;
        if (this.currentType === 'TRANSFORMACION' && target !== 'transformation' && target !== 'production') {
            return;
        }
        const t = target || 'main';
        const it = this.selectedItems[index];
        it.target = t;
        this.renderSelectedItems();
    },

    updateCompraPlaceKind(index, kind) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== 'COMPRA_STOCK') return;
        const k = String(kind || 'main');
        if (k === 'box') {
            this.selectedItems[index].compraPlace = { kind: 'box', boxNumber: '' };
        } else if (k === 'location') {
            this.selectedItems[index].compraPlace = { kind: 'location', locationKey: '' };
        } else {
            this.selectedItems[index].compraPlace = { kind: 'main' };
        }
        this.renderSelectedItems();
    },

    updateCompraPlaceBoxNumber(index, value) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== 'COMPRA_STOCK') return;
        const n = parseInt(String(value), 10);
        if (!this.selectedItems[index].compraPlace) this.selectedItems[index].compraPlace = { kind: 'box' };
        this.selectedItems[index].compraPlace.kind = 'box';
        this.selectedItems[index].compraPlace.boxNumber = Number.isFinite(n) ? n : '';
        this.renderSelectedItems();
    },

    updateCompraPlaceLocationKey(index, value) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== 'COMPRA_STOCK') return;
        if (!this.selectedItems[index].compraPlace) this.selectedItems[index].compraPlace = { kind: 'location' };
        this.selectedItems[index].compraPlace.kind = 'location';
        this.selectedItems[index].compraPlace.locationKey = String(value || '').trim();
        this.renderSelectedItems();
    },

    updateCompraLotDates(index) {
        if (index < 0 || index >= this.selectedItems.length || this.currentType !== 'COMPRA_STOCK') return;
        const rows = document.querySelectorAll("#selected-items-body tr");
        const row = rows[index];
        const it = this.selectedItems[index];
        if (!row || !it) return;
        const e1 = row.querySelector(".mov-compra-lot-expiry");
        const e2 = row.querySelector(".mov-compra-lot-expedition");
        it.compraLotExpiry = e1 && e1.value ? e1.value : "";
        it.compraLotExpedition = e2 && e2.value ? e2.value : "";
    },

    _lineSupportsStockSourceSelect(item, conf) {
        if (!item || !conf) return false;
        if (conf.id === 'TRANSFERENCIA' || conf.id === 'TRANSFORMACION') return false;
        if (conf.specialForm === 'recepcion' || conf.specialForm === 'compra') return false;
        if (conf.behavior !== 'negative') return false;
        return true;
    },

    /** Ferretería, Merma, consumo diario, M.E. producción, M.E. obra: destino de línea = origen de stock. */
    _movementTypeStockSourceDestMirror() {
        const t = this.currentType;
        return (
            t === "FERRETERIA" ||
            t === "MERMA" ||
            t === "CONSUMO_DIARIO" ||
            t === "MAT_ELEC_PROD" ||
            t === "MAT_ELEC_OBRA"
        );
    },

    /** Valor del `<select>` de origen: incluye depot:production / depot:transformation acorde a `target`. */
    _movementStockSourceSelectValue(item) {
        if (!item) return "";
        const sid = this._getLineStockSourceId(item);
        if (sid) return sid;
        const t = item.target || "main";
        if (t === "production") return "depot:production";
        if (t === "transformation") return "depot:transformation";
        return "";
    },

    /** Identificador unificado de origen: "", "depot:production", "depot:transformation", "box:id", "loc:encodedLocation" */
    _getLineStockSourceId(item) {
        if (!item) return '';
        if (item.stockSourceId) return String(item.stockSourceId).trim();
        if (item.boxId) return `box:${item.boxId}`;
        if (item.locationStockKey) return `loc:${encodeURIComponent(item.locationStockKey)}`;
        return '';
    },

    /**
     * Depósito donde aplicar updateStock para esta línea (cantidad firmada).
     * El origen explícito depot:* tiene prioridad sobre la columna «Destino» (multiTarget).
     * Cajas/ubicaciones cuentan sobre stock principal.
     */
    _resolveStockTargetForLine(item) {
        if (!item) return 'main';
        const sid = String(item.stockSourceId || '').trim();
        if (sid === 'depot:production') return 'production';
        if (sid === 'depot:transformation') return 'transformation';
        if (sid.startsWith('box:') || sid.startsWith('ibox:') || sid.startsWith('loc:')) return 'main';
        return item.target || 'main';
    },

    /**
     * Ferretería, Merma, consumo diario, M.E. producción y M.E. obra: `target` sigue al origen de stock
     * (sin forzar un destino distinto en la columna «Destino»).
     */
    _syncFerreteriaMermaTargetFromSource(item) {
        if (!item || !this._movementTypeStockSourceDestMirror()) return;
        const sid = String(item.stockSourceId || "").trim();
        if (sid === "depot:production") item.target = "production";
        else if (sid === "depot:transformation") item.target = "transformation";
        else item.target = "main";
    },

    /**
     * Stock disponible en el origen elegido (principal restante, producción, caja, ubicación inferida)
     * para la columna actual → nuevo en ferretería / merma y vista coherente con el sobregiro.
     */
    _getLineStockSnapshotForPreview(item) {
        if (!item || !item.itemId || typeof InventoryManager === "undefined") return 0;
        const sid = this._getLineStockSourceId(item);
        if (sid === "depot:production") return parseFloat(InventoryManager.getStock(item.itemId, "production")) || 0;
        if (sid === "depot:transformation") return parseFloat(InventoryManager.getStock(item.itemId, "transformation")) || 0;
        if (sid.startsWith("box:")) {
            const bid = sid.slice(4);
            return typeof InventoryManager.getBoxStockQtyForMovement === "function"
                ? InventoryManager.getBoxStockQtyForMovement(item.itemId, bid, item.boxNumber) || 0
                : 0;
        }
        if (sid.startsWith("ibox:")) {
            const n = parseInt(sid.slice(5), 10);
            return typeof InventoryManager.getMovementInferredBoxAvailableQty === "function"
                ? InventoryManager.getMovementInferredBoxAvailableQty(item.itemId, n) || 0
                : 0;
        }
        if (sid.startsWith("loc:")) {
            let raw = "";
            try {
                raw = decodeURIComponent(sid.slice(4));
            } catch (e) {
                raw = "";
            }
            return typeof InventoryManager.getMovementLocationAvailableQty === "function"
                ? InventoryManager.getMovementLocationAvailableQty(item.itemId, raw) || 0
                : 0;
        }
        return parseFloat(InventoryManager.getStock(item.itemId, "main")) || 0;
    },

    /** Etiqueta de destino = mismo origen de stock (tipos con espejo origen→destino). */
    _formatStockSourceAsDestLabel(item) {
        if (!item) return "—";
        const sid = this._getLineStockSourceId(item);
        if (sid === "depot:production") return I18n.t("target.production");
        if (sid === "depot:transformation") return I18n.t("target.transformation");
        if (sid.startsWith("box:")) {
            const bid = sid.slice(4);
            const boxes = InventoryManager.getItemBoxStocks(item.itemId) || [];
            const b = boxes.find(x => String(x.boxId) === String(bid));
            const n = b && Number.isFinite(Number(b.boxNumber)) ? Number(b.boxNumber) : item.boxNumber ?? "?";
            const qDisp = b ? Utils.formatDecimalDisplay(parseFloat(b.qty) || 0) : "";
            return I18n.t("inventory.boxOptionWithQty")
                .replace("{n}", String(n))
                .replace("{q}", qDisp);
        }
        if (sid.startsWith("ibox:")) {
            const num = sid.slice(5);
            const qInf =
                typeof InventoryManager.getMovementInferredBoxAvailableQty === "function"
                    ? InventoryManager.getMovementInferredBoxAvailableQty(item.itemId, parseInt(num, 10)) || 0
                    : 0;
            return I18n.t("inventory.boxOptionWithQty")
                .replace("{n}", String(num))
                .replace("{q}", Utils.formatDecimalDisplay(qInf));
        }
        if (sid.startsWith("loc:")) {
            try {
                return decodeURIComponent(sid.slice(4));
            } catch (e) {
                return "—";
            }
        }
        return I18n.t("target.main");
    },

    _validateQuantitiesNonZero(items) {
        for (const it of items || []) {
            const q = Math.abs(parseFloat(it.quantity) || 0);
            if (q <= 1e-12) {
                Utils.showToast(I18n.t("msg.movementQtyZeroForbidden"), "error");
                return false;
            }
        }
        return true;
    },

    _validateCartHasNoZeroQuantities() {
        const type = this.currentType;
        const conf = type && MOVEMENT_TYPES[type];
        if (!conf) return true;
        if (conf.specialForm === "recepcion") return true;
        if (type === "COMPRA_STOCK" && this.isCompraConsumibleReceiptMode()) return true;
        return this._validateQuantitiesNonZero(this.selectedItems);
    },

    _validateStockSourcesAvailability(items) {
        const list = Array.isArray(items) ? items : [];
        for (const it of list) {
            if (!it || !it.itemId) continue;
            const qty = Math.abs(parseFloat(it.quantity) || 0);
            if (qty <= 0) continue;
            const tgt = this._resolveStockTargetForLine(it);
            if (tgt !== "main" || (parseFloat(it.quantity) || 0) >= 0) continue;
            const src = this._getLineStockSourceId(it);
            if (!src || src === "main") continue;
            if (src.startsWith("box:")) {
                const boxId = src.slice(4);
                if (!boxId) {
                    Utils.showToast(I18n.t("msg.stockSourceUnavailable"), "error");
                    return false;
                }
            } else if (src.startsWith("ibox:")) {
                const n = parseInt(src.slice(5), 10);
                if (!Number.isFinite(n) || n < 1) {
                    Utils.showToast(I18n.t("msg.stockSourceUnavailable"), "error");
                    return false;
                }
            } else if (src.startsWith("loc:")) {
                let raw = "";
                try {
                    raw = decodeURIComponent(src.slice(4));
                } catch (e) {
                    raw = "";
                }
                if (!String(raw || "").trim()) {
                    Utils.showToast(I18n.t("msg.stockSourceUnavailable"), "error");
                    return false;
                }
            }
        }
        return true;
    },

    _getDefaultTransferEndpoints(itemId) {
        const stock = {
            main:
                itemId && typeof InventoryManager !== 'undefined' && InventoryManager.getStock
                    ? parseFloat(InventoryManager.getStock(itemId, 'main')) || 0
                    : 0,
            production:
                itemId && typeof InventoryManager !== 'undefined' && InventoryManager.getStock
                    ? parseFloat(InventoryManager.getStock(itemId, 'production')) || 0
                    : 0,
            transformation:
                itemId && typeof InventoryManager !== 'undefined' && InventoryManager.getStock
                    ? parseFloat(InventoryManager.getStock(itemId, 'transformation')) || 0
                    : 0
        };

        // Prefer transfers between plant depots; avoid forcing "main" when not needed.
        if (stock.transformation > 0) return { from: 'transformation', to: 'production' };
        if (stock.production > 0) return { from: 'production', to: 'transformation' };
        if (stock.main > 0) return { from: 'main', to: 'production' };
        return { from: 'transformation', to: 'production' };
    },

    _isMainToProductionMovement(type) {
        return String(type || '').toUpperCase() === 'ENVIAR_PRODUCCION';
    },

    _normalizeTransferDepot(value) {
        const v = String(value || '').trim();
        return v === 'main' || v === 'production' || v === 'transformation' ? v : '';
    },

    /** Valor del `<select>` de transferencia: depósito o `box:<boxId>` (caja del principal). */
    _parseTransferSelectValue(raw) {
        const s = String(raw || '').trim();
        if (s.startsWith('box:')) {
            return { depot: 'main', boxId: s.slice(4) };
        }
        const d = this._normalizeTransferDepot(s);
        return { depot: d || 'main', boxId: '' };
    },

    _buildTransferEndpointOptionsHtml(itemId, selectedDepot, selectedBoxId) {
        if (typeof InventoryManager === 'undefined' || !itemId) return '';
        const esc = s => this._escHtml(s);
        const fmt = v => Utils.formatDecimalDisplay(v);
        const selDep = String(selectedDepot || 'main');
        const selBox = String(selectedBoxId || '').trim();
        const parts = [];
        const mainQ = InventoryManager.getTransferenciaEndpointQty(itemId, 'main', '');
        const prodQ = InventoryManager.getTransferenciaEndpointQty(itemId, 'production', '');
        const transQ = InventoryManager.getTransferenciaEndpointQty(itemId, 'transformation', '');
        const mSel = selDep === 'main' && !selBox;
        const pSel = selDep === 'production' && !selBox;
        const tSel = selDep === 'transformation' && !selBox;
        parts.push(
            `<option value="main" ${mSel ? 'selected' : ''}>${esc(I18n.t('target.main'))} · ${esc(fmt(mainQ))}</option>`
        );
        parts.push(
            `<option value="production" ${pSel ? 'selected' : ''}>${esc(
                I18n.t('target.production')
            )} · ${esc(fmt(prodQ))}</option>`
        );
        parts.push(
            `<option value="transformation" ${tSel ? 'selected' : ''}>${esc(
                I18n.t('target.transformation')
            )} · ${esc(fmt(transQ))}</option>`
        );
        const boxes = InventoryManager.getItemBoxStocks(itemId) || [];
        for (const b of boxes) {
            const qBox = Math.max(0, parseFloat(b.qty) || 0);
            if (qBox <= 0) continue;
            const v = `box:${b.boxId}`;
            const bSel = selDep === 'main' && String(selBox) === String(b.boxId);
            const label = I18n.t('inventory.boxOptionWithQty')
                .replace('{n}', String(b.boxNumber))
                .replace('{q}', fmt(qBox));
            parts.push(`<option value="${Utils.escapeAttr(v)}" ${bSel ? 'selected' : ''}>${esc(label)}</option>`);
        }
        return parts.join('');
    },

    _getPreferredTransferEndpoints(itemId) {
        const fromDraft = this._normalizeTransferDepot(this._transferDraftFrom);
        const toDraft = this._normalizeTransferDepot(this._transferDraftTo);
        if (fromDraft && toDraft && fromDraft !== toDraft) {
            return { from: fromDraft, to: toDraft };
        }
        return this._getDefaultTransferEndpoints(itemId);
    },

    _renderMovementStockSourceCell(item, index, conf) {
        const thBox = document.getElementById('mov-selected-box-th');
        if (!thBox || thBox.style.display === 'none') return '';
        if (!this._lineSupportsStockSourceSelect(item, conf)) return `<td class="mov-box-cell">—</td>`;
        const sel = this._movementStockSourceSelectValue(item);
        const html =
            typeof InventoryManager !== 'undefined' && InventoryManager.buildStockSourceOptionsHtmlForMovement
                ? InventoryManager.buildStockSourceOptionsHtmlForMovement(item.itemId, sel, {
                      onlyOriginsWithStock:
                          this.currentType === 'CONSUMO_DIARIO' || this.currentType === 'MERMA'
                  })
                : '<option value="">—</option>';
        return `<td class="mov-box-cell"><select class="target-select mov-stock-source-select" data-stock-line-index="${index}" aria-label="${this._escHtml(I18n.t('movements.stockSourceColumn'))}">${html}</select></td>`;
    },

    updateItemStockSource(index, value) {
        if (index < 0 || index >= this.selectedItems.length) return;
        const it = this.selectedItems[index];
        const v = String(value || '').trim();
        it.stockSourceId = v;
        it.boxId = '';
        it.boxNumber = undefined;
        it.locationStockKey = '';
        if (v.startsWith('box:')) {
            it.boxId = v.slice(4);
            if (typeof InventoryManager !== 'undefined' && InventoryManager.getItemBoxStocks) {
                const b = (InventoryManager.getItemBoxStocks(it.itemId) || []).find(
                    x => String(x.boxId) === String(it.boxId)
                );
                if (b && Number.isFinite(Number(b.boxNumber))) it.boxNumber = Number(b.boxNumber);
            }
        } else if (v.startsWith('loc:')) {
            try {
                const raw = decodeURIComponent(v.slice(4));
                const canon = Utils.strictEffectiveWarehouseLocationText(raw) || raw;
                it.locationStockKey = canon;
            } catch (e) {
                it.locationStockKey = '';
            }
        }
        if (this._movementTypeStockSourceDestMirror()) {
            this._syncFerreteriaMermaTargetFromSource(it);
        }
        this.renderSelectedItems();
    },

    updateItemBox(index, boxId) {
        return this.updateItemStockSource(index, boxId ? `box:${boxId}` : '');
    },

    /**
     * Aplica el delta de stock al procesar un movimiento (o Stand-by al liberar).
     * @param {string} movementType - tipo del movimiento que se está aplicando
     */
    _applyStockChangeForLine(item, movementType) {
        if (!item) return;
        if (item.consumableReceipt) return;
        if (item.itemId && typeof InventoryManager !== 'undefined') {
            const invIt = InventoryManager.getItemById(item.itemId);
            if (invIt && invIt.inventoryConsumable) return;
        }
        const type = movementType || this.currentType;
        if (type === 'COMPRA_STOCK') {
            const q = Math.abs(parseFloat(item.quantity) || 0);
            if (q <= 0) return;
            const place0 = item.compraPlace && typeof item.compraPlace === 'object' ? { ...item.compraPlace } : { kind: 'main' };
            if (!place0.kind) place0.kind = 'main';
            if (place0.kind === 'location' && place0.locationKey) {
                place0.locationKey = Utils.strictEffectiveWarehouseLocationText(String(place0.locationKey).trim()) || String(place0.locationKey).trim();
            }
            const r =
                typeof InventoryManager !== 'undefined' && InventoryManager.applyCompraStockPlacement
                    ? InventoryManager.applyCompraStockPlacement(item.itemId, q, place0)
                    : { ok: false };
            if (!r || !r.ok) {
                if (typeof InventoryManager !== 'undefined') InventoryManager.updateStock(item.itemId, 'main', q);
            } else if (place0.kind === 'box' && r.ok) {
                const n = parseInt(place0.boxNumber, 10);
                const it = InventoryManager.getItemById(item.itemId);
                const row = it && it.boxStocks ? it.boxStocks.find(b => Number(b.boxNumber) === n) : null;
                if (row) {
                    item.compraPlace = { kind: 'box', boxNumber: n, boxId: row.boxId };
                }
            } else if (place0.kind === 'location' && r.ok && place0.locationKey) {
                item.compraPlace = { kind: 'location', locationKey: place0.locationKey };
            } else if (place0.kind === 'main' && r.ok) {
                item.compraPlace = { kind: 'main' };
            }
            if (
                place0.kind === 'main' &&
                typeof InventoryManager !== 'undefined' &&
                typeof InventoryManager.mergeCompraLotIntoExpirations === 'function'
            ) {
                InventoryManager.mergeCompraLotIntoExpirations(item.itemId, q, {
                    expiryDate: item.compraLotExpiry,
                    expDate: item.compraLotExpedition
                });
            }
            return;
        }
        if (type === 'TRANSFERENCIA' && this._isTransferLine(item)) {
            if (typeof InventoryManager.applyTransferenciaLine === 'function') {
                const r = InventoryManager.applyTransferenciaLine(item);
                if (!r || !r.ok) {
                    Utils.showToast(I18n.t('msg.transferApplyFailed'), 'error');
                }
            } else {
                const q = Math.abs(parseFloat(item.quantity) || 0);
                if (q <= 0) return;
                InventoryManager.updateStock(item.itemId, item.transferFrom, -q);
                InventoryManager.updateStock(item.itemId, item.transferTo, q);
            }
            return;
        }
        if (this._isMainToProductionMovement(type)) {
            const q = Math.abs(parseFloat(item.quantity) || 0);
            if (q <= 0) return;
            InventoryManager.updateStock(item.itemId, 'main', -q);
            InventoryManager.updateStock(item.itemId, 'production', q);
            return;
        }
        const tgt = this._resolveStockTargetForLine(item);
        const qty = parseFloat(item.quantity) || 0;
        if (
            tgt === 'main' &&
            qty < 0 &&
            type !== 'TRANSFERENCIA' &&
            type !== 'TRANSFORMACION' &&
            typeof InventoryManager !== 'undefined'
        ) {
            const qAbs = Math.abs(qty);
            const src = this._getLineStockSourceId(item);
            if (
                !src &&
                typeof InventoryManager.consumeFromMainStockFefo === 'function' &&
                InventoryManager.itemTracksExpiration(InventoryManager.getItemById(item.itemId))
            ) {
                const r0 = InventoryManager.consumeFromMainStockFefo(item.itemId, qAbs);
                if (r0 && r0.ok) {
                    item.mainFefoDeductions = r0.deductions || [];
                    return;
                }
            }
            if (src.startsWith('box:') && InventoryManager.consumeFromBoxAndMain) {
                const r = InventoryManager.consumeFromBoxAndMain(item.itemId, src.slice(4), qAbs, {
                    boxNumber: item.boxNumber
                });
                if (!r || !r.ok) InventoryManager.updateStock(item.itemId, tgt, qty);
                return;
            }
            if (src.startsWith('ibox:')) {
                InventoryManager.updateStock(item.itemId, tgt, qty);
                return;
            }
            if (src.startsWith('loc:') && InventoryManager.consumeFromLocationStockAndMain) {
                let locKey = '';
                try {
                    locKey = decodeURIComponent(src.slice(4));
                } catch (e) {
                    locKey = '';
                }
                const r = InventoryManager.consumeFromLocationStockAndMain(item.itemId, locKey, qAbs);
                if (!r || !r.ok) InventoryManager.updateStock(item.itemId, tgt, qty);
                return;
            }
        }
        InventoryManager.updateStock(item.itemId, tgt, qty);
    },

    /**
     * Revierte el efecto en inventario de una línea ya aplicada (anulación).
     */
    _revertAppliedMovementLine(item, movementType) {
        if (!item || item.annulled) return;
        if (movementType === 'COMPRA_STOCK' && item.consumableReceipt) return;
        if (movementType === 'COMPRA_STOCK' && typeof InventoryManager !== 'undefined') {
            const q = Math.abs(parseFloat(item.quantity) || 0);
            if (q <= 0) return;
            const invIt = item.itemId ? InventoryManager.getItemById(item.itemId) : null;
            if (invIt && invIt.inventoryConsumable) {
                const prevMain = Math.max(0, Utils.roundDecimal(parseFloat(invIt.mainStock) || 0));
                InventoryManager.updateItem(item.itemId, {
                    mainStock: Utils.roundDecimal(Math.max(0, prevMain - q)),
                    prodStock: 0,
                    transStock: 0
                });
                return;
            }
            if (item.compraPlace && typeof InventoryManager.revertCompraStockPlacement === 'function') {
                InventoryManager.revertCompraStockPlacement(item.itemId, q, item.compraPlace);
            } else {
                InventoryManager.updateStock(item.itemId, 'main', -q);
            }
            const pl = item.compraPlace && typeof item.compraPlace === 'object' ? item.compraPlace : { kind: 'main' };
            if (
                pl.kind === 'main' &&
                typeof InventoryManager.revertMergeCompraLotFromExpirations === 'function'
            ) {
                InventoryManager.revertMergeCompraLotFromExpirations(item.itemId, q, item);
            }
            return;
        }
        if (item.itemId && typeof InventoryManager !== 'undefined') {
            const invIt = InventoryManager.getItemById(item.itemId);
            if (invIt && invIt.inventoryConsumable) return;
        }
        if (movementType === 'TRANSFERENCIA' && this._isTransferLine(item)) {
            if (typeof InventoryManager.revertTransferenciaLine === 'function') {
                InventoryManager.revertTransferenciaLine(item);
            } else {
                const q = Math.abs(parseFloat(item.quantity) || 0);
                InventoryManager.updateStock(item.itemId, item.transferFrom, q);
                InventoryManager.updateStock(item.itemId, item.transferTo, -q);
            }
            return;
        }
        if (this._isMainToProductionMovement(movementType)) {
            const q = Math.abs(parseFloat(item.quantity) || 0);
            if (q <= 0) return;
            InventoryManager.updateStock(item.itemId, 'main', q);
            InventoryManager.updateStock(item.itemId, 'production', -q);
            return;
        }
        const tgt = this._resolveStockTargetForLine(item);
        const qty = parseFloat(item.quantity) || 0;
        if (tgt === 'main' && qty < 0 && movementType !== 'TRANSFERENCIA' && movementType !== 'TRANSFORMACION') {
            const qAbs = Math.abs(qty);
            const src = this._getLineStockSourceId(item);
            if (
                !src &&
                item.mainFefoDeductions &&
                item.mainFefoDeductions.length &&
                typeof InventoryManager.restoreMainStockFefo === 'function'
            ) {
                InventoryManager.restoreMainStockFefo(item.itemId, item.mainFefoDeductions);
                return;
            }
            if (src.startsWith('box:') && InventoryManager.restoreToBoxAndMain) {
                const r = InventoryManager.restoreToBoxAndMain(item.itemId, src.slice(4), qAbs, {
                    boxNumber: item.boxNumber
                });
                if (!r || !r.ok) InventoryManager.updateStock(item.itemId, tgt, -qty);
                return;
            }
            if (src.startsWith('ibox:')) {
                InventoryManager.updateStock(item.itemId, tgt, -qty);
                return;
            }
            if (src.startsWith('loc:')) {
                let locKey = '';
                try {
                    locKey = decodeURIComponent(src.slice(4));
                } catch (e) {
                    locKey = '';
                }
                const fromRow = item.locationConsumedFromStockRow === true;
                if (fromRow && InventoryManager.restoreToLocationStockAndMain) {
                    const r = InventoryManager.restoreToLocationStockAndMain(item.itemId, locKey, qAbs);
                    if (r && r.ok) return;
                }
                InventoryManager.updateStock(item.itemId, tgt, -qty);
                return;
            }
        }
        InventoryManager.updateStock(item.itemId, tgt, -qty);
    },

    /**
     * Si la línea guardada consumió fila de stock por ubicación (JSON), la anulación debe restaurar esa fila y el principal.
     */
    _predictLocationConsumedFromStockRow(li) {
        const src = this._getLineStockSourceId(li);
        if (!src.startsWith('loc:')) return undefined;
        let raw = '';
        try {
            raw = decodeURIComponent(src.slice(4));
        } catch (e) {
            raw = '';
        }
        if (!raw || typeof InventoryManager === 'undefined') return false;
        if (
            typeof InventoryManager.hasLocationStockRowForMovement === 'function' &&
            !InventoryManager.hasLocationStockRowForMovement(li.itemId, raw)
        ) {
            return false;
        }
        const avail =
            typeof InventoryManager.getMovementLocationAvailableQty === 'function'
                ? InventoryManager.getMovementLocationAvailableQty(li.itemId, raw)
                : 0;
        const need = Math.abs(parseFloat(li.quantity) || 0);
        return avail >= need;
    },

    updateItemTransferFrom(index, value) {
        if (index < 0 || index >= this.selectedItems.length) return;
        this._syncTransferLineQtyFromDom(index);
        const p = this._parseTransferSelectValue(value);
        const it = this.selectedItems[index];
        it.transferFrom = p.depot;
        it.transferFromBoxId = p.boxId;
        this._transferDraftFrom = it.transferFrom;
        this.renderSelectedItems();
    },

    updateItemTransferTo(index, value) {
        if (index < 0 || index >= this.selectedItems.length) return;
        this._syncTransferLineQtyFromDom(index);
        const p = this._parseTransferSelectValue(value);
        const it = this.selectedItems[index];
        it.transferTo = p.depot;
        it.transferToBoxId = p.boxId;
        this._transferDraftTo = it.transferTo;
        this.renderSelectedItems();
    },

    _syncTransferLineQtyFromDom(index) {
        if (this.currentType !== "TRANSFERENCIA") return;
        if (index < 0 || index >= (this.selectedItems || []).length) return;
        const row = document.querySelectorAll("#selected-items-body tr")[index];
        const input = row ? row.querySelector(".quantity-input") : null;
        if (!input) return;
        const q = Math.abs(this._parseQuantityInputValue(input.value));
        this.selectedItems[index].quantity = Utils.roundDecimal(q);
    },

    removeItem(index) {
        this.selectedItems.splice(index, 1);
        this.renderSelectedItems();
    },

    _setCompraLinePurchaseField(index, kind, raw) {
        if (index < 0 || index >= (this.selectedItems || []).length) return;
        if (this.currentType !== "COMPRA_STOCK") return;
        const v = String(raw ?? "").trim();
        const it = this.selectedItems[index];
        if (!it) return;
        if (kind === "po") it.compraLinePo = v;
        else if (kind === "sup") it.compraLineSupplier = v;
    },

    /**
     * Antes de re-renderizar la tabla: conserva PO, proveedor y fechas de lote desde el DOM.
     * Sin esto, `updateItemQuantity` / calculadora / clic fuera disparan `renderSelectedItems` y se pierden los inputs.
     */
    _pullCompraPurchaseFieldsFromDom() {
        if (this.currentType !== "COMPRA_STOCK" || this.isCompraConsumibleReceiptMode()) return;
        const rows = document.querySelectorAll("#selected-items-body tr");
        const items = this.selectedItems || [];
        for (let i = 0; i < Math.min(rows.length, items.length); i++) {
            const row = rows[i];
            const it = items[i];
            if (!it || row.querySelector("td[colspan]")) continue;
            const poInp = row.querySelector(".mov-compra-line-po");
            const supInp = row.querySelector(".mov-compra-line-supplier");
            if (poInp) it.compraLinePo = String(poInp.value || "").trim();
            if (supInp) it.compraLineSupplier = String(supInp.value || "").trim();
            const e1 = row.querySelector(".mov-compra-lot-expiry");
            const e2 = row.querySelector(".mov-compra-lot-expedition");
            if (e1) it.compraLotExpiry = e1.value || "";
            if (e2) it.compraLotExpedition = e2.value || "";
        }
    },

    renderSelectedItems() {
        const tbody = document.getElementById('selected-items-body');
        if (!tbody || !this.currentType) return;

        this._pullCompraPurchaseFieldsFromDom();

        const esc = s => this._escHtml(s);
        const fmt = v => Utils.formatDecimalDisplay(v);

        const conf = MOVEMENT_TYPES[this.currentType];

        if (conf.specialForm !== "recepcion" && this.selectedItems.length) {
            for (const item of this.selectedItems) {
                if (!this._lineSupportsStockSourceSelect(item, conf)) continue;
                if (String(item.stockSourceId || "").trim()) continue;
                const inv = InventoryManager.getItemById(item.itemId);
                if (!inv || typeof InventoryManager.getMovementLocationSourceOptions !== "function") continue;
                const rows = InventoryManager.getMovementLocationSourceOptions(inv);
                if (!rows || !rows.length) continue;
                const v = `loc:${encodeURIComponent(rows[0].location)}`;
                item.stockSourceId = v;
                item.boxId = "";
                item.boxNumber = undefined;
                try {
                    const raw = decodeURIComponent(v.slice(4));
                    item.locationStockKey = Utils.strictEffectiveWarehouseLocationText(raw) || raw;
                } catch (e) {
                    item.locationStockKey = "";
                }
            }
        }

        if (conf.specialForm === 'recepcion') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted);">
                        ${esc(I18n.t('msg.receptionUseFieldsAbove'))}
                    </td>
                </tr>
            `;
            return;
        }

        if (this.selectedItems.length === 0) {
            const thBox = document.getElementById('mov-selected-box-th');
            const hasBoxCol = thBox && thBox.style.display !== 'none';
            const thCom = document.getElementById('mov-compra-dest-th');
            const hasCompraCol = thCom && thCom.style.display !== 'none';
            const thPoL = document.getElementById('mov-compra-line-po-th');
            const hasCompraPoCols = thPoL && thPoL.style.display !== 'none';
            const emptyCols =
                (this.currentType === 'CONSUMO_DIARIO' ? 8 : 7) +
                (hasBoxCol ? 1 : 0) +
                (hasCompraCol ? 1 : 0) +
                (hasCompraPoCols ? 2 : 0);
            tbody.innerHTML = `
                <tr>
                    <td colspan="${emptyCols}" style="text-align: center; color: var(--text-muted);">
                        ${esc(I18n.t('msg.noItemsSelected'))}
                    </td>
                </tr>
            `;
            if (this.currentType === 'TRANSFORMACION') {
                this.renderTransformationStockTables();
            }
            if (this.currentType === 'CONSUMO_DIARIO') {
                this._persistConsumoCartFromForm();
            }
            return;
        }

        if (this._movementTypeStockSourceDestMirror()) {
            for (const line of this.selectedItems) {
                this._syncFerreteriaMermaTargetFromSource(line);
            }
        }

        tbody.innerHTML = this.selectedItems.map((item, index) => {
            if (conf.id === 'TRANSFERENCIA') {
                const from = item.transferFrom || 'main';
                const to = item.transferTo || 'main';
                const fromBox = item.transferFromBoxId || '';
                const toBox = item.transferToBoxId || '';
                const q = Math.abs(parseFloat(item.quantity) || 0);
                const curFrom =
                    typeof InventoryManager.getTransferenciaEndpointQty === 'function'
                        ? InventoryManager.getTransferenciaEndpointQty(item.itemId, from, fromBox)
                        : parseFloat(InventoryManager.getStock(item.itemId, from)) || 0;
                const curTo =
                    typeof InventoryManager.getTransferenciaEndpointQty === 'function'
                        ? InventoryManager.getTransferenciaEndpointQty(item.itemId, to, toBox)
                        : parseFloat(InventoryManager.getStock(item.itemId, to)) || 0;
                const newFrom = curFrom - q;
                const newTo = curTo + q;
                const exceedsStock = newFrom < 0;
                const fromOpts = this._buildTransferEndpointOptionsHtml(item.itemId, from, fromBox);
                const toOpts = this._buildTransferEndpointOptionsHtml(item.itemId, to, toBox);
                const fromSelect = `
                    <select class="target-select" data-transfer-role="from" data-line-index="${index}">${fromOpts}</select>`;
                const toSelect = `
                    <select class="target-select" data-transfer-role="to" data-line-index="${index}">${toOpts}</select>`;
                return `
                <tr class="${exceedsStock ? 'row-overdraft-pending' : ''}">
                    <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                    <td class="app-desc-copy-cell">${esc(item.description)}</td>
                    <td>${this._renderQuantityInputWithCalc(index, q > 0 ? q : "", { min: 0, step: "any" })}</td>
                    <td class="transfer-depot-cell">
                        <div class="transfer-depot-pair">
                            <div><span class="transfer-depot-label">${esc(I18n.t('movements.transferFrom'))}</span>${fromSelect}</div>
                            <div><span class="transfer-depot-label">${esc(I18n.t('movements.transferTo'))}</span>${toSelect}</div>
                        </div>
                    </td>
                    <td>
                        <small>${esc(I18n.t('movements.transferFrom'))}:</small> ${fmt(curFrom)} → <strong class="${exceedsStock ? 'stock-negative' : ''}">${fmt(newFrom)}</strong><br>
                        <small>${esc(I18n.t('movements.transferTo'))}:</small> ${fmt(curTo)} → <strong>${fmt(newTo)}</strong>
                    </td>
                    <td>
                        <span class="status-badge ${exceedsStock ? 'warning' : 'valid'}">
                            ${exceedsStock ? esc(I18n.t('status.overdraftRequiresConfirm')) : esc(I18n.t('status.valid'))}
                        </span>
                    </td>
                    <td>
                        <button type="button" class="remove-item-btn" data-remove-index="${index}" title="Eliminar">✕</button>
                    </td>
                </tr>`;
            }
            if (this._isMainToProductionMovement(conf.id)) {
                const q = Math.abs(parseFloat(item.quantity) || 0);
                const curFrom = parseFloat(InventoryManager.getStock(item.itemId, 'main')) || 0;
                const curTo = parseFloat(InventoryManager.getStock(item.itemId, 'production')) || 0;
                const newFrom = curFrom - q;
                const newTo = curTo + q;
                const exceedsStock = newFrom < 0;
                return `
                <tr class="${exceedsStock ? 'row-overdraft-pending' : ''}">
                    <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                    <td class="app-desc-copy-cell">${esc(item.description)}</td>
                    <td>${this._renderQuantityInputWithCalc(index, q > 0 ? q : "", { min: 0, step: "any" })}</td>
                    <td>${esc(I18n.t('target.main'))} → ${esc(I18n.t('target.production'))}</td>
                    <td>
                        <small>${esc(I18n.t('target.main'))}:</small> ${fmt(curFrom)} → <strong class="${exceedsStock ? 'stock-negative' : ''}">${fmt(newFrom)}</strong><br>
                        <small>${esc(I18n.t('target.production'))}:</small> ${fmt(curTo)} → <strong>${fmt(newTo)}</strong>
                    </td>
                    <td>
                        <span class="status-badge ${exceedsStock ? 'warning' : 'valid'}">
                            ${exceedsStock ? esc(I18n.t('status.overdraftRequiresConfirm')) : esc(I18n.t('status.valid'))}
                        </span>
                    </td>
                    <td>
                        <button type="button" class="remove-item-btn" data-remove-index="${index}" title="Eliminar">✕</button>
                    </td>
                </tr>`;
            }

            if (conf.id === 'CONSUMO_DIARIO') {
                const currentStock = this._getLineStockSnapshotForPreview(item);
                const newStock = currentStock + item.quantity;
                const exceedsStock = conf.behavior === 'negative' && newStock < 0;
                const destLabel = esc(this._formatStockSourceAsDestLabel(item));
                const qtyUi = this._movementQtyInputUi(item, conf);
                const recVal = esc(item.recipientName || '');
                const staffNames =
                    typeof EmployeeManager !== 'undefined' && EmployeeManager.getSortedNames
                        ? EmployeeManager.getSortedNames()
                        : [];
                const occNames =
                    typeof EmployeeManager !== 'undefined' && EmployeeManager.getOccasionalSortedNames
                        ? EmployeeManager.getOccasionalSortedNames()
                        : [];
                const useEmployeeSelect = staffNames.length + occNames.length > 0;
                const showFree = this._consumoLineShowsFreeRecipientInput(item, staffNames, occNames);
                const OTHER = this.CONSUMO_RECIPIENT_OTHER;
                let recipientCell;
                if (showFree) {
                    const backBtn = useEmployeeSelect
                        ? `<button type="button" class="btn btn-secondary btn-sm consumo-recipient-back-list" onclick="MovementManager.setConsumoRecipientListMode(${index})">${esc(I18n.t('movements.recipientBackToList'))}</button>`
                        : '';
                    recipientCell = `<div class="consumo-recipient-free-wrap"><input type="text" class="form-input consumo-recipient-input" list="consumo-recipient-datalist"
                               value="${recVal}"
                               data-i18n-placeholder="movements.recipientPlaceholder"
                               placeholder=""
                               onchange="MovementManager.updateConsumoRecipientFreeText(${index}, this.value)"
                               autocomplete="name" />
                        ${backBtn}</div>`;
                } else {
                    const cur = String(item.recipientName || '').trim();
                    const ph = I18n.t('movements.recipientSelectPlaceholder');
                    const optParts = [`<option value="">${esc(ph)}</option>`];
                    const pushName = n => {
                        const isSel = cur && n.toLowerCase() === cur.toLowerCase();
                        optParts.push(`<option value="${esc(n)}"${isSel ? ' selected' : ''}>${esc(n)}</option>`);
                    };
                    if (staffNames.length) {
                        optParts.push(`<optgroup label="${esc(I18n.t('employees.optgroupStaff'))}">`);
                        for (const n of staffNames) pushName(n);
                        optParts.push('</optgroup>');
                    }
                    if (occNames.length) {
                        optParts.push(`<optgroup label="${esc(I18n.t('employees.optgroupOccasional'))}">`);
                        for (const n of occNames) pushName(n);
                        optParts.push('</optgroup>');
                    }
                    optParts.push(
                        `<optgroup label="${esc(I18n.t('movements.recipientOtherGroup'))}"><option value="${esc(OTHER)}">${esc(
                            I18n.t('movements.recipientOptionOther')
                        )}</option></optgroup>`
                    );
                    recipientCell = `<select class="target-select consumo-recipient-select" aria-label="${esc(
                        I18n.t('movements.recipientName')
                    )}" onchange="MovementManager.updateItemRecipient(${index}, this.value)">${optParts.join('')}</select>`;
                }
                return `
                <tr class="${exceedsStock ? 'row-overdraft-pending' : ''}">
                    <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                    <td class="app-desc-copy-cell">${esc(item.description)}</td>
                    <td>
                        ${recipientCell}
                    </td>
                    <td>${this._renderQuantityInputWithCalc(index, qtyUi.value, { min: qtyUi.min, step: "any" })}</td>
                    ${this._renderMovementStockSourceCell(item, index, conf)}
                    <td><span class="mov-same-dest-mirror">${destLabel}</span></td>
                    <td>${fmt(currentStock)} → <strong class="${exceedsStock ? 'stock-negative' : ''}">${fmt(newStock)}</strong></td>
                    <td>
                        <span class="status-badge ${exceedsStock ? 'warning' : 'valid'}">
                            ${exceedsStock ? esc(I18n.t('status.overdraftRequiresConfirm')) : esc(I18n.t('status.valid'))}
                        </span>
                    </td>
                    <td>
                        <button type="button" class="remove-item-btn" data-remove-index="${index}" title="Eliminar">✕</button>
                    </td>
                </tr>`;
            }

            if (this.currentType === 'COMPRA_STOCK') {
                const pl = item.compraPlace && typeof item.compraPlace === 'object' ? item.compraPlace : { kind: 'main' };
                const k = pl.kind || 'main';
                const nBox = pl.boxNumber != null && pl.boxNumber !== '' ? parseInt(pl.boxNumber, 10) : NaN;
                const locRaw = String(pl.locationKey || '');
                const boxNums =
                    typeof InventoryManager !== 'undefined' && InventoryManager._getKnownBoxNumbers
                        ? InventoryManager._getKnownBoxNumbers()
                        : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                const boxOpts = boxNums
                    .map(n =>
                        `<option value="${n}"${Number.isFinite(nBox) && nBox === n ? ' selected' : ''}>📦${n}</option>`
                    )
                    .join('');
                const placeCell = `
                  <div class="compra-place-wrap">
                    <select class="filter-select compra-place-kind" style="max-width:12rem;" onchange="MovementManager.updateCompraPlaceKind(${index}, this.value)">
                      <option value="main" ${k === 'main' ? 'selected' : ''}>${esc(I18n.t('movCompra.placeMain'))}</option>
                      <option value="box" ${k === 'box' ? 'selected' : ''}>${esc(I18n.t('movCompra.placeBox'))}</option>
                      <option value="location" ${k === 'location' ? 'selected' : ''}>${esc(I18n.t('movCompra.placeLocation'))}</option>
                    </select>
                    ${
                        k === 'box'
                            ? `<div style="margin-top:4px;"><select class="filter-select" style="max-width:8rem;" onchange="MovementManager.updateCompraPlaceBoxNumber(${index}, this.value)"><option value="">${esc(I18n.t('movCompra.pickBox'))}</option>${boxOpts}</select></div>`
                            : ''
                    }
                    ${
                        k === 'location'
                            ? `<div style="margin-top:4px;"><input type="text" class="form-input" list="mov-compra-loc-datalist" value="${esc(
                                  locRaw
                              )}" placeholder="${esc(I18n.t('movCompra.locationPh'))}" onchange="MovementManager.updateCompraPlaceLocationKey(${index}, this.value)" /></div>`
                            : ''
                    }
                  </div>`;
                const invRow = item.itemId ? InventoryManager.getItemById(item.itemId) : null;
                const showLots =
                    !item.consumableReceipt &&
                    typeof InventoryManager !== 'undefined' &&
                    invRow &&
                    !invRow.inventoryConsumable;
                const lotDatesHtml = showLots
                    ? `<div class="compra-lot-dates muted" style="margin-top:6px;font-size:0.8rem;line-height:1.4;" title="${esc(
                          k !== 'main' ? I18n.t('movCompra.lotDatesMainOnlyHint') : ''
                      )}">
                        <div><label>${esc(I18n.t('movCompra.lotExpiry'))}
                          <input type="date" class="mov-compra-lot-expiry" value="${esc(item.compraLotExpiry || '')}" oninput="MovementManager.updateCompraLotDates(${index})" onchange="MovementManager.updateCompraLotDates(${index})" />
                        </label></div>
                        <div style="margin-top:2px;"><label>${esc(I18n.t('movCompra.lotExpedition'))}
                          <input type="date" class="mov-compra-lot-expedition" value="${esc(item.compraLotExpedition || '')}" oninput="MovementManager.updateCompraLotDates(${index})" onchange="MovementManager.updateCompraLotDates(${index})" />
                        </label></div>
                      </div>`
                    : '';
                const placeCellFull = `${placeCell}${lotDatesHtml}`;
                const curM = item.itemId ? InventoryManager.getStock(item.itemId, 'main') : 0;
                const qAbs = Math.abs(parseFloat(item.quantity) || 0);
                const newM = curM + qAbs;
                const consBadge = item.consumableReceipt
                    ? ` <span class="status-badge muted">${esc(I18n.t('movements.compraConsumableLineBadge'))}</span>`
                    : '';
                const poVal = this._escAttr(String(item.compraLinePo || ''));
                const supVal = this._escAttr(String(item.compraLineSupplier || ''));
                return `
                <tr>
                    <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                    <td class="app-desc-copy-cell">${esc(item.description)}${consBadge}</td>
                    <td><input type="text" class="form-input mov-compra-line-po" style="min-width:6rem;max-width:10rem;" value="${poVal}" autocomplete="off" oninput="MovementManager._setCompraLinePurchaseField(${index},'po',this.value)" onchange="MovementManager._setCompraLinePurchaseField(${index},'po',this.value)" /></td>
                    <td><input type="text" class="form-input mov-compra-line-supplier" style="min-width:8rem;max-width:14rem;" value="${supVal}" list="mov-compra-supplier-datalist" autocomplete="off" oninput="MovementManager._setCompraLinePurchaseField(${index},'sup',this.value)" onchange="MovementManager._setCompraLinePurchaseField(${index},'sup',this.value)" /></td>
                    <td>${this._renderQuantityInputWithCalc(index, qAbs > 0 ? qAbs : "", { min: 0, step: "any" })}</td>
                    ${this._renderMovementStockSourceCell(item, index, conf)}
                    <td>${esc(I18n.t('target.main'))}</td>
                    <td>${placeCellFull}</td>
                    <td>${fmt(curM)} → <strong>${fmt(newM)}</strong></td>
                    <td><span class="status-badge valid">${esc(I18n.t('status.valid'))}</span></td>
                    <td><button type="button" class="remove-item-btn" data-remove-index="${index}" title="Eliminar">✕</button></td>
                </tr>`;
            }

            if (this._movementTypeStockSourceDestMirror()) {
                const currentStock = this._getLineStockSnapshotForPreview(item);
                const newStock = currentStock + item.quantity;
                const exceedsStock = newStock < 0;
                const destLabel = esc(this._formatStockSourceAsDestLabel(item));
                const qtyUi = this._movementQtyInputUi(item, conf);
                return `
                <tr class="${exceedsStock ? 'row-overdraft-pending' : ''}">
                    <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                    <td class="app-desc-copy-cell">${esc(item.description)}</td>
                    <td>${this._renderQuantityInputWithCalc(index, qtyUi.value, { min: qtyUi.min, step: "any" })}</td>
                    ${this._renderMovementStockSourceCell(item, index, conf)}
                    <td><span class="mov-same-dest-mirror">${destLabel}</span></td>
                    <td>${fmt(currentStock)} → <strong class="${exceedsStock ? 'stock-negative' : ''}">${fmt(newStock)}</strong></td>
                    <td>
                        <span class="status-badge ${exceedsStock ? 'warning' : 'valid'}">
                            ${exceedsStock ? esc(I18n.t('status.overdraftRequiresConfirm')) : esc(I18n.t('status.valid'))}
                        </span>
                    </td>
                    <td>
                        <button type="button" class="remove-item-btn" data-remove-index="${index}" title="Eliminar">✕</button>
                    </td>
                </tr>`;
            }

            const currentStock = InventoryManager.getStock(item.itemId, this._resolveStockTargetForLine(item));
            const newStock = currentStock + item.quantity;
            const exceedsStock = conf.behavior === 'negative' && newStock < 0;

            // Selector de destino solo si multiTarget es true
            let targetSelect = esc(I18n.t(`target.${item.target}`));
            if (conf.multiTarget) {
                if (conf.id === 'TRANSFORMACION') {
                    const depKey = item.target === 'production' ? 'production' : 'transformation';
                    targetSelect = `<span class="mov-tf-insumo-depot-label">${esc(I18n.t(`target.${depKey}`))}</span>`;
                } else {
                    const al = this._escHtml(I18n.t('table.target'));
                    targetSelect = `
                    <select class="target-select mov-target-depot-select" data-target-line-index="${index}" aria-label="${al}">
                        <option value="main" ${item.target === 'main' ? 'selected' : ''}>${esc(I18n.t('target.main'))}</option>
                        <option value="production" ${item.target === 'production' ? 'selected' : ''}>${esc(I18n.t('target.production'))}</option>
                        <option value="transformation" ${item.target === 'transformation' ? 'selected' : ''}>${esc(I18n.t('target.transformation'))}</option>
                    </select>
                `;
                }
            }

            return `
                <tr class="${exceedsStock ? 'row-overdraft-pending' : ''}">
                    <td class="app-code-copy-cell"><strong>${esc(item.code)}</strong></td>
                    <td class="app-desc-copy-cell">${esc(item.description)}</td>
                    <td>${(() => {
                        const qtyUi = this._movementQtyInputUi(item, conf);
                        return this._renderQuantityInputWithCalc(index, qtyUi.value, { min: qtyUi.min, step: "any" });
                    })()}</td>
                    ${this._renderMovementStockSourceCell(item, index, conf)}
                    <td>${targetSelect}</td>
                    <td>${fmt(currentStock)} → <strong class="${exceedsStock ? 'stock-negative' : ''}">${fmt(newStock)}</strong></td>
                    <td>
                        <span class="status-badge ${exceedsStock ? 'warning' : 'valid'}">
                            ${exceedsStock ? esc(I18n.t('status.overdraftRequiresConfirm')) : esc(I18n.t('status.valid'))}
                        </span>
                    </td>
                    <td>
                        <button type="button" class="remove-item-btn" data-remove-index="${index}" title="Eliminar">✕</button>
                    </td>
                </tr>
            `;
        }).join('');
        if (this.currentType === 'TRANSFORMACION') {
            this.renderTransformationStockTables();
        }
        if (this.currentType === 'CONSUMO_DIARIO') {
            this._refreshConsumoRecipientDatalist();
            document.querySelectorAll('#selected-items-body .consumo-recipient-input[data-i18n-placeholder]').forEach(el => {
                const k = el.getAttribute('data-i18n-placeholder');
                if (k && I18n.t) el.setAttribute('placeholder', I18n.t(k));
            });
            this._persistConsumoCartFromForm();
        }

        tbody.querySelectorAll("tr").forEach(tr => {
            if (!tr.querySelector("td[colspan]")) tr.tabIndex = -1;
        });
        if (typeof Utils !== "undefined" && Utils.installTableBodyArrowNav) {
            Utils.installTableBodyArrowNav(tbody);
        }

    },

    validateMovement() {
        if (!this.currentType) return false;
        
        const conf = MOVEMENT_TYPES[this.currentType];
        const projectId = document.getElementById('project-id')?.value?.trim() || '';

        if (conf.specialForm === 'compra') {
            if (this.isCompraConsumibleReceiptMode()) {
                if (typeof ConsumableManager === 'undefined' || !ConsumableManager.hasList()) {
                    Utils.showToast(I18n.t('consumables.configEmptyWarn'), 'error');
                    return false;
                }
                const raw = this._getCompraConsumibleNameRaw();
                const canon = ConsumableManager.canonicalConsumable(raw);
                if (!canon || !String(canon).trim()) {
                    Utils.showToast(I18n.t('movements.compraConsumableInvalid'), 'error');
                    return false;
                }
                const cq = this._parseQuantityInputValue(document.getElementById('mov-compra-consumible-qty')?.value);
                if (!(cq > 0)) {
                    Utils.showToast(I18n.t('movements.compraConsumableQtyInvalid'), 'error');
                    return false;
                }
                const cpo = document.getElementById('mov-compra-consumible-po')?.value?.trim() || '';
                const csup = document.getElementById('mov-compra-consumible-supplier')?.value?.trim() || '';
                if (!cpo) {
                    Utils.showToast(I18n.t('msg.compraLinePoRequired'), 'error');
                    return false;
                }
                if (!csup) {
                    Utils.showToast(I18n.t('msg.compraLineSupplierRequired'), 'error');
                    return false;
                }
                return true;
            }
            if (this.selectedItems.length === 0) {
                Utils.showToast(I18n.t('msg.noItemsSelected'), 'error');
                return false;
            }
            for (const it of this.selectedItems) {
                if (it.consumableReceipt) continue;
                const pl = it.compraPlace;
                if (pl && pl.kind === 'box' && (pl.boxNumber == null || pl.boxNumber === '' || !Number.isFinite(parseInt(pl.boxNumber, 10)))) {
                    Utils.showToast(I18n.t('msg.compraBoxRequired'), 'error');
                    return false;
                }
                if (pl && pl.kind === 'location' && !String(pl.locationKey || '').trim()) {
                    Utils.showToast(I18n.t('msg.compraLocationRequired'), 'error');
                    return false;
                }
                const lpo = String(it.compraLinePo ?? '').trim();
                const lsup = String(it.compraLineSupplier ?? '').trim();
                if (!lpo) {
                    Utils.showToast(I18n.t('msg.compraLinePoRequired'), 'error');
                    return false;
                }
                if (!lsup) {
                    Utils.showToast(I18n.t('msg.compraLineSupplierRequired'), 'error');
                    return false;
                }
            }
            if (!this._validateCartHasNoZeroQuantities()) return false;
            return true;
        } else if (conf.specialForm === 'recepcion') {
            if (conf.projectRequired && !projectId) {
                Utils.showToast(I18n.t('msg.projectIdRequired'), 'error');
                return false;
            }
            const lines = this._getReceptionDraftLines();
            if (!lines.length) {
                Utils.showToast(I18n.t('msg.receptionItemRequired'), 'error');
                return false;
            }
            const valid = lines.filter(li => li.itemName && li.quantity > 0);
            if (!valid.length) {
                Utils.showToast(I18n.t('msg.receptionItemRequired'), 'error');
                return false;
            }
            if (valid.some(li => li.quantity <= 0)) {
                Utils.showToast(I18n.t('msg.receptionQtyRequired'), 'error');
                return false;
            }
            const cat = document.getElementById('mov-rec-category')?.value || 'OTRO';
            const po = document.getElementById('mov-rec-po')?.value?.trim() || '';
            if (typeof ReceptionsManager !== 'undefined' && ReceptionsManager.requiresPurchaseOrder(cat) && !po) {
                Utils.showToast(I18n.t('msg.receptionPoRequired'), 'error');
                return false;
            }
            if (typeof ReceptionsManager !== "undefined" && ReceptionsManager.isGlassPackingCategory(cat)) {
                const gp = (document.getElementById("mov-rec-glass-packing")?.value || "").trim();
                if (gp !== "standard_box" && gp !== "loose_mixed") {
                    Utils.showToast(I18n.t("msg.receptionGlassPackingRequired"), "error");
                    return false;
                }
            }
            return true;
        } else {
        // Validar proyecto obligatorio
        if (conf.projectRequired && !projectId) {
            Utils.showToast(I18n.t('msg.projectIdRequired'), 'error');
            return false;
        }

        // Validar al menos un artículo
        if (this.selectedItems.length === 0) {
            Utils.showToast(I18n.t('msg.noItemsSelected'), 'error');
            return false;
        }

        if (this.currentType === 'CONSUMO_DIARIO') {
            const EM = typeof EmployeeManager !== 'undefined' ? EmployeeManager : null;
            for (const it of this.selectedItems) {
                const name = String(it.recipientName || '').trim();
                if (!name) {
                    Utils.showToast(I18n.t('msg.consumoRecipientRequired'), 'error');
                    return false;
                }
            }
        }

        if (this.currentType === 'TRANSFERENCIA') {
            for (const it of this.selectedItems) {
                const from = it.transferFrom || 'main';
                const to = it.transferTo || 'main';
                const q = Math.abs(parseFloat(it.quantity) || 0);
                if (q > 0 && from === to) {
                    Utils.showToast(I18n.t('msg.transferSameDepot'), 'error');
                    return false;
                }
            }
        }

        if (this.currentType === 'TRANSFORMACION') {
            for (const it of this.selectedItems) {
                if (it.target !== 'transformation' && it.target !== 'production') {
                    Utils.showToast(I18n.t('msg.transformationInsumoDepotInvalid'), 'error');
                    return false;
                }
            }
            if (this.getTransformationTargetMode() === 'existing') {
                if (!this.transformationTargetItemId) {
                    Utils.showToast(I18n.t('msg.transformationTargetRequired'), 'error');
                    return false;
                }
            } else {
                const nc = document.getElementById('mov-tf-new-code')?.value?.trim() || '';
                const nd = document.getElementById('mov-tf-new-desc')?.value?.trim() || '';
                if (!nc || !nd) {
                    Utils.showToast(I18n.t('msg.transformationNewItemRequired'), 'error');
                    return false;
                }
            }
            const outQ = this._parseQuantityInputValue(document.getElementById('mov-transformacion-output-qty')?.value);
            if (!Number.isFinite(outQ) || outQ <= 0) {
                Utils.showToast(I18n.t('msg.transformationOutputQtyRequired'), 'error');
                return false;
            }
        }

        /* Sobregiro (stock negativo / cantidad > disponible en caja o ubicación): no bloquear aquí;
           processMovement abre el modal de motivo y permite continuar. */

        if (!this._validateCartHasNoZeroQuantities()) return false;
        if (!this._validateStockSourcesAvailability(this.selectedItems)) return false;

        return true;
        }
    },

    normalizeQuantityForType(qty, type) {
        const conf = MOVEMENT_TYPES[type];
        if (!conf) return qty;
        if (conf.behavior === 'negative') return -Math.abs(qty);
        if (conf.behavior === 'positive') return Math.abs(qty);
        return qty;
    },

    /**
     * Si el movimiento debe tratarse como sobregiro en UI, filtros e informes.
     * Compra y recepción no generan retirada que cause sobregiro; versiones antiguas pudieron guardar `hadOverdraft: true` por error — aquí se ignora ese flag.
     * @param {object} mov
     * @returns {boolean}
     */
    effectiveHadOverdraft(mov) {
        if (!mov) return false;
        const t = mov.type;
        if (t && typeof MOVEMENT_TYPES !== 'undefined' && MOVEMENT_TYPES[t]) {
            const sf = MOVEMENT_TYPES[t].specialForm;
            if (sf === 'compra' || sf === 'recepcion') return false;
        }
        return !!mov.hadOverdraft;
    },

    /**
     * Alguna línea dejaría el stock del destino por debajo de cero.
     * @param {string} [movementType] Tipo lógico del movimiento (p. ej. al liberar stand-by). Si se omite, se usa el tipo del formulario (`currentType`); deben coincidir o el cálculo usa ramas incorrectas (p. ej. compra tratada como envío a producción).
     */
    linesWouldOverdraft(items, movementType) {
        if (!items || !items.length) return false;
        const mt = movementType !== undefined ? movementType : this.currentType;
        const typeConf = mt && MOVEMENT_TYPES[mt];
        if (typeConf && (typeConf.specialForm === 'compra' || typeConf.specialForm === 'recepcion')) {
            return false;
        }
        return items.some(item => {
            if (this._isTransferLine(item)) {
                const q = Math.abs(parseFloat(item.quantity) || 0);
                if (q <= 0) return false;
                const cur =
                    typeof InventoryManager.getTransferenciaEndpointQty === 'function'
                        ? InventoryManager.getTransferenciaEndpointQty(
                              item.itemId,
                              item.transferFrom,
                              item.transferFromBoxId
                          )
                        : InventoryManager.getStock(item.itemId, item.transferFrom);
                return cur - q < 0;
            }
            if (this._isMainToProductionMovement(mt)) {
                const q = Math.abs(parseFloat(item.quantity) || 0);
                if (q <= 0) return false;
                const cur = parseFloat(InventoryManager.getStock(item.itemId, 'main')) || 0;
                return cur - q < 0;
            }
            const tgt = this._resolveStockTargetForLine(item);
            const qty = parseFloat(item.quantity) || 0;
            if (tgt === 'main' && qty < 0 && typeof InventoryManager !== 'undefined') {
                const qAbs = Math.abs(qty);
                const src = this._getLineStockSourceId(item);
                if (src.startsWith('box:')) {
                    const boxId = src.slice(4);
                    if (typeof InventoryManager.getBoxStockQtyForMovement === 'function') {
                        return InventoryManager.getBoxStockQtyForMovement(item.itemId, boxId, item.boxNumber) < qAbs;
                    }
                    const box = (InventoryManager.getItemBoxStocks(item.itemId) || []).find(
                        b => String(b.boxId) === String(boxId)
                    );
                    return !box || (parseFloat(box.qty) || 0) < qAbs;
                }
                if (src.startsWith('ibox:')) {
                    const n = parseInt(src.slice(5), 10);
                    const avail =
                        typeof InventoryManager.getMovementInferredBoxAvailableQty === 'function'
                            ? InventoryManager.getMovementInferredBoxAvailableQty(item.itemId, n)
                            : 0;
                    return avail < qAbs;
                }
                if (src.startsWith('loc:')) {
                    let raw = '';
                    try {
                        raw = decodeURIComponent(src.slice(4));
                    } catch (e) {
                        raw = '';
                    }
                    const avail =
                        typeof InventoryManager.getMovementLocationAvailableQty === 'function'
                            ? InventoryManager.getMovementLocationAvailableQty(item.itemId, raw)
                            : 0;
                    return avail < qAbs;
                }
            }
            const currentStock = InventoryManager.getStock(item.itemId, tgt);
            return currentStock + item.quantity < 0;
        });
    },

    /** Cantidad firmada en una línea de movimiento guardada (acepta quantity/qty). */
    _parseMovementLineQty(li) {
        if (!li) return 0;
        const raw =
            li.quantity !== undefined && li.quantity !== null
                ? li.quantity
                : li.qty !== undefined && li.qty !== null
                  ? li.qty
                  : 0;
        return this._parseQuantityInputValue(raw);
    },

    /**
     * Movimiento persistido cuyas líneas no alteran stock (p. ej. ajuste con cantidad 0). No anulados.
     */
    _movementHasZeroStockEffect(m) {
        if (!m || m.annulled) return false;
        const typeU = String(m.type || "").trim().toUpperCase();
        const items = Array.isArray(m.items) ? m.items : [];

        if (typeU === "AJUSTE") {
            if (!items.length) return true;
            const totals = new Map();
            for (const li of items) {
                const tgt = li.target || "main";
                const key = `${String(li.itemId ?? "")}|${tgt}`;
                const q = this._parseMovementLineQty(li);
                totals.set(key, (totals.get(key) || 0) + q);
            }
            for (const sum of totals.values()) {
                if (Math.abs(sum) > 1e-7) return false;
            }
            return true;
        }

        if (typeU === "RECEPCION_MATERIAL") {
            const raw = m.receptionSnapshot && m.receptionSnapshot.quantity;
            if (raw === undefined || raw === null || raw === "") return false;
            const q = this._parseQuantityInputValue(raw);
            return !(Number.isFinite(q) && Math.abs(q) > 1e-12);
        }

        if (typeU === "TRANSFERENCIA") {
            if (!items.length) return true;
            const any = items.some(it => {
                const q = Math.abs(this._parseMovementLineQty(it));
                if (q <= 1e-12) return false;
                if (it.transferFrom != null && it.transferTo != null && it.transferFrom !== it.transferTo) return true;
                return true;
            });
            return !any;
        }

        if (typeU === "TRANSFORMACION") {
            const outField = this._parseQuantityInputValue(m.transformationOutputQuantity);
            const outFromField = Number.isFinite(outField) && Math.abs(outField) > 1e-12;
            const outFromLine = items.some(
                li => li.transformationOutput && Math.abs(this._parseMovementLineQty(li)) > 1e-12
            );
            const inLines = items.some(
                li => !li.transformationOutput && Math.abs(this._parseMovementLineQty(li)) > 1e-12
            );
            return !outFromField && !outFromLine && !inLines;
        }

        if (!items.length) return true;

        return items.every(li => Math.abs(this._parseMovementLineQty(li)) <= 1e-7);
    },

    /** Quita movimientos guardados sin efecto en stock (p. ej. tras reglas antiguas). @returns {number} cantidad eliminada */
    _purgeMovementsWithZeroStockEffect() {
        const before = (this.movements || []).length;
        this.movements = (this.movements || []).filter(m => !this._movementHasZeroStockEffect(m));
        const removed = before - this.movements.length;
        if (removed > 0) {
            if (typeof I18n !== "undefined" && I18n.t) {
                Utils.showToast(
                    I18n.t("msg.movementsPurgedZeroEffect").replace(/\{n\}/g, String(removed)),
                    "info"
                );
            }
            if (typeof HistoryManager !== "undefined" && HistoryManager.render) {
                HistoryManager.render();
            }
        }
        return removed;
    },

    /**
     * Elimina movimientos sin cambio neto de stock y persiste. Usado al iniciar; puede llamarse desde la consola tras actualizar la app.
     * @returns {number} cuántos se eliminaron
     */
    purgeZeroStockMovementsNow() {
        const removed = this._purgeMovementsWithZeroStockEffect();
        if (removed > 0) {
            Utils.syncMovementRefCounterFromMovements(this.movements);
            this.save();
        }
        return removed;
    },

    _openOverdraftModal() {
        return new Promise((resolve, reject) => {
            const modal = document.getElementById('overdraft-confirm-modal');
            const ta = document.getElementById('overdraft-reason-input');
            if (!modal || !ta) {
                reject(new Error('no-modal'));
                return;
            }
            ta.value = '';
            const confirmBtn = document.getElementById('overdraft-confirm-btn');
            const cancelBtn = document.getElementById('overdraft-cancel-btn');
            const closeBtn = document.getElementById('overdraft-modal-close');
            modal.querySelectorAll('[data-i18n]').forEach(el => {
                const k = el.getAttribute('data-i18n');
                if (k) el.textContent = I18n.t(k);
            });
            const phKey = ta.getAttribute('data-i18n-placeholder');
            if (phKey) ta.placeholder = I18n.t(phKey);

            const cleanup = () => {
                document.removeEventListener('keydown', onKey, true);
                confirmBtn?.removeEventListener('click', onConfirm);
                cancelBtn?.removeEventListener('click', finishCancel);
                closeBtn?.removeEventListener('click', finishCancel);
            };

            const finishCancel = () => {
                cleanup();
                modal.classList.remove('active');
                reject(new Error('cancel'));
            };

            const onConfirm = () => {
                const reason = ta.value.trim();
                if (!reason) {
                    Utils.showToast(I18n.t('msg.overdraftReasonRequired'), 'error');
                    return;
                }
                cleanup();
                modal.classList.remove('active');
                resolve(reason);
            };

            const onKey = e => {
                if (e.key === 'Escape') finishCancel();
            };

            cancelBtn?.addEventListener('click', finishCancel);
            closeBtn?.addEventListener('click', finishCancel);
            confirmBtn?.addEventListener('click', onConfirm);
            document.addEventListener('keydown', onKey, true);
            modal.classList.add('active');
            setTimeout(() => ta.focus(), 50);
        });
    },

    async processMovement() {
        if (!Auth.guardPerm("movements")) return;
        if (typeof Auth !== "undefined" && Auth.guardMovementTypeProcess && !Auth.guardMovementTypeProcess(this.currentType)) return;

        if (this.currentType === 'MAT_ELEC_OBRA') {
            void this._processMovementElecObraWithBoxPrompt();
            return;
        }

        this.syncSelectedItemQuantitiesFromDom();
        if (!this.validateMovement()) return;

        if (typeof App !== "undefined" && App.showConfirmAsync) {
            const ok = await App.showConfirmAsync(I18n.t("confirm.processMovement"));
            if (!ok) return;
        }

        const conf = MOVEMENT_TYPES[this.currentType];
        const needsOverdraftConfirm =
            this.linesWouldOverdraft(this.selectedItems) &&
            conf.specialForm !== 'recepcion' &&
            conf.specialForm !== 'compra';

        if (needsOverdraftConfirm) {
            this._openOverdraftModal()
                .then(reason => void this._executeProcessMovement(reason))
                .catch(() => {});
            return;
        }

        void this._executeProcessMovement('');
    },

    /** Pregunta las cajas totales del movimiento M.E. obra y luego procesa (incl. sobregiro). */
    async _processMovementElecObraWithBoxPrompt() {
        if (!Auth.guardPerm("movements")) return;
        if (typeof Auth !== "undefined" && Auth.guardMovementTypeProcess && !Auth.guardMovementTypeProcess(this.currentType)) return;
        this.syncSelectedItemQuantitiesFromDom();
        if (!this.validateMovement()) return;

        if (typeof App !== "undefined" && App.showConfirmAsync) {
            const ok = await App.showConfirmAsync(I18n.t("confirm.processMovement"));
            if (!ok) return;
        }

        const msg = I18n.t('movements.elecObraPromptMovementBoxes');
        const raw =
            typeof App !== 'undefined' && App.showPrompt
                ? await App.showPrompt({ message: msg, defaultValue: '1', inputType: 'text' })
                : null;
        if (raw === null) return;

        const totalBoxes = Math.max(
            1,
            Math.round(Math.abs(this._parseQuantityInputValue(raw)) || 0) || 1
        );

        const conf = MOVEMENT_TYPES[this.currentType];
        const needsOverdraftConfirm =
            this.linesWouldOverdraft(this.selectedItems) &&
            conf.specialForm !== 'recepcion' &&
            conf.specialForm !== 'compra';

        if (needsOverdraftConfirm) {
            this._openOverdraftModal()
                .then(reason => void this._executeProcessMovement(reason, totalBoxes))
                .catch(() => {});
            return;
        }

        await this._executeProcessMovement('', totalBoxes);
    },

    async _executeProcessMovement(overdraftReason, elecObraTotalBoxes) {
        this.syncSelectedItemQuantitiesFromDom();
        const conf = MOVEMENT_TYPES[this.currentType];
        let projectId = document.getElementById('project-id')?.value?.trim() || '';
        let notes = document.getElementById('movement-notes')?.value?.trim() || '';
        /** AAAA-MM-DD: fecha de recepción real (prioridad en registro de recepción, metadatos de compra y timeline de pedido). */
        let realReceiptYmd = "";

        if (this.currentType === 'COMPRA_STOCK' || this.currentType === 'RECEPCION_MATERIAL') {
            const histEl = document.getElementById(
                this.currentType === 'COMPRA_STOCK'
                    ? 'mov-compra-receipt-historical-date'
                    : 'mov-rec-receipt-historical-date'
            );
            const rawHist = histEl && histEl.value ? String(histEl.value).trim() : '';
            if (rawHist) {
                const parsed = this._parseHistoricalReceiptDateStrict(rawHist);
                if (!parsed) {
                    Utils.showToast(I18n.t('movements.receiptHistoricalDateInvalid'), 'error');
                    return;
                }
                if (parsed.isFuture) {
                    Utils.showToast(I18n.t('movements.receiptHistoricalDateFuture'), 'error');
                    return;
                }
                realReceiptYmd = parsed.label;
                const line = I18n.t('movements.receiptHistoricalNoteLine').replace('{date}', parsed.label);
                notes = notes ? `${notes}\n\n${line}` : line;
            }
        }

        if (this.currentType === 'CONSUMO_DIARIO') {
            projectId = '';
        }

        // Auto-asignar proyecto antes del prompt de lista de chequeo (el ID efectivo debe existir al pedir fecha).
        if (conf.projectAutoAssign && !projectId) {
            projectId = conf.projectAutoAssign;
        }

        /** Lista de chequeo: fecha de expedición antes de aplicar stock (cancelar prompt = no procesar). */
        let listaChequeoExpeditionDate = null;
        if (this.currentType === 'LISTA_CHEQUEO') {
            const pidForTr = (projectId || "").trim();
            if (pidForTr && typeof TransportManager !== 'undefined') {
                const existingTr = TransportManager.getByProject(pidForTr);
                if (!existingTr) {
                    const defaultDate = new Date().toISOString().split('T')[0];
                    const raw = await App.showPrompt({
                        message: I18n.t('prompt.transportExpeditionDate'),
                        defaultValue: defaultDate,
                        inputType: 'date'
                    });
                    if (raw === null) return;
                    listaChequeoExpeditionDate =
                        raw != null && String(raw).trim() ? String(raw).trim() : defaultDate;
                }
            }
        }

        const isEditingStandby = this.currentType === 'STANDBY' && !!this.editingStandbyId;
        const reference = isEditingStandby
            ? (this.movements.find(m => m.id === this.editingStandbyId)?.reference || Utils.generateRef(this.currentType))
            : Utils.generateRef(this.currentType);
        
        const hadOverdraft =
            conf.specialForm === 'recepcion' || conf.specialForm === 'compra'
                ? false
                : this.linesWouldOverdraft(this.selectedItems);

        let receptionId = null;
        let receptionSnapshot = null;
        if (this.currentType === 'RECEPCION_MATERIAL') {
            const recCat = document.getElementById('mov-rec-category')?.value || 'OTRO';
            const recLines = this._getReceptionDraftLines().filter(li => li.itemName && li.quantity > 0);
            if (!recLines.length) return;
            const gpVal = (document.getElementById("mov-rec-glass-packing")?.value || "").trim();
            const glassPackingForRec =
                typeof ReceptionsManager !== "undefined" && ReceptionsManager.isGlassPackingCategory(recCat)
                    ? gpVal === "standard_box" || gpVal === "loose_mixed"
                        ? gpVal
                        : null
                    : null;
            const sharedSupplier = document.getElementById('mov-rec-supplier')?.value?.trim() || '';
            const sharedPo = document.getElementById('mov-rec-po')?.value?.trim() || '';
            const sharedProv = document.getElementById('mov-rec-provisional')?.checked || false;
            const recCreated = [];
            for (const line of recLines) {
                const dimensionsItems = await this._collectReceptionDimensionsPerUnit(line.quantity, line.dimensions);
                if (dimensionsItems === null) return;
                const recData = {
                    projectId,
                    itemName: line.itemName,
                    quantity: line.quantity,
                    supplier: sharedSupplier,
                    container: '',
                    combinesWith: [],
                    dimensions: line.dimensions,
                    dimensionsItems,
                    dimensionUnit: "in",
                    glassPacking: glassPackingForRec,
                    materialCategory: recCat,
                    purchaseOrder: sharedPo,
                    provisional: sharedProv,
                    ...(realReceiptYmd ? { realReceiptDate: realReceiptYmd } : {})
                };
                const rec = ReceptionsManager.registerReception(recData, { skipToast: true });
                if (!rec) return;
                recCreated.push(rec);
            }
            receptionId = recCreated.length === 1 ? recCreated[0].id : null;
            receptionSnapshot = recCreated.length === 1
                ? {
                    materialCategory: recCreated[0].materialCategory,
                    itemName: recCreated[0].itemName,
                    projectId: recCreated[0].projectId,
                    purchaseOrder: recCreated[0].purchaseOrder,
                    quantity: recCreated[0].quantity,
                    provisional: recCreated[0].provisional,
                    dimensions: recCreated[0].dimensions,
                    dimensionUnit: recCreated[0].dimensionUnit || "in",
                    glassPacking: recCreated[0].glassPacking || null,
                    supplier: recCreated[0].supplier,
                    dateReceived: recCreated[0].dateReceived
                  }
                : {
                    materialCategory: recCat,
                    itemName: I18n.t("reception.multipleItemsLabel"),
                    projectId,
                    purchaseOrder: sharedPo,
                    quantity: recCreated.reduce((a, r) => a + (parseFloat(r.quantity) || 0), 0),
                    provisional: sharedProv,
                    dimensions: { L: 0, W: 0, H: 0 },
                    dimensionUnit: "in",
                    glassPacking: glassPackingForRec || null,
                    supplier: sharedSupplier,
                    dateReceived: recCreated[0]?.dateReceived || new Date().toISOString(),
                    receptions: recCreated.map(r => ({
                        id: r.id,
                        itemName: r.itemName,
                        quantity: r.quantity,
                        dimensions: r.dimensions
                    }))
                  };
        }

        const packingSlip = document.getElementById('mov-compra-slip')?.value?.trim() || '';

        let transformationTargetItemId = null;
        let transformationTargetCode = '';
        let transformationTargetDescription = '';
        let transformationTargetCreatedNew = false;
        let transformationOutputQuantity = 0;

        if (this.currentType === 'TRANSFORMACION') {
            if (this.getTransformationTargetMode() === 'new') {
                const code = document.getElementById('mov-tf-new-code')?.value?.trim() || '';
                const desc = document.getElementById('mov-tf-new-desc')?.value?.trim() || '';
                const category = document.getElementById('mov-tf-new-category')?.value?.trim() || '';
                const low = code.toLowerCase();
                const dup = InventoryManager.items.find(i => (i.code || '').trim().toLowerCase() === low);
                if (dup) {
                    Utils.showToast(I18n.t('msg.transformationCodeDuplicate'), 'error');
                    return;
                }
                const newItem = InventoryManager.addItem({
                    code,
                    description: desc,
                    category,
                    mainStock: 0,
                    prodStock: 0,
                    transStock: 0
                });
                transformationTargetItemId = newItem.id;
                transformationTargetCreatedNew = true;
                transformationTargetCode = newItem.code || '';
                transformationTargetDescription = newItem.description || '';
            } else {
                transformationTargetItemId = this.transformationTargetItemId;
                const ti = InventoryManager.items.find(i => i.id === transformationTargetItemId);
                if (ti) {
                    transformationTargetCode = ti.code || '';
                    transformationTargetDescription = ti.description || '';
                }
            }
            const sourceIds = new Set(this.selectedItems.map(i => i.itemId));
            if (transformationTargetItemId && sourceIds.has(transformationTargetItemId)) {
                Utils.showToast(I18n.t('msg.transformationTargetSameAsSource'), 'error');
                if (transformationTargetCreatedNew && transformationTargetItemId) {
                    InventoryManager.deleteItem(transformationTargetItemId);
                }
                return;
            }
            transformationOutputQuantity = this._parseQuantityInputValue(document.getElementById('mov-transformacion-output-qty')?.value);
            if (!Number.isFinite(transformationOutputQuantity) || transformationOutputQuantity <= 0) {
                Utils.showToast(I18n.t('msg.transformationOutputQtyRequired'), 'error');
                if (transformationTargetCreatedNew && transformationTargetItemId) {
                    InventoryManager.deleteItem(transformationTargetItemId);
                }
                return;
            }
        }

        let mappedItems =
            this.currentType === 'RECEPCION_MATERIAL'
                ? []
                : this.selectedItems.map(item => ({
                      ...item,
                      annulled: false
                  }));
        if (
            this.currentType === "COMPRA_STOCK" &&
            typeof this.isCompraConsumibleReceiptMode === "function" &&
            this.isCompraConsumibleReceiptMode() &&
            typeof ConsumableManager !== "undefined"
        ) {
            const canon = ConsumableManager.canonicalConsumable(this._getCompraConsumibleNameRaw());
            const qAbs = this._parseQuantityInputValue(document.getElementById("mov-compra-consumible-qty")?.value);
            mappedItems = [
                {
                    consumableReceipt: true,
                    itemId: null,
                    code: canon || "",
                    description: canon || "",
                    quantity: Utils.roundDecimal(Math.abs(qAbs)),
                    target: "main",
                    annulled: false,
                    compraLinePo: document.getElementById("mov-compra-consumible-po")?.value?.trim() || "",
                    compraLineSupplier: document.getElementById("mov-compra-consumible-supplier")?.value?.trim() || ""
                }
            ];
        }
        if (
            this.currentType === 'CONSUMO_DIARIO' &&
            typeof EmployeeManager !== 'undefined' &&
            EmployeeManager.isEnforced &&
            EmployeeManager.isEnforced()
        ) {
            mappedItems = mappedItems.map(li => ({
                ...li,
                recipientName:
                    EmployeeManager.canonicalRecipientName(li.recipientName) || String(li.recipientName || '').trim()
            }));
        }

        if (this.currentType === "CONSUMO_DIARIO") {
            mappedItems = mappedItems.map(li => {
                const out = { ...li };
                const ts = Date.parse(String(li?.consumoAddedAt || ""));
                out.lineAddedAt = Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
                delete out.recipientClass;
                delete out.consumoRecipientEntry;
                delete out.consumoAddedAt;
                return out;
            });
        }

        mappedItems = mappedItems.map(li =>
            li && typeof li.quantity !== "undefined"
                ? { ...li, quantity: Utils.roundDecimal(li.quantity) }
                : li
        );
        if (this.currentType === "COMPRA_STOCK") {
            const duplicate = (this.movements || []).some(m => {
                if (!m || m.annulled || m.type !== "COMPRA_STOCK") return false;
                const lineKey = it =>
                    `${it?.itemId || ""}|${String(it?.description || "").trim().toLowerCase()}|${Utils.roundDecimal(Math.abs(parseFloat(it?.quantity) || 0))}|${String(it?.compraLinePo || "").trim().toLowerCase()}|${String(it?.compraLineSupplier || "").trim().toLowerCase()}`;
                const a = (m.items || [])
                    .map(lineKey)
                    .sort()
                    .join(";");
                const b = (mappedItems || [])
                    .map(lineKey)
                    .sort()
                    .join(";");
                return a && a === b;
            });
            if (duplicate) {
                Utils.showToast(I18n.t("msg.compraDuplicateBlocked"), "warning");
                return;
            }
        }
        mappedItems = mappedItems.map(li => {
            if (!li || li.consumableReceipt || li.itemId == null) return li;
            if (typeof InventoryManager === "undefined") return li;
            const src = this._getLineStockSourceId(li);
            if (src.startsWith("box:")) {
                const bid = src.slice(4);
                const boxes = InventoryManager.getItemBoxStocks(li.itemId) || [];
                let box = boxes.find(b => String(b.boxId) === String(bid));
                if (!box && li.boxNumber != null) {
                    const n = parseInt(li.boxNumber, 10);
                    if (Number.isFinite(n)) box = boxes.find(b => Number(b.boxNumber) === n);
                }
                if (!box) return { ...li, boxId: bid, boxNumber: li.boxNumber };
                return {
                    ...li,
                    boxId: box.boxId,
                    boxNumber: box.boxNumber,
                    boxLocationLabel: box.locationLabel || ""
                };
            }
            if (src.startsWith("ibox:")) {
                const n = parseInt(src.slice(5), 10);
                return {
                    ...li,
                    inferredBoxFromLocation: true,
                    boxNumber: Number.isFinite(n) ? n : undefined
                };
            }
            if (src.startsWith("loc:")) {
                let raw = "";
                try {
                    raw = decodeURIComponent(src.slice(4));
                } catch (e) {
                    raw = "";
                }
                const canon = Utils.strictEffectiveWarehouseLocationText(raw) || raw;
                return {
                    ...li,
                    locationStockKey: canon,
                    locationStockLabel: canon,
                    locationConsumedFromStockRow: this._predictLocationConsumedFromStockRow(li)
                };
            }
            return li;
        });

        let expiredStockOverrideReason = "";
        const pidTrim = (projectId || "").trim();
        if (
            pidTrim &&
            typeof InventoryManager !== "undefined" &&
            InventoryManager.movementWouldConsumeExpiredStockForProject
        ) {
            if (InventoryManager.movementWouldConsumeExpiredStockForProject(this, mappedItems, this.currentType)) {
                const msg = I18n.t("msg.expiredStockProjectPrompt");
                const raw =
                    typeof App !== "undefined" && App.showPrompt
                        ? await App.showPrompt({ message: msg, defaultValue: "", inputType: "text" })
                        : null;
                if (raw === null) return;
                const reason = String(raw || "").trim();
                if (!reason) {
                    Utils.showToast(I18n.t("msg.expiredStockOverrideRequired"), "error");
                    return;
                }
                expiredStockOverrideReason = reason;
            }
        }

        let movementDateIso = new Date().toISOString();
        if (this.currentType === "CONSUMO_DIARIO") {
            const stamps = (this.selectedItems || []).map(li => li.consumoAddedAt).filter(Boolean);
            const ms = stamps.map(s => Date.parse(String(s))).filter(t => Number.isFinite(t));
            if (ms.length) movementDateIso = new Date(Math.min(...ms)).toISOString();
        }

        const movement = {
            id: Utils.generateId(),
            reference: reference,
            type: this.currentType,
            projectId: projectId,
            notes: notes,
            date: movementDateIso,
            items: mappedItems,
            hadOverdraft: hadOverdraft,
            annulled: false,
            attachments: []
        };
        movement.createdBy = Auth.getDisplayName();
        if (expiredStockOverrideReason) {
            movement.expiredStockOverrideReason = expiredStockOverrideReason;
        }

        if (
            this.currentType === 'MAT_ELEC_OBRA' &&
            typeof elecObraTotalBoxes === 'number' &&
            Number.isFinite(elecObraTotalBoxes)
        ) {
            movement.elecObraBoxCount = Math.max(1, Math.round(elecObraTotalBoxes));
        }

        if (this.currentType === 'TRANSFORMACION') {
            const tv = document.getElementById('mov-transformacion-vendor')?.value?.trim() || '';
            if (tv) movement.transformationVendor = tv;
            if (transformationTargetItemId) {
                movement.transformationTargetItemId = transformationTargetItemId;
                movement.transformationTargetCode = transformationTargetCode;
                movement.transformationTargetDescription = transformationTargetDescription;
                if (transformationTargetCreatedNew) movement.transformationTargetCreatedNew = true;
            }
            movement.transformationOutputQuantity = Utils.roundDecimal(transformationOutputQuantity);
            movement.transformationOutputTarget = 'main';
            if (transformationTargetItemId && transformationOutputQuantity > 0) {
                const tiLoc = InventoryManager.items.find(i => i.id === transformationTargetItemId);
                movement.items.push({
                    itemId: transformationTargetItemId,
                    code: transformationTargetCode,
                    description: transformationTargetDescription,
                    quantity: transformationOutputQuantity,
                    target: 'main',
                    location: (tiLoc && tiLoc.location) || '',
                    annulled: false,
                    transformationOutput: true
                });
            }
        }

        if (hadOverdraft && overdraftReason) {
            movement.overdraftReason = overdraftReason;
            movement.overdraftAt = new Date().toISOString();
        }

        // COMPRA_STOCK: mismo formulario siempre; orderLineId solo si venía del panel y el movimiento coincide.
        if (this.currentType === 'COMPRA_STOCK') {
            movement.purchaseMeta = {
                packingSlip,
                ...(realReceiptYmd ? { realReceiptDate: realReceiptYmd } : {})
            };
            if (typeof ConfigManager !== 'undefined' && ConfigManager.getPurchaseOrders && ConfigManager.savePurchaseOrders) {
                const orders = ConfigManager.getPurchaseOrders();
                for (const li of movement.items || []) {
                    const poNum = String(li?.compraLinePo || '').trim();
                    const supLi = String(li?.compraLineSupplier || '').trim();
                    if (!poNum || !supLi) continue;
                    const supplierPoNorm = supLi.toLowerCase();
                    const exists = orders.some(
                        o =>
                            (o.poNumber || '').trim().toLowerCase() === poNum.toLowerCase() &&
                            String(o.supplier || '').trim().toLowerCase() === supplierPoNorm
                    );
                    if (!exists) {
                        orders.push({
                            id: Utils.generateId(),
                            poNumber: poNum,
                            projectId: '',
                            supplier: supLi,
                            notes: notes || '',
                            status: 'open',
                            created: new Date().toISOString()
                        });
                    }
                }
                ConfigManager.savePurchaseOrders(orders);
            }
            const receiptDate = realReceiptYmd || new Date().toISOString().slice(0, 10);
            (movement.items || []).forEach(li => {
                if (!li || li.consumableReceipt || !li.itemId) return;
                const inv = InventoryManager.items.find(x => x.id === li.itemId);
                if (!inv) return;
                const patch = { lastOrder: receiptDate };
                if (inv.inventoryConsumable) {
                    const qRecv = Math.max(0, Utils.roundDecimal(Math.abs(parseFloat(li.quantity) || 0)));
                    const prevMain = Math.max(0, Utils.roundDecimal(parseFloat(inv.mainStock) || 0));
                    patch.mainStock = Utils.roundDecimal(prevMain + qRecv);
                    patch.prodStock = 0;
                    patch.transStock = 0;
                }
                InventoryManager.updateItem(li.itemId, patch);
            });
            if (this.pendingOrderLineReceipt) {
                const pen = this.pendingOrderLineReceipt;
                let attach = false;
                if (typeof OrderLinesManager !== 'undefined' && OrderLinesManager.tryAttachOrderLineReceipt) {
                    attach = OrderLinesManager.tryAttachOrderLineReceipt(movement, pen);
                }
                if (attach) {
                    movement.orderLineId = pen.orderLineId;
                } else if (pen) {
                    Utils.showToast(I18n.t('orderLines.msgReceiptLinkMismatch'), 'warning');
                }
                this.pendingOrderLineReceipt = null;
            }
            if (this.pendingOrderLineBatchReceipts) {
                const attachBatch = [];
                const usedMovementLineIdx = new Set();
                for (const pen of this.pendingOrderLineBatchReceipts) {
                    let attach = false;
                    if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.tryAttachOrderLineReceipt) {
                        attach = OrderLinesManager.tryAttachOrderLineReceipt(movement, pen, usedMovementLineIdx);
                    }
                    if (attach) attachBatch.push(pen);
                }
                if (attachBatch.length) {
                    movement.orderLineBatchReceipts = attachBatch;
                } else {
                    Utils.showToast(I18n.t('orderLines.msgReceiptLinkMismatch'), 'warning');
                }
                this.pendingOrderLineBatchReceipts = null;
            }
        }

        if (receptionId) {
            movement.receptionId = receptionId;
            movement.receptionSnapshot = receptionSnapshot;
        }

        // STANDBY no impacta inventario hasta procesarse
        if (this.currentType === 'STANDBY') {
            const standbyReleaseType = document.getElementById('standby-release-type')?.value || 'AJUSTE';
            movement.pending = true;
            movement.pendingSince = new Date().toISOString();
            movement.standbyReleaseType = standbyReleaseType;
        } else if (this.currentType !== 'RECEPCION_MATERIAL') {
            mappedItems.forEach(item => {
                this._applyStockChangeForLine(item, this.currentType);
            });
            if (
                this.currentType === 'TRANSFORMACION' &&
                transformationTargetItemId &&
                transformationOutputQuantity > 0
            ) {
                InventoryManager.updateStock(transformationTargetItemId, 'main', transformationOutputQuantity);
            }
        }

        if (isEditingStandby) {
            const idx = this.movements.findIndex(m => m.id === this.editingStandbyId);
            if (idx !== -1) {
                const prev = this.movements[idx];
                const keepAttachments = Array.isArray(prev.attachments) ? [...prev.attachments] : [];
                this.movements[idx] = {
                    ...prev,
                    ...movement,
                    id: this.editingStandbyId,
                    reference,
                    attachments: keepAttachments
                };
            } else {
                this.movements.push(movement);
            }
        } else {
            this.movements.push(movement);
        }
        this.save();
        Auth.logAudit("movement.create", `${this.currentType} ${reference} by ${Auth.getDisplayName()}`);
        this.editingStandbyId = null;
        this.updateEditingBadge();

        if (
            !isEditingStandby &&
            this.currentType === 'COMPRA_STOCK' &&
            movement.orderLineId &&
            typeof OrderLinesManager !== 'undefined' &&
            OrderLinesManager.commitReceiptAfterCompra
        ) {
            OrderLinesManager.commitReceiptAfterCompra(movement);
        }
        if (
            !isEditingStandby &&
            this.currentType === 'COMPRA_STOCK' &&
            Array.isArray(movement.orderLineBatchReceipts) &&
            movement.orderLineBatchReceipts.length &&
            typeof OrderLinesManager !== 'undefined' &&
            OrderLinesManager.commitBatchReceiptAfterCompra
        ) {
            OrderLinesManager.commitBatchReceiptAfterCompra(movement);
        }

        if (
            !isEditingStandby &&
            this.currentType === 'COMPRA_STOCK' &&
            !movement.orderLineId &&
            typeof OrderLinesManager !== 'undefined' &&
            OrderLinesManager.offerBackfillFromStandaloneCompra
        ) {
            void OrderLinesManager.offerBackfillFromStandaloneCompra(movement);
        }

        if (!isEditingStandby && this.currentType === 'LISTA_CHEQUEO' && projectId) {
            const existing = typeof TransportManager !== 'undefined' ? TransportManager.getByProject(projectId) : null;
            const expedition = !existing ? listaChequeoExpeditionDate : null;
            if (typeof TransportManager !== 'undefined') {
                TransportManager.ensureFromChecklist(movement, expedition);
            }
        }
        if (!isEditingStandby && this.currentType === 'MAT_ELEC_OBRA' && projectId) {
            if (typeof TransportManager !== 'undefined') {
                TransportManager.attachElecObra(movement);
            }
            if (
                typeof MELegacyPendingManager !== 'undefined' &&
                typeof MELegacyPendingManager.recordFromMovement === 'function'
            ) {
                MELegacyPendingManager.recordFromMovement(movement);
            }
        }
        if (!isEditingStandby && this.currentType === 'MAT_ELEC_PROD' && projectId) {
            if (typeof TransportManager !== 'undefined') {
                TransportManager.attachElecProd(movement);
            }
        }

        if (this.currentType === 'STANDBY') {
            Utils.showToast(`${I18n.t('msg.standbySaved')} (${reference})`, 'info');
        } else {
            Utils.showToast(`${I18n.t('msg.movementProcessed')} (${reference})`, 'success');
        }
        if (projectId) Utils.warnProjectIdFormatIfNeeded(projectId);

        if (this.currentType === 'CONSUMO_DIARIO' && !isEditingStandby) {
            if (this._consumoAutoDayMark) {
                try {
                    localStorage.setItem(STORAGE_KEYS.CONSUMO_AUTO_DAY, this._consumoAutoDayMark);
                } catch (e) {}
                this._consumoAutoDayMark = null;
            }
            this.consumoCart = [];
            try {
                localStorage.setItem(STORAGE_KEYS.CONSUMO_CART, '[]');
            } catch (e) {}
            this._touchConsumoCartActivityDay();
            this.renderConsumoCartFloat();
            this.selectType('CONSUMO_DIARIO');
            if (typeof HistoryManager !== 'undefined' && HistoryManager.renderConsumoRecipientLedger) {
                HistoryManager.renderConsumoRecipientLedger();
            }
            const notesEl = document.getElementById('movement-notes');
            if (notesEl) notesEl.value = '';
            const itemSearch = document.getElementById('item-search');
            const searchResults = document.getElementById('item-search-results');
            if (itemSearch) itemSearch.value = '';
            if (searchResults) {
                searchResults.innerHTML = '';
                searchResults.classList.remove('active');
            }
        } else {
            this.resetForm();
        }

        InventoryManager.render();
    },

    async _collectReceptionDimensionsPerUnit(qty, defaultDims) {
        const q = Math.max(0, Math.floor(parseFloat(qty) || 0));
        if (q <= 1) return [];
        const hasDefault =
            (parseFloat(defaultDims?.L) || 0) > 0 ||
            (parseFloat(defaultDims?.W) || 0) > 0 ||
            (parseFloat(defaultDims?.H) || 0) > 0;
        const ask = await App.showConfirmAsync(I18n.t("confirm.receptionAskUnitDimensions"));
        if (!ask) return hasDefault ? [] : [];
        const out = [];
        for (let i = 0; i < q; i++) {
            const baseL = i === 0 ? String(defaultDims?.L || "") : String(out[i - 1]?.L || "");
            const baseW = i === 0 ? String(defaultDims?.W || "") : String(out[i - 1]?.W || "");
            const baseH = i === 0 ? String(defaultDims?.H || "") : String(out[i - 1]?.H || "");
            const unitNo = String(i + 1);
            const lRaw = await App.showPrompt({
                message: I18n.t("prompt.receptionDimUnitL").replace("{n}", unitNo),
                defaultValue: baseL,
                inputType: "text"
            });
            if (lRaw === null) return null;
            const wRaw = await App.showPrompt({
                message: I18n.t("prompt.receptionDimUnitW").replace("{n}", unitNo),
                defaultValue: baseW,
                inputType: "text"
            });
            if (wRaw === null) return null;
            const hRaw = await App.showPrompt({
                message: I18n.t("prompt.receptionDimUnitH").replace("{n}", unitNo),
                defaultValue: baseH,
                inputType: "text"
            });
            if (hRaw === null) return null;
            out.push({
                L: Math.max(0, parseFloat(String(lRaw).replace(",", ".")) || 0),
                W: Math.max(0, parseFloat(String(wRaw).replace(",", ".")) || 0),
                H: Math.max(0, parseFloat(String(hRaw).replace(",", ".")) || 0)
            });
        }
        return out;
    },

    async processStandby(movementId) {
        if (!Auth.guardPerm("movements")) return;
        const movement = this.movements.find(m => m.id === movementId);
        if (!movement || movement.annulled || movement.type !== 'STANDBY') return;
        const targetType = movement.standbyReleaseType;
        if (typeof Auth !== "undefined" && Auth.guardMovementTypeProcess && !Auth.guardMovementTypeProcess(targetType)) return;
        if (!MOVEMENT_TYPES[targetType] || targetType === 'STANDBY') {
            Utils.showToast(I18n.t('msg.standbyInvalidReleaseType'), 'warning');
            return;
        }

        const conf = MOVEMENT_TYPES[targetType];
        let projectId = (movement.projectId || '').trim();
        if (targetType === "CONSUMO_DIARIO") {
            projectId = "";
        } else if (conf.projectAutoAssign && !projectId) {
            projectId = conf.projectAutoAssign;
        }
        if (conf.projectRequired && !projectId) {
            const provided = await App.showPrompt({
                message: I18n.t('msg.standbyProjectIdPrompt'),
                defaultValue: '',
                inputType: 'text'
            });
            if (provided === null) return;
            projectId = (provided || '').trim();
            if (!projectId) {
                Utils.showToast(I18n.t('msg.standbyMissingProjectId'), 'error');
                return;
            }
        }

        let elecObraBoxCount = null;
        if (targetType === 'MAT_ELEC_OBRA') {
            const br = await App.showPrompt({
                message: I18n.t('movements.elecObraPromptMovementBoxes'),
                defaultValue: '1',
                inputType: 'text'
            });
            if (br === null) return;
            elecObraBoxCount = Math.max(
                1,
                Math.round(Math.abs(this._parseQuantityInputValue(br)) || 0) || 1
            );
        }

        const defaultTarget = this.getDefaultTarget(targetType);
        const normalizedItems = movement.items.map(item => {
            const isXfer = targetType === 'TRANSFERENCIA' && this._isTransferLine(item);
            const quantity = isXfer
                ? Math.abs(parseFloat(item.quantity) || 0)
                : this.normalizeQuantityForType(item.quantity, targetType);
            return {
                ...item,
                target: conf.multiTarget ? item.target : defaultTarget,
                quantity
            };
        });

        if (!this._validateQuantitiesNonZero(normalizedItems)) return;

        const wouldOverdraft = this.linesWouldOverdraft(normalizedItems, targetType);
        if (wouldOverdraft) {
            this._openOverdraftModal()
                .then(reason =>
                    void this._finishProcessStandby(
                        movementId,
                        normalizedItems,
                        projectId,
                        targetType,
                        reason,
                        elecObraBoxCount
                    )
                )
                .catch(() => {});
            return;
        }

        void this._finishProcessStandby(movementId, normalizedItems, projectId, targetType, '', elecObraBoxCount);
    },

    async _finishProcessStandby(movementId, normalizedItems, projectId, targetType, overdraftReason, elecObraBoxCount) {
        const movement = this.movements.find(m => m.id === movementId);
        if (!movement || movement.annulled || movement.type !== 'STANDBY') return;

        /** Lista de chequeo desde Stand-by: pedir fecha de expedición ANTES de tocar stock (cancelar = no procesar). */
        let listaStandbyExpedition = null;
        if (targetType === 'LISTA_CHEQUEO' && projectId && typeof TransportManager !== 'undefined') {
            const existing = TransportManager.getByProject(projectId);
            if (!existing) {
                const defaultDate = new Date().toISOString().split('T')[0];
                const raw = await App.showPrompt({
                    message: I18n.t('prompt.transportExpeditionDate'),
                    defaultValue: defaultDate,
                    inputType: 'date'
                });
                if (raw === null) return;
                listaStandbyExpedition =
                    raw != null && String(raw).trim() ? String(raw).trim() : defaultDate;
            }
        }

        const hadOverdraft = this.linesWouldOverdraft(normalizedItems, targetType);

        normalizedItems.forEach(item => {
            this._applyStockChangeForLine(item, targetType);
        });

        movement.items = normalizedItems;
        movement.type = targetType;
        movement.projectId = projectId;
        movement.pending = false;
        movement.processedFromStandby = true;
        movement.processedAt = new Date().toISOString();
        movement.hadOverdraft = hadOverdraft;
        if (targetType === 'MAT_ELEC_OBRA' && typeof elecObraBoxCount === 'number' && Number.isFinite(elecObraBoxCount)) {
            movement.elecObraBoxCount = Math.max(1, Math.round(elecObraBoxCount));
        }
        if (hadOverdraft && overdraftReason) {
            movement.overdraftReason = overdraftReason;
            movement.overdraftAt = new Date().toISOString();
        } else {
            delete movement.overdraftReason;
            delete movement.overdraftAt;
        }
        this.save();
        Auth.logAudit("standby.process", `${movementId} → ${targetType} by ${Auth.getDisplayName()}`);

        if (targetType === 'LISTA_CHEQUEO' && projectId && typeof TransportManager !== 'undefined') {
            const existing = TransportManager.getByProject(projectId);
            const expedition = !existing ? listaStandbyExpedition : null;
            TransportManager.ensureFromChecklist(movement, expedition);
        }
        if (targetType === 'MAT_ELEC_OBRA' && projectId) {
            if (typeof TransportManager !== 'undefined') {
                TransportManager.attachElecObra(movement);
            }
            if (
                typeof MELegacyPendingManager !== 'undefined' &&
                typeof MELegacyPendingManager.recordFromMovement === 'function'
            ) {
                MELegacyPendingManager.recordFromMovement(movement);
            }
        }
        if (targetType === 'MAT_ELEC_PROD' && projectId) {
            if (typeof TransportManager !== 'undefined') {
                TransportManager.attachElecProd(movement);
            }
        }

        if (projectId) Utils.warnProjectIdFormatIfNeeded(projectId);

        Utils.showToast(`${I18n.t('msg.standbyProcessedAs')} ${I18n.t(`movType.${targetType}`)}`, 'success');
        InventoryManager.render();
        HistoryManager.render();
    },

    cancelStandby(movementId) {
        const movement = this.movements.find(m => m.id === movementId);
        if (!movement || movement.annulled || movement.type !== 'STANDBY') return;
        if (!Auth.guardPerm("movements")) return;
        movement.annulled = true;
        movement.cancelled = true;
        movement.cancelledAt = new Date().toISOString();
        this.save();
        Auth.logAudit("standby.cancel", `${movement.reference} by ${Auth.getDisplayName()}`);
        Utils.showToast(I18n.t('msg.standbyCancelled'), 'warning');
        HistoryManager.render();
    },

    editStandby(movementId) {
        const movement = this.movements.find(m => m.id === movementId);
        if (!movement || movement.annulled || movement.type !== 'STANDBY') return;

        this.selectType('STANDBY');
        this.editingStandbyId = movementId;
        this.updateEditingBadge();
        this.selectedItems = (movement.items || []).map(item => ({
            itemId: item.itemId,
            code: item.code,
            description: item.description,
            quantity: item.quantity,
            target: item.target || 'main',
            transferFrom: item.transferFrom,
            transferTo: item.transferTo,
            location: item.location || '',
            stockSourceId: item.stockSourceId || '',
            boxId: item.boxId || '',
            boxNumber: item.boxNumber,
            locationStockKey: item.locationStockKey || '',
            locationConsumedFromStockRow: item.locationConsumedFromStockRow,
            recipientName: item.recipientName,
            consumoAddedAt: item.consumoAddedAt || item.lineAddedAt,
            annulled: false
        }));
        this.selectedItems.forEach(it => {
            const src = this._getLineStockSourceId(it);
            if (!src.startsWith('box:') || typeof InventoryManager === 'undefined') return;
            if (it.boxNumber != null && it.boxNumber !== '') return;
            const bid = src.slice(4);
            const b = (InventoryManager.getItemBoxStocks(it.itemId) || []).find(x => String(x.boxId) === String(bid));
            if (b && Number.isFinite(Number(b.boxNumber))) it.boxNumber = Number(b.boxNumber);
        });

        const projectId = document.getElementById('project-id');
        if (projectId) projectId.value = movement.projectId || '';
        const notes = document.getElementById('movement-notes');
        if (notes) notes.value = movement.notes || '';
        const releaseType = document.getElementById('standby-release-type');
        if (releaseType) {
            this.populateStandbyReleaseTypes();
            releaseType.value = movement.standbyReleaseType || 'AJUSTE';
        }

        this.renderSelectedItems();
        App.switchTab('movements');
        Utils.showToast(`${I18n.t('msg.standbyEditing')} ${movement.reference}`, 'info');
    },

    annulMovement(movementId, forceConfirmed = false) {
        if (!Auth.guardPerm("movements")) return;
        const movement = this.movements.find(m => m.id === movementId);
        if (!movement || movement.annulled) return;
        if (!forceConfirmed) {
            const proceed = () => this.annulMovement(movementId, true);
            if (typeof App !== "undefined" && App.showConfirm) {
                App.showConfirm(I18n.t("confirm.annulMovement"), proceed);
            } else if (window.confirm(I18n.t("confirm.annulMovement"))) {
                proceed();
            }
            return;
        }

        // Solo revertir si el movimiento ya impactó inventario
        if (!movement.pending) {
            if (movement.type === 'RECEPCION_MATERIAL' && movement.receptionId) {
                if (typeof ReceptionsManager !== 'undefined' && ReceptionsManager.revertAndRemoveReception) {
                    ReceptionsManager.revertAndRemoveReception(movement.receptionId);
                }
            } else {
                movement.items.forEach(item => {
                    if (item.annulled) return;
                    this._revertAppliedMovementLine(item, movement.type);
                });
                // Transformación antigua: entrada a principal solo en metadatos (sin línea transformationOutput en items)
                const hasTfOutLine = (movement.items || []).some(line => line && line.transformationOutput);
                if (
                    movement.type === 'TRANSFORMACION' &&
                    !hasTfOutLine &&
                    movement.transformationTargetItemId &&
                    movement.transformationOutputQuantity != null
                ) {
                    const q = parseFloat(movement.transformationOutputQuantity) || 0;
                    if (q !== 0) {
                        InventoryManager.updateStock(movement.transformationTargetItemId, 'main', -q);
                    }
                }
            }
        }

        movement.annulled = true;
        movement.items.forEach(item => item.annulled = true);
        this.save();
        Auth.logAudit("movement.annul", `${movement.reference} by ${Auth.getDisplayName()}`);

        if (typeof TransportManager !== 'undefined' && TransportManager.onMovementAnnulled) {
            TransportManager.onMovementAnnulled(movement);
        }

        Utils.showToast(I18n.t('msg.movementAnnulled'), 'success');
        InventoryManager.render();
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.render();
            if (
                HistoryManager.currentMovement &&
                String(HistoryManager.currentMovement.id) === String(movementId)
            ) {
                HistoryManager.showMovementDetail(movementId);
            }
        }
    },

    annulMovementItem(movementId, itemIndex, forceConfirmed = false) {
        if (!Auth.guardPerm("movements")) return;
        const movement = this.movements.find(m => m.id === movementId);
        if (!movement || movement.annulled) return;
        if (movement.type === 'TRANSFORMACION') {
            Utils.showToast(I18n.t('msg.transformationAnnulItemBlocked'), 'warning');
            return;
        }

        const item = movement.items[itemIndex];
        if (!item || item.annulled) return;
        if (movement.type === 'RECEPCION_MATERIAL') return;
        if (!forceConfirmed) {
            const proceed = () => this.annulMovementItem(movementId, itemIndex, true);
            if (typeof App !== "undefined" && App.showConfirm) {
                App.showConfirm(I18n.t("confirm.annulItem"), proceed);
            } else if (window.confirm(I18n.t("confirm.annulItem"))) {
                proceed();
            }
            return;
        }

        // Revertir solo si este movimiento ya fue aplicado al stock
        if (!movement.pending) {
            this._revertAppliedMovementLine(item, movement.type);
        }
        item.annulled = true;
        const stillActive = (movement.items || []).some(it => it && !it.annulled);
        if (!stillActive) {
            movement.annulled = true;
            if (typeof TransportManager !== 'undefined' && TransportManager.onMovementAnnulled) {
                TransportManager.onMovementAnnulled(movement);
            }
        }
        this.save();
        Auth.logAudit("movement.annul.item", `${movement.reference}[${itemIndex}] by ${Auth.getDisplayName()}`);

        Utils.showToast(I18n.t('msg.itemAnnulled'), 'success');
        InventoryManager.render();
        if (typeof HistoryManager !== 'undefined') {
            if (HistoryManager.maybeRefreshConsumoLedger) HistoryManager.maybeRefreshConsumoLedger();
            HistoryManager.render();
            if (
                HistoryManager.currentMovement &&
                String(HistoryManager.currentMovement.id) === String(movementId)
            ) {
                HistoryManager.showMovementDetail(movementId);
            }
        }
    },

    getMovementById(id) {
        const sid = id == null ? "" : String(id);
        return this.movements.find(m => String(m.id) === sid);
    },

    async addMovementAttachments(movementId) {
        if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return false;
        const m = this.getMovementById(movementId);
        if (!m) return false;
        if (!Utils.canLinkLocalAttachments()) {
            Utils.showToast(I18n.t("msg.attachmentsLinkUnsupported"), "warning");
            return false;
        }
        let picked;
        try {
            picked = await window.showOpenFilePicker({ multiple: true });
        } catch (e) {
            if (e && e.name === "AbortError") return false;
            console.error(e);
            Utils.showToast((e && e.message) || I18n.t("msg.attachmentsLinkError"), "error");
            return false;
        }
        const handles = Array.isArray(picked) ? picked : [picked];
        if (!handles.length) return false;
        if (!Array.isArray(m.attachments)) m.attachments = [];
        const { saved } = await Utils.saveLinkedAttachmentHandles(handles);
        if (saved && saved.length) {
            m.attachments.push(...saved);
            this.save();
            if (typeof Auth !== "undefined" && Auth.logAudit) {
                Auth.logAudit("movement.attach", `${m.reference}: +${saved.length} file(s) linked`);
            }
            return true;
        }
        Utils.showToast(I18n.t("msg.attachmentsLinkError"), "warning");
        return false;
    },

    async removeMovementAttachment(movementId, attachmentId) {
        if (typeof Auth !== "undefined" && !Auth.guardPerm("movements")) return false;
        const m = this.getMovementById(movementId);
        if (!m || !Array.isArray(m.attachments)) return false;
        const idx = m.attachments.findIndex(a => a && a.id === attachmentId);
        if (idx < 0) return false;
        const att = m.attachments[idx];
        await Utils.removeLinkedAttachmentHandle(att.id);
        m.attachments.splice(idx, 1);
        this.save();
        if (typeof Auth !== "undefined" && Auth.logAudit) {
            Auth.logAudit("movement.attach.remove", `${m.reference}: ${att.fileName || attachmentId}`);
        }
        return true;
    },

    /** Orden cronológico estable (fecha ASC, orden de guardado como desempate). */
    getMovementsChronological() {
        return this.movements
            .map((m, idx) => ({ m, idx }))
            .sort((a, b) => {
                const ta = new Date(a.m.date || 0).getTime();
                const tb = new Date(b.m.date || 0).getTime();
                if (ta !== tb) return ta - tb;
                return a.idx - b.idx;
            })
            .map(x => x.m);
    },

    _cloneStockSnapshot() {
        const map = new Map();
        (InventoryManager.items || []).forEach(it => {
            map.set(it.id, {
                main: parseFloat(it.mainStock) || 0,
                prod: parseFloat(it.prodStock) || 0,
                trans: parseFloat(it.transStock) || 0
            });
        });
        return map;
    },

    _cloneStockMapFrom(map) {
        const n = new Map();
        map.forEach((v, k) => {
            n.set(k, { main: v.main, prod: v.prod, trans: v.trans });
        });
        return n;
    },

    _ensureStockRow(map, itemId) {
        if (!map.has(itemId)) {
            map.set(itemId, { main: 0, prod: 0, trans: 0 });
        }
    },

    _getStockSnapshot(map, itemId, target) {
        this._ensureStockRow(map, itemId);
        const row = map.get(itemId);
        const t = target || 'main';
        if (t === 'production') return row.prod || 0;
        if (t === 'transformation') return row.trans || 0;
        return row.main || 0;
    },

    _addStockSnapshot(map, itemId, target, qty) {
        this._ensureStockRow(map, itemId);
        const row = map.get(itemId);
        const t = target || 'main';
        const q = parseFloat(qty) || 0;
        if (t === 'production') row.prod = (row.prod || 0) + q;
        else if (t === 'transformation') row.trans = (row.trans || 0) + q;
        else row.main = (row.main || 0) + q;
    },

    /** Línea de transferencia con origen y destino distintos (incl. caja ↔ caja en principal). */
    _isTransferLine(item) {
        if (!item || item.transferFrom == null || item.transferTo == null) return false;
        const fBox = String(item.transferFromBoxId || '').trim();
        const tBox = String(item.transferToBoxId || '').trim();
        const fromKey =
            item.transferFrom === 'main' && fBox ? `main:box:${fBox}` : String(item.transferFrom);
        const toKey = item.transferTo === 'main' && tBox ? `main:box:${tBox}` : String(item.transferTo);
        return fromKey !== toKey;
    },

    /**
     * Transformación antigua: la entrada a principal no estaba en `items`, solo en transformationOutput*.
     * Si ya existe línea con transformationOutput, no hacer nada (evita doble reversión).
     */
    _undoTransformationExtraOutputIfLegacy(map, m) {
        if (!m || m.type !== 'TRANSFORMACION' || m.annulled || m.pending) return;
        if (!(m.transformationTargetItemId && m.transformationOutputQuantity != null)) return;
        const hasLine = (m.items || []).some(line => line && line.transformationOutput);
        if (hasLine) return;
        const q = parseFloat(m.transformationOutputQuantity) || 0;
        if (q === 0) return;
        this._addStockSnapshot(map, m.transformationTargetItemId, 'main', -q);
    },

    /** Deshace en el mapa el efecto que tuvo una línea al procesarse (para reconstrucción hacia atrás). */
    _undoMovementLineOnSnapshot(map, movementType, line) {
        if (line.annulled) return;
        if (line.consumableReceipt) return;
        if (movementType === 'TRANSFERENCIA' && this._isTransferLine(line)) {
            const q = Math.abs(parseFloat(line.quantity) || 0);
            this._addStockSnapshot(map, line.itemId, line.transferFrom, q);
            this._addStockSnapshot(map, line.itemId, line.transferTo, -q);
            return;
        }
        if (this._isMainToProductionMovement(movementType)) {
            const q = Math.abs(parseFloat(line.quantity) || 0);
            this._addStockSnapshot(map, line.itemId, 'main', q);
            this._addStockSnapshot(map, line.itemId, 'production', -q);
            return;
        }
        this._addStockSnapshot(
            map,
            line.itemId,
            line.target || 'main',
            -(parseFloat(line.quantity) || 0)
        );
    },

    /** Aplica en el mapa el efecto de una línea tal como al procesar el movimiento. */
    _applyMovementLineOnSnapshot(map, movementType, line) {
        if (line.annulled) return;
        if (line.consumableReceipt) return;
        if (movementType === 'TRANSFERENCIA' && this._isTransferLine(line)) {
            const q = Math.abs(parseFloat(line.quantity) || 0);
            this._addStockSnapshot(map, line.itemId, line.transferFrom, -q);
            this._addStockSnapshot(map, line.itemId, line.transferTo, q);
            return;
        }
        if (this._isMainToProductionMovement(movementType)) {
            const q = Math.abs(parseFloat(line.quantity) || 0);
            this._addStockSnapshot(map, line.itemId, 'main', -q);
            this._addStockSnapshot(map, line.itemId, 'production', q);
            return;
        }
        this._addStockSnapshot(
            map,
            line.itemId,
            line.target || 'main',
            parseFloat(line.quantity) || 0
        );
    },

    /**
     * Stock en el almacén destino justo antes y justo después de cada línea del movimiento
     * (reconstruido desde el inventario actual y el historial de movimientos).
     * No incluye recepciones ni ajustes manuales fuera de movimientos.
     * Para TRANSFERENCIA, antes/después se refieren al bucket `transferFrom` de esa línea.
     */
    computeMovementLineStockBeforeAfter(movement) {
        const items = movement.items || [];
        const n = items.length;
        const before = new Array(n).fill(null);
        const after = new Array(n).fill(null);
        if (!n || typeof InventoryManager === 'undefined') return { before, after };

        const ordered = this.getMovementsChronological();
        const pos = ordered.findIndex(m => m.id === movement.id);
        if (pos === -1) return { before, after };

        const stockMap = this._cloneStockSnapshot();

        for (let p = ordered.length - 1; p > pos; p--) {
            const m = ordered[p];
            if (m.annulled || m.pending) continue;
            for (const line of m.items || []) {
                this._undoMovementLineOnSnapshot(stockMap, m.type, line);
            }
            this._undoTransformationExtraOutputIfLegacy(stockMap, m);
        }

        const V_before_M = this._cloneStockMapFrom(stockMap);
        if (!movement.pending && !movement.annulled) {
            for (let k = n - 1; k >= 0; k--) {
                const line = items[k];
                this._undoMovementLineOnSnapshot(V_before_M, movement.type, line);
            }
            this._undoTransformationExtraOutputIfLegacy(V_before_M, movement);
        }

        const work = this._cloneStockMapFrom(V_before_M);
        for (let j = 0; j < n; j++) {
            const line = items[j];
            if (line && line.consumableReceipt) {
                before[j] = null;
                after[j] = null;
                continue;
            }
            const bucket =
                movement.type === 'TRANSFERENCIA' && this._isTransferLine(line)
                    ? line.transferFrom
                    : this._isMainToProductionMovement(movement.type)
                    ? 'main'
                    : line.target || 'main';
            before[j] = this._getStockSnapshot(work, line.itemId, bucket);
            this._applyMovementLineOnSnapshot(work, movement.type, line);
            after[j] = this._getStockSnapshot(work, line.itemId, bucket);
        }
        return { before, after };
    },

    /**
     * @see computeMovementLineStockBeforeAfter
     */
    computeMovementLineStockBefore(movement) {
        return this.computeMovementLineStockBeforeAfter(movement).before;
    },

    /**
     * Stock reconstruido al final del día indicado (fecha local YYYY-MM-DD).
     * Parte del inventario actual y revierte movimientos y recepciones con fecha/hora posteriores al corte.
     * Los cambios de stock desde el editor (Configuración), import CSV de inventario y alta con stock inicial
     * generan movimiento AJUSTE. Respaldo JSON restaura datos tal cual estaban guardados.
     */
    computeStockMapAsOfDate(isoDateStr) {
        const map = this._cloneStockSnapshot();
        if (!isoDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDateStr).trim())) return map;
        const endOfDay = new Date(`${String(isoDateStr).trim()}T23:59:59.999`);
        const T = endOfDay.getTime();
        if (Number.isNaN(T)) return map;

        const events = [];

        for (let idx = 0; idx < this.movements.length; idx++) {
            const m = this.movements[idx];
            if (m.annulled || m.pending) continue;
            const eff = m.processedFromStandby && m.processedAt ? m.processedAt : m.date;
            const tm = new Date(eff || 0).getTime();
            if (!(tm > T)) continue;
            if (m.type === "RECEPCION_MATERIAL" && m.receptionId) continue;
            events.push({ tm, idx, kind: "m", m });
        }

        if (typeof ReceptionsManager !== "undefined" && Array.isArray(ReceptionsManager.receptions)) {
            ReceptionsManager.receptions.forEach((r, ridx) => {
                if (r.provisional || r.provisionalAnnulled) return;
                const tm = new Date(r.dateReceived || 0).getTime();
                if (!(tm > T)) return;
                events.push({ tm, idx: ridx, kind: "r", r });
            });
        }

        events.sort((a, b) => b.tm - a.tm || b.idx - a.idx);

        for (const ev of events) {
            if (ev.kind === "r") {
                const finder = ReceptionsManager._findItemByNameOrCode;
                const item = typeof finder === "function" ? finder.call(ReceptionsManager, ev.r.itemName) : null;
                if (item) {
                    this._addStockSnapshot(map, item.id, "main", -(parseFloat(ev.r.quantity) || 0));
                }
            } else {
                const m = ev.m;
                for (const line of m.items || []) {
                    this._undoMovementLineOnSnapshot(map, m.type, line);
                }
                this._undoTransformationExtraOutputIfLegacy(map, m);
            }
        }

        return map;
    },

    /**
     * Replica el efecto en inventario de un movimiento ya guardado (fusión desde otro equipo).
     * No sustituye transportes ni otros efectos laterales del flujo interactivo.
     */
    applyMovementStockEffectForMerge(movement) {
        const m = movement;
        if (!m || m.annulled) return;
        if (m.type === "STANDBY" && m.pending) return;
        if (m.type === "RECEPCION_MATERIAL") return;

        const items = m.items || [];
        if (m.type === "TRANSFERENCIA") {
            items.forEach(item => {
                if (item.annulled) return;
                const q = Math.abs(parseFloat(item.quantity) || 0);
                if (q <= 0) return;
                if (this._isTransferLine(item)) {
                    InventoryManager.updateStock(item.itemId, item.transferFrom, -q);
                    InventoryManager.updateStock(item.itemId, item.transferTo, q);
                } else {
                    InventoryManager.updateStock(item.itemId, item.target || "main", item.quantity);
                }
            });
            return;
        }

        if (m.type === "TRANSFORMACION") {
            const hasOutLine = items.some(line => line && line.transformationOutput);
            items.forEach(item => {
                if (item.annulled) return;
                this._applyStockChangeForLine(item, "TRANSFORMACION");
            });
            if (!hasOutLine && m.transformationTargetItemId != null && m.transformationOutputQuantity != null) {
                const q = parseFloat(m.transformationOutputQuantity) || 0;
                if (q !== 0) InventoryManager.updateStock(m.transformationTargetItemId, "main", q);
            }
            return;
        }

        if (m.type === "COMPRA_STOCK") {
            items.forEach(item => {
                if (!item || item.annulled) return;
                this._applyStockChangeForLine(item, "COMPRA_STOCK");
            });
            return;
        }

        items.forEach(item => {
            if (item.annulled) return;
            this._applyStockChangeForLine(item, m.type);
        });
    },

    /**
     * Registra recepción local para un movimiento importado si aún no existe ese id (actualiza stock principal cuando aplica).
     * @returns {boolean} si se pudo crear o ya existía
     */
    _ensureReceptionFromMergeMovement(m) {
        if (!m.receptionId || typeof ReceptionsManager === "undefined") return false;
        const rid = m.receptionId;
        if (ReceptionsManager.receptions.some(r => r.id === rid)) return true;
        const snap = m.receptionSnapshot || {};
        const projectId = (m.projectId || snap.projectId || "").trim();
        const itemName = (snap.itemName || "").trim();
        if (!projectId || !itemName) return false;
        const d = snap.dimensions && typeof snap.dimensions === "object" ? snap.dimensions : {};
        const rec = {
            id: rid,
            projectId,
            itemName,
            quantity: parseFloat(snap.quantity) || 0,
            dimensions: {
                L: Math.max(0, parseFloat(d.L) || 0),
                W: Math.max(0, parseFloat(d.W) || 0),
                H: Math.max(0, parseFloat(d.H) || 0)
            },
            dimensionUnit: snap.dimensionUnit || "in",
            glassPacking: ReceptionsManager._normalizeGlassPacking(
                (snap.materialCategory || "OTRO").trim() || "OTRO",
                snap.glassPacking
            ),
            supplier: (snap.supplier || "").trim(),
            dateReceived: m.date || new Date().toISOString(),
            container: "",
            combinesWith: [],
            purchaseOrder: (snap.purchaseOrder || "").trim(),
            materialCategory: (snap.materialCategory || "OTRO").trim() || "OTRO",
            provisional: !!snap.provisional,
            provisionalAnnulled: false
        };
        ReceptionsManager.receptions.push(rec);
        ReceptionsManager.save();
        ReceptionsManager.applyMainStockForReception(rec);
        return true;
    },

    /**
     * Fusiona movimientos desde otro archivo: solo ids nuevos; aplica stock para cada uno.
     * @param {object[]} incomingList
     * @returns {{ added: number, skipped: number, receptionSkipped: number }}
     */
    mergeMovementsFromImportArray(incomingList) {
        const incomingArr = Array.isArray(incomingList) ? incomingList : [];
        const existing = [...(this.movements || [])];
        const existingIds = new Set(existing.map(m => m.id).filter(Boolean));
        const toAdd = [];
        const seenIncoming = new Set();
        for (const m of incomingArr) {
            if (!m || !m.id || existingIds.has(m.id)) continue;
            if (seenIncoming.has(m.id)) continue;
            seenIncoming.add(m.id);
            toAdd.push(m);
        }

        const skipped = incomingArr.length - toAdd.length;
        if (!toAdd.length) {
            return { added: 0, skipped, receptionSkipped: 0 };
        }

        toAdd.forEach(m => {
            if (m && !Array.isArray(m.attachments)) m.attachments = [];
        });

        const mig = Utils.applyImportedMovementReferencePrefixing(toAdd);
        if (mig.changed) Utils.patchLinkedRefsAfterMovementRefMigrate(mig.refMap);

        toAdd.sort((a, b) => {
            const ta = new Date(a.date || 0).getTime();
            const tb = new Date(b.date || 0).getTime();
            if (ta !== tb) return ta - tb;
            return String(a.id).localeCompare(String(b.id));
        });

        const successfulAdds = [];
        let receptionSkipped = 0;

        for (const m of toAdd) {
            try {
                if (m.type === "RECEPCION_MATERIAL" && m.receptionId) {
                    const ok = this._ensureReceptionFromMergeMovement(m);
                    if (!ok) {
                        receptionSkipped++;
                        continue;
                    }
                } else {
                    this.applyMovementStockEffectForMerge(m);
                }

                if (
                    m.type === "COMPRA_STOCK" &&
                    m.orderLineId &&
                    typeof OrderLinesManager !== "undefined" &&
                    typeof OrderLinesManager.commitReceiptAfterCompra === "function"
                ) {
                    try {
                        OrderLinesManager.commitReceiptAfterCompra(m);
                    } catch (err) {
                        if (typeof window !== "undefined" && window.__GNEEX_DEBUG) {
                            console.warn("merge commitReceiptAfterCompra", err);
                        }
                    }
                }

                successfulAdds.push(m);
            } catch (err) {
                console.error("merge movement", m && m.id, err);
            }
        }

        this.movements = existing.concat(successfulAdds);
        this.movements.sort((a, b) => {
            const ta = new Date(a.date || 0).getTime();
            const tb = new Date(b.date || 0).getTime();
            if (ta !== tb) return ta - tb;
            return String(a.id).localeCompare(String(b.id));
        });

        this.save();
        Utils.syncMovementRefCounterFromMovements(this.movements);
        if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
        if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();

        return { added: successfulAdds.length, skipped, receptionSkipped };
    },

    resetForm() {
        this._closeMovementFormWindow();
        this._movementFormMinimized = false;
        this._compraBatchFromOrdersBuilding = false;
        this.updateMovementDraftBar();
        this.pendingOrderLineReceipt = null;
        this.pendingOrderLineBatchReceipts = null;
        this.currentType = null;
        this.selectedItems = [];
        this.editingStandbyId = null;
        this.updateEditingBadge();
        
        document.querySelectorAll('.movement-type-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        const details = document.getElementById('movement-details');
        if (details) details.style.display = 'none';
        
        const projectId = document.getElementById('project-id');
        if (projectId) projectId.value = '';
        
        const notes = document.getElementById('movement-notes');
        if (notes) notes.value = '';
        const movTfVendor = document.getElementById('mov-transformacion-vendor');
        if (movTfVendor) movTfVendor.value = '';
        this.resetTransformationTargetForm();

        const movPo = document.getElementById('mov-compra-po');
        const movSlip = document.getElementById('mov-compra-slip');
        const movSup = document.getElementById('mov-compra-supplier');
        if (movPo) movPo.value = '';
        if (movSlip) movSlip.value = '';
        if (movSup) movSup.value = '';
        const movHistCompra = document.getElementById('mov-compra-receipt-historical-date');
        if (movHistCompra) movHistCompra.value = '';
        const movCA = document.getElementById("mov-compra-consumible-only");
        if (movCA) movCA.checked = false;
        const movCQ = document.getElementById("mov-compra-consumible-qty");
        if (movCQ) movCQ.value = "1";
        const movCI = document.getElementById("mov-compra-consumible-name");
        if (movCI) movCI.value = "";
        const movCS = document.getElementById("mov-compra-consumible-select");
        if (movCS && movCS.options.length) movCS.selectedIndex = 0;
        const movCf = document.getElementById("mov-compra-consumible-fields");
        if (movCf) movCf.style.display = "none";
        const movCpo = document.getElementById("mov-compra-consumible-po");
        const movCsup = document.getElementById("mov-compra-consumible-supplier");
        if (movCpo) movCpo.value = "";
        if (movCsup) movCsup.value = "";
        const thCompraLinePo = document.getElementById("mov-compra-line-po-th");
        const thCompraLineSup = document.getElementById("mov-compra-line-supplier-th");
        if (thCompraLinePo) thCompraLinePo.style.display = "none";
        if (thCompraLineSup) thCompraLineSup.style.display = "none";
        const thCompraPlRf = document.getElementById("mov-compra-dest-th");
        if (thCompraPlRf) thCompraPlRf.style.display = "none";
        const mrp = document.getElementById('mov-rec-po');
        const mrs = document.getElementById('mov-rec-supplier');
        const mrprov = document.getElementById('mov-rec-provisional');
        if (mrp) mrp.value = '';
        if (mrs) mrs.value = '';
        if (mrprov) mrprov.checked = false;
        const recWrap = document.getElementById("mov-rec-lines-wrap");
        if (recWrap) recWrap.innerHTML = "";
        this._ensureReceptionLineRows();
        const mrgp = document.getElementById("mov-rec-glass-packing");
        if (mrgp) mrgp.value = "";
        const mrHist = document.getElementById("mov-rec-receipt-historical-date");
        if (mrHist) mrHist.value = "";

        const invLines = document.getElementById('movement-inventory-lines');
        if (invLines) invLines.style.display = 'block';

        const stdSearchWrap = document.getElementById('mov-standard-item-search-wrap');
        const tfStockTablesWrap = document.getElementById('mov-tf-stock-tables-wrap');
        if (stdSearchWrap) stdSearchWrap.style.display = '';
        if (tfStockTablesWrap) tfStockTablesWrap.style.display = 'none';
        
        const tbody = document.getElementById('selected-items-body');
        if (tbody) tbody.innerHTML = '';
        const thTargetCol = document.getElementById('mov-selected-target-col');
        if (thTargetCol && typeof I18n !== 'undefined' && I18n.t) {
            thTargetCol.textContent = I18n.t('table.target');
        }
        const thRecipient = document.getElementById('mov-recipient-th');
        if (thRecipient) thRecipient.style.display = 'none';
        const thBox = document.getElementById('mov-selected-box-th');
        if (thBox) thBox.style.display = 'none';
        this._syncMovementSearchPlaceholder(null);
        const searchLbl = document.getElementById('mov-item-search-label');
        if (searchLbl && typeof I18n !== 'undefined' && I18n.t) {
            searchLbl.textContent = I18n.t('movements.searchItems');
        }
        const selTitle = document.getElementById('mov-selected-items-title');
        if (selTitle && typeof I18n !== 'undefined' && I18n.t) {
            selTitle.textContent = I18n.t('movements.selectedItems');
        }
    },

    setupEventListeners() {
        // Selección de tipo de movimiento
        const grid = document.getElementById('movement-types-grid');
        if (grid) {
            grid.addEventListener('click', e => {
                const helpBtn = e.target.closest('.mov-type-help-btn');
                if (helpBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const t = helpBtn.getAttribute('data-mov-help');
                    if (t) this.showMovementTypeHelp(t);
                    return;
                }
                const btn = e.target.closest('.movement-type-btn');
                if (btn && btn.dataset.type) this.selectType(btn.dataset.type);
            });
        }

        document.getElementById("mov-compra-consumible-only")?.addEventListener("change", () => {
            this._onCompraConsumibleToggle();
        });

        const movFormWin = document.getElementById("movement-form-window");
        if (movFormWin && !this._movementFormWindowBound) {
            this._movementFormWindowBound = true;
            document.getElementById("movement-form-window-minimize")?.addEventListener("click", () =>
                this.minimizeMovementFormWindow()
            );
            document.getElementById("movement-form-window-close")?.addEventListener("click", () =>
                this.promptDiscardMovementForm()
            );
            document.addEventListener("keydown", e => {
                if (e.key !== "Escape") return;
                if (movFormWin.classList.contains("active")) {
                    const od = document.getElementById("overdraft-confirm-modal");
                    if (od && od.classList.contains("active")) return;
                    e.preventDefault();
                    this.minimizeMovementFormWindow();
                }
            });
        }

        if (!this._movementDraftFloatBound) {
            this._movementDraftFloatBound = true;
            document.getElementById("movement-draft-float-resume")?.addEventListener("click", () =>
                this.resumeMovementFormWindow()
            );
            document.getElementById("movement-draft-float-discard")?.addEventListener("click", () =>
                this.promptDiscardMovementForm()
            );
        }

        const closeMovHelp = document.getElementById('close-mov-type-help');
        if (closeMovHelp && !this._movTypeHelpCloseBound) {
            this._movTypeHelpCloseBound = true;
            closeMovHelp.addEventListener('click', () => {
                document.getElementById('mov-type-help-modal')?.classList.remove('active');
            });
        }

        const recentList = document.getElementById("movements-recent-list");
        if (recentList && !this._recentMovementsClickBound) {
            this._recentMovementsClickBound = true;
            recentList.addEventListener("click", e => {
                const row = e.target.closest(".movements-recent-tile");
                if (!row || !row.dataset.movementId) return;
                if (typeof HistoryManager !== "undefined" && HistoryManager.showMovementDetail) {
                    HistoryManager.showMovementDetail(row.dataset.movementId);
                }
            });
        }

        // Búsqueda de artículos
        const itemSearch = document.getElementById('item-search');
        const searchResults = document.getElementById('item-search-results');
        
        if (itemSearch && searchResults) {
            itemSearch.addEventListener('input', Utils.debounce((e) => {
                if (this.currentType === 'TRANSFORMACION') return;
                const query = e.target.value.trim();
                if (query.length < 2) {
                    searchResults.innerHTML = '';
                    searchResults.classList.remove('active');
                    return;
                }

                const results = InventoryManager.search(query).slice(0, 10);
                if (results.length === 0) {
                    searchResults.innerHTML = `<div class="search-result-item">${this._escHtml(I18n.t('msg.noResults'))}</div>`;
                } else {
                    searchResults.innerHTML = results.map(item => `
                        <div class="search-result-item" data-id="${this._escAttr(item.id)}">
                            <span class="result-code">${this._escHtml(item.code)}</span>
                            <span class="result-description">${this._escHtml(item.description)}</span>
                        </div>
                    `).join('');
                }
                searchResults.classList.add('active');
            }, 200));

            searchResults.addEventListener('click', (e) => {
                if (this.currentType === 'TRANSFORMACION') return;
                const resultItem = e.target.closest('.search-result-item');
                if (resultItem && resultItem.dataset.id) {
                    const item = InventoryManager.items.find(i => i.id === resultItem.dataset.id);
                    if (item) this.addItem(item);
                }
            });

            // Cerrar resultados al hacer clic fuera
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.item-search-container')) {
                    searchResults.classList.remove('active');
                }
                const tfRes = document.getElementById('mov-tf-target-results');
                if (tfRes && !e.target.closest('.mov-tf-target-search-wrap')) {
                    tfRes.classList.remove('active');
                }
            });
        }

        const tfStockWrap = document.getElementById('mov-tf-stock-tables-wrap');
        if (tfStockWrap && !this._tfStockTablesBound) {
            this._tfStockTablesBound = true;
            tfStockWrap.addEventListener('click', e => {
                const row = e.target.closest('.mov-tf-stock-row');
                if (!row || row.dataset.itemId == null || !row.dataset.depot) return;
                this.pickTransformationInsumo(row.dataset.itemId, row.dataset.depot);
            });
            tfStockWrap.addEventListener('keydown', e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const row = e.target.closest('.mov-tf-stock-row');
                if (!row || row.dataset.itemId == null || !row.dataset.depot) return;
                e.preventDefault();
                this.pickTransformationInsumo(row.dataset.itemId, row.dataset.depot);
            });
        }

        const tfSearch = document.getElementById('mov-tf-target-search');
        const tfResults = document.getElementById('mov-tf-target-results');
        if (tfSearch && tfResults) {
            tfSearch.addEventListener(
                'input',
                Utils.debounce(e => {
                    const query = e.target.value.trim();
                    if (query.length < 2) {
                        tfResults.innerHTML = '';
                        tfResults.classList.remove('active');
                        return;
                    }
                    const results = InventoryManager.search(query).slice(0, 10);
                    if (results.length === 0) {
                        tfResults.innerHTML = `<div class="search-result-item">${this._escHtml(I18n.t('msg.noResults'))}</div>`;
                    } else {
                        tfResults.innerHTML = results
                            .map(
                                item => `
                        <div class="search-result-item mov-tf-target-result" data-id="${this._escAttr(item.id)}">
                            <span class="result-code">${this._escHtml(item.code)}</span>
                            <span class="result-description">${this._escHtml(item.description)}</span>
                        </div>`
                            )
                            .join('');
                    }
                    tfResults.classList.add('active');
                }, 200)
            );
            tfResults.addEventListener('click', e => {
                const row = e.target.closest('.mov-tf-target-result');
                if (!row || !row.dataset.id) return;
                const item = InventoryManager.items.find(i => i.id === row.dataset.id);
                if (item) this.setTransformationTargetFromItem(item);
            });
        }

        const selectedItemsBody = document.getElementById("selected-items-body");
        if (selectedItemsBody && !this._selectedItemsQtyLiveBound) {
            this._selectedItemsQtyLiveBound = true;
            const onQtyEdit = e => {
                const input = e.target.closest(".quantity-input");
                if (!input) return;
                const idx = parseInt(String(input.dataset.index || ""), 10);
                if (!Number.isFinite(idx)) return;
                this.updateItemQuantity(idx, input.value);
            };
            selectedItemsBody.addEventListener("change", onQtyEdit);
        }
        if (selectedItemsBody && !this._selectedItemsRemoveClickBound) {
            this._selectedItemsRemoveClickBound = true;
            selectedItemsBody.addEventListener("click", e => {
                const calcBtn = e.target.closest(".mov-qty-calc-btn[data-calc-index]");
                if (calcBtn && selectedItemsBody.contains(calcBtn)) {
                    e.preventDefault();
                    const idx = parseInt(String(calcBtn.getAttribute("data-calc-index") || ""), 10);
                    if (!Number.isFinite(idx)) return;
                    void this.openQuantityCalculator(idx);
                    return;
                }
                const btn = e.target.closest(".remove-item-btn");
                if (!btn || !selectedItemsBody.contains(btn)) return;
                e.preventDefault();
                const idx = parseInt(String(btn.getAttribute("data-remove-index") || ""), 10);
                if (!Number.isFinite(idx)) return;
                this.removeItem(idx);
            });
        }
        if (selectedItemsBody && !this._transferSelectChangeBound) {
            this._transferSelectChangeBound = true;
            selectedItemsBody.addEventListener("change", e => {
                const sel = e.target.closest('.target-select[data-transfer-role][data-line-index]');
                if (!sel || !selectedItemsBody.contains(sel)) return;
                if (this.currentType !== "TRANSFERENCIA") return;
                const role = sel.getAttribute("data-transfer-role");
                const idx = parseInt(String(sel.getAttribute("data-line-index") || ""), 10);
                if (!Number.isFinite(idx)) return;
                if (role === "from") this.updateItemTransferFrom(idx, sel.value);
                else if (role === "to") this.updateItemTransferTo(idx, sel.value);
            });
        }
        if (selectedItemsBody && !this._selectedItemsStockSourceChangeBound) {
            this._selectedItemsStockSourceChangeBound = true;
            selectedItemsBody.addEventListener("change", e => {
                const sel = e.target.closest("select.mov-stock-source-select[data-stock-line-index]");
                if (!sel || !selectedItemsBody.contains(sel)) return;
                const idx = parseInt(String(sel.getAttribute("data-stock-line-index") || ""), 10);
                if (!Number.isFinite(idx)) return;
                this.updateItemStockSource(idx, sel.value);
            });
        }
        if (selectedItemsBody && !this._selectedItemsTargetDepotChangeBound) {
            this._selectedItemsTargetDepotChangeBound = true;
            selectedItemsBody.addEventListener("change", e => {
                const sel = e.target.closest("select.mov-target-depot-select[data-target-line-index]");
                if (!sel || !selectedItemsBody.contains(sel)) return;
                const idx = parseInt(String(sel.getAttribute("data-target-line-index") || ""), 10);
                if (!Number.isFinite(idx)) return;
                this.updateItemTarget(idx, sel.value);
            });
        }

        document.addEventListener('change', e => {
            if (e.target.matches('input[name="mov-tf-target-mode"]')) {
                this.toggleTransformationTargetMode();
            }
        });

        // Botones de acción
        const processBtn = document.getElementById('process-movement');
        if (processBtn) {
            processBtn.addEventListener('click', () => this.processMovement());
        }

        const processRecepcionBtn = document.getElementById('process-recepcion-movement');
        if (processRecepcionBtn) {
            processRecepcionBtn.addEventListener('click', () => this.processMovement());
        }

        const cancelBtn = document.getElementById('cancel-movement');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.resetForm());
        }

        const standbyList = document.getElementById('standby-list');
        if (standbyList) {
            standbyList.addEventListener('click', (e) => {
                const row = e.target.closest('.standby-row');
                if (!row) return;
                this.selectedStandbyId = row.dataset.id;
                standbyList.querySelectorAll('.standby-row.selected').forEach(el => el.classList.remove('selected'));
                row.classList.add('selected');
            });

            standbyList.addEventListener('dblclick', (e) => {
                const row = e.target.closest('.standby-row');
                if (!row) return;
                this.selectedStandbyId = row.dataset.id;
                this.editStandby(this.selectedStandbyId);
            });

            standbyList.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.standby-edit-btn');
                if (editBtn) {
                    this.editStandby(editBtn.dataset.id);
                    return;
                }

                const processBtn = e.target.closest('.standby-process-btn');
                if (processBtn) {
                    App.showConfirm(I18n.t('confirm.processStandby'), () => {
                        this.processStandby(processBtn.dataset.id);
                    });
                    return;
                }

                const cancelStandbyBtn = e.target.closest('.standby-cancel-btn');
                if (cancelStandbyBtn) {
                    App.showConfirm(I18n.t('confirm.cancelStandby'), () => {
                        this.cancelStandby(cancelStandbyBtn.dataset.id);
                    });
                }
            });
        }

        const floatFab = document.getElementById("standby-float-fab");
        const floatBody = document.getElementById("standby-float-body");
        if (!this._standbyFloatListenersBound) {
            this._standbyFloatListenersBound = true;
            floatFab?.addEventListener("click", e => {
                e.stopPropagation();
                this._toggleStandbyFloatPanel();
            });
            document.getElementById("standby-float-close")?.addEventListener("click", () => this._setStandbyFloatOpen(false));
            document.getElementById("standby-float-new")?.addEventListener("click", () => {
                this._setStandbyFloatOpen(false);
                if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
                this.editingStandbyId = null;
                this.updateEditingBadge();
                this.selectType("STANDBY");
                const pid = document.getElementById("project-id");
                const nte = document.getElementById("movement-notes");
                if (pid) pid.value = "";
                if (nte) nte.value = "";
            });
            document.getElementById("standby-float-go-movements")?.addEventListener("click", () => {
                this._setStandbyFloatOpen(false);
                if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
                setTimeout(() => {
                    document
                        .querySelector('.movement-type-btn[data-type="STANDBY"]')
                        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }, 50);
            });
            document.getElementById("standby-float-dismiss")?.addEventListener("click", () =>
                this.dismissStandbyFloatUser()
            );
            floatBody?.addEventListener("click", e => {
                const editBtn = e.target.closest(".standby-float-edit");
                if (editBtn?.dataset.id) {
                    this._setStandbyFloatOpen(false);
                    this.editStandby(editBtn.dataset.id);
                    return;
                }
                const procBtn = e.target.closest(".standby-float-process");
                if (procBtn?.dataset.id) {
                    App.showConfirm(I18n.t("confirm.processStandby"), () => {
                        this.processStandby(procBtn.dataset.id);
                    });
                }
            });
            document.addEventListener("click", e => {
                const wrap = document.getElementById("standby-float-wrap");
                const panel = document.getElementById("standby-float-panel");
                if (!wrap || !panel?.classList.contains("standby-float-panel--open")) return;
                if (!wrap.contains(e.target)) this._setStandbyFloatOpen(false);
            });
            document.addEventListener("keydown", e => {
                if (e.key !== "Escape") return;
                const panel = document.getElementById("standby-float-panel");
                if (panel?.classList.contains("standby-float-panel--open")) this._setStandbyFloatOpen(false);
            });
        }

        const consumoFab = document.getElementById("consumo-cart-float-fab");
        const consumoBody = document.getElementById("consumo-cart-float-body");
        if (!this._consumoCartFloatListenersBound) {
            this._consumoCartFloatListenersBound = true;
            consumoFab?.addEventListener("click", e => {
                e.stopPropagation();
                this._toggleConsumoCartFloatPanel();
            });
            document.getElementById("consumo-cart-float-close")?.addEventListener("click", () =>
                this._setConsumoCartFloatOpen(false)
            );
            document.getElementById("consumo-cart-float-process")?.addEventListener("click", () =>
                this.processConsumoCartFromFloat()
            );
            document.getElementById("consumo-cart-float-go-movements")?.addEventListener("click", () => {
                this._setConsumoCartFloatOpen(false);
                if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
                this.selectType("CONSUMO_DIARIO");
            });
            document.getElementById("consumo-cart-float-clear")?.addEventListener("click", () => {
                App.showConfirm(I18n.t("movements.consumoCartClearConfirm"), () => {
                    this.clearConsumoCart();
                    Utils.showToast(I18n.t("movements.consumoCartClearedToast"), "info");
                });
            });
            document.getElementById("consumo-cart-float-dismiss")?.addEventListener("click", () =>
                this.dismissConsumoCartFloatUser()
            );
            consumoBody?.addEventListener("click", e => {
                const rm = e.target.closest(".consumo-cart-float-remove");
                if (rm && rm.dataset.index != null) {
                    this.removeConsumoCartLine(parseInt(rm.dataset.index, 10));
                }
            });
            document.addEventListener("click", e => {
                const wrap = document.getElementById("consumo-cart-float-wrap");
                const panel = document.getElementById("consumo-cart-float-panel");
                if (!wrap || !panel?.classList.contains("consumo-cart-float-panel--open")) return;
                if (!wrap.contains(e.target)) this._setConsumoCartFloatOpen(false);
            });
            document.addEventListener("keydown", e => {
                if (e.key !== "Escape") return;
                const cp = document.getElementById("consumo-cart-float-panel");
                if (cp?.classList.contains("consumo-cart-float-panel--open")) this._setConsumoCartFloatOpen(false);
            });
        }

        document.addEventListener('keydown', (e) => {
            if (App && typeof App.switchTab === 'function') {
                const movementsTab = document.getElementById('movements-tab');
                if (!movementsTab || !movementsTab.classList.contains('active')) return;
            }
            if (!this.selectedStandbyId) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                this.editStandby(this.selectedStandbyId);
                return;
            }

            if (e.key === 'Delete') {
                e.preventDefault();
                const id = this.selectedStandbyId;
                App.showConfirm(I18n.t('confirm.cancelStandby'), () => {
                    this.cancelStandby(id);
                    this.selectedStandbyId = null;
                });
            }
        });

        const projectInput = document.getElementById('project-id');
        if (projectInput) {
            projectInput.addEventListener('blur', () => Utils.warnProjectIdFormatIfNeeded(projectInput.value));
        }

        const movRecCat = document.getElementById('mov-rec-category');
        if (movRecCat) {
            movRecCat.addEventListener("change", () => {
                this.syncMovRecProvisional();
                this.syncMovRecGlassPackingUI();
            });
        }

        const movPurList = document.getElementById('mov-purchase-list');
        if (movPurList) {
            movPurList.addEventListener('click', e => {
                const btn = e.target.closest('.mov-purchase-action');
                if (!btn) return;
                const code = btn.dataset.code;
                const p = InventoryManager.purchaseList.find(x => x.code === code);
                if (!p) return;
                if (btn.dataset.action === 'recibido') p.status = 'recibido';
                if (btn.dataset.action === 'eliminar') {
                    InventoryManager.purchaseList = InventoryManager.purchaseList.filter(x => x.code !== code);
                }
                InventoryManager.save();
                this.renderMovPurchaseSuggestions();
            });
        }
        document.getElementById("mov-rec-add-line-btn")?.addEventListener("click", () => {
            this._addReceptionLineRow();
        });
        document.getElementById("mov-rec-lines-wrap")?.addEventListener("click", e => {
            const btn = e.target.closest(".mov-rec-remove-line-btn");
            if (!btn) return;
            const row = btn.closest(".mov-rec-line-row");
            if (!row) return;
            row.remove();
            this._ensureReceptionLineRows();
        });
    }
};
