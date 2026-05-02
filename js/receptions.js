// receptions.js — recepciones externas, PO, stock provisional por proyecto

const ReceptionsManager = {
  receptions: [],

  /** Categorías para las que la PO es obligatoria y el stock es provisional (no inventario principal). */
  PO_REQUIRED_MATERIAL_CATEGORIES: [
    "MARMOL",
    "VIDRIO",
    "VIDRIO_PLANO",
    "VIDRIO_CURVO",
    "VIDRIO_PINTADO",
    "GRANITO",
    "GRANITO_LACROIX",
    "ESPECIAL"
  ],

  /** Solo estos tres: presentación caja / suelto en recepción. */
  GLASS_PACKING_CATEGORIES: ["VIDRIO_PLANO", "VIDRIO_CURVO", "VIDRIO_PINTADO"],

  isGlassPackingCategory(cat) {
    return this.GLASS_PACKING_CATEGORIES.includes((cat || "").trim());
  },

  _normalizeGlassPacking(materialCategory, value) {
    if (!this.isGlassPackingCategory(materialCategory)) return null;
    const v = (value || "").trim();
    if (v === "standard_box" || v === "loose_mixed") return v;
    return null;
  },

  init() {
    try {
      this.receptions = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECEPTIONS) || "[]");
      if (!Array.isArray(this.receptions)) this.receptions = [];
      console.log("✅ ReceptionsManager iniciado:", this.receptions.length);
    } catch (err) {
      console.error(err);
      this.receptions = [];
    }
  },

  save() {
    localStorage.setItem(STORAGE_KEYS.RECEPTIONS, JSON.stringify(this.receptions));
  },

  requiresPurchaseOrder(category) {
    return this.PO_REQUIRED_MATERIAL_CATEGORIES.includes(category);
  },

  _findItemByNameOrCode(name) {
    const n = (name || "").trim();
    if (!n) return null;
    return InventoryManager.items.find(i => i.code === n)
        || InventoryManager.items.find(i => (i.code || "").toLowerCase() === n.toLowerCase())
        || InventoryManager.items.find(i => i.description === n)
        || InventoryManager.items.find(i => (i.description || "").toLowerCase() === n.toLowerCase())
        || null;
  },

  applyMainStockForReception(rec) {
    if (!rec || rec.provisional || rec.provisionalAnnulled) return;
    const item = this._findItemByNameOrCode(rec.itemName);
    if (item) InventoryManager.updateStock(item.id, "main", parseFloat(rec.quantity) || 0);
  },

  revertMainStockEffect(rec) {
    if (!rec || rec.provisional || rec.provisionalAnnulled) return;
    const item = this._findItemByNameOrCode(rec.itemName);
    if (item) InventoryManager.updateStock(item.id, "main", -(parseFloat(rec.quantity) || 0));
  },

  /**
   * Fecha de recepción en el registro: prioridad a `data.realReceiptDate` (AAAA-MM-DD), luego hoy.
   * No futuras; inválida → ahora.
   */
  _resolveReceptionDateReceived(data) {
    const ymd = String((data && data.realReceiptDate) || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return new Date().toISOString();
    const t = new Date(`${ymd}T12:00:00`).getTime();
    if (!Number.isFinite(t)) return new Date().toISOString();
    const endToday = new Date();
    endToday.setHours(23, 59, 59, 999);
    if (t > endToday.getTime()) return new Date().toISOString();
    return new Date(t).toISOString();
  },

  /**
   * Registra una recepción. Devuelve el objeto creado o null si falla la validación.
   */
  registerReception(data, opts = {}) {
    const materialCategory = (data.materialCategory || "OTRO").trim() || "OTRO";
    const purchaseOrder = (data.purchaseOrder || "").trim();
    let provisional = !!data.provisional;

    if (this.requiresPurchaseOrder(materialCategory)) {
      if (!purchaseOrder) {
        Utils.showToast(I18n.t("msg.receptionPoRequired"), "error");
        return null;
      }
      provisional = true;
    }

    const dateReceivedIso = this._resolveReceptionDateReceived(data);

    const dimsPerUnit = Array.isArray(data.dimensionsItems)
      ? data.dimensionsItems
          .map(d => ({
            L: Math.max(0, parseFloat(d?.L) || 0),
            W: Math.max(0, parseFloat(d?.W) || 0),
            H: Math.max(0, parseFloat(d?.H) || 0)
          }))
          .filter(d => d.L > 0 || d.W > 0 || d.H > 0)
      : [];
    const rec = {
      id: Utils.generateId(),
      projectId: (data.projectId || "").trim(),
      itemName: (data.itemName || "").trim(),
      quantity: data.quantity,
      dimensions: data.dimensions || { L: 0, W: 0, H: 0 },
      dimensionsItems: dimsPerUnit,
      dimensionUnit: "in",
      glassPacking: this._normalizeGlassPacking(materialCategory, data.glassPacking),
      supplier: data.supplier || "",
      dateReceived: dateReceivedIso,
      container: data.container || "",
      combinesWith: data.combinesWith || [],
      purchaseOrder,
      materialCategory,
      provisional,
      provisionalAnnulled: false
    };

    if (!rec.projectId || !rec.itemName) {
      Utils.showToast(I18n.t("msg.receptionProjectItemRequired"), "error");
      return null;
    }

    this.receptions.push(rec);
    this.save();
    this.applyMainStockForReception(rec);

    if (!opts.skipToast) {
      Utils.showToast(I18n.t("msg.receptionRegistered"), "success");
    }
    Utils.warnProjectIdFormatIfNeeded(rec.projectId);
    InventoryManager.render();
    if (typeof TransportManager !== "undefined" && TransportManager.syncProjectTransportsFromReceptions) {
      TransportManager.syncProjectTransportsFromReceptions(rec.projectId);
    }
    return rec;
  },

  /** Actualiza una recepción existente (rehace efecto en stock principal si aplica). */
  updateReception(id, patch) {
    const i = this.receptions.findIndex(r => r.id === id);
    if (i < 0) return false;
    const old = { ...this.receptions[i] };
    this.revertMainStockEffect(old);

    const merged = {
      ...old,
      ...patch,
      id: old.id,
      dateReceived: old.dateReceived
    };
    merged.projectId = (merged.projectId || "").trim();
    merged.itemName = (merged.itemName || "").trim();
    merged.purchaseOrder = (merged.purchaseOrder || "").trim();
    merged.supplier = (merged.supplier || "").trim();
    merged.materialCategory = (merged.materialCategory || "OTRO").trim() || "OTRO";
    merged.quantity = parseFloat(merged.quantity) || 0;
    const dimSrc = merged.dimensions && typeof merged.dimensions === "object" ? merged.dimensions : {};
    merged.dimensions = {
      L: Math.max(0, parseFloat(dimSrc.L) || 0),
      W: Math.max(0, parseFloat(dimSrc.W) || 0),
      H: Math.max(0, parseFloat(dimSrc.H) || 0)
    };
    const dimsItemsSrc = Array.isArray(merged.dimensionsItems) ? merged.dimensionsItems : [];
    merged.dimensionsItems = dimsItemsSrc
      .map(d => ({
        L: Math.max(0, parseFloat(d?.L) || 0),
        W: Math.max(0, parseFloat(d?.W) || 0),
        H: Math.max(0, parseFloat(d?.H) || 0)
      }))
      .filter(d => d.L > 0 || d.W > 0 || d.H > 0);
    if (!merged.dimensionUnit) merged.dimensionUnit = "in";
    if (this.isGlassPackingCategory(merged.materialCategory)) {
      const gp =
        "glassPacking" in patch
          ? this._normalizeGlassPacking(merged.materialCategory, patch.glassPacking)
          : this._normalizeGlassPacking(merged.materialCategory, merged.glassPacking);
      merged.glassPacking = gp;
    } else {
      merged.glassPacking = null;
    }

    if (this.requiresPurchaseOrder(merged.materialCategory)) {
      if (!merged.purchaseOrder) {
        this.applyMainStockForReception(old);
        Utils.showToast(I18n.t("msg.receptionPoRequired"), "error");
        return false;
      }
      merged.provisional = true;
    }

    if (!merged.projectId || !merged.itemName) {
      this.applyMainStockForReception(old);
      Utils.showToast(I18n.t("msg.receptionProjectItemRequired"), "error");
      return false;
    }

    this.receptions[i] = merged;
    this.save();
    this.applyMainStockForReception(merged);
    InventoryManager.render();
    if (typeof TransportManager !== "undefined" && TransportManager.syncProjectTransportsFromReceptions) {
      TransportManager.syncProjectTransportsFromReceptions(merged.projectId);
    }
    return true;
  },

  deleteReception(id) {
    const i = this.receptions.findIndex(r => r.id === id);
    if (i < 0) return false;
    const rec = this.receptions[i];
    const pid = (rec.projectId || "").trim();
    this.revertMainStockEffect(rec);
    this.receptions.splice(i, 1);
    this.save();
    InventoryManager.render();
    if (pid && typeof TransportManager !== "undefined" && TransportManager.syncProjectTransportsFromReceptions) {
      TransportManager.syncProjectTransportsFromReceptions(pid);
    }
    return true;
  },

  /** Anula recepción vinculada a un movimiento (quita registro y revierte stock). */
  revertAndRemoveReception(id) {
    return this.deleteReception(id);
  },

  /** Elimina recepciones provisionales del proyecto (p. ej. al anular expedición). Devuelve cuántas se eliminaron. */
  removeProvisionalByProject(projectId) {
    const pid = (projectId || "").trim();
    if (!pid) return 0;
    const before = this.receptions.length;
    this.receptions = this.receptions.filter(
      r =>
        !(
          r.provisional &&
          Utils.projectIdsEquivalent(r.projectId, pid) &&
          !r.provisionalAnnulled
        )
    );
    const removed = before - this.receptions.length;
    if (removed) this.save();
    return removed;
  }
};
