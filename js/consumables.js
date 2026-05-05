// consumables.js — lista maestra de artículos consumibles (solo constancia COMPRA, sin inventario)

const ConsumableManager = {
  /** @type {{ id: string, name: string }[]} */
  consumables: [],

  init() {
    this.load();
    this._bindConfig();
    this.renderConfigList();
    this.refreshDatalists();
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CONSUMABLES);
      const parsed = raw ? JSON.parse(raw) : [];
      this.consumables = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      this.consumables = [];
    }
    this._dedupeAndNormalize();
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEYS.CONSUMABLES, JSON.stringify(this.consumables));
    } catch (e) {}
    this.refreshDatalists();
    if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.render) OrderLinesManager.render();
  },

  _dedupeAndNormalize() {
    const seen = new Set();
    const out = [];
    for (const e of this.consumables) {
      if (!e || typeof e !== "object") continue;
      const name = String(e.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: e.id && String(e.id).trim() ? String(e.id) : Utils.generateId(),
        name
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    this.consumables = out;
  },

  getSortedNames() {
    return this.consumables.map(e => e.name);
  },

  /** Nombre canonico si existe en lista (misma grafia que en maestro); null si lista vacia o sin coincidencia */
  canonicalConsumable(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const low = s.toLowerCase();
    const hit = this.consumables.find(e => e.name.toLowerCase() === low);
    return hit ? hit.name : null;
  },

  isKnownName(raw) {
    return !!this.canonicalConsumable(raw);
  },

  hasList() {
    return this.consumables.length > 0;
  },

  /** Añade el nombre a la lista maestra si no existe (p. ej. artículo marcado como consumible de inventario). */
  ensureMasterName(raw) {
    const name = String(raw || "").trim();
    if (!name) return;
    if (
      this.consumables.some(e => String(e.name || "").trim().toLowerCase() === name.toLowerCase())
    )
      return;
    if (typeof Auth !== "undefined" && !Auth.isAdmin() && !Auth.isElevated()) return;
    this.consumables.push({ id: Utils.generateId(), name });
    this._dedupeAndNormalize();
    this.save();
    this.renderConfigList();
  },

  /** Quita el nombre de la lista maestra (p. ej. al desmarcar «consumible de inventario» en el editor del artículo). */
  removeMasterName(raw) {
    const name = String(raw || "").trim();
    if (!name) return false;
    if (!this._canEdit()) return false;
    const low = name.toLowerCase();
    const before = this.consumables.length;
    this.consumables = this.consumables.filter(e => String(e.name || "").trim().toLowerCase() !== low);
    if (this.consumables.length === before) return false;
    this._dedupeAndNormalize();
    this.save();
    this.renderConfigList();
    Utils.showToast(I18n.t("consumables.removed"), "info");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("consumables.removeByName", name);
    return true;
  },

  _canEdit() {
    return typeof Auth === "undefined" || Auth.isAdmin() || Auth.isElevated();
  },

  addFromInput() {
    if (!this._canEdit()) return;
    const input = document.getElementById("consumables-add-name");
    const raw = input ? input.value : "";
    const name = String(raw || "").trim();
    if (!name) {
      Utils.showToast(I18n.t("consumables.nameRequired"), "warning");
      return;
    }
    if (this.consumables.some(e => e.name.toLowerCase() === name.toLowerCase())) {
      Utils.showToast(I18n.t("consumables.duplicate"), "warning");
      return;
    }
    this.consumables.push({ id: Utils.generateId(), name });
    this._dedupeAndNormalize();
    this.save();
    this.renderConfigList();
    if (input) input.value = "";
    Utils.showToast(I18n.t("consumables.added"), "success");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("consumables.add", name);
  },

  remove(id) {
    if (!this._canEdit()) return;
    const sid = String(id || "");
    if (!sid) return;
    this.consumables = this.consumables.filter(e => e.id !== sid);
    this.save();
    this.renderConfigList();
    Utils.showToast(I18n.t("consumables.removed"), "info");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("consumables.remove", sid);
  },

  refreshDatalists() {
    const names = this.getSortedNames();
    const optHtml = names.map(n => `<option value="${Utils.escapeAttr(n)}"></option>`).join("");
    ["mov-compra-consumible-datalist", "orderline-consumible-datalist"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = optHtml;
    });
    const ph = I18n.t("consumables.selectPlaceholder");

    const applyPair = (selId, inpId) => {
      const sel = document.getElementById(selId);
      const inp = document.getElementById(inpId);
      if (!sel || !inp) return;
      if (names.length > 0) {
        sel.style.display = "";
        inp.style.display = "none";
        sel.innerHTML =
          `<option value="">${this._esc(ph)}</option>` +
          names.map(n => `<option value="${Utils.escapeAttr(n)}">${this._esc(n)}</option>`).join("");
      } else {
        sel.style.display = "none";
        inp.style.display = "";
        sel.innerHTML = "";
      }
    };

    applyPair("orderline-consumible-select", "orderline-consumible-name");
    applyPair("mov-compra-consumible-select", "mov-compra-consumible-name");
  },

  _esc(s) {
    return Utils.escapeHtml(s);
  },

  renderConfigList() {
    const ul = document.getElementById("consumables-config-list");
    if (!ul) return;
    if (!this.consumables.length) {
      ul.innerHTML = `<li class="employees-config-empty muted">${this._esc(I18n.t("consumables.listEmpty"))}</li>`;
      return;
    }
    const del = I18n.t("buttons.delete");
    ul.innerHTML = this.consumables
      .map(
        e => `<li class="employees-config-row">
            <span class="employees-config-name">${this._esc(e.name)}</span>
            <button type="button" class="btn btn-secondary btn-sm consumables-remove-btn" data-id="${Utils.escapeAttr(e.id)}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button>
          </li>`
      )
      .join("");
  },

  _bindConfig() {
    document.getElementById("consumables-add-btn")?.addEventListener("click", () => this.addFromInput());
    document.getElementById("consumables-add-name")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.addFromInput();
      }
    });
    document.getElementById("consumables-config-list")?.addEventListener("click", e => {
      const btn = e.target.closest(".consumables-remove-btn");
      if (btn && btn.dataset.id) this.remove(btn.dataset.id);
    });
  }
};
