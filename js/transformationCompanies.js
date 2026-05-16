// transformationCompanies.js — maestro de empresas / talleres de transformación (reutilizable en movimientos)

const TransformationCompaniesManager = {
  companies: [],

  _canEdit() {
    return typeof Auth === "undefined" || Auth.isAdmin() || Auth.isElevated();
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.TRANSFORMATION_COMPANIES);
      const arr = raw ? JSON.parse(raw) : [];
      this.companies = Array.isArray(arr) ? arr : [];
    } catch (e) {
      this.companies = [];
    }
    this._normalize();
  },

  save() {
    localStorage.setItem(STORAGE_KEYS.TRANSFORMATION_COMPANIES, JSON.stringify(this.companies));
  },

  _normalize() {
    const seen = new Set();
    this.companies = (this.companies || [])
      .map(e => ({
        id: String(e?.id || "").trim() || Utils.generateId(),
        name: String(e?.name || "").trim()
      }))
      .filter(e => {
        const k = e.name.toLowerCase();
        if (!e.name || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  },

  getSorted() {
    return [...this.companies];
  },

  getById(id) {
    const sid = String(id || "").trim();
    if (!sid) return null;
    return this.companies.find(c => c.id === sid) || null;
  },

  getName(id) {
    const c = this.getById(id);
    return c ? c.name : "";
  },

  /**
   * Añade por nombre si no existe; devuelve el id (existente o nuevo).
   * @param {string} rawName
   * @returns {string|null} id o null si no se pudo
   */
  ensureByName(rawName) {
    const name = String(rawName || "").trim();
    if (!name) return null;
    this.load();
    const low = name.toLowerCase();
    const hit = this.companies.find(c => c.name.toLowerCase() === low);
    if (hit) return hit.id;
    if (!this._canEdit()) return null;
    const id = Utils.generateId();
    this.companies.push({ id, name });
    this._normalize();
    this.save();
    this.renderConfigList();
    this.refreshDatalists();
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("transformationCompanies.add", id);
    return id;
  },

  addFromInput() {
    if (!this._canEdit()) return;
    const inp = document.getElementById("trans-companies-add-name");
    const name = String(inp?.value || "").trim();
    if (!name) {
      Utils.showToast(I18n.t("transCompanies.nameRequired"), "warning");
      return;
    }
    const low = name.toLowerCase();
    this.load();
    if (this.companies.some(c => c.name.toLowerCase() === low)) {
      Utils.showToast(I18n.t("transCompanies.duplicate"), "warning");
      return;
    }
    this.companies.push({ id: Utils.generateId(), name });
    this._normalize();
    this.save();
    if (inp) inp.value = "";
    this.renderConfigList();
    this.refreshDatalists();
    Utils.showToast(I18n.t("transCompanies.added"), "success");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("transformationCompanies.add", name);
  },

  remove(id) {
    if (!this._canEdit()) return;
    const sid = String(id || "");
    if (!sid) return;
    this.companies = this.companies.filter(e => e.id !== sid);
    this.save();
    this.renderConfigList();
    this.refreshDatalists();
    Utils.showToast(I18n.t("transCompanies.removed"), "info");
    if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("transformationCompanies.remove", sid);
  },

  refreshDatalists() {
    const names = this.getSorted().map(c => c.name);
    const list = this.getSorted();
    const optHtml = list.map(c => `<option value="${Utils.escapeAttr(c.name)}"></option>`).join("");
    const el = document.getElementById("mov-tf-vendor-datalist");
    if (el) el.innerHTML = optHtml;
    const esc = s => Utils.escapeHtml(s);
    const opts =
      `<option value="">${esc(I18n.t("transCompanies.selectPlaceholder"))}</option>` +
      list.map(c => `<option value="${Utils.escapeAttr(c.id)}">${esc(c.name)}</option>`).join("");
    document.querySelectorAll("select.mov-transfer-tf-co-select").forEach(sel => {
      const cur = String(sel.value || "");
      sel.innerHTML = opts;
      if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    });
  },

  /** Opciones HTML para `<select>` (valor = id). */
  buildOptionsHtml(selectedId) {
    const esc = s => Utils.escapeHtml(s);
    const sel = String(selectedId || "").trim();
    const rows = this.getSorted();
    let html = `<option value="">${esc(I18n.t("transCompanies.selectPlaceholder"))}</option>`;
    for (const c of rows) {
      const a = Utils.escapeAttr(c.id);
      const optSel = sel && c.id === sel ? " selected" : "";
      html += `<option value="${a}"${optSel}>${esc(c.name)}</option>`;
    }
    return html;
  },

  _esc(s) {
    return Utils.escapeHtml(s);
  },

  renderConfigList() {
    const ul = document.getElementById("trans-companies-config-list");
    if (!ul) return;
    this.load();
    if (!this.companies.length) {
      ul.innerHTML = `<li class="employees-config-empty muted">${this._esc(I18n.t("transCompanies.listEmpty"))}</li>`;
      return;
    }
    const del = I18n.t("buttons.delete");
    ul.innerHTML = this.companies
      .map(
        e => `<li class="employees-config-row">
            <span class="employees-config-name">${this._esc(e.name)}</span>
            <button type="button" class="btn btn-secondary btn-sm trans-companies-remove-btn" data-id="${Utils.escapeAttr(e.id)}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button>
          </li>`
      )
      .join("");
  },

  _bindConfig() {
    document.getElementById("trans-companies-add-btn")?.addEventListener("click", () => this.addFromInput());
    document.getElementById("trans-companies-add-name")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.addFromInput();
      }
    });
    document.getElementById("trans-companies-config-list")?.addEventListener("click", e => {
      const btn = e.target.closest(".trans-companies-remove-btn");
      if (btn && btn.dataset.id) this.remove(btn.dataset.id);
    });
  },

  init() {
    this.load();
    this._bindConfig();
    this.renderConfigList();
    this.refreshDatalists();
  }
};
