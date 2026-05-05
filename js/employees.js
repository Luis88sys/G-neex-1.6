// employees.js — listas de destinatarios (Consumo diario): plantilla + ocasionales/externos

const EmployeeManager = {
    /** @type {{ id: string, name: string }[]} */
    employees: [],
    /** @type {{ id: string, name: string }[]} */
    occasionalRecipients: [],

    init() {
        this.load();
        this._bindConfig();
        this.renderConfigList();
        this.renderRecipientsPreview();
    },

    /** Edición de listas solo para administradores (pestaña Empleados). */
    _canEditLists() {
        return typeof Auth === "undefined" || Auth.isAdmin() || Auth.isElevated();
    },

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
            const parsed = raw ? JSON.parse(raw) : [];
            this.employees = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            this.employees = [];
        }
        try {
            const rawO = localStorage.getItem(STORAGE_KEYS.OCCASIONAL_RECIPIENTS);
            const parsedO = rawO ? JSON.parse(rawO) : [];
            this.occasionalRecipients = Array.isArray(parsedO) ? parsedO : [];
        } catch (e) {
            this.occasionalRecipients = [];
        }
        this._dedupeAndNormalize();
        this._dedupeOccasional();
    },

    save() {
        try {
            localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(this.employees));
        } catch (e) {}
        try {
            localStorage.setItem(STORAGE_KEYS.OCCASIONAL_RECIPIENTS, JSON.stringify(this.occasionalRecipients));
        } catch (e) {}
        this._notifyConsumoDatalist();
        this.renderRecipientsPreview();
    },

    _dedupeAndNormalize() {
        const seen = new Set();
        const out = [];
        for (const e of this.employees) {
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
        this.employees = out;
    },

    _dedupeOccasional() {
        const seen = new Set();
        const out = [];
        for (const e of this.occasionalRecipients) {
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
        this.occasionalRecipients = out;
    },

    /** Nombres ordenados (plantilla). */
    getSortedNames() {
        return this.employees.map(e => e.name);
    },

    /** Nombres ordenados (ocasionales / externos). */
    getOccasionalSortedNames() {
        return this.occasionalRecipients.map(e => e.name);
    },

    /** Si hay al menos un nombre en cualquiera de las dos listas, el destinatario debe estar en ellas. */
    isEnforced() {
        return this.employees.length > 0 || this.occasionalRecipients.length > 0;
    },

    /** Coincide con plantilla u ocasional (sin distinguir mayúsculas). */
    isKnownRecipient(name) {
        const n = String(name || "").trim().toLowerCase();
        if (!n) return false;
        return (
            this.employees.some(e => e.name.toLowerCase() === n) ||
            this.occasionalRecipients.some(e => e.name.toLowerCase() === n)
        );
    },

    /** Nombre canónico según las listas o null. */
    canonicalRecipientName(name) {
        const n = String(name || "").trim().toLowerCase();
        if (!n) return null;
        const fe = this.employees.find(e => e.name.toLowerCase() === n);
        if (fe) return fe.name;
        const fo = this.occasionalRecipients.find(e => e.name.toLowerCase() === n);
        return fo ? fo.name : null;
    },

    addFromInput() {
        if (!this._canEditLists()) return;
        const input = document.getElementById("employees-add-name");
        const raw = input ? input.value : "";
        const name = String(raw || "").trim();
        if (!name) {
            Utils.showToast(I18n.t("employees.nameRequired"), "warning");
            return;
        }
        if (this.employees.some(e => e.name.toLowerCase() === name.toLowerCase())) {
            Utils.showToast(I18n.t("employees.duplicate"), "warning");
            return;
        }
        if (this.occasionalRecipients.some(e => e.name.toLowerCase() === name.toLowerCase())) {
            Utils.showToast(I18n.t("employees.duplicateInOccasional"), "warning");
            return;
        }
        this.employees.push({ id: Utils.generateId(), name });
        this._dedupeAndNormalize();
        this.save();
        this.renderConfigList();
        if (input) input.value = "";
        Utils.showToast(I18n.t("employees.added"), "success");
        if (typeof Auth !== "undefined" && Auth.logAudit) {
            Auth.logAudit("employees.add", name);
        }
    },

    /**
     * Añade un nombre a la lista de ocasionales desde Consumo diario (botón junto a «Otro»).
     * Quien tenga permiso Movimientos puede usarlo sin ser administrador; la pestaña Empleados sigue siendo solo admin.
     */
    addOccasionalFromMovement(name) {
        if (typeof Auth === "undefined" || !Auth.hasPerm("movements")) {
            Utils.showToast(I18n.t("auth.noPermission"), "warning");
            return false;
        }
        const raw = String(name || "").trim();
        if (!raw) {
            Utils.showToast(I18n.t("employees.nameRequired"), "warning");
            return false;
        }
        if (this.occasionalRecipients.some(e => e.name.toLowerCase() === raw.toLowerCase())) {
            Utils.showToast(I18n.t("employees.duplicateInOccasional"), "warning");
            return false;
        }
        if (this.employees.some(e => e.name.toLowerCase() === raw.toLowerCase())) {
            Utils.showToast(I18n.t("employees.duplicateInStaff"), "warning");
            return false;
        }
        this.occasionalRecipients.push({ id: Utils.generateId(), name: raw });
        this._dedupeOccasional();
        this.save();
        Utils.showToast(I18n.t("employees.occasionalAdded"), "success");
        if (typeof Auth !== "undefined" && Auth.logAudit) {
            Auth.logAudit("occasionalRecipients.addFromMovement", raw);
        }
        return true;
    },

    addOccasionalFromInput() {
        if (!this._canEditLists()) return;
        const input = document.getElementById("employees-occasional-add-name");
        const raw = input ? input.value : "";
        const name = String(raw || "").trim();
        if (!name) {
            Utils.showToast(I18n.t("employees.nameRequired"), "warning");
            return;
        }
        if (this.occasionalRecipients.some(e => e.name.toLowerCase() === name.toLowerCase())) {
            Utils.showToast(I18n.t("employees.duplicate"), "warning");
            return;
        }
        if (this.employees.some(e => e.name.toLowerCase() === name.toLowerCase())) {
            Utils.showToast(I18n.t("employees.duplicateInStaff"), "warning");
            return;
        }
        this.occasionalRecipients.push({ id: Utils.generateId(), name });
        this._dedupeOccasional();
        this.save();
        this.renderConfigList();
        if (input) input.value = "";
        Utils.showToast(I18n.t("employees.occasionalAdded"), "success");
        if (typeof Auth !== "undefined" && Auth.logAudit) {
            Auth.logAudit("occasionalRecipients.add", name);
        }
    },

    remove(id) {
        if (!this._canEditLists()) return;
        const sid = String(id || "");
        if (!sid) return;
        this.employees = this.employees.filter(e => e.id !== sid);
        this.save();
        this.renderConfigList();
        Utils.showToast(I18n.t("employees.removed"), "info");
        if (typeof Auth !== "undefined" && Auth.logAudit) {
            Auth.logAudit("employees.remove", sid);
        }
    },

    removeOccasional(id) {
        if (!this._canEditLists()) return;
        const sid = String(id || "");
        if (!sid) return;
        this.occasionalRecipients = this.occasionalRecipients.filter(e => e.id !== sid);
        this.save();
        this.renderConfigList();
        Utils.showToast(I18n.t("employees.occasionalRemoved"), "info");
        if (typeof Auth !== "undefined" && Auth.logAudit) {
            Auth.logAudit("occasionalRecipients.remove", sid);
        }
    },

    /** Vista rápida en Configuración → Import/Export (solo nombres, para revisar / evitar duplicados). */
    renderRecipientsPreview() {
        const el = document.getElementById("config-employees-preview-body");
        if (!el) return;
        const staff = this.getSortedNames();
        const occ = this.getOccasionalSortedNames();
        if (!staff.length && !occ.length) {
            el.innerHTML = `<p class="muted">${this._esc(I18n.t("employees.previewEmpty"))}</p>`;
            return;
        }
        const parts = [];
        if (staff.length) {
            parts.push(
                `<div class="employees-preview-group"><strong>${this._esc(I18n.t("employees.optgroupStaff"))}:</strong> ${staff.map(n => this._esc(n)).join(", ")}</div>`
            );
        }
        if (occ.length) {
            parts.push(
                `<div class="employees-preview-group"><strong>${this._esc(I18n.t("employees.optgroupOccasional"))}:</strong> ${occ.map(n => this._esc(n)).join(", ")}</div>`
            );
        }
        el.innerHTML = parts.join("");
    },

    _notifyConsumoDatalist() {
        if (typeof MovementManager !== "undefined" && MovementManager._refreshConsumoRecipientDatalist) {
            MovementManager._refreshConsumoRecipientDatalist();
        }
        if (
            typeof MovementManager !== "undefined" &&
            MovementManager.currentType === "CONSUMO_DIARIO" &&
            typeof MovementManager.renderSelectedItems === "function"
        ) {
            MovementManager.renderSelectedItems();
        }
    },

    _esc(s) {
        return Utils.escapeHtml(s);
    },

    renderConfigList() {
        this._renderStaffList();
        this._renderOccasionalList();
    },

    _renderStaffList() {
        const ul = document.getElementById("employees-config-list");
        if (!ul) return;
        if (!this.employees.length) {
            ul.innerHTML = `<li class="employees-config-empty muted">${this._esc(I18n.t("employees.listEmpty"))}</li>`;
            return;
        }
        const del = typeof I18n !== "undefined" && I18n.t ? I18n.t("buttons.delete") : "×";
        ul.innerHTML = this.employees
            .map(
                e => `<li class="employees-config-row">
            <span class="employees-config-name">${this._esc(e.name)}</span>
            <button type="button" class="btn btn-secondary btn-sm employees-remove-btn" data-id="${Utils.escapeAttr(e.id)}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button>
          </li>`
            )
            .join("");
    },

    _renderOccasionalList() {
        const ul = document.getElementById("employees-occasional-config-list");
        if (!ul) return;
        if (!this.occasionalRecipients.length) {
            ul.innerHTML = `<li class="employees-config-empty muted">${this._esc(I18n.t("employees.occasionalListEmpty"))}</li>`;
            return;
        }
        const del = typeof I18n !== "undefined" && I18n.t ? I18n.t("buttons.delete") : "×";
        ul.innerHTML = this.occasionalRecipients
            .map(
                e => `<li class="employees-config-row">
            <span class="employees-config-name">${this._esc(e.name)}</span>
            <button type="button" class="btn btn-secondary btn-sm employees-occasional-remove-btn" data-id="${Utils.escapeAttr(e.id)}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button>
          </li>`
            )
            .join("");
    },

    _bindConfig() {
        document.getElementById("employees-add-btn")?.addEventListener("click", () => this.addFromInput());
        document.getElementById("employees-add-name")?.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.addFromInput();
            }
        });
        document.getElementById("employees-config-list")?.addEventListener("click", e => {
            const btn = e.target.closest(".employees-remove-btn");
            if (btn && btn.dataset.id) this.remove(btn.dataset.id);
        });

        document.getElementById("employees-occasional-add-btn")?.addEventListener("click", () => this.addOccasionalFromInput());
        document.getElementById("employees-occasional-add-name")?.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.addOccasionalFromInput();
            }
        });
        document.getElementById("employees-occasional-config-list")?.addEventListener("click", e => {
            const btn = e.target.closest(".employees-occasional-remove-btn");
            if (btn && btn.dataset.id) this.removeOccasional(btn.dataset.id);
        });
    }
};
