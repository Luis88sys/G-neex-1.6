// suppliers.js — lista maestra de proveedores (pedidos a proveedor, sugerencias)

const SupplierManager = {
    /** @type {{ id: string, name: string }[]} */
    suppliers: [],

    init() {
        this.load();
        this._bindConfig();
        this.renderConfigList();
        this.refreshOrderLineSupplierUI();
    },

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
            const parsed = raw ? JSON.parse(raw) : [];
            this.suppliers = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            this.suppliers = [];
        }
        this._dedupeAndNormalize();
    },

    save() {
        try {
            localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(this.suppliers));
        } catch (e) {}
        this.refreshOrderLineSupplierUI();
        if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.render) OrderLinesManager.render();
    },

    _dedupeAndNormalize() {
        const seen = new Set();
        const out = [];
        for (const e of this.suppliers) {
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
        this.suppliers = out;
    },

    getSortedNames() {
        return this.suppliers.map(e => e.name);
    },

    _canEdit() {
        return typeof Auth === "undefined" || Auth.isAdmin() || Auth.isElevated();
    },

    addFromInput() {
        if (!this._canEdit()) return;
        const input = document.getElementById("suppliers-add-name");
        const raw = input ? input.value : "";
        const name = String(raw || "").trim();
        if (!name) {
            Utils.showToast(I18n.t("suppliers.nameRequired"), "warning");
            return;
        }
        if (this.suppliers.some(e => e.name.toLowerCase() === name.toLowerCase())) {
            Utils.showToast(I18n.t("suppliers.duplicate"), "warning");
            return;
        }
        this.suppliers.push({ id: Utils.generateId(), name });
        this._dedupeAndNormalize();
        this.save();
        this.renderConfigList();
        if (input) input.value = "";
        Utils.showToast(I18n.t("suppliers.added"), "success");
        if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("suppliers.add", name);
    },

    remove(id) {
        if (!this._canEdit()) return;
        const sid = String(id || "");
        if (!sid) return;
        this.suppliers = this.suppliers.filter(e => e.id !== sid);
        this.save();
        this.renderConfigList();
        Utils.showToast(I18n.t("suppliers.removed"), "info");
        if (typeof Auth !== "undefined" && Auth.logAudit) Auth.logAudit("suppliers.remove", sid);
    },

    /** Actualiza select/input del formulario y datalist de Pedidos. */
    refreshOrderLineSupplierUI() {
        const names = this.getSortedNames();
        const optHtml = names.map(n => `<option value="${Utils.escapeAttr(n)}"></option>`).join("");
        const datalist = document.getElementById("orderline-supplier-datalist");
        if (datalist) {
            datalist.innerHTML = optHtml;
        }
        ["mov-rec-supplier-datalist", "mov-compra-supplier-datalist", "orderline-consum-supplier-datalist"].forEach(
            id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = optHtml;
            }
        );
        const ph = I18n.t("suppliers.selectPlaceholder");
        const applySupplierPair = (sel, inp) => {
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
        applySupplierPair(
            document.getElementById("orderline-supplier-select"),
            document.getElementById("orderline-supplier")
        );
        applySupplierPair(
            document.getElementById("orderline-consum-supplier-select"),
            document.getElementById("orderline-consum-supplier")
        );
    },

    _esc(s) {
        return Utils.escapeHtml(s);
    },

    renderConfigList() {
        const ul = document.getElementById("suppliers-config-list");
        if (!ul) return;
        if (!this.suppliers.length) {
            ul.innerHTML = `<li class="employees-config-empty muted">${this._esc(I18n.t("suppliers.listEmpty"))}</li>`;
            return;
        }
        const del = I18n.t("buttons.delete");
        ul.innerHTML = this.suppliers
            .map(
                e => `<li class="employees-config-row">
            <span class="employees-config-name">${this._esc(e.name)}</span>
            <button type="button" class="btn btn-secondary btn-sm suppliers-remove-btn" data-id="${Utils.escapeAttr(e.id)}" title="${this._esc(del)}" aria-label="${this._esc(del)}">${this._esc(del)}</button>
          </li>`
            )
            .join("");
    },

    _bindConfig() {
        document.getElementById("suppliers-add-btn")?.addEventListener("click", () => this.addFromInput());
        document.getElementById("suppliers-add-name")?.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.addFromInput();
            }
        });
        document.getElementById("suppliers-config-list")?.addEventListener("click", e => {
            const btn = e.target.closest(".suppliers-remove-btn");
            if (btn && btn.dataset.id) this.remove(btn.dataset.id);
        });
    }
};
