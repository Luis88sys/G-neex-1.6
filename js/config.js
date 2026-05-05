// config.js — módulo central de configuración avanzada

const ConfigManager = {
  /** Artículo seleccionado en pestaña Expiraciones (vida útil en meses). */
  expirationSelectedId: null,
  _receptionEditId: null,
  _receptionListFilter: "",
  /** Modal de configuración minimizado pero formularios vivos en el DOM */
  _configDraftMinimized: false,
  _userMatrixTargetId: null,
  _userMatrixModalBound: false,

  init() {
    try {
      this.setupEventListeners();
      this.setupUserPermissionMatrixModal();
      this.renderItemEditorOptions();
      this.renderReceptionList();
      this.syncExpAlertInput();
      this.refreshItemEditLockUI();
      this.setupExpirationSearchListeners();
      this.updateConfigDraftBar();
      console.log("✅ ConfigManager iniciado");
    } catch (err) {
      console.error("❌ Error iniciando ConfigManager:", err);
    }
  },

  esc(s) {
    return Utils.escapeHtml(s);
  },

  /** Etiquetas del desplegable de nivel; las filas `tab*` explican «no ver la pestaña», etc. */
  _matrixLevelOptionLabel(matrixKey, level) {
    const genKey = `auth.matrix.level.${level}`;
    if (matrixKey && String(matrixKey).startsWith("tab")) {
      const tabKey = `auth.matrix.level.tab.${level}`;
      const tabLbl = I18n.t(tabKey);
      if (tabLbl !== tabKey) return tabLbl;
    }
    return I18n.t(genKey);
  },

  /**
   * Alinea la pestaña de configuración con la matriz de acciones (Configuración, fase 1).
   * Mantiene reglas estrictas: usuarios / elevación solo administrador real.
   */
  sanitizeConfigTab(tab) {
    let t = String(tab || "about");
    if (typeof Auth === "undefined") return t;
    if (!Auth.isAdmin() && (t === "users" || t === "elevation")) t = "about";
    const map = Auth.CONFIG_TAB_TO_ACTION || {};
    const level = name => {
      const k = map[name];
      return k ? Auth.getSessionConfigActionLevel(k) : "none";
    };
    if (level(t) === "none") {
      const order = [
        "about",
        "import",
        "receptions",
        "expirations",
        "itemedit",
        "employees",
        "suppliers",
        "consumables"
      ];
      t = "about";
      for (const name of order) {
        if (level(name) !== "none") {
          t = name;
          break;
        }
      }
    }
    return t;
  },

  updateConfigDraftBar() {
    const wrap = document.getElementById("config-draft-float-wrap");
    if (!wrap) return;
    wrap.hidden = !this._configDraftMinimized;
  },

  minimizeConfigModal() {
    const modal = document.getElementById("config-modal");
    if (!modal?.classList.contains("active")) return;
    this._configDraftMinimized = true;
    modal.classList.remove("active");
    this.updateConfigDraftBar();
  },

  resumeConfigModal() {
    const modal = document.getElementById("config-modal");
    if (!modal) return;
    this._configDraftMinimized = false;
    modal.classList.add("active");
    if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
    this.updateConfigDraftBar();
  },

  /** Si hay entrada relevante antes de cerrar de forma irreversible el modal */
  isConfigFormDirty() {
    if (this._receptionEditId) return true;
    if (document.getElementById("config-item-editor-id")?.value?.trim()) return true;

    const pinIds = [
      "item-edit-pin-input",
      "item-edit-pin-new",
      "item-edit-pin-new2",
      "item-edit-pin-current-change",
      "item-edit-pin-new-change",
      "item-edit-pin-new2-change"
    ];
    for (const id of pinIds) {
      const el = document.getElementById(id);
      if (el && String(el.value || "").trim()) return true;
    }

    const knownIds = [
      "config-item-search",
      "suppliers-add-name",
      "consumables-add-name",
      "employees-add-name",
      "employees-occasional-add-name",
      "config-location-catalog-input",
      "user-add-username",
      "user-add-display",
      "user-add-password",
      "exp-item-search"
    ];
    for (const id of knownIds) {
      const el = document.getElementById(id);
      if (el && String(el.value || "").trim()) return true;
    }

    const pane = document.getElementById("config-modal")?.querySelector(".config-content.active");
    if (!pane) return false;

    const skipScanIds = new Set(["receptions-config-search"]);
    const knownSet = new Set(knownIds);
    const textInputs = pane.querySelectorAll(
      'input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
    );
    for (const el of textInputs) {
      const id = el.id || "";
      if (!id || skipScanIds.has(id) || knownSet.has(id)) continue;
      if (String(el.value || "").trim()) return true;
    }

    for (const ta of pane.querySelectorAll("textarea")) {
      if (String(ta.value || "").trim()) return true;
    }

    return false;
  },

  closeConfigModalDiscard() {
    const modal = document.getElementById("config-modal");
    if (modal) modal.classList.remove("active");
    this.resetItemEditSession();
    this._configDraftMinimized = false;
    this.updateConfigDraftBar();
  },

  promptDiscardConfigModal() {
    this.closeConfigModalDiscard();
  },

  setupUserPermissionMatrixModal() {
    if (this._userMatrixModalBound) return;
    const modal = document.getElementById("user-permission-matrix-modal");
    const form = document.getElementById("user-permission-matrix-form");
    const closeBtn = document.getElementById("close-user-permission-matrix");
    const cancelBtn = document.getElementById("user-permission-matrix-cancel");
    if (!modal || !form) return;
    this._userMatrixModalBound = true;
    form.addEventListener("change", e => {
      const t = e.target;
      if (t && t.matches && t.matches('select[name^="matrix-"]')) {
        this._syncUserPermissionMatrixModalHierarchy(form);
      }
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const uid = this._userMatrixTargetId;
      if (!uid || typeof Auth === "undefined") return;
      const matrix = {};
      for (const k of Auth.MATRIX_KEYS) {
        const sel = form.querySelector(`[name="matrix-${k}"]`);
        matrix[k] = sel && Auth.MATRIX_LEVELS.includes(sel.value) ? sel.value : "none";
      }
      const actionMatrix = {};
      for (const k of Auth.CONFIG_ACTION_KEYS || []) {
        const sel = form.querySelector(`[name="action-${k}"]`);
        actionMatrix[k] = sel && Auth.MATRIX_LEVELS.includes(sel.value) ? sel.value : "none";
      }
      for (const k of Auth.ORDER_ACTION_KEYS || []) {
        const sel = form.querySelector(`[name="action-${k}"]`);
        actionMatrix[k] = sel && Auth.MATRIX_LEVELS.includes(sel.value) ? sel.value : "none";
      }
      for (const k of Auth.TAB_FEATURE_ACTION_KEYS || []) {
        const sel = form.querySelector(`[name="action-${k}"]`);
        actionMatrix[k] = sel && Auth.MATRIX_LEVELS.includes(sel.value) ? sel.value : "none";
      }
      Auth.setUserPermissionMatrix(uid, matrix, actionMatrix);
      Utils.showToast(I18n.t("auth.permChanged"), "success");
      this.closeUserPermissionMatrixModal();
      this.renderUsersTable();
      this.renderAuditLog();
    });
    const close = () => this.closeUserPermissionMatrixModal();
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (cancelBtn) cancelBtn.addEventListener("click", close);
    modal.addEventListener("click", e => {
      if (e.target === modal) close();
    });
  },

  closeUserPermissionMatrixModal() {
    const modal = document.getElementById("user-permission-matrix-modal");
    if (modal) modal.classList.remove("active");
    this._userMatrixTargetId = null;
  },

  /**
   * Mientras se edita la matriz: pedidos (`ord*`) y zonas (`inv*`…) no pueden superar su pestaña.
   * Actualiza selects al vuelo (sin guardar).
   */
  _syncUserPermissionMatrixModalHierarchy(form) {
    if (!form || typeof Auth === "undefined") return;
    const mx = {};
    for (const k of Auth.MATRIX_KEYS) {
      const el = form.querySelector(`[name="matrix-${k}"]`);
      mx[k] = el && Auth.MATRIX_LEVELS.includes(el.value) ? el.value : "none";
    }
    const fineKeys = [...(Auth.ORDER_ACTION_KEYS || []), ...(Auth.TAB_FEATURE_ACTION_KEYS || [])];
    for (const key of fineKeys) {
      const parentKey = Auth._parentTabMatrixKeyForAction(key);
      if (!parentKey) continue;
      const p = mx[parentKey] || "none";
      const sel = form.querySelector(`select[name="action-${key}"]`);
      if (!sel) continue;
      const row = sel.closest(".user-matrix-row");
      sel.disabled = false;
      for (const opt of sel.querySelectorAll("option")) opt.disabled = false;
      if (row) row.classList.remove("user-matrix-row--hierarchy-locked");

      if (p === "none") {
        sel.value = "none";
        sel.disabled = true;
        if (row) row.classList.add("user-matrix-row--hierarchy-locked");
        continue;
      }
      if (p === "view") {
        const editOpt = sel.querySelector('option[value="edit"]');
        if (editOpt) editOpt.disabled = true;
        if (sel.value === "edit") sel.value = "view";
      }
    }
  },

  openUserPermissionMatrixModal(userId) {
    if (typeof Auth === "undefined") return;
    const u = Auth.getUserById(userId);
    if (!u || u.role === "admin") return;
    this._userMatrixTargetId = userId;
    const modal = document.getElementById("user-permission-matrix-modal");
    const titleEl = document.getElementById("user-permission-matrix-title");
    const fields = document.getElementById("user-permission-matrix-fields");
    if (!modal || !fields) return;
    const name = (u.displayName || u.username || userId || "").trim();
    if (titleEl) titleEl.textContent = `${I18n.t("auth.matrixModalTitle")} — ${name}`;
    const mx = Auth.getUserPermissionMatrix(u);
    const actMx = Auth.getEffectivePermissionActionMatrix(u);
    const levels = Auth.MATRIX_LEVELS;
    const keys = Auth.MATRIX_KEYS;
    const cfgKeys = Auth.CONFIG_ACTION_KEYS || [];
    const ordKeys = Auth.ORDER_ACTION_KEYS || [];
    const tabFeatSections = Auth.TAB_FEATURE_MATRIX_SECTIONS || [];
    const tabFeatKeysFlat = Auth.TAB_FEATURE_ACTION_KEYS || [];
    let html = keys
      .map(k => {
        const cur = mx[k] || "none";
        const opts = levels
          .map(
            l =>
              `<option value="${l}"${cur === l ? " selected" : ""}>${this.esc(this._matrixLevelOptionLabel(k, l))}</option>`
          )
          .join("");
        return `<div class="user-matrix-row">
      <label for="umx-${this.esc(k)}">${this.esc(I18n.t(`auth.matrix.key.${k}`))}</label>
      <select id="umx-${this.esc(k)}" name="matrix-${this.esc(k)}" class="user-matrix-select">${opts}</select>
    </div>`;
      })
      .join("");
    html += `<h3 class="user-matrix-section-title">${this.esc(I18n.t("auth.matrixSectionConfigActions"))}</h3>`;
    html += cfgKeys
      .map(k => {
        const cur = actMx[k] || "none";
        const opts = levels
          .map(
            l =>
              `<option value="${l}"${cur === l ? " selected" : ""}>${this.esc(I18n.t(`auth.matrix.level.${l}`))}</option>`
          )
          .join("");
        const labelKey = `auth.cfgAction.${k}`;
        const lbl = I18n.t(labelKey);
        const label = lbl !== labelKey ? lbl : k;
        return `<div class="user-matrix-row user-matrix-row--cfg">
      <label for="uax-${this.esc(k)}">${this.esc(label)}</label>
      <select id="uax-${this.esc(k)}" name="action-${this.esc(k)}" class="user-matrix-select">${opts}</select>
    </div>`;
      })
      .join("");
    html += `<p class="user-matrix-hierarchy-hint muted" style="margin:0.65rem 0 0.75rem;font-size:0.82rem;line-height:1.35;">${this.esc(I18n.t("auth.matrixHierarchyHint"))}</p>`;
    html += `<h3 class="user-matrix-section-title">${this.esc(I18n.t("auth.matrixSectionOrderActions"))}</h3>`;
    html += ordKeys
      .map(k => {
        const cur = actMx[k] || "none";
        const opts = levels
          .map(
            l =>
              `<option value="${l}"${cur === l ? " selected" : ""}>${this.esc(I18n.t(`auth.matrix.level.${l}`))}</option>`
          )
          .join("");
        const labelKey = `auth.ordAction.${k}`;
        const lbl = I18n.t(labelKey);
        const label = lbl !== labelKey ? lbl : k;
        return `<div class="user-matrix-row user-matrix-row--ord">
      <label for="uax-${this.esc(k)}">${this.esc(label)}</label>
      <select id="uax-${this.esc(k)}" name="action-${this.esc(k)}" class="user-matrix-select">${opts}</select>
    </div>`;
      })
      .join("");
    const tabFeatRowHtml = k => {
      const cur = actMx[k] || "none";
      const opts = levels
        .map(
          l =>
            `<option value="${l}"${cur === l ? " selected" : ""}>${this.esc(I18n.t(`auth.matrix.level.${l}`))}</option>`
        )
        .join("");
      const labelKey = `auth.tabFeat.${k}`;
      const lbl = I18n.t(labelKey);
      const label = lbl !== labelKey ? lbl : k;
      return `<div class="user-matrix-row user-matrix-row--tabfeat">
      <label for="uax-${this.esc(k)}">${this.esc(label)}</label>
      <select id="uax-${this.esc(k)}" name="action-${this.esc(k)}" class="user-matrix-select">${opts}</select>
    </div>`;
    };
    if (tabFeatSections.length) {
      tabFeatSections.forEach(sec => {
        html += `<h3 class="user-matrix-section-title">${this.esc(I18n.t(sec.titleKey))}</h3>`;
        html += sec.keys.map(k => tabFeatRowHtml(k)).join("");
      });
    } else {
      html += `<h3 class="user-matrix-section-title">${this.esc(I18n.t("auth.matrixSectionTabFeatures"))}</h3>`;
      html += tabFeatKeysFlat.map(k => tabFeatRowHtml(k)).join("");
    }
    fields.innerHTML = html;
    const formEl = document.getElementById("user-permission-matrix-form");
    if (formEl) this._syncUserPermissionMatrixModalHierarchy(formEl);
    if (typeof App !== "undefined" && App._bringModalToFront) App._bringModalToFront(modal);
    modal.classList.add("active");
  },

  renderUsersTable() {
    const wrap = document.getElementById("users-table-wrap");
    if (!wrap || typeof Auth === "undefined") return;
    if (!Auth.isAdmin()) {
      wrap.innerHTML = "";
      return;
    }
    Auth.loadUsers();
    Auth.ensureBuiltinAccountsSeeded();
    const byId = new Map();
    for (const id of Auth.BUILTIN_IDS_ORDERED || []) {
      const merged = Auth.getUserById(id);
      if (merged) byId.set(id, merged);
    }
    for (const u of Auth.users || []) {
      if (u && u.id && !byId.has(u.id)) byId.set(u.id, u);
    }
    const users = Array.from(byId.values());
    if (!this._usersTableEventsBound) {
      this._usersTableEventsBound = true;
      wrap.addEventListener("click", e => {
        const matrixBtn = e.target.closest(".user-matrix-btn");
        if (matrixBtn && matrixBtn.dataset.userId) {
          this.openUserPermissionMatrixModal(matrixBtn.dataset.userId);
          return;
        }
        const editProfileBtn = e.target.closest(".user-edit-profile-btn");
        if (editProfileBtn && editProfileBtn.dataset.userId && !editProfileBtn.disabled) {
          if (typeof Auth !== "undefined" && Auth.openProfileModal) {
            Auth.openProfileModal(editProfileBtn.dataset.userId);
          }
          return;
        }
        const resetBtn = e.target.closest(".user-reset-pwd-btn");
        if (resetBtn && resetBtn.dataset.userId) {
          void (async () => {
            const id = resetBtn.dataset.userId;
            const pw = await App.showPrompt({
              message: I18n.t("auth.newPasswordPrompt"),
              defaultValue: "",
              inputType: "text"
            });
            if (pw === null) return;
            if (String(pw).length < 4) {
              Utils.showToast(I18n.t("auth.fieldsInvalid"), "error");
              return;
            }
            const r = await Auth.setUserPassword(id, pw);
            if (r && r.ok) Utils.showToast(I18n.t("auth.passwordChanged"), "success");
            else if (r && r.msg === "password-reuse") Utils.showToast(I18n.t("auth.passwordReuse"), "warning");
            else if (r && r.msg === "short") Utils.showToast(I18n.t("auth.fieldsInvalid"), "error");
            else Utils.showToast(I18n.t("auth.error"), "error");
            this.renderUsersTable();
            this.renderAuditLog();
          })();
          return;
        }
        const delBtn = e.target.closest(".user-delete-btn");
        if (delBtn && delBtn.dataset.userId) {
          if (delBtn.disabled) return;
          const id = delBtn.dataset.userId;
          const un = delBtn.dataset.username || "";
          App.showConfirm(`${I18n.t("auth.deleteUser")} — ${un}?`, () => {
            const wasSelf = id === Auth.sessionUserId;
            Auth.deleteUser(id);
            Auth.loadUsers();
            const uStill = Auth.users.some(x => x.id === id);
            if (uStill) {
              Utils.showToast(wasSelf ? I18n.t("auth.cannotDeleteSelf") : I18n.t("auth.error"), "warning");
            } else {
              Utils.showToast(I18n.t("auth.userDeleted"), "info");
            }
            this.renderUsersTable();
            this.renderAuditLog();
          });
        }
      });
    }
    const rows = users
      .map(u => {
        const isBuiltin = !!(u.builtin || Auth.isBuiltinId(u.id));
        const isAdmin = u.role === "admin";
        const isSelf = u.id === Auth.sessionUserId;
        const roleCell = isAdmin ? this.esc(I18n.t("auth.roleAdmin")) : this.esc(u.role || "");
        const delDisabled = isSelf || isBuiltin ? " disabled" : "";
        const matrixBtn = isAdmin
          ? ""
          : `<button type="button" class="btn btn-secondary user-matrix-btn" data-user-id="${Utils.escapeAttr(u.id)}">${this.esc(I18n.t("auth.matrixEditor"))}</button>`;
        const builtinTag = isBuiltin
          ? ` <span class="muted" style="font-size:0.75rem;">(${this.esc(I18n.t("auth.builtinAccount"))})</span>`
          : "";
        return `<tr data-user-id="${Utils.escapeAttr(u.id)}">
          <td>${this.esc(u.username)}${builtinTag}</td>
          <td>${this.esc(u.displayName || u.username || "")}</td>
          <td>${roleCell}</td>
          <td class="rec-actions-cell user-matrix-actions-cell">
            ${matrixBtn}
            <button type="button" class="btn btn-secondary user-edit-profile-btn" data-user-id="${Utils.escapeAttr(u.id)}">${this.esc(I18n.t("auth.editProfile"))}</button>
            <button type="button" class="btn btn-secondary user-reset-pwd-btn" data-user-id="${Utils.escapeAttr(u.id)}">${this.esc(I18n.t("auth.resetPassword"))}</button>
            <button type="button" class="btn btn-danger user-delete-btn" data-user-id="${Utils.escapeAttr(u.id)}" data-username="${Utils.escapeAttr(u.username)}"${delDisabled}>${this.esc(I18n.t("auth.deleteUser"))}</button>
          </td>
        </tr>`;
      })
      .join("");
    wrap.innerHTML = `
      <div class="inventory-table-container">
        <table class="inventory-table users-perm-table">
          <thead>
            <tr>
              <th>${this.esc(I18n.t("auth.userUsername"))}</th>
              <th>${this.esc(I18n.t("auth.userDisplay"))}</th>
              <th>${this.esc(I18n.t("auth.userRole"))}</th>
              <th>${this.esc(I18n.t("auth.userActions"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  renderAuditLog() {
    const wrap = document.getElementById("audit-log-wrap");
    if (!wrap) return;
    let log = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUDIT) || "[]";
      log = JSON.parse(raw);
      if (!Array.isArray(log)) log = [];
    } catch (e) {
      log = [];
    }

    const fUser = (document.getElementById("audit-filter-user")?.value || "").trim().toLowerCase();
    const fAction = (document.getElementById("audit-filter-action")?.value || "").trim().toLowerCase();
    const fDateFrom = document.getElementById("audit-filter-date-from")?.value || "";
    const fDateTo = document.getElementById("audit-filter-date-to")?.value || "";

    let filtered = log;
    if (fUser) {
      filtered = filtered.filter(e =>
        (e.displayName || e.userId || "").toLowerCase().includes(fUser)
      );
    }
    if (fAction) {
      filtered = filtered.filter(e =>
        ((e.action || "") + " " + (e.detail || "")).toLowerCase().includes(fAction)
      );
    }
    if (fDateFrom) {
      const from = new Date(fDateFrom);
      filtered = filtered.filter(e => new Date(e.at) >= from);
    }
    if (fDateTo) {
      const to = new Date(fDateTo + "T23:59:59");
      filtered = filtered.filter(e => new Date(e.at) <= to);
    }

    const slice = filtered.slice(-100).reverse();
    if (!slice.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted)">${this.esc(I18n.t("msg.noResults"))}</p>`;
      return;
    }
    const rows = slice
      .map(entry => {
        const d = this.esc(Utils.formatDateTime(entry.at));
        const user = this.esc(entry.displayName || entry.userId || "—");
        const act = this.esc(entry.action || "");
        const det = this.esc(entry.detail || "");
        return `<tr><td>${d}</td><td>${user}</td><td>${act}</td><td>${det}</td></tr>`;
      })
      .join("");
    wrap.innerHTML = `
      <div class="inventory-table-container">
        <table class="inventory-table">
          <thead>
            <tr>
              <th>${this.esc(I18n.t("reception.dateShort"))}</th>
              <th>${this.esc(I18n.t("auth.displayName"))}</th>
              <th>${this.esc(I18n.t("history.filterType"))}</th>
              <th>${this.esc(I18n.t("table.details"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  syncExpAlertInput() {
    const expDays = document.getElementById("exp-alert-days");
    if (expDays && typeof InventoryManager !== "undefined") {
      expDays.value = String(InventoryManager.expAlertDays || 30);
    }
  },

  renderLocationCatalog() {
    const body = document.getElementById("config-location-catalog-body");
    if (!body || typeof Utils === "undefined") return;
    const base = Array.isArray(Utils.WAREHOUSE_LOCATION_SLOTS) ? Utils.WAREHOUSE_LOCATION_SLOTS : [];
    const disabledBase = new Set(
      (Utils.getDisabledBaseWarehouseLocationSlots ? Utils.getDisabledBaseWarehouseLocationSlots() : []).map(s =>
        String(s || "").toUpperCase()
      )
    );
    const disabledCustom = new Set(
      (Utils.getDisabledCustomWarehouseLocationSlots ? Utils.getDisabledCustomWarehouseLocationSlots() : []).map(s =>
        String(s || "").toUpperCase()
      )
    );
    const user = Utils.getUserWarehouseLocationSlots ? Utils.getUserWarehouseLocationSlots() : [];
    const rows = [];
    for (const s of base) rows.push({ name: s, source: "base", disabled: disabledBase.has(String(s).toUpperCase()) });
    for (const s of user) rows.push({ name: s, source: "custom", disabled: disabledCustom.has(String(s).toUpperCase()) });
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="3" class="muted">${this.esc(I18n.t("msg.noResults"))}</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(r => {
        const isCustom = r.source === "custom";
        const isBase = r.source === "base";
        const actions = isCustom
          ? `<button type="button" class="btn btn-secondary btn-sm" data-loc-act="${
              r.disabled ? "activate-custom" : "deactivate-custom"
            }" data-loc="${Utils.escapeAttr(r.name)}">${r.disabled ? "Activar" : "Desactivar"}</button>
             <button type="button" class="btn btn-secondary btn-sm" data-loc-act="edit" data-loc="${Utils.escapeAttr(
               r.name
             )}">Editar</button>
             <button type="button" class="btn btn-danger btn-sm" data-loc-act="delete" data-loc="${Utils.escapeAttr(
               r.name
             )}">Eliminar</button>`
          : isBase
            ? `<button type="button" class="btn btn-secondary btn-sm" data-loc-act="${
                r.disabled ? "activate-base" : "deactivate-base"
              }" data-loc="${Utils.escapeAttr(r.name)}">${r.disabled ? "Activar" : "Desactivar"}</button>`
            : `<span class="muted">—</span>`;
        const sourceLabel = isCustom
          ? r.disabled
            ? "custom (desactivada)"
            : "custom"
          : r.disabled
            ? "base (desactivada)"
            : "base";
        return `<tr>
          <td>${this.esc(r.name)}</td>
          <td>${this.esc(sourceLabel)}</td>
          <td class="rec-actions-cell">${actions}</td>
        </tr>`;
      })
      .join("");
  },

  refreshItemLocationSuggestions() {
    const sel = document.getElementById("edit-location-select");
    if (!sel || typeof Utils === "undefined") return;
    const slots = Utils.getEffectiveWarehouseLocationSlots ? Utils.getEffectiveWarehouseLocationSlots() : [];
    const currentItemId = document.getElementById("config-item-editor-id")?.value || "";
    const currentItem =
      typeof InventoryManager !== "undefined" && currentItemId
        ? (InventoryManager.items || []).find(i => String(i.id) === String(currentItemId))
        : null;
    const itemBoxes = Array.isArray(currentItem?.boxStocks) ? currentItem.boxStocks : [];
    const itemBoxEntries = itemBoxes
      .map(b => {
        const n = parseInt(b?.boxNumber, 10);
        if (!Number.isFinite(n) || n < 1) return null;
        const boxToken = `BOX${n}`;
        const loc = String(b?.locationLabel || "").trim();
        const strictLoc = loc ? Utils.strictEffectiveWarehouseLocationText(loc) : "";
        const composite = strictLoc ? `${strictLoc} > ${boxToken}` : boxToken;
        return { n, boxToken, strictLoc, composite };
      })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n);
    const itemBoxSeen = new Set();
    const itemBoxOptions = [];
    for (const e of itemBoxEntries) {
      const k = e.composite.toUpperCase();
      if (itemBoxSeen.has(k)) continue;
      itemBoxSeen.add(k);
      itemBoxOptions.push(e);
    }
    const currentSelections = String(this._getEditLocationSelections() || "")
      .split(/\s*,\s*/)
      .map(v => String(v || "").trim())
      .filter(Boolean);
    const seen = new Set();
    for (const s of slots) {
      const k = String(s || "").trim().toUpperCase();
      if (k) seen.add(k);
    }
    const knownGlobalBoxes =
      typeof InventoryManager !== "undefined" && InventoryManager._getKnownBoxNumbers
        ? InventoryManager._getKnownBoxNumbers()
        : [];
    for (const n of knownGlobalBoxes) seen.add(`BOX${n}`);

    const parts = [`<option value="">—</option>`];
    for (const v of currentSelections) {
      const ck = v.toUpperCase();
      if (!seen.has(ck)) {
        seen.add(ck);
        parts.push(`<option value="${Utils.escapeAttr(v)}">${this.esc(v)}</option>`);
      }
    }

    const slotGroupLabel =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("inventory.boxFilterGroupSlots") : "Ubicaciones almacén";
    parts.push(`<optgroup label="${this.esc(slotGroupLabel)}">`);
    const slotSeen = new Set();
    for (const s of slots) {
      const k = String(s || "").trim().toUpperCase();
      if (!k || slotSeen.has(k)) continue;
      slotSeen.add(k);
      parts.push(`<option value="${Utils.escapeAttr(s)}">${this.esc(s)}</option>`);
    }
    parts.push(`</optgroup>`);

    const boxGroupLabel =
      typeof I18n !== "undefined" && I18n.t ? I18n.t("inventory.boxFilterGroupBoxes") : "Cajas";
    if (itemBoxOptions.length) {
      const articleBoxLabel =
        typeof I18n !== "undefined" && I18n.t ? I18n.t("inventory.boxManagerItemLabel") : "Artículo";
      parts.push(`<optgroup label="${this.esc(`${boxGroupLabel} — ${articleBoxLabel}`)}">`);
      for (const e of itemBoxOptions) {
        const txt = e.strictLoc ? `${e.strictLoc} · ${e.boxToken}` : e.boxToken;
        parts.push(`<option value="${Utils.escapeAttr(e.composite)}">${this.esc(txt)}</option>`);
      }
      parts.push(`</optgroup>`);
    }
    parts.push(`<optgroup label="${this.esc(boxGroupLabel)}">`);
    for (const n of knownGlobalBoxes) {
      const label = `BOX${n}`;
      parts.push(`<option value="${Utils.escapeAttr(label)}">${this.esc(label)}</option>`);
    }
    parts.push(`</optgroup>`);

    sel.innerHTML = parts.join("");
    if (!sel.value) sel.value = "";
    if (typeof InventoryManager !== "undefined" && InventoryManager._refreshBoxManagerLocationDatalists) {
      InventoryManager._refreshBoxManagerLocationDatalists();
    }
  },

  _setEditLocationSelections(rawLocation) {
    const inp = document.getElementById("edit-location-values");
    if (!inp) return;
    const values = String(rawLocation || "")
      .split(/\s*,\s*/)
      .map(v => String(v || "").trim())
      .filter(Boolean);
    const dedup = [];
    const seen = new Set();
    for (const v of values) {
      const k = v.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(v);
    }
    inp.value = dedup.join(", ");
    this.refreshItemLocationSuggestions();
  },

  _getEditLocationSelections() {
    const inp = document.getElementById("edit-location-values");
    if (!inp) return "";
    const vals = String(inp.value || "")
      .split(/\s*,\s*/)
      .map(o => String(o || "").trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const v of vals) {
      const k = v.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out.join(", ");
  },

  _appendEditLocationSelection(value) {
    const v = String(value || "").trim();
    if (!v) return;
    const cur = this._getEditLocationSelections();
    const vals = cur ? cur.split(/\s*,\s*/) : [];
    const seen = new Set(vals.map(x => x.toUpperCase()));
    if (!seen.has(v.toUpperCase())) vals.push(v);
    this._setEditLocationSelections(vals.join(", "));
  },

  _removeEditLocationSelection(value) {
    const v = String(value || "").trim();
    if (!v) return;
    const cur = this._getEditLocationSelections();
    const vals = cur ? cur.split(/\s*,\s*/) : [];
    const next = vals.filter(x => String(x || "").trim().toUpperCase() !== v.toUpperCase());
    this._setEditLocationSelections(next.join(", "));
  },

  addLocationCatalogEntry(rawName) {
    const name = Utils.normalizeWarehouseLocationText(rawName || "");
    if (!name) return;
    const base = new Set((Utils.WAREHOUSE_LOCATION_SLOTS || []).map(s => String(s).toUpperCase()));
    const current = Utils.getUserWarehouseLocationSlots ? Utils.getUserWarehouseLocationSlots() : [];
    const key = name.toUpperCase();
    if (base.has(key) || current.some(s => String(s).toUpperCase() === key)) return;
    Utils.setUserWarehouseLocationSlots([...(current || []), name]);
    this.renderLocationCatalog();
    this.refreshItemLocationSuggestions();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
  },

  editLocationCatalogEntry(oldName, nextName) {
    const oldKey = String(oldName || "").trim().toUpperCase();
    if (!oldKey) return;
    const normalizedNext = Utils.normalizeWarehouseLocationText(nextName || "");
    if (!normalizedNext) return;
    const base = new Set((Utils.WAREHOUSE_LOCATION_SLOTS || []).map(s => String(s).toUpperCase()));
    const current = Utils.getUserWarehouseLocationSlots ? Utils.getUserWarehouseLocationSlots() : [];
    const replaced = [];
    for (const s of current) {
      const k = String(s || "").trim().toUpperCase();
      if (k === oldKey) replaced.push(normalizedNext);
      else replaced.push(s);
    }
    const dedup = [];
    const seen = new Set();
    for (const s of replaced) {
      const k = String(s || "").trim().toUpperCase();
      if (!s || seen.has(k) || base.has(k)) continue;
      seen.add(k);
      dedup.push(s);
    }
    Utils.setUserWarehouseLocationSlots(dedup);
    this.renderLocationCatalog();
    this.refreshItemLocationSuggestions();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
  },

  deleteLocationCatalogEntry(name) {
    const key = String(name || "").trim().toUpperCase();
    if (!key) return;
    const current = Utils.getUserWarehouseLocationSlots ? Utils.getUserWarehouseLocationSlots() : [];
    const next = current.filter(s => String(s || "").trim().toUpperCase() !== key);
    Utils.setUserWarehouseLocationSlots(next);
    this.renderLocationCatalog();
    this.refreshItemLocationSuggestions();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
  },

  setBaseLocationDisabled(name, disabled) {
    const key = String(name || "").trim().toUpperCase();
    if (!key) return;
    const base = new Set((Utils.WAREHOUSE_LOCATION_SLOTS || []).map(s => String(s).toUpperCase()));
    if (!base.has(key)) return;
    const cur = Utils.getDisabledBaseWarehouseLocationSlots ? Utils.getDisabledBaseWarehouseLocationSlots() : [];
    let next;
    if (disabled) {
      next = [...cur, name];
    } else {
      next = cur.filter(s => String(s || "").trim().toUpperCase() !== key);
    }
    Utils.setDisabledBaseWarehouseLocationSlots(next);
    this.renderLocationCatalog();
    this.refreshItemLocationSuggestions();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
  },

  setCustomLocationDisabled(name, disabled) {
    const key = String(name || "").trim().toUpperCase();
    if (!key) return;
    const currentCustom = Utils.getUserWarehouseLocationSlots ? Utils.getUserWarehouseLocationSlots() : [];
    if (!currentCustom.some(s => String(s || "").trim().toUpperCase() === key)) return;
    const cur = Utils.getDisabledCustomWarehouseLocationSlots ? Utils.getDisabledCustomWarehouseLocationSlots() : [];
    let next;
    if (disabled) {
      next = [...cur, name];
    } else {
      next = cur.filter(s => String(s || "").trim().toUpperCase() !== key);
    }
    Utils.setDisabledCustomWarehouseLocationSlots(next);
    this.renderLocationCatalog();
    this.refreshItemLocationSuggestions();
    if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
  },

  // =========================================================
  // PIN edición de artículo
  // =========================================================
  getStoredItemEditPin() {
    try {
      return localStorage.getItem(STORAGE_KEYS.ITEM_EDIT_PIN) || "";
    } catch (e) {
      return "";
    }
  },

  async setStoredItemEditPin(pin) {
    const hash = await Auth._hash(pin, "gneex-pin-salt");
    localStorage.setItem(STORAGE_KEYS.ITEM_EDIT_PIN, hash);
  },

  async pinMatches(input) {
    const stored = this.getStoredItemEditPin();
    if (!stored) return false;
    if (stored.length === 64) {
      const hash = await Auth._hash(input, "gneex-pin-salt");
      return hash === stored;
    }
    try {
      const legacy = decodeURIComponent(escape(atob(stored)));
      if (legacy === input) {
        await this.setStoredItemEditPin(input);
        return true;
      }
    } catch (e) {}
    return false;
  },

  isItemEditSessionUnlocked() {
    try {
      return sessionStorage.getItem("phoenix-unlock-item-edit") === "yes";
    } catch (e) {
      return false;
    }
  },

  setItemEditSessionUnlocked() {
    try {
      sessionStorage.setItem("phoenix-unlock-item-edit", "yes");
    } catch (e) {}
  },

  resetItemEditSession() {
    const unlocked = document.getElementById("item-edit-unlocked");
    const lock = document.getElementById("item-edit-lock-panel");
    if (unlocked) unlocked.style.display = "block";
    if (lock) lock.style.display = "none";
  },

  refreshItemEditLockUI() {
    const lock = document.getElementById("item-edit-lock-panel");
    const unlocked = document.getElementById("item-edit-unlocked");
    if (!lock || !unlocked) return;
    lock.style.display = "none";
    unlocked.style.display = "block";
  },

  // =========================================================
  // Órdenes de compra (PO)
  // =========================================================
  getPurchaseOrders() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PURCHASE_ORDERS) || "[]";
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  },

  savePurchaseOrders(orders) {
    localStorage.setItem(STORAGE_KEYS.PURCHASE_ORDERS, JSON.stringify(orders));
  },

  // =========================================================
  // Expiraciones: búsqueda + vida útil (meses)
  // =========================================================
  addMonthsToIsoDate(isoDateStr, months) {
    const m = Math.max(0, parseInt(months, 10) || 0);
    if (!isoDateStr || !m) return "";
    const d = new Date(isoDateStr + "T12:00:00");
    if (Number.isNaN(d.getTime())) return "";
    d.setMonth(d.getMonth() + m);
    return d.toISOString().split("T")[0];
  },

  renderExpirationPanel() {
    const search = document.getElementById("exp-item-search");
    if (search) search.value = "";
    const res = document.getElementById("exp-item-search-results");
    if (res) {
      res.innerHTML = "";
      res.classList.remove("active");
    }
    this.setExpirationSelected(null);
  },

  setExpirationSelected(itemId) {
    this.expirationSelectedId = itemId || null;
    const panel = document.getElementById("expiration-item-panel");
    if (!panel) return;
    if (!this.expirationSelectedId) {
      panel.style.display = "none";
      return;
    }
    const item = (InventoryManager.items || []).find(i => i.id === this.expirationSelectedId);
    if (!item) {
      this.expirationSelectedId = null;
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    const codeEl = document.getElementById("exp-panel-code");
    const descEl = document.getElementById("exp-panel-desc");
    const expDateEl = document.getElementById("exp-panel-expdate");
    const monthsEl = document.getElementById("exp-shelf-life-months");
    if (codeEl) codeEl.textContent = item.code || "";
    if (descEl) descEl.textContent = item.description || "";
    if (expDateEl) {
      expDateEl.textContent = item.expDate
        ? Utils.formatDate(item.expDate)
        : "—";
    }
    if (monthsEl) {
      monthsEl.value = String(Math.max(0, parseInt(item.shelfLifeMonths, 10) || 0));
    }
    this.updateExpirationComputedPreview();
  },

  updateExpirationComputedPreview() {
    const hint = document.getElementById("exp-panel-computed");
    const monthsEl = document.getElementById("exp-shelf-life-months");
    if (!hint || !monthsEl || !this.expirationSelectedId) return;
    const item = InventoryManager.items.find(i => i.id === this.expirationSelectedId);
    if (!item) return;
    const months = Math.max(0, parseInt(monthsEl.value, 10) || 0);
    if (item.expDate && months > 0) {
      const end = this.addMonthsToIsoDate(item.expDate, months);
      hint.style.display = "block";
      hint.textContent = `${I18n.t("config.expComputedExpiry")}: ${Utils.formatDate(end)}`;
    } else if (months > 0 && !item.expDate) {
      hint.style.display = "block";
      hint.textContent = I18n.t("config.expComputedNeedsIssueDate");
    } else {
      hint.style.display = "none";
      hint.textContent = "";
    }
  },

  saveExpirationShelfLife() {
    if (typeof Auth !== "undefined" && !Auth.guardExpirationConfig()) return;
    if (!this.expirationSelectedId) {
      Utils.showToast(I18n.t("msg.selectItem"), "warning");
      return;
    }
    const item = InventoryManager.items.find(i => i.id === this.expirationSelectedId);
    if (!item) return;
    const months = Math.max(0, parseInt(document.getElementById("exp-shelf-life-months")?.value || "0", 10) || 0);
    let expirationDate = item.expirationDate || "";
    if (item.expDate && months > 0) {
      expirationDate = this.addMonthsToIsoDate(item.expDate, months);
    } else if (months === 0) {
      expirationDate = "";
    }
    const daysToExpire =
      expirationDate && !Number.isNaN(new Date(expirationDate + "T12:00:00").getTime())
        ? Math.max(0, InventoryManager.daysTo(expirationDate))
        : 0;
    InventoryManager.updateItem(this.expirationSelectedId, {
      shelfLifeMonths: months,
      expirationDate,
      daysToExpire
    });
    Utils.showToast(I18n.t("msg.itemUpdated"), "success");
    InventoryManager.render();
    this.updateExpirationComputedPreview();
  },

  setupExpirationSearchListeners() {
    if (this._expirationSearchBound) return;
    this._expirationSearchBound = true;

    const searchInput = document.getElementById("exp-item-search");
    const searchResults = document.getElementById("exp-item-search-results");
    if (!searchInput || !searchResults) return;

    searchInput.addEventListener(
      "input",
      Utils.debounce(() => {
        const q = searchInput.value.trim();
        if (q.length < 2) {
          searchResults.innerHTML = "";
          searchResults.classList.remove("active");
          return;
        }
        const results = InventoryManager.search(q).slice(0, 15);
        if (!results.length) {
          searchResults.innerHTML = `<div class="search-result-item">${this.esc(I18n.t("msg.noResults"))}</div>`;
        } else {
          searchResults.innerHTML = results
            .map(
              item => `
            <div class="search-result-item exp-search-result" data-id="${Utils.escapeAttr(item.id)}">
              <span class="result-code">${this.esc(item.code)}</span>
              <span class="result-description">${this.esc(item.description)}</span>
            </div>`
            )
            .join("");
        }
        searchResults.classList.add("active");
      }, 200)
    );

    searchResults.addEventListener("click", e => {
      const row = e.target.closest(".exp-search-result");
      if (!row || !row.dataset.id) return;
      const item = InventoryManager.items.find(i => i.id === row.dataset.id);
      if (!item) return;
      searchInput.value = `${item.code} — ${item.description}`;
      searchResults.innerHTML = "";
      searchResults.classList.remove("active");
      this.setExpirationSelected(item.id);
    });

    document.addEventListener("click", e => {
      if (!e.target.closest(".exp-search-container")) {
        searchResults.classList.remove("active");
      }
    });

    const monthsEl = document.getElementById("exp-shelf-life-months");
    if (monthsEl) {
      monthsEl.addEventListener("input", () => this.updateExpirationComputedPreview());
    }

    const saveBtn = document.getElementById("exp-save-shelf-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.saveExpirationShelfLife());
    }
  },

  // =========================================================
  // EVENTOS GENERALES DE PESTAÑAS
  // =========================================================
  /**
   * Solo administrador: abre Configuración → Edición de artículo con el ítem ya seleccionado (p. ej. doble clic en código en inventario).
   */
  openItemEditorFromInventoryById(itemId) {
    if (typeof Auth === "undefined" || !Auth.isAdmin()) return false;
    const id = String(itemId || "").trim();
    if (!id || typeof InventoryManager === "undefined") return false;
    const item = (InventoryManager.items || []).find(i => String(i.id) === id);
    if (!item) return false;
    const hidden = document.getElementById("config-item-editor-id");
    const searchInp = document.getElementById("config-item-search");
    if (hidden) hidden.value = id;
    if (searchInp) searchInp.value = `${String(item.code || "").trim()} — ${String(item.description || "").trim()}`;
    this.openModalAtTab("itemedit");
    this.loadItemEditor(id);
    return true;
  },

  /** Abre el modal de configuración y cambia a una pestaña (p. ej. import para respaldos). */
  openModalAtTab(tab) {
    const modal = document.getElementById("config-modal");
    if (!modal) return;
    tab = this.sanitizeConfigTab(tab);
    if (typeof Auth !== "undefined") {
      const cfgWide = Auth.isAdmin() || Auth.isElevated();
      if (!cfgWide && tab === "expirations" && !Auth.hasExpirationConfig()) tab = this.sanitizeConfigTab("about");
    }
    tab = this.sanitizeConfigTab(tab);
    this.renderItemEditorOptions();
    this.syncExpAlertInput();
    this._configDraftMinimized = false;
    modal.classList.add("active");
    this.switchConfigTab(tab);
    if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
    this.refreshRecipientsPreview();
    this.updateConfigDraftBar();
  },

  /** Actualiza el bloque «vista rápida» de destinatarios en Import/Export. */
  refreshRecipientsPreview() {
    if (typeof EmployeeManager !== "undefined" && EmployeeManager.renderRecipientsPreview) {
      EmployeeManager.renderRecipientsPreview();
    }
  },

  renderElevationPanel() {
    const wrap = document.getElementById("elevation-admin-panel");
    if (!wrap || typeof Auth === "undefined") return;
    if (!Auth.isAdmin()) {
      wrap.innerHTML = "";
      return;
    }
    const c = Auth.elevationPoolCounts();
    const esc = s => this.esc(String(s ?? ""));
    const dispTierCount = n => (n === null ? I18n.t("elevation.unlimited") : String(n));
    const targets = Auth.getElevationIssuanceTargets();
    const opts =
      `<option value="">${esc(I18n.t("elevation.pickUserPlaceholder"))}</option>` +
      targets.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("");
    const selectHtml =
      `<div class="elevation-target-row form-group">
        <label for="elevation-target-user">${esc(I18n.t("elevation.targetUserLabel"))}</label>
        <select id="elevation-target-user" class="filter-select elevation-target-select">${opts}</select>
        <p class="config-hint muted">${esc(I18n.t("elevation.targetUserHint"))}</p>
      </div>`;
    const canIssue = targets.length > 0;
    const tiers = [
      { key: "h48", titleKey: "elevation.tier48", hintKey: "elevation.tier48Hint" },
      { key: "week", titleKey: "elevation.tierWeek", hintKey: "elevation.tierWeekHint" },
      { key: "month", titleKey: "elevation.tierMonth", hintKey: "elevation.tierMonthHint" }
    ];
    const cards = tiers
      .map(
        t => `
      <div class="elevation-tier-card">
        <h4>${esc(I18n.t(t.titleKey))}</h4>
        <div class="elevation-tier-meta">${esc(I18n.t(t.hintKey))}<br>${esc(I18n.t("elevation.remaining"))}: <strong>${esc(dispTierCount(c[t.key]))}</strong></div>
        <button type="button" class="btn btn-primary btn-sm" data-elevation-issue="${esc(t.key)}" ${canIssue ? "" : "disabled"}>${esc(I18n.t("elevation.issueBtn"))}</button>
      </div>`
      )
      .join("");
    wrap.innerHTML = `
      ${targets.length ? selectHtml : `<p class="config-hint">${esc(I18n.t("elevation.noTargets"))}</p>`}
      <div class="elevation-tier-meta">${esc(I18n.t("elevation.pendingRedeem"))}: <strong>${c.outstanding}</strong></div>
      <div class="elevation-tier-grid">${cards}</div>
      <div class="elevation-reset-row">
        <button type="button" id="elevation-reset-pool-btn" class="btn btn-danger btn-sm">${esc(I18n.t("elevation.resetBtn"))}</button>
        <p class="config-hint muted">${esc(I18n.t("elevation.resetHint"))}</p>
      </div>`;
    if (!this._elevationPanelClickBound) {
      this._elevationPanelClickBound = true;
      wrap.addEventListener("click", async e => {
        const issueBtn = e.target.closest("[data-elevation-issue]");
        if (issueBtn && issueBtn.dataset.elevationIssue && typeof Auth !== "undefined") {
          const tier = issueBtn.dataset.elevationIssue;
          const uid = document.getElementById("elevation-target-user")?.value || "";
          const r = await Auth.issueElevationCode(tier, uid);
          if (!r.ok) {
            const toastKey =
              r.msg === "no-target"
                ? "elevation.pickUser"
                : r.msg === "bad-target"
                  ? "elevation.badTarget"
                  : r.msg === "error"
                    ? "elevation.issueError"
                    : "auth.noPermission";
            Utils.showToast(I18n.t(toastKey), "error");
            this.renderElevationPanel();
            return;
          }
          try {
            await navigator.clipboard.writeText(r.code);
            Utils.showToast(I18n.t("elevation.issuedCopied"), "success");
          } catch (err) {
            Utils.showToast(I18n.t("elevation.copyFailed"), "error");
          }
          this.renderElevationPanel();
          return;
        }
        if (e.target.id === "elevation-reset-pool-btn" && typeof Auth !== "undefined") {
          App.showConfirm(I18n.t("elevation.resetConfirm"), () => {
            const rr = Auth.resetElevationPools();
            if (rr.ok) {
              Utils.showToast(I18n.t("elevation.resetDone"), "success");
              this.renderElevationPanel();
            }
          });
        }
      });
    }
  },

  switchConfigTab(tab) {
    tab = this.sanitizeConfigTab(tab);
    if (typeof Auth !== "undefined") {
      const cfgWide = Auth.isAdmin() || Auth.isElevated();
      if (!cfgWide && tab === "expirations" && !Auth.hasExpirationConfig()) tab = this.sanitizeConfigTab("about");
    }
    tab = this.sanitizeConfigTab(tab);
    document.querySelectorAll(".config-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.configTab === tab));
    document.querySelectorAll(".config-content").forEach(c => c.classList.toggle("active", c.id === `config-${tab}`));
    if (tab === "itemedit") {
      this.refreshItemEditLockUI();
    }
    if (tab === "expirations") {
      this.renderExpirationPanel();
      this.syncExpAlertInput();
    }
    if (tab === "receptions") {
      this._receptionEditId = null;
      this.renderReceptionList();
    }
    if (tab === "employees") {
      if (typeof EmployeeManager !== "undefined" && EmployeeManager.renderConfigList) {
        EmployeeManager.renderConfigList();
      }
    }
    if (tab === "suppliers") {
      if (typeof SupplierManager !== "undefined" && SupplierManager.renderConfigList) {
        SupplierManager.renderConfigList();
        SupplierManager.refreshOrderLineSupplierUI();
      }
    }
    if (tab === "consumables") {
      if (typeof ConsumableManager !== "undefined") {
        ConsumableManager.renderConfigList();
        ConsumableManager.refreshDatalists();
      }
    }
    if (tab === "import") {
      this.refreshRecipientsPreview();
    }
    if (tab === "itemedit") {
      this.renderLocationCatalog();
      this.refreshItemLocationSuggestions();
    }
    if (tab === "users") {
      this.renderUsersTable();
      this.renderAuditLog();
    }
    if (tab === "elevation") {
      this.renderElevationPanel();
    }
    if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
  },

  setupEventListeners() {
    document.querySelectorAll(".config-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => this.switchConfigTab(btn.dataset.configTab));
    });

    const close = document.getElementById("close-config");
    if (close) {
      close.addEventListener("click", () => this.promptDiscardConfigModal());
    }

    const minCfg = document.getElementById("config-modal-minimize");
    if (minCfg && !this._configMinimizeBtnBound) {
      this._configMinimizeBtnBound = true;
      minCfg.addEventListener("click", () => this.minimizeConfigModal());
    }

    const cfgModalWin = document.getElementById("config-modal");
    if (cfgModalWin && !this._configModalBackdropDraftBound) {
      this._configModalBackdropDraftBound = true;
      cfgModalWin.addEventListener("click", e => {
        if (e.target === cfgModalWin) this.minimizeConfigModal();
      });
    }

    if (!this._configModalEscapeDraftBound) {
      this._configModalEscapeDraftBound = true;
      document.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        const movWin = document.getElementById("movement-form-window");
        if (movWin?.classList.contains("active")) return;
        const cfg = document.getElementById("config-modal");
        if (!cfg?.classList.contains("active")) return;
        e.preventDefault();
        this.minimizeConfigModal();
      });
    }

    if (!this._configDraftFloatBound) {
      this._configDraftFloatBound = true;
      document.getElementById("config-draft-float-resume")?.addEventListener("click", () => this.resumeConfigModal());
      document.getElementById("config-draft-float-discard")?.addEventListener("click", () =>
        this.promptDiscardConfigModal()
      );
    }

    const cfg = document.getElementById("config-btn");
    if (cfg) {
      cfg.addEventListener("click", () => {
        if (typeof Auth !== "undefined") {
          if (!Auth.guardConfigAction("cfgModalOpen", "view")) return;
          const wide = Auth.isAdmin() || Auth.isElevated();
          if (!wide) {
            const prev = document.querySelector(".config-tab-btn.active")?.dataset.configTab;
            if (prev === "itemedit" || prev === "expirations" || prev === "employees" || prev === "suppliers" || prev === "consumables") {
              this.switchConfigTab("import");
            }
          }
          if (!Auth.isAdmin()) {
            const prevA = document.querySelector(".config-tab-btn.active")?.dataset.configTab;
            if (prevA === "users" || prevA === "elevation") {
              this.switchConfigTab("import");
            }
          }
        }
        this.renderItemEditorOptions();
        this.syncExpAlertInput();
        this._configDraftMinimized = false;
        document.getElementById("config-modal").classList.add("active");
        this.updateConfigDraftBar();
        const active = document.querySelector(".config-tab-btn.active")?.dataset.configTab;
        if (active === "itemedit") this.refreshItemEditLockUI();
        if (active === "expirations") this.renderExpirationPanel();
        if (active === "users") {
          this.renderUsersTable();
          this.renderAuditLog();
        }
        if (active === "elevation") {
          this.renderElevationPanel();
        }
        if (active === "employees" && typeof EmployeeManager !== "undefined" && EmployeeManager.renderConfigList) {
          EmployeeManager.renderConfigList();
        }
        if (active === "suppliers" && typeof SupplierManager !== "undefined") {
          SupplierManager.renderConfigList();
          SupplierManager.refreshOrderLineSupplierUI();
        }
        if (active === "consumables" && typeof ConsumableManager !== "undefined") {
          ConsumableManager.renderConfigList();
          ConsumableManager.refreshDatalists();
        }
        this.refreshRecipientsPreview();
        if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
      });
    }

    const csvInput = document.getElementById("import-inventory-btn");
    if (csvInput) csvInput.addEventListener("change", e => {
      if (typeof Auth !== "undefined" && !Auth.guardLoadInventoryCsv()) { e.target.value = ""; return; }
      if (e.target.files[0]) InventoryManager.importInitialCSV(e.target.files[0]);
    });
    const tplBtn = document.getElementById("export-inventory-template-btn");
    if (tplBtn)
      tplBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardConfigAction("cfgActExportTemplate", "view")) return;
        void InventoryManager.exportInventoryImportTemplateCsv();
      });

    const zipBtn = document.getElementById("export-zip-btn");
    if (zipBtn)
      zipBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardConfigAction("cfgActBackupExport", "edit")) return;
        Utils.exportZIP();
      });

    const importBackupBtn = document.getElementById("import-backup-btn");
    const importBackupInput = document.getElementById("import-backup-input");
    if (importBackupBtn && importBackupInput) {
      importBackupBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardImportBackup()) return;
        importBackupInput.click();
      });
      importBackupInput.addEventListener("change", e => {
        if (typeof Auth !== "undefined" && !Auth.guardImportBackup()) { e.target.value = ""; return; }
        const file = e.target.files?.[0];
        if (file) {
          App.showConfirm(I18n.t("confirm.importBackup"), () => Utils.importBackupJSON(file));
        }
        e.target.value = "";
      });
    }

    const exportMovementsOnlyBtn = document.getElementById("export-movements-only-btn");
    if (exportMovementsOnlyBtn) {
      exportMovementsOnlyBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardMovementsExport()) return;
        void Utils.exportMovementsJSON();
      });
    }
    const importMovementsMergeBtn = document.getElementById("import-movements-merge-btn");
    const importMovementsMergeInput = document.getElementById("import-movements-merge-input");
    if (importMovementsMergeBtn && importMovementsMergeInput) {
      importMovementsMergeBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardMergeMovementsImport()) return;
        importMovementsMergeInput.click();
      });
      importMovementsMergeInput.addEventListener("change", e => {
        if (typeof Auth !== "undefined" && !Auth.guardMergeMovementsImport()) {
          e.target.value = "";
          return;
        }
        const file = e.target.files?.[0];
        if (file) {
          App.showConfirm(I18n.t("confirm.importMovementsMerge"), () => Utils.importMovementsMergeJSON(file));
        }
        e.target.value = "";
      });
    }

    const exportTransportsShippedOnlyBtn = document.getElementById("export-transports-shipped-only-btn");
    if (exportTransportsShippedOnlyBtn) {
      exportTransportsShippedOnlyBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardTransportsExportJson()) return;
        void Utils.exportTransportsJSON({ shippedOnly: true });
      });
    }
    const importTransportsMergeBtn = document.getElementById("import-transports-merge-btn");
    const importTransportsMergeInput = document.getElementById("import-transports-merge-input");
    if (importTransportsMergeBtn && importTransportsMergeInput) {
      importTransportsMergeBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardMergeTransportsImport()) return;
        importTransportsMergeInput.click();
      });
      importTransportsMergeInput.addEventListener("change", e => {
        if (typeof Auth !== "undefined" && !Auth.guardMergeTransportsImport()) {
          e.target.value = "";
          return;
        }
        const file = e.target.files?.[0];
        if (file) {
          App.showConfirm(I18n.t("confirm.importTransportsMerge"), () => Utils.importTransportsMergeJSON(file));
        }
        e.target.value = "";
      });
    }

    const archiveBtn = document.getElementById("archive-movements-btn");
    if (archiveBtn) archiveBtn.addEventListener("click", () => void this.archiveMovements());

    const reimportBtn = document.getElementById("reimport-archive-btn");
    const reimportInput = document.getElementById("reimport-archive-input");
    if (reimportBtn && reimportInput) {
      reimportBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) return;
        reimportInput.click();
      });
      reimportInput.addEventListener("change", e => {
        if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) { e.target.value = ""; return; }
        const file = e.target.files?.[0];
        if (file) this.reimportArchive(file);
        e.target.value = "";
      });
    }

    const wipeBtn = document.getElementById("wipe-db-btn");
    if (wipeBtn) wipeBtn.addEventListener("click", () => void this.wipeAll());

    const locAddBtn = document.getElementById("config-location-catalog-add-btn");
    const locInput = document.getElementById("config-location-catalog-input");
    if (locAddBtn && locInput) {
      locAddBtn.addEventListener("click", () => {
        this.addLocationCatalogEntry(locInput.value || "");
        locInput.value = "";
      });
      locInput.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        this.addLocationCatalogEntry(locInput.value || "");
        locInput.value = "";
      });
    }
    const locResetBtn = document.getElementById("config-location-catalog-reset-btn");
    if (locResetBtn) {
      locResetBtn.addEventListener("click", () => {
        Utils.setUserWarehouseLocationSlots([]);
        this.renderLocationCatalog();
        this.refreshItemLocationSuggestions();
        if (typeof InventoryManager !== "undefined" && InventoryManager.render) InventoryManager.render();
      });
    }
    const locBody = document.getElementById("config-location-catalog-body");
    if (locBody) {
      locBody.addEventListener("click", async e => {
        const btn = e.target.closest("[data-loc-act][data-loc]");
        if (!btn) return;
        const act = btn.getAttribute("data-loc-act");
        const name = btn.getAttribute("data-loc") || "";
        if (act === "delete") {
          this.deleteLocationCatalogEntry(name);
          return;
        }
        if (act === "edit" && typeof App !== "undefined" && App.showPrompt) {
          const v = await App.showPrompt({ message: "Editar ubicación", defaultValue: name, inputType: "text" });
          if (v === null) return;
          this.editLocationCatalogEntry(name, v);
          return;
        }
        if (act === "deactivate-base") {
          this.setBaseLocationDisabled(name, true);
          return;
        }
        if (act === "activate-base") {
          this.setBaseLocationDisabled(name, false);
          return;
        }
        if (act === "deactivate-custom") {
          this.setCustomLocationDisabled(name, true);
          return;
        }
        if (act === "activate-custom") {
          this.setCustomLocationDisabled(name, false);
        }
      });
    }

    const userAddBtn = document.getElementById("user-add-btn");
    if (userAddBtn && !this._userAddBtnBound) {
      this._userAddBtnBound = true;
      userAddBtn.addEventListener("click", async () => {
        if (typeof Auth === "undefined" || !Auth.isAdmin()) {
          Utils.showToast(I18n.t("auth.noPermission"), "error");
          return;
        }
        const username = document.getElementById("user-add-username")?.value ?? "";
        const displayName = document.getElementById("user-add-display")?.value ?? "";
        const password = document.getElementById("user-add-password")?.value ?? "";
        const role = document.getElementById("user-add-role")?.value || "user";
        const canEdit = !!document.getElementById("user-add-canEdit")?.checked;
        const r = await Auth.addUser({ username, displayName, password, role, canEdit });
        if (!r.ok) {
          const key =
            r.msg === "reserved"
              ? "auth.reservedUsername"
              : r.msg === "dup"
                ? "auth.userDuplicate"
                : r.msg === "short"
                  ? "auth.fieldsInvalid"
                  : r.msg === "forbidden"
                    ? "auth.noPermission"
                    : "auth.error";
          Utils.showToast(I18n.t(key), "error");
          return;
        }
        Utils.showToast(I18n.t("auth.userAdded"), "success");
        const uEl = document.getElementById("user-add-username");
        const dEl = document.getElementById("user-add-display");
        const pEl = document.getElementById("user-add-password");
        const rEl = document.getElementById("user-add-role");
        const cEl = document.getElementById("user-add-canEdit");
        if (uEl) uEl.value = "";
        if (dEl) dEl.value = "";
        if (pEl) pEl.value = "";
        if (rEl) rEl.value = "user";
        if (cEl) cEl.checked = false;
        this.renderUsersTable();
        this.renderAuditLog();
      });
    }

    const auditFilterIds = ["audit-filter-user", "audit-filter-action", "audit-filter-date-from", "audit-filter-date-to"];
    auditFilterIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => this.renderAuditLog());
    });
    const auditClearBtn = document.getElementById("audit-filter-clear");
    if (auditClearBtn) {
      auditClearBtn.addEventListener("click", () => {
        auditFilterIds.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        this.renderAuditLog();
      });
    }

    const itemForm = document.getElementById("item-edit-form");
    if (itemForm) {
      itemForm.addEventListener("submit", e => {
        e.preventDefault();
        void this.saveItemEditor();
      });
    }
    document.getElementById("config-item-new-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
      const h = document.getElementById("config-item-editor-id");
      const s = document.getElementById("config-item-search");
      if (h) h.value = "";
      if (s) s.value = "";
      this.loadItemEditor("");
      const c = document.getElementById("edit-code");
      if (c) c.focus();
    });
    document.getElementById("config-item-delete-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
      const id = document.getElementById("config-item-editor-id")?.value?.trim();
      if (!id) return;
      App.showConfirm(I18n.t("confirm.deleteItem"), () => {
        InventoryManager.deleteItem(id);
        if (typeof Auth !== "undefined") Auth.logAudit("item.delete", id);
        const h = document.getElementById("config-item-editor-id");
        const s = document.getElementById("config-item-search");
        if (h) h.value = "";
        if (s) s.value = "";
        this.loadItemEditor("");
        this.renderItemEditorOptions();
        Utils.showToast(I18n.t("msg.itemDeleted"), "success");
        if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();
      });
    });
    if (!this._editInventoryConsumableConfirmBound) {
      this._editInventoryConsumableConfirmBound = true;
      const cb = document.getElementById("edit-inventory-consumable");
      if (cb) {
        cb.addEventListener("change", () => {
          const sid = document.getElementById("config-item-editor-id")?.value?.trim();
          const ex = sid ? InventoryManager.items.find(x => x.id === sid) : null;
          const was = !!(ex && ex.inventoryConsumable);
          if (cb.checked && !was) {
            cb.checked = false;
            App.showConfirm(I18n.t("config.inventoryConsumableConfirmEnable"), () => {
              cb.checked = true;
            });
            return;
          }
          if (!cb.checked && was) {
            cb.checked = true;
            App.showConfirm(I18n.t("config.inventoryConsumableConfirmDisable"), () => {
              cb.checked = false;
            });
          }
        });
      }
    }
    const editLocationSel = document.getElementById("edit-location-select");
    const addLocBtn = document.getElementById("edit-location-add-btn");
    const remLocBtn = document.getElementById("edit-location-remove-btn");
    if (addLocBtn && editLocationSel && !this._editLocationAddBound) {
      this._editLocationAddBound = true;
      addLocBtn.addEventListener("click", () => {
        this._appendEditLocationSelection(editLocationSel.value || "");
      });
    }
    if (remLocBtn && editLocationSel && !this._editLocationRemoveBound) {
      this._editLocationRemoveBound = true;
      remLocBtn.addEventListener("click", () => {
        this._removeEditLocationSelection(editLocationSel.value || "");
      });
    }

    const stockEl = document.getElementById("edit-main-stock");
    const qtyPerBoxEl = document.getElementById("edit-qty-per-box");
    const numBoxesEl = document.getElementById("edit-num-boxes");
    if (stockEl && qtyPerBoxEl && numBoxesEl && !this._itemEditBoxesFormulaBound) {
      this._itemEditBoxesFormulaBound = true;
      const syncBoxes = () => {
        const stock = Utils.roundDecimal(parseFloat(stockEl.value) || 0, 4);
        const perBox = Utils.roundDecimal(parseFloat(qtyPerBoxEl.value) || 0, 4);
        const boxes = perBox > 0 ? Utils.roundDecimal(stock / perBox, 4) : 0;
        numBoxesEl.value = String(boxes);
      };
      stockEl.addEventListener("input", syncBoxes);
      qtyPerBoxEl.addEventListener("input", syncBoxes);
    }

    const unlockBtn = document.getElementById("item-edit-unlock-btn");
    if (unlockBtn) {
      unlockBtn.addEventListener("click", async () => {
        if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
        const pin = document.getElementById("item-edit-pin-input")?.value || "";
        if (!(await this.pinMatches(pin))) {
          Utils.showToast(I18n.t("msg.itemEditPinWrong"), "error");
          return;
        }
        this.setItemEditSessionUnlocked();
        this.refreshItemEditLockUI();
        this.renderItemEditorOptions();
        Utils.showToast(I18n.t("msg.itemEditUnlocked"), "success");
      });
    }

    const createPinBtn = document.getElementById("item-edit-create-pin-btn");
    if (createPinBtn) {
      createPinBtn.addEventListener("click", async () => {
        if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
        const a = document.getElementById("item-edit-pin-new")?.value || "";
        const b = document.getElementById("item-edit-pin-new2")?.value || "";
        if (a.length < 4) {
          Utils.showToast(I18n.t("msg.itemEditPinShort"), "warning");
          return;
        }
        if (a !== b) {
          Utils.showToast(I18n.t("msg.itemEditPinMismatch"), "error");
          return;
        }
        await this.setStoredItemEditPin(a);
        this.setItemEditSessionUnlocked();
        this.refreshItemEditLockUI();
        this.renderItemEditorOptions();
        Utils.showToast(I18n.t("msg.itemEditPinCreated"), "success");
      });
    }

    const changePinBtn = document.getElementById("item-edit-change-pin-btn");
    if (changePinBtn) {
      changePinBtn.addEventListener("click", async () => {
        if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
        if (!this.getStoredItemEditPin()) {
          Utils.showToast(I18n.t("msg.itemEditPinShort"), "warning");
          return;
        }
        const cur = document.getElementById("item-edit-pin-current-change")?.value || "";
        if (!(await this.pinMatches(cur))) {
          Utils.showToast(I18n.t("msg.itemEditChangePinWrongCurrent"), "error");
          return;
        }
        const a = document.getElementById("item-edit-pin-new-change")?.value || "";
        const b = document.getElementById("item-edit-pin-new2-change")?.value || "";
        if (a.length < 4) {
          Utils.showToast(I18n.t("msg.itemEditPinShort"), "warning");
          return;
        }
        if (a !== b) {
          Utils.showToast(I18n.t("msg.itemEditPinMismatch"), "error");
          return;
        }
        await this.setStoredItemEditPin(a);
        ["item-edit-pin-current-change", "item-edit-pin-new-change", "item-edit-pin-new2-change"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        this.setItemEditSessionUnlocked();
        this.refreshItemEditLockUI();
        Utils.showToast(I18n.t("msg.itemEditPinChanged"), "success");
      });
    }

    const expDays = document.getElementById("exp-alert-days");
    if (expDays) {
      expDays.addEventListener("change", e => {
        if (typeof Auth !== "undefined" && !Auth.guardExpirationConfig()) return;
        const val = parseInt(e.target.value, 10) || 30;
        InventoryManager.expAlertDays = val;
        localStorage.setItem(STORAGE_KEYS.EXP_ALERT, String(val));
        InventoryManager.render();
        Utils.showToast(I18n.t("msg.expirationConfigUpdated"), "success");
      });
    }

    this.setupItemEditorSearch();

    const recSearch = document.getElementById("receptions-config-search");
    if (recSearch) {
      recSearch.addEventListener("input", () => {
        this._receptionListFilter = (recSearch.value || "").trim().toLowerCase();
        this.renderReceptionList();
      });
    }
    document.getElementById("receptions-config-import-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.guardReceptionsEdit()) return;
      const inp = document.getElementById("receptions-config-import-input");
      if (!inp) return;
      inp.value = "";
      inp.click();
    });
    document.getElementById("receptions-config-import-input")?.addEventListener("change", e => {
      if (typeof Auth !== "undefined" && !Auth.guardReceptionsEdit()) return;
      const file = e.target && e.target.files ? e.target.files[0] : null;
      if (!file) return;
      void this.importReceptionsFile(file);
      e.target.value = "";
    });
    document.getElementById("receptions-config-print-btn")?.addEventListener("click", () => {
      const q = (document.getElementById("receptions-config-search")?.value || "")
        .trim()
        .toLowerCase();
      const ordered = (ReceptionsManager.receptions || []).slice().reverse();
      const filtered = ordered.filter(r => this.receptionRowMatchesFilter(r, q));
      void this.printReceptionsFiltered(filtered, q || I18n.t("history.filterAll"));
    });
    document.getElementById("receptions-config-export-btn")?.addEventListener("click", async () => {
      const q = (document.getElementById("receptions-config-search")?.value || "")
        .trim()
        .toLowerCase();
      const ordered = (ReceptionsManager.receptions || []).slice().reverse();
      const filtered = ordered.filter(r => this.receptionRowMatchesFilter(r, q));
      const headers = this._buildReceptionsPrintExportHeaders();
      const selectedHeaders = await Utils.pickColumns(headers, I18n.t("config.exportReceptionsFiltered"));
      if (!selectedHeaders || !selectedHeaders.length) return;
      void Utils.exportReceptionsXlsx(filtered, {
        scopeLabel: q || I18n.t("history.filterAll"),
        selectedHeaders
      });
    });

    const recTable = document.getElementById("receptions-config-table");
    if (recTable) {
      recTable.addEventListener("click", e => {
        const editBtn = e.target.closest(".rec-edit-btn");
        if (editBtn && editBtn.dataset.id) {
          this._receptionEditId = editBtn.dataset.id;
          this.renderReceptionList();
          return;
        }
        const cancelBtn = e.target.closest(".rec-cancel-edit-btn");
        if (cancelBtn) {
          this._receptionEditId = null;
          this.renderReceptionList();
          return;
        }
        const saveBtn = e.target.closest(".rec-save-btn");
        if (saveBtn && saveBtn.dataset.id) {
          if (typeof Auth !== "undefined" && !Auth.guardReceptionsEdit()) return;
          this.saveReceptionInline(saveBtn.dataset.id);
          return;
        }
        const delBtn = e.target.closest(".rec-delete-btn");
        if (delBtn && delBtn.dataset.id) {
          if (typeof Auth !== "undefined" && !Auth.guardReceptionsEdit()) return;
          App.showConfirm(I18n.t("confirm.deleteReception"), () => {
            const expectedWord = (I18n.t("prompt.deleteReceptionCodeWord") || "ELIMINAR").trim();
            App.showPrompt({
              message: I18n.t("prompt.deleteReceptionCode"),
              defaultValue: "",
              inputType: "text"
            }).then(val => {
              if (val === null) return;
              if (String(val || "").trim().toUpperCase() !== expectedWord.toUpperCase()) {
                Utils.showToast(I18n.t("msg.receptionDeleteGuardFail"), "warning");
                return;
              }
              ReceptionsManager.deleteReception(delBtn.dataset.id);
              this._receptionEditId = null;
              this.renderReceptionList();
              Utils.showToast(I18n.t("msg.receptionDeleted"), "info");
              if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
            });
          });
        }
      });
    }
    this.renderLocationCatalog();
    this.refreshItemLocationSuggestions();
  },

  _parseImportDimToken(token) {
    const raw = String(token || "").trim();
    if (!raw) return null;
    const m = raw.match(/(?:\d+\)\s*)?([0-9.,]+)\s*[x×]\s*([0-9.,]+)\s*[x×]\s*([0-9.,]+)/i);
    if (!m) return null;
    const parseN = s => {
      const t = String(s || "").trim().replace(/\s+/g, "").replace(",", ".");
      const n = parseFloat(t);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    const L = parseN(m[1]);
    const W = parseN(m[2]);
    const H = parseN(m[3]);
    if (!(L > 0 || W > 0 || H > 0)) return null;
    return { L, W, H };
  },

  _extractImportedDimensionsItems(row) {
    const unitRaw =
      row.DimensionesPorUnidad ??
      row.DimensionsPerUnit ??
      row.dimensionsItems ??
      row.dimensions_per_unit ??
      "";
    const tokens = String(unitRaw || "")
      .split("|")
      .map(s => s.trim())
      .filter(Boolean);
    const parsedUnits = tokens.map(t => this._parseImportDimToken(t)).filter(Boolean);
    if (parsedUnits.length) return parsedUnits;
    const baseRaw =
      row.Dimensiones ??
      row.Dimensions ??
      row.dimensions ??
      "";
    const one = this._parseImportDimToken(baseRaw);
    return one ? [one] : [];
  },

  _buildReceptionFromImportRow(row) {
    const projectId = String(
      row.Proyecto ?? row.Project ?? row.projectId ?? row.project ?? ""
    ).trim();
    const itemName = String(
      row.Articulo ?? row.Artículo ?? row.Article ?? row.Item ?? row.itemName ?? row.item ?? ""
    ).trim();
    const parseQ = v => {
      const s = String(v ?? "").trim().replace(/\s+/g, "").replace(",", ".");
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    const quantity = parseQ(row.Cantidad ?? row.Quantity ?? row.quantity ?? 0);
    const materialCategory = String(
      row.Categoria ?? row.Categoría ?? row.Category ?? row.materialCategory ?? "OTRO"
    )
      .trim()
      .toUpperCase();
    const purchaseOrder = String(row.PO ?? row.PurchaseOrder ?? row.purchaseOrder ?? "").trim();
    const supplier = String(row.Proveedor ?? row.Supplier ?? row.supplier ?? "").trim();
    const dimsItems = this._extractImportedDimensionsItems(row);
    const dims = dimsItems[0] || { L: 0, W: 0, H: 0 };
    const provisionalRaw = String(row.Provisional ?? row.provisional ?? "").trim().toLowerCase();
    const provisional =
      provisionalRaw === "1" ||
      provisionalRaw === "true" ||
      provisionalRaw === "si" ||
      provisionalRaw === "sí" ||
      provisionalRaw === "yes" ||
      provisionalRaw === "oui";
    if (!projectId || !itemName || !(quantity > 0)) return null;
    return {
      projectId,
      itemName,
      quantity,
      materialCategory: materialCategory || "OTRO",
      purchaseOrder,
      supplier,
      provisional,
      dimensions: { L: dims.L || 0, W: dims.W || 0, H: dims.H || 0 },
      dimensionsItems: dimsItems
    };
  },

  async importReceptionsFile(file) {
    const nameLc = String(file?.name || "").toLowerCase();
    const isJson = nameLc.endsWith(".json");
    const reader = new FileReader();
    const parseRows = content => {
      if (isJson) {
        const parsed = JSON.parse(String(content || "[]"));
        return Array.isArray(parsed) ? parsed : [];
      }
      return null;
    };
    const processRows = rows => {
      if (!Array.isArray(rows) || !rows.length) {
        Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
        return;
      }
      let imported = 0;
      let skipped = 0;
      rows.forEach(raw => {
        const data = this._buildReceptionFromImportRow(raw);
        if (!data) {
          skipped++;
          return;
        }
        const rec = ReceptionsManager.registerReception(data, { skipToast: true });
        if (rec) imported++;
        else skipped++;
      });
      if (imported > 0) {
        this.renderReceptionList();
        if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
        Utils.showToast(`${I18n.t("msg.dataImported")}: ${imported}${skipped ? ` · omitidos: ${skipped}` : ""}`, "success");
      } else {
        Utils.showToast(I18n.t("msg.errorImportingData"), "warning");
      }
    };
    if (isJson) {
      reader.onload = e => {
        try {
          processRows(parseRows(e.target.result));
        } catch (err) {
          console.error(err);
          Utils.showToast(I18n.t("msg.errorImportingData"), "error");
        }
      };
      reader.readAsText(file);
      return;
    }
    Utils.importDataCSV(
      file,
      "__TMP_RECEPTIONS_IMPORT__",
      parsed => {
        try {
          processRows(parsed);
        } finally {
          localStorage.removeItem("__TMP_RECEPTIONS_IMPORT__");
        }
      },
      { silentToast: true }
    );
  },

  /** Cabeceras fijas: paquetes en filas (Paquete + L/W/H), no columnas Paquete 1 L… horizontales. */
  _buildReceptionsPrintExportHeaders() {
    return [
      I18n.t("reception.exportWhen"),
      I18n.t("reception.project"),
      I18n.t("reception.item"),
      I18n.t("reception.materialCategory"),
      I18n.t("reception.quantityShort"),
      I18n.t("reception.dimensionsCol"),
      I18n.t("reception.purchaseOrder"),
      I18n.t("reception.supplier"),
      I18n.t("transport.cargoPackageCol"),
      I18n.t("transport.cargoAxisL"),
      I18n.t("transport.cargoAxisW"),
      I18n.t("transport.cargoAxisH")
    ];
  },

  async printReceptionsFiltered(receptions, scopeLabel) {
    const list = Array.isArray(receptions) ? receptions : [];
    if (!list.length) {
      Utils.showToast(I18n.t("msg.reportEmpty"), "warning");
      return;
    }
    const headers = this._buildReceptionsPrintExportHeaders();
    const selectedHeaders = await Utils.pickColumns(headers, I18n.t("config.printReceptionsFiltered"));
    if (!selectedHeaders || !selectedHeaders.length) return;
    const esc = s => Utils.escapeHtml(String(s ?? ""));
    const dimColKey = I18n.t("reception.dimensionsCol");
    const colPkg = I18n.t("transport.cargoPackageCol");
    const colL = I18n.t("transport.cargoAxisL");
    const colW = I18n.t("transport.cargoAxisW");
    const colH = I18n.t("transport.cargoAxisH");
    const rows = [];
    for (const r of list) {
      const cat = r.materialCategory || "OTRO";
      const catLabel = I18n.t(`reception.mat.${cat}`) !== `reception.mat.${cat}` ? I18n.t(`reception.mat.${cat}`) : cat;
      const unitDims = Array.isArray(r?.dimensionsItems) ? r.dimensionsItems : [];
      const n = Math.max(unitDims.length, 1);
      for (let i = 0; i < n; i++) {
        const p = unitDims[i] || {};
        const row = {
          [I18n.t("reception.exportWhen")]: Utils.formatDateTime(r.dateReceived),
          [I18n.t("reception.project")]: r.projectId,
          [I18n.t("reception.item")]: r.itemName,
          [I18n.t("reception.materialCategory")]: catLabel,
          [I18n.t("reception.quantityShort")]: r.quantity,
          [dimColKey]: this._formatReceptionDimensionsPrintHtml(r),
          [I18n.t("reception.purchaseOrder")]: r.purchaseOrder || "—",
          [I18n.t("reception.supplier")]: r.supplier || "—",
          [colPkg]: unitDims.length ? String(i + 1) : "",
          [colL]: unitDims.length ? p.L || 0 : "",
          [colW]: unitDims.length ? p.W || 0 : "",
          [colH]: unitDims.length ? p.H || 0 : ""
        };
        rows.push(
          `<tr>${selectedHeaders
            .map(h => {
              const raw = row[h] ?? "";
              const cell = h === dimColKey ? raw : esc(raw);
              return `<td>${cell}</td>`;
            })
            .join("")}</tr>`
        );
      }
    }
    const rowsHtml = rows.join("");
    Utils.printHtmlDocument(
      I18n.t("config.receptionsTitle"),
      `${I18n.t("history.filterType")}: ${esc(scopeLabel || I18n.t("history.filterAll"))}`,
      `<table class="inventory-table"><thead><tr>${selectedHeaders.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody></table>`
    );
  },

  /** HTML seguro para impresión: un paquete por línea (bloque vertical). */
  _formatReceptionDimensionsPrintHtml(r) {
    const fmt = v => {
      const n = parseFloat(v) || 0;
      if (!(n > 0)) return "0";
      return String(Utils.roundDecimal(n, 4)).replace(/\.?0+$/, "");
    };
    const unitDims = Array.isArray(r?.dimensionsItems) ? r.dimensionsItems : [];
    const lines = unitDims
      .map((x, idx) => {
        const l = parseFloat(x?.L) || 0;
        const w = parseFloat(x?.W) || 0;
        const h = parseFloat(x?.H) || 0;
        if (!(l > 0 || w > 0 || h > 0)) return "";
        return `<span class="reception-print-pkg-line">${idx + 1}) ${fmt(l)} × ${fmt(w)} × ${fmt(h)}</span>`;
      })
      .filter(Boolean);
    if (lines.length) return `<div class="reception-print-pkg-block">${lines.join("")}</div>`;
    const dim = (r && r.dimensions) || {};
    const dL = parseFloat(dim.L) || 0;
    const dW = parseFloat(dim.W) || 0;
    const dH = parseFloat(dim.H) || 0;
    if (!(dL > 0 || dW > 0 || dH > 0)) return "—";
    return `${fmt(dL)} × ${fmt(dW)} × ${fmt(dH)}`;
  },

  _formatReceptionDimensionsCell(r) {
    const fmt = v => {
      const n = parseFloat(v) || 0;
      if (!(n > 0)) return "0";
      return String(Utils.roundDecimal(n, 4)).replace(/\.?0+$/, "");
    };
    const unitDims = Array.isArray(r?.dimensionsItems) ? r.dimensionsItems : [];
    const units = unitDims
      .map((x, idx) => {
        const l = parseFloat(x?.L) || 0;
        const w = parseFloat(x?.W) || 0;
        const h = parseFloat(x?.H) || 0;
        if (!(l > 0 || w > 0 || h > 0)) return "";
        return `${idx + 1}) ${fmt(l)}×${fmt(w)}×${fmt(h)}`;
      })
      .filter(Boolean);
    if (units.length) return units.join(" | ");
    const dim = (r && r.dimensions) || {};
    const dL = parseFloat(dim.L) || 0;
    const dW = parseFloat(dim.W) || 0;
    const dH = parseFloat(dim.H) || 0;
    if (!(dL > 0 || dW > 0 || dH > 0)) return "—";
    return `${fmt(dL)}×${fmt(dW)}×${fmt(dH)}`;
  },

  _formatReceptionGlassPacking(r) {
    if (!r || !ReceptionsManager.isGlassPackingCategory(r.materialCategory)) return "—";
    const g = r.glassPacking;
    if (g === "standard_box") return I18n.t("reception.glassPackingStandard");
    if (g === "loose_mixed") return I18n.t("reception.glassPackingLoose");
    return "—";
  },

  saveReceptionInline(id) {
    const tr = document.querySelector(`tr.rec-editor-row[data-rec-id="${id}"]`);
    if (!tr) return;
    const get = field => tr.querySelector(`[data-rec-field="${field}"]`)?.value ?? "";
    const provEl = tr.querySelector(`[data-rec-field="provisional"]`);
    const mat = get("materialCategory").trim() || "OTRO";
    const qty = Math.max(0, parseFloat(get("quantity")) || 0);
    const nPack = Math.max(1, Math.min(80, Math.floor(qty) || 1));
    const dimensionsItems = [];
    for (let i = 0; i < nPack; i++) {
      dimensionsItems.push({
        L: Math.max(0, parseFloat(get(`pkg-${i}-L`)) || 0),
        W: Math.max(0, parseFloat(get(`pkg-${i}-W`)) || 0),
        H: Math.max(0, parseFloat(get(`pkg-${i}-H`)) || 0)
      });
    }
    const patch = {
      projectId: get("projectId").trim(),
      itemName: get("itemName").trim(),
      quantity: qty,
      supplier: get("supplier").trim(),
      purchaseOrder: get("purchaseOrder").trim(),
      materialCategory: mat,
      provisional: !!(provEl && provEl.checked),
      dimensions: {
        L: Math.max(0, parseFloat(get("dimL")) || 0),
        W: Math.max(0, parseFloat(get("dimW")) || 0),
        H: Math.max(0, parseFloat(get("dimH")) || 0)
      },
      dimensionsItems,
      glassPacking: ReceptionsManager.isGlassPackingCategory(mat)
        ? ReceptionsManager._normalizeGlassPacking(mat, get("glassPacking"))
        : null
    };
    if (dimensionsItems.length && (dimensionsItems[0].L > 0 || dimensionsItems[0].W > 0 || dimensionsItems[0].H > 0)) {
      patch.dimensions = { ...dimensionsItems[0] };
    }
    if (ReceptionsManager.requiresPurchaseOrder(patch.materialCategory)) {
      patch.provisional = true;
    }
    if (ReceptionsManager.isGlassPackingCategory(mat) && !ReceptionsManager._normalizeGlassPacking(mat, get("glassPacking"))) {
      Utils.showToast(I18n.t("msg.receptionGlassPackingRequired"), "error");
      return;
    }
    const ok = ReceptionsManager.updateReception(id, patch);
    if (ok) {
      this._receptionEditId = null;
      this.renderReceptionList();
      Utils.showToast(I18n.t("msg.receptionUpdated"), "success");
      if (typeof TransportManager !== "undefined" && TransportManager.render) TransportManager.render();
    }
  },

  setupItemEditorSearch() {
    if (this._itemEditSearchBound) return;
    const inp = document.getElementById("config-item-search");
    const res = document.getElementById("config-item-search-results");
    if (!inp || !res) return;
    this._itemEditSearchBound = true;

    inp.addEventListener(
      "input",
      Utils.debounce(() => {
        const q = inp.value.trim();
        if (q.length < 1) {
          res.innerHTML = "";
          res.classList.remove("active");
          return;
        }
        const found = InventoryManager.search(q).slice(0, 25);
        if (!found.length) {
          res.innerHTML = `<div class="search-result-item muted">${this.esc(I18n.t("msg.noResults"))}</div>`;
        } else {
          res.innerHTML = found
            .map(
              item => `
            <div class="search-result-item config-item-search-hit" data-id="${Utils.escapeAttr(item.id)}" data-code="${Utils.escapeAttr(item.code)}" data-desc="${Utils.escapeAttr(item.description)}">
              <span class="result-code">${this.esc(item.code)}</span>
              <span class="result-description">${this.esc(item.description)}</span>
              <span class="result-meta muted">${this.esc(item.category || "")} · ${this.esc(item.location || "")}</span>
            </div>`
            )
            .join("");
        }
        res.classList.add("active");
      }, 200)
    );

    res.addEventListener("click", e => {
      const hit = e.target.closest(".config-item-search-hit");
      if (!hit || !hit.dataset.id) return;
      const id = hit.dataset.id;
      const hidden = document.getElementById("config-item-editor-id");
      if (hidden) hidden.value = id;
      inp.value = `${hit.dataset.code || ""} — ${hit.dataset.desc || ""}`;
      res.classList.remove("active");
      this.loadItemEditor(id);
    });

    document.addEventListener("click", e => {
      if (!e.target.closest(".item-edit-search-container")) res.classList.remove("active");
    });
  },

  renderItemEditorOptions() {
    const hidden = document.getElementById("config-item-editor-id");
    const searchInp = document.getElementById("config-item-search");
    if (!hidden) return;
    const items = InventoryManager.items || [];
    if (!items.length) {
      hidden.value = "";
      if (searchInp) searchInp.value = "";
      this.loadItemEditor("");
      return;
    }

    let current = hidden.value;
    if (!current || !items.some(i => i.id === current)) {
      current = items[0].id;
      hidden.value = current;
    }
    const curItem = items.find(i => i.id === current);
    if (searchInp && curItem) {
      searchInp.value = `${curItem.code} — ${curItem.description}`;
    }
    this.loadItemEditor(current);
  },

  loadItemEditor(itemId) {
    const item = (InventoryManager.items || []).find(x => x.id === itemId);
    const set = (id, value = "") => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? "";
    };

    if (!item) {
      set("config-item-editor-id", "");
      [
        "edit-code",
        "edit-description",
        "edit-category",
        "edit-location-values",
        "edit-main-stock",
        "edit-prod-stock",
        "edit-trans-stock",
        "edit-qty-per-box",
        "edit-num-boxes",
        "edit-exp-date",
        "edit-days-to-expire",
        "edit-expiration-date",
        "edit-supplier",
        "edit-last-order",
        "edit-min-stock",
        "edit-max-stock",
        "edit-default-price",
        "edit-price-currency",
        "edit-details",
        "edit-notes",
        "edit-item-problems-note"
      ].forEach(id => set(id, ""));
      this._setEditLocationSelections("");
      const consEl = document.getElementById("edit-inventory-consumable");
      if (consEl) consEl.checked = false;
      document.getElementById("config-item-delete-btn") && (document.getElementById("config-item-delete-btn").disabled = true);
      return;
    }

    document.getElementById("config-item-delete-btn") &&
      (document.getElementById("config-item-delete-btn").disabled = false);
    set("config-item-editor-id", item.id);
    set("edit-code", item.code);
    set("edit-description", item.description);
    set("edit-category", item.category);
    this._setEditLocationSelections(item.location);
    set("edit-main-stock", item.mainStock ?? 0);
    set("edit-prod-stock", item.prodStock ?? 0);
    set("edit-trans-stock", item.transStock ?? 0);
    set("edit-qty-per-box", item.qtyPerBox ?? 0);
    set("edit-num-boxes", item.numBoxes ?? 0);
    set("edit-exp-date", item.expDate || "");
    set("edit-days-to-expire", item.daysToExpire ?? 0);
    set("edit-expiration-date", item.expirationDate || "");
    set("edit-supplier", item.supplier);
    set("edit-last-order", item.lastOrder);
    set("edit-min-stock", item.minStock ?? 0);
    set("edit-max-stock", item.maxStock ?? 0);
    set("edit-default-price", item.defaultPrice ?? 0);
    set("edit-price-currency", item.priceCurrency || "CAD");
    set("edit-details", item.details);
    set("edit-notes", item.notes);
    set("edit-item-problems-note", item.itemProblemsNote);
    const ignLowEl = document.getElementById("edit-ignore-low-stock-alert");
    if (ignLowEl) ignLowEl.checked = !!item.ignoreLowStockAlert;
    const consEl = document.getElementById("edit-inventory-consumable");
    if (consEl) consEl.checked = !!item.inventoryConsumable;
  },

  async saveItemEditor() {
    if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
    const itemIdRaw = document.getElementById("config-item-editor-id")?.value;
    const itemId = String(itemIdRaw || "").trim();
    const existing = itemId ? InventoryManager.items.find(x => x.id === itemId) : null;

    const get = id => document.getElementById(id)?.value ?? "";
    const toNum = id => parseFloat(get(id)) || 0;
    const round4 = n => Utils.roundDecimal(n, 4);
    const shelfLifeMonths = Math.max(0, parseInt(existing?.shelfLifeMonths, 10) || 0);
    const mainStock = round4(toNum("edit-main-stock"));
    const qtyPerBox = round4(toNum("edit-qty-per-box"));
    const numBoxes =
      qtyPerBox > 0
        ? round4(mainStock / qtyPerBox)
        : 0;

    const updated = {
      code: get("edit-code").trim(),
      description: get("edit-description").trim(),
      category: get("edit-category").trim(),
      location: this._getEditLocationSelections(),
      mainStock,
      prodStock: round4(toNum("edit-prod-stock")),
      transStock: round4(toNum("edit-trans-stock")),
      qtyPerBox,
      numBoxes,
      expDate: get("edit-exp-date"),
      daysToExpire: parseInt(get("edit-days-to-expire"), 10) || 0,
      expirationDate: get("edit-expiration-date").trim(),
      supplier: get("edit-supplier").trim(),
      lastOrder: get("edit-last-order").trim(),
      minStock: round4(toNum("edit-min-stock")),
      maxStock: round4(toNum("edit-max-stock")),
      defaultPrice: Utils.roundDecimal(toNum("edit-default-price"), 2),
      priceCurrency: get("edit-price-currency") || "CAD",
      details: get("edit-details").trim(),
      notes: get("edit-notes").trim(),
      itemProblemsNote: get("edit-item-problems-note").trim(),
      shelfLifeMonths,
      inventoryConsumable: !!document.getElementById("edit-inventory-consumable")?.checked,
      ignoreLowStockAlert: !!document.getElementById("edit-ignore-low-stock-alert")?.checked
    };

    const numBoxesEl = document.getElementById("edit-num-boxes");
    if (numBoxesEl) numBoxesEl.value = String(updated.numBoxes);

    if (updated.expDate && shelfLifeMonths > 0) {
      updated.expirationDate = InventoryManager.addMonthsToIsoDate(updated.expDate, shelfLifeMonths);
      updated.daysToExpire =
        updated.expirationDate && !Number.isNaN(new Date(updated.expirationDate + "T12:00:00").getTime())
          ? Math.max(0, InventoryManager.daysTo(updated.expirationDate))
          : 0;
    }

    if (!updated.code || !updated.description) {
      Utils.showToast(I18n.t("msg.codeDescriptionRequired"), "error");
      return;
    }
    if (updated.maxStock > 0 && updated.maxStock < updated.minStock) {
      Utils.showToast(I18n.t("msg.maxLessThanMin"), "error");
      return;
    }

    if (!existing) {
      const low = updated.code.trim().toLowerCase();
      if (InventoryManager.items.some(i => (i.code || "").trim().toLowerCase() === low)) {
        Utils.showToast(I18n.t("msg.itemCodeDuplicate"), "error");
        return;
      }
      const newItem = InventoryManager.addItem({
        code: updated.code,
        description: updated.description,
        category: updated.category,
        location: updated.location,
        mainStock: updated.mainStock,
        prodStock: updated.prodStock,
        transStock: updated.transStock,
        qtyPerBox: updated.qtyPerBox,
        numBoxes: updated.numBoxes,
        expDate: updated.expDate,
        daysToExpire: updated.daysToExpire,
        expirationDate: updated.expirationDate,
        supplier: updated.supplier,
        lastOrder: updated.lastOrder,
        minStock: updated.minStock,
        maxStock: updated.maxStock,
        defaultPrice: updated.defaultPrice,
        priceCurrency: updated.priceCurrency,
        details: updated.details,
        notes: updated.notes,
        itemProblemsNote: updated.itemProblemsNote,
        shelfLifeMonths: updated.shelfLifeMonths,
        inventoryConsumable: updated.inventoryConsumable,
        ignoreLowStockAlert: updated.ignoreLowStockAlert
      });
      const hid = document.getElementById("config-item-editor-id");
      if (hid) hid.value = newItem.id;
      const searchInp = document.getElementById("config-item-search");
      if (searchInp) searchInp.value = `${newItem.code} — ${newItem.description}`;
      this.loadItemEditor(newItem.id);
      Utils.showToast(I18n.t("msg.itemCreated"), "success");
      if (typeof Auth !== "undefined") Auth.logAudit("item.create", newItem.code);
      if (newItem.inventoryConsumable && typeof ConsumableManager !== "undefined" && ConsumableManager.ensureMasterName) {
        ConsumableManager.ensureMasterName(newItem.description || newItem.code);
      }
      return;
    }

    const oldMain = parseFloat(existing.mainStock) || 0;
    const oldProd = parseFloat(existing.prodStock) || 0;
    const oldTrans = parseFloat(existing.transStock) || 0;
    const dMain = updated.mainStock - oldMain;
    const dProd = updated.prodStock - oldProd;
    const dTrans = updated.transStock - oldTrans;
    const stockChanged =
      Math.abs(dMain) > 1e-9 || Math.abs(dProd) > 1e-9 || Math.abs(dTrans) > 1e-9;

    if (stockChanged) {
      if (typeof MovementManager === "undefined" || !MovementManager.recordAjusteFromConfigEditor) {
        Utils.showToast(I18n.t("msg.error"), "error");
        return;
      }
      let reasonExtra = "";
      if (typeof App !== "undefined" && App.showPrompt) {
        const reason = await App.showPrompt({
          message: I18n.t("movements.editorAjusteReasonPrompt"),
          defaultValue: "",
          inputType: "text"
        });
        if (reason != null && String(reason).trim()) reasonExtra = String(reason).trim();
      }
      const baseNote = I18n.t("movements.configEditorAjusteNote");
      const notes = reasonExtra
        ? `${baseNote}\n\n${I18n.t("movements.editorAjusteReasonLabel")}: ${reasonExtra}`
        : baseNote;
      const mov = MovementManager.recordAjusteFromConfigEditor({
        itemId,
        deltaMain: dMain,
        deltaProd: dProd,
        deltaTrans: dTrans,
        notes
      });
      if (mov == null) return;
    }

    const rawLocationForCheck = String(updated.location || "").trim();
    if (rawLocationForCheck && typeof Utils !== "undefined") {
      const normLoc = Utils.normalizeWarehouseLocationText(rawLocationForCheck);
      if (normLoc) {
        const strictLoc = Utils.strictEffectiveWarehouseLocationText(rawLocationForCheck);
        if (strictLoc !== normLoc) {
          Utils.showToast(I18n.t("config.locationDiscardedNonCatalog"), "warning");
        }
      }
    }

    InventoryManager.updateItem(itemId, updated);
    if (typeof ConsumableManager !== "undefined") {
      const labelNew = String(updated.description || updated.code || "").trim();
      const labelOld = String(existing.description || existing.code || "").trim();
      if (updated.inventoryConsumable && labelNew && ConsumableManager.ensureMasterName) {
        ConsumableManager.ensureMasterName(labelNew);
      }
      if (existing.inventoryConsumable && !updated.inventoryConsumable && labelOld && ConsumableManager.removeMasterName) {
        ConsumableManager.removeMasterName(labelOld);
      }
    }
    const searchInp = document.getElementById("config-item-search");
    const cur = InventoryManager.items.find(x => x.id === itemId);
    if (searchInp && cur) searchInp.value = `${cur.code} — ${cur.description}`;
    this.loadItemEditor(itemId);
    Utils.showToast(I18n.t("msg.itemUpdated"), "success");
    if (typeof Auth !== "undefined") Auth.logAudit("item.edit", updated.code);
  },

  receptionMaterialOptions(selected) {
    const opts = [
      "MARMOL",
      "VIDRIO_PLANO",
      "VIDRIO_CURVO",
      "VIDRIO_PINTADO",
      "GRANITO",
      "GRANITO_LACROIX",
      "ESPECIAL",
      "OTRO",
      "VIDRIO"
    ];
    return [...new Set(opts)]
      .map(v => {
        const lab = I18n.t(`reception.mat.${v}`);
        const label = lab === `reception.mat.${v}` ? v : lab;
        return `<option value="${Utils.escapeAttr(v)}" ${v === selected ? "selected" : ""}>${this.esc(label)}</option>`;
      })
      .join("");
  },

  receptionRowMatchesFilter(r, q) {
    if (!q) return true;
    const cat = r.materialCategory || "OTRO";
    const catLabel = I18n.t(`reception.mat.${cat}`) !== `reception.mat.${cat}` ? I18n.t(`reception.mat.${cat}`) : cat;
    const dim = r.dimensions || {};
    const dimTxt = [dim.L, dim.W, dim.H, this._formatReceptionDimensionsCell(r)]
      .map(x => String(x ?? ""))
      .join(" ");
    const gpTxt = [r.glassPacking, this._formatReceptionGlassPacking(r), I18n.t("reception.glassPackingStandard"), I18n.t("reception.glassPackingLoose")].map(x => String(x ?? "").toLowerCase()).join(" ");
    const hay = [
      r.id,
      r.projectId,
      r.itemName,
      r.purchaseOrder,
      r.supplier,
      String(r.quantity ?? ""),
      cat,
      catLabel,
      r.provisional ? "provisional" : "",
      r.provisional ? I18n.t("reception.provisional") : "",
      Utils.formatDate(r.dateReceived),
      r.dateReceived,
      dimTxt,
      gpTxt
    ]
      .map(x => String(x ?? "").toLowerCase())
      .join(" ");
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    return tokens.every(tok => hay.indexOf(tok) >= 0);
  },

  renderReceptionList() {
    const wrap = document.getElementById("receptions-config-table");
    if (!wrap) return;
    const searchEl = document.getElementById("receptions-config-search");
    const q = (searchEl && searchEl.value !== undefined ? searchEl.value : this._receptionListFilter || "")
      .trim()
      .toLowerCase();
    if (searchEl) this._receptionListFilter = q;

    const arr = ReceptionsManager.receptions || [];
    if (!arr.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted)">${this.esc(I18n.t("msg.noReceptions"))}</p>`;
      return;
    }
    const ordered = arr.slice().reverse();
    const filtered = ordered.filter(
      r => r.id === this._receptionEditId || this.receptionRowMatchesFilter(r, q)
    );
    if (!filtered.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted)">${this.esc(I18n.t("msg.receptionsNoFilterMatch"))}</p>`;
      return;
    }
    const rows = filtered.map(r => {
        const cat = r.materialCategory || "OTRO";
        const catLabel = I18n.t(`reception.mat.${cat}`) !== `reception.mat.${cat}` ? I18n.t(`reception.mat.${cat}`) : cat;
        const provLabel = r.provisional ? I18n.t("reception.provisional") : "—";
        if (this._receptionEditId === r.id) {
          const rd = r.dimensions || {};
          const dL = rd.L ?? 0;
          const dW = rd.W ?? 0;
          const dH = rd.H ?? 0;
          const qtyInt = Math.max(1, Math.min(80, Math.floor(parseFloat(r.quantity) || 0) || 1));
          let unitArr = Array.isArray(r.dimensionsItems) && r.dimensionsItems.length
            ? r.dimensionsItems.map(u => ({
                L: Math.max(0, parseFloat(u?.L) || 0),
                W: Math.max(0, parseFloat(u?.W) || 0),
                H: Math.max(0, parseFloat(u?.H) || 0)
              }))
            : [];
          while (unitArr.length < qtyInt) unitArr.push({ L: 0, W: 0, H: 0 });
          const pkgEditRows = unitArr.slice(0, qtyInt)
            .map(
              (u, i) => `
            <div class="rec-pkg-dim-row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0;padding:6px 0;border-top:1px solid var(--border-color);">
              <span class="muted" style="min-width:5rem;">${this.esc(I18n.t("reception.packageShort"))} ${i + 1}</span>
              <label style="margin:0;">L <input type="number" class="form-input" style="max-width:6rem;" data-rec-field="pkg-${i}-L" min="0" step="0.0001" value="${Utils.escapeAttr(u.L)}" /></label>
              <label style="margin:0;">W <input type="number" class="form-input" style="max-width:6rem;" data-rec-field="pkg-${i}-W" min="0" step="0.0001" value="${Utils.escapeAttr(u.W)}" /></label>
              <label style="margin:0;">H <input type="number" class="form-input" style="max-width:6rem;" data-rec-field="pkg-${i}-H" min="0" step="0.0001" value="${Utils.escapeAttr(u.H)}" /></label>
            </div>`
            )
            .join("");
          const gp = r.glassPacking;
          const glassPackEdit = ReceptionsManager.isGlassPackingCategory(cat)
            ? `<label>${this.esc(I18n.t("reception.glassPackingLabel"))}
                <select data-rec-field="glassPacking" class="filter-select">
                  <option value=""${!gp || (gp !== "standard_box" && gp !== "loose_mixed") ? " selected" : ""}>${this.esc(
                    I18n.t("reception.glassPackingUnspecified")
                  )}</option>
                  <option value="standard_box"${gp === "standard_box" ? " selected" : ""}>${this.esc(
                    I18n.t("reception.glassPackingStandard")
                  )}</option>
                  <option value="loose_mixed"${gp === "loose_mixed" ? " selected" : ""}>${this.esc(
                    I18n.t("reception.glassPackingLoose")
                  )}</option>
                </select>
              </label>`
            : "";
          return `
        <tr class="rec-editor-row" data-rec-id="${Utils.escapeAttr(r.id)}">
          <td colspan="12" class="rec-editor-cell">
            <div class="rec-editor-grid">
              <label>${this.esc(I18n.t("reception.project"))}<input type="text" data-rec-field="projectId" class="form-input" value="${Utils.escapeAttr(r.projectId)}"></label>
              <label>${this.esc(I18n.t("reception.item"))}<input type="text" data-rec-field="itemName" class="form-input" value="${Utils.escapeAttr(r.itemName)}"></label>
              <label>${this.esc(I18n.t("reception.materialCategory"))}
                <select data-rec-field="materialCategory" class="filter-select">${this.receptionMaterialOptions(cat)}</select>
              </label>
              <label>${this.esc(I18n.t("reception.purchaseOrder"))}<input type="text" data-rec-field="purchaseOrder" class="form-input" value="${Utils.escapeAttr(r.purchaseOrder)}"></label>
              <label>${this.esc(I18n.t("reception.quantity"))}<input type="number" data-rec-field="quantity" class="form-input" step="1" value="${Utils.escapeAttr(r.quantity)}"></label>
              <label>${this.esc(I18n.t("reception.dimL"))}<input type="number" data-rec-field="dimL" class="form-input" min="0" step="0.0001" value="${Utils.escapeAttr(dL)}"></label>
              <label>${this.esc(I18n.t("reception.dimW"))}<input type="number" data-rec-field="dimW" class="form-input" min="0" step="0.0001" value="${Utils.escapeAttr(dW)}"></label>
              <label>${this.esc(I18n.t("reception.dimH"))}<input type="number" data-rec-field="dimH" class="form-input" min="0" step="0.0001" value="${Utils.escapeAttr(dH)}"></label>
              <div class="rec-pkg-dims-block" style="grid-column:1/-1;">
                <div class="muted" style="margin-bottom:4px;">${this.esc(I18n.t("reception.perPackageDims"))}</div>
                ${pkgEditRows}
              </div>
              ${glassPackEdit}
              <label>${this.esc(I18n.t("reception.supplier"))}<input type="text" data-rec-field="supplier" class="form-input" value="${Utils.escapeAttr(r.supplier)}"></label>
              <label class="rec-prov-inline"><input type="checkbox" data-rec-field="provisional" ${r.provisional ? "checked" : ""} /> ${this.esc(I18n.t("reception.provisionalCheck"))}</label>
              <div class="rec-editor-actions">
                <button type="button" class="btn btn-primary rec-save-btn" data-id="${Utils.escapeAttr(r.id)}">${this.esc(I18n.t("buttons.save"))}</button>
                <button type="button" class="btn btn-secondary rec-cancel-edit-btn">${this.esc(I18n.t("buttons.cancel"))}</button>
              </div>
            </div>
          </td>
        </tr>`;
        }
        return `
        <tr data-rec-id="${Utils.escapeAttr(r.id)}">
          <td class="rec-actions-cell">
            <button type="button" class="btn btn-secondary rec-edit-btn" data-id="${Utils.escapeAttr(r.id)}">${this.esc(I18n.t("buttons.edit"))}</button>
          </td>
          <td>${Utils.formatDate(r.dateReceived)}</td>
          <td>${this.esc(r.projectId)}</td>
          <td>${this.esc(r.itemName)}</td>
          <td>${this.esc(catLabel)}</td>
          <td>${this.esc(r.quantity)}</td>
          <td>${this.esc(this._formatReceptionDimensionsCell(r))}</td>
          <td>${this.esc(this._formatReceptionGlassPacking(r))}</td>
          <td>${this.esc(r.purchaseOrder || "—")}</td>
          <td>${this.esc(r.supplier || "—")}</td>
          <td>${this.esc(provLabel)}</td>
          <td class="rec-actions-cell">
            <button type="button" class="btn btn-danger rec-delete-btn" data-id="${Utils.escapeAttr(r.id)}">${this.esc(I18n.t("buttons.deleteItem"))}</button>
          </td>
        </tr>`;
      })
      .join("");
    wrap.innerHTML = `
      <div class="inventory-table-container">
        <table class="inventory-table receptions-admin-table">
          <thead>
            <tr>
              <th>${this.esc(I18n.t("buttons.edit"))}</th>
              <th>${this.esc(I18n.t("reception.dateShort"))}</th>
              <th>${this.esc(I18n.t("reception.project"))}</th>
              <th>${this.esc(I18n.t("reception.item"))}</th>
              <th>${this.esc(I18n.t("reception.materialCategory"))}</th>
              <th>${this.esc(I18n.t("reception.quantityShort"))}</th>
              <th>${this.esc(I18n.t("reception.dimensionsCol"))}</th>
              <th>${this.esc(I18n.t("reception.glassPackingCol"))}</th>
              <th>${this.esc(I18n.t("reception.purchaseOrder"))}</th>
              <th>${this.esc(I18n.t("reception.supplier"))}</th>
              <th>${this.esc(I18n.t("reception.provisional"))}</th>
              <th>${this.esc(I18n.t("table.actions"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  async archiveMovements() {
    if (typeof Auth !== "undefined" && !Auth.guardConfigAction("cfgActArchive", "edit")) return;
    if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) return;

    const dateInput = document.getElementById("archive-date");
    const cutoff = dateInput?.value;
    if (!cutoff) {
      Utils.showToast(I18n.t("config.archiveNoDate"), "warning");
      return;
    }

    const cutoffDate = new Date(cutoff + "T23:59:59");
    if (isNaN(cutoffDate.getTime())) {
      Utils.showToast(I18n.t("config.archiveNoDate"), "warning");
      return;
    }

    const allMovements = MovementManager.movements || [];
    const toArchive = [];
    const toKeep = [];
    allMovements.forEach(m => {
      const ts = new Date(m?.date).getTime();
      if (!Number.isFinite(ts)) {
        // Fecha inválida: nunca archivar automáticamente para evitar pérdida de datos.
        toKeep.push(m);
        return;
      }
      if (ts <= cutoffDate.getTime()) toArchive.push(m);
      else toKeep.push(m);
    });

    if (!toArchive.length) {
      Utils.showToast(I18n.t("config.archiveNone"), "info");
      return;
    }

    const msg = I18n.t("config.archiveConfirm")
      .replace("{count}", toArchive.length)
      .replace("{date}", cutoff);

    App.showConfirm(msg, async () => {
      const typeLabels = {
        AJUSTE: "Adjustment", CONSUMO_DIARIO: "Daily Consumption",
        FERRETERIA: "Hardware", ESPECIAL: "Special",
        LISTA_CHEQUEO: "Checklist", MERMA: "Shrinkage",
        RETORNO: "Return", DESMANTELAR: "Dismantling",
        TRANSFERENCIA: "Transfer", TRANSFORMACION: "Transformation",
        ENVIAR_PRODUCCION: "Send to Production",
        MAT_ELEC_PROD: "E.M. Production", MAT_ELEC_OBRA: "E.M. Work Site",
        STANDBY: "Stand-By", COMPRA_STOCK: "Stock Purchase",
        RECEPCION_MATERIAL: "Material Reception"
      };
      const readable = toArchive.map(m => {
        const entry = {
          id: m.id,
          date: m.date,
          type: typeLabels[m.type] || m.type,
          typeCode: m.type,
          reference: m.reference || "",
          project: m.projectId || "",
          notes: m.notes || "",
          performedBy: m.createdBy || "",
          annulled: !!m.annulled,
          hadOverdraft:
            typeof MovementManager !== "undefined" && typeof MovementManager.effectiveHadOverdraft === "function"
              ? MovementManager.effectiveHadOverdraft(m)
              : !!m.hadOverdraft
        };
        if (m.overdraftReason) entry.overdraftReason = m.overdraftReason;
        if (m.purchaseMeta) entry.purchaseInfo = m.purchaseMeta;
        if (m.items && m.items.length) {
          entry.items = m.items.map(it => ({
            article: it.itemName || it.name || it.itemId || "",
            quantity: it.quantity ?? 0,
            unit: it.unit || "",
            annulled: !!it.annulled
          }));
        }
        return entry;
      });
      const now = new Date();
      const payload = {
        _description: "Phoenix Cell G-NEEX — Archived movements export",
        exportLabel: I18n.t("export.manifest.archiveMovements"),
        exportedAtUtc: now.toISOString(),
        exportedAtLocal: Utils.formatDateTime(now),
        archivedAt: now.toISOString(),
        cutoffDate: cutoff,
        movementCount: readable.length,
        movements: readable,
        _rawMovements: toArchive
      };
      const json = JSON.stringify(payload, null, 2);

      const times = toArchive.map(m => new Date(m.date).getTime()).filter(t => !isNaN(t));
      const fromMs = times.length ? Math.min(...times) : cutoffDate.getTime();
      const fromD = new Date(fromMs);
      const fromStr = `${fromD.getFullYear()}-${String(fromD.getMonth() + 1).padStart(2, "0")}-${String(
        fromD.getDate()
      ).padStart(2, "0")}`;
      const toStr = cutoff;
      const filename = Utils.archivedMovementsFilename(fromStr, toStr);

      const r = await Utils.writeProjectExportFile(
        Utils.PROJECT_EXPORT_PREVIOUS_PERIODS,
        filename,
        json,
        { bom: false }
      );
      if (r === "cancelled") return;
      if (r !== "ok") {
        Utils.downloadFile(json, filename, "application/json");
      }

      MovementManager.movements = toKeep;
      MovementManager.save();

      if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();

      if (typeof Auth !== "undefined") {
        Auth.logAudit("archive.movements", `${toArchive.length} movimientos antes de ${cutoff}`);
      }

      Utils.showToast(
        I18n.t("config.archiveDone").replace("{count}", toArchive.length),
        "success"
      );
    });
  },

  reimportArchive(file) {
    if (typeof Auth !== "undefined" && !Auth.guardConfigAction("cfgActReimportArchive", "edit")) return;
    if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        const archived = Array.isArray(data)
          ? data
          : (Array.isArray(data._rawMovements) ? data._rawMovements : null);
        if (!archived || !archived.length) {
          Utils.showToast(I18n.t("config.reimportEmpty"), "warning");
          return;
        }

        const existing = MovementManager.movements || [];
        const existingIds = new Set(existing.map(m => m.id));
        const toAdd = archived.filter(m => m.id && !existingIds.has(m.id));

        if (!toAdd.length) {
          Utils.showToast(I18n.t("config.reimportDuplicates"), "info");
          return;
        }

        const msg = I18n.t("config.reimportConfirm").replace("{count}", toAdd.length);
        App.showConfirm(msg, () => {
          MovementManager.movements = existing.concat(toAdd);
          MovementManager.movements.sort((a, b) => {
            const ta = new Date(a?.date || 0).getTime();
            const tb = new Date(b?.date || 0).getTime();
            const va = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
            const vb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
            if (va !== vb) return va - vb;
            return String(a?.id || "").localeCompare(String(b?.id || ""));
          });
          MovementManager.save();
          if (Utils.syncMovementRefCounterFromMovements) {
            Utils.syncMovementRefCounterFromMovements(MovementManager.movements || []);
          }

          if (typeof HistoryManager !== "undefined" && HistoryManager.render) HistoryManager.render();

          if (typeof Auth !== "undefined") {
            Auth.logAudit("reimport.archive", `${toAdd.length} movimientos reimportados`);
          }

          Utils.showToast(
            I18n.t("config.reimportDone").replace("{count}", toAdd.length),
            "success"
          );
        });
      } catch (err) {
        console.error("reimport error", err);
        Utils.showToast(I18n.t("config.reimportError"), "error");
      }
    };
    reader.readAsText(file);
  },

  async wipeAll() {
    if (typeof Auth !== "undefined" && !Auth.guardConfigAction("cfgActWipeDb", "edit")) return;
    if (typeof Auth !== "undefined" && !Auth.guardAdmin()) return;
    const conf = await App.showPrompt({
      message: I18n.t("prompt.deleteDatabase"),
      defaultValue: "",
      inputType: "text"
    });
    if (conf === null) {
      Utils.showToast(I18n.t("msg.cancelled"), "warning");
      return;
    }
    const normalized = (conf || "").replace(/\s+/g, " ").trim().toUpperCase();
    const accepted = [
      I18n.t("prompt.deleteDatabaseCode"),
      "BORRAR TODO",
      "DELETE ALL",
      "SUPPRIMER TOUT"
    ].map(v => (v || "").replace(/\s+/g, " ").trim().toUpperCase());
    if (!accepted.includes(normalized)) {
      Utils.showToast(I18n.t("msg.cancelled"), "warning");
      return;
    }
    if (typeof Auth !== "undefined") Auth.logAudit("database.wipe", "all");
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("refCounter_")) localStorage.removeItem(k);
    });
    try { sessionStorage.removeItem("phoenix-unlock-item-edit"); } catch (e) {}
    Utils.showToast(I18n.t("msg.databaseDeletedReload"), "error");
    setTimeout(() => window.location.reload(), 1500);
  }
};
