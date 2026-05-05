// reminders.js — tareas y recordatorios (escala por días hábiles, expansión por ítem, completado con fecha)
// Cada recordatorio lleva createdByUserId; la UI solo muestra los del usuario en sesión (el JSON guarda todos).

const REMINDERS_LEGACY_OWNER_MIG_KEY = "gneex-reminders-legacy-owner-migrated-v1";

const REMINDER_PRIORITY = {
  WHEN: "when",
  ATTENTION: "attention",
  URGENT: "urgent"
};

const REMINDER_PRIORITY_ORDER = {
  [REMINDER_PRIORITY.URGENT]: 0,
  [REMINDER_PRIORITY.ATTENTION]: 1,
  [REMINDER_PRIORITY.WHEN]: 2
};

const RemindersManager = {
  items: [],
  /** IDs de tareas con panel de detalle abierto (solo en memoria). */
  _expandedIds: new Set(),

  init() {
    this._load();
    this._bind();
    this._setDueInputDefault();
    this.refreshAll();
  },

  _localMidnight(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  },

  _dateAfterNBusinessDays(fromDate, n) {
    const d = this._localMidnight(new Date(fromDate));
    let left = Math.max(0, Math.floor(n));
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) left--;
    }
    return d;
  },

  _hasReachedBusinessDayThreshold(anchorDate, n) {
    const threshold = this._dateAfterNBusinessDays(anchorDate, n);
    const today = this._localMidnight(new Date());
    return today.getTime() >= threshold.getTime();
  },

  _normalizePriority(p) {
    const v = String(p || "").trim();
    if (v === REMINDER_PRIORITY.URGENT || v === REMINDER_PRIORITY.ATTENTION || v === REMINDER_PRIORITY.WHEN) return v;
    return REMINDER_PRIORITY.WHEN;
  },

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REMINDERS) || "[]";
      const parsed = JSON.parse(raw);
      this.items = Array.isArray(parsed) ? parsed : [];
      this.items.forEach(it => {
        it.priority = this._normalizePriority(it.priority);
      });
    } catch (e) {
      this.items = [];
    }
  },

  _currentUserId() {
    try {
      const u = typeof Auth !== "undefined" && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      return u && u.id ? String(u.id) : "";
    } catch (e) {
      return "";
    }
  },

  /** Recordatorios visibles para la sesión actual (almacén sigue teniendo los de todos los usuarios). */
  _visibleItems() {
    const uid = this._currentUserId();
    if (!uid) return [];
    return this.items.filter(it => String(it.createdByUserId || "") === uid);
  },

  _ownsReminder(it) {
    const uid = this._currentUserId();
    return !!uid && !!it && String(it.createdByUserId || "") === uid;
  },

  /**
   * Datos antiguos sin creador (todos sin campo): una sola vez se asignan al usuario en sesión — típico al actualizar desde versiones sin `createdByUserId`.
   */
  _migrateLegacyCreatorsOnce() {
    const uid = this._currentUserId();
    if (!uid) return;
    try {
      if (localStorage.getItem(REMINDERS_LEGACY_OWNER_MIG_KEY)) return;
    } catch (e) {
      return;
    }
    const noItems = !this.items.length;
    const pureLegacy =
      !noItems &&
      this.items.every(it => it.createdByUserId == null || String(it.createdByUserId).trim() === "");
    if (noItems || !pureLegacy) {
      try {
        localStorage.setItem(REMINDERS_LEGACY_OWNER_MIG_KEY, "1");
      } catch (e) {
        /* ignore */
      }
      return;
    }
    for (const it of this.items) {
      it.createdByUserId = uid;
    }
    this._save();
    try {
      localStorage.setItem(REMINDERS_LEGACY_OWNER_MIG_KEY, "1");
    } catch (e) {
      /* ignore */
    }
  },

  _migrateItems() {
    this.items.forEach(it => {
      if (it.priority === REMINDER_PRIORITY.ATTENTION && !it.becameAttentionAt) {
        it.becameAttentionAt = it.createdAt || new Date().toISOString();
      }
    });
  },

  _applyEscalation() {
    let changed = false;
    for (const it of this.items) {
      if (it.done) continue;
      const created = new Date(it.createdAt || Date.now());
      const p = this._normalizePriority(it.priority);

      if (p === REMINDER_PRIORITY.WHEN) {
        if (this._hasReachedBusinessDayThreshold(created, 10)) {
          it.priority = REMINDER_PRIORITY.ATTENTION;
          const attnDay = this._dateAfterNBusinessDays(created, 10);
          attnDay.setHours(12, 0, 0, 0);
          it.becameAttentionAt = attnDay.toISOString();
          changed = true;
        }
      } else if (p === REMINDER_PRIORITY.ATTENTION) {
        const anchor = it.becameAttentionAt ? new Date(it.becameAttentionAt) : created;
        if (this._hasReachedBusinessDayThreshold(anchor, 3)) {
          it.priority = REMINDER_PRIORITY.URGENT;
          changed = true;
        }
      }
    }
    return changed;
  },

  _processItems() {
    this._migrateItems();
    if (this._applyEscalation()) this._save();
  },

  _save() {
    localStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(this.items));
  },

  _rankPriority(p) {
    const n = REMINDER_PRIORITY_ORDER[this._normalizePriority(p)];
    return typeof n === "number" ? n : REMINDER_PRIORITY_ORDER[REMINDER_PRIORITY.WHEN];
  },

  _isReminderExpanded(id) {
    return this._expandedIds.has(String(id));
  },

  _toggleReminderExpanded(id) {
    const s = String(id);
    if (this._expandedIds.has(s)) this._expandedIds.delete(s);
    else this._expandedIds.add(s);
    this.render();
  },

  _setReminderExpanded(id, open) {
    const s = String(id);
    if (open) this._expandedIds.add(s);
    else this._expandedIds.delete(s);
  },

  _sortedForEditor() {
    return [...this._visibleItems()].sort((a, b) => {
      const da = !!a.done;
      const db = !!b.done;
      if (da !== db) return da ? 1 : -1;
      const pr = this._rankPriority(a.priority) - this._rankPriority(b.priority);
      if (pr !== 0) return pr;
      const ad = a.dueDate || "";
      const bd = b.dueDate || "";
      if (!da) {
        if (ad && bd && ad !== bd) return ad.localeCompare(bd);
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
      }
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  },

  _sortedPendingForDashboard() {
    return this._visibleItems()
      .filter(x => !x.done)
      .sort((a, b) => {
        const pr = this._rankPriority(a.priority) - this._rankPriority(b.priority);
        if (pr !== 0) return pr;
        const ad = a.dueDate || "";
        const bd = b.dueDate || "";
        if (ad && bd && ad !== bd) return ad.localeCompare(bd);
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });
  },

  _todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  },

  /** Fecha del día actual en el selector (YYYY-MM-DD local). */
  _setDueInputDefault() {
    const dueEl = document.getElementById("reminder-due-input");
    if (dueEl) dueEl.value = this._todayISO();
  },

  _prioClass(p) {
    const n = this._normalizePriority(p);
    if (n === REMINDER_PRIORITY.URGENT) return "reminder-prio-urgent";
    if (n === REMINDER_PRIORITY.ATTENTION) return "reminder-prio-attention";
    return "reminder-prio-when";
  },

  _addFromForm() {
    if (typeof Auth !== "undefined" && !Auth.guardReminders()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("remPanel", "edit")) return;
    if (!this._currentUserId()) return;
    const input = document.getElementById("reminder-text-input");
    const dueEl = document.getElementById("reminder-due-input");
    const priEl = document.getElementById("reminder-priority-input");
    const text = (input && input.value ? input.value : "").trim();
    if (!text) return;
    const dueRaw = dueEl && dueEl.value ? dueEl.value.trim() : "";
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : "";
    const priority = this._normalizePriority(priEl && priEl.value ? priEl.value : REMINDER_PRIORITY.WHEN);
    const now = new Date().toISOString();
    const uid = this._currentUserId();
    const row = {
      id: Utils.generateId(),
      text,
      done: false,
      priority,
      createdAt: now,
      dueDate: dueDate || undefined,
      createdByUserId: uid || undefined
    };
    if (priority === REMINDER_PRIORITY.ATTENTION) {
      row.becameAttentionAt = now;
    }
    this.items.push(row);
    if (input) input.value = "";
    this._setDueInputDefault();
    if (priEl) priEl.value = REMINDER_PRIORITY.WHEN;
    this._save();
    this.refreshAll();
  },

  setPriority(id, value) {
    if (typeof Auth !== "undefined" && !Auth.guardReminders()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("remPanel", "edit")) return;
    const it = this.items.find(x => String(x.id) === String(id));
    if (!it || !this._ownsReminder(it)) return;
    const prev = this._normalizePriority(it.priority);
    const next = this._normalizePriority(value);
    it.priority = next;
    if (next === REMINDER_PRIORITY.ATTENTION && prev !== REMINDER_PRIORITY.ATTENTION) {
      it.becameAttentionAt = new Date().toISOString();
    }
    if (next === REMINDER_PRIORITY.WHEN) {
      it.becameAttentionAt = null;
    }
    this._save();
    this.refreshAll();
  },

  toggle(id) {
    if (typeof Auth !== "undefined" && !Auth.guardReminders()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("remPanel", "edit")) return;
    const it = this.items.find(x => String(x.id) === String(id));
    if (!it || !this._ownsReminder(it)) return;
    it.done = !it.done;
    if (it.done) {
      it.completedAt = new Date().toISOString();
    } else {
      it.completedAt = null;
    }
    this._save();
    this.refreshAll();
  },

  remove(id) {
    if (typeof Auth !== "undefined" && !Auth.guardReminders()) return;
    if (typeof Auth !== "undefined" && !Auth.guardFineAction("remPanel", "edit")) return;
    const it = this.items.find(x => String(x.id) === String(id));
    if (!it || !this._ownsReminder(it)) return;
    this._expandedIds.delete(String(id));
    this.items = this.items.filter(x => String(x.id) !== String(id));
    this._save();
    this.refreshAll();
  },

  _bind() {
    document.getElementById("reminder-add-btn")?.addEventListener("click", () => this._addFromForm());
    const input = document.getElementById("reminder-text-input");
    input?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._addFromForm();
      }
    });

    document.getElementById("dashboard-open-reminders-btn")?.addEventListener("click", () => {
      if (typeof Auth !== "undefined" && !Auth.hasReminders()) return;
      if (typeof App !== "undefined" && App.switchTab) App.switchTab("reminders");
    });

    const list = document.getElementById("reminders-list");
    list?.addEventListener("change", e => {
      const sel = e.target.closest("select[data-reminder-priority]");
      if (sel) {
        this.setPriority(sel.getAttribute("data-reminder-priority"), sel.value);
        return;
      }
      const cb = e.target.closest('input[type="checkbox"][data-reminder-id]');
      if (!cb) return;
      this.toggle(cb.getAttribute("data-reminder-id"));
    });
    list?.addEventListener("click", e => {
      if (e.target.closest("[data-reminder-delete]")) {
        const btn = e.target.closest("[data-reminder-delete]");
        const id = btn.getAttribute("data-reminder-delete");
        if (typeof App !== "undefined" && App.showConfirm) {
          App.showConfirm(I18n.t("reminders.confirmDelete"), () => this.remove(id));
        } else if (window.confirm(I18n.t("reminders.confirmDelete"))) {
          this.remove(id);
        }
        return;
      }
      const expandHit = e.target.closest("[data-reminder-expand]");
      if (expandHit) {
        e.preventDefault();
        this._toggleReminderExpanded(expandHit.getAttribute("data-reminder-expand"));
        return;
      }
    });
    list?.addEventListener("keydown", e => {
      const hit = e.target.closest("[data-reminder-expand]");
      if (!hit || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      this._toggleReminderExpanded(hit.getAttribute("data-reminder-expand"));
    });

    const dashList = document.getElementById("dashboard-reminders-summary");
    dashList?.addEventListener("click", e => {
      const row = e.target.closest("[data-reminder-goto]");
      if (!row || typeof App === "undefined" || !App.switchTab) return;
      if (typeof Auth !== "undefined" && !Auth.hasReminders()) return;
      const id = row.getAttribute("data-reminder-goto");
      if (id) this._setReminderExpanded(id, true);
      App.switchTab("reminders");
    });
  },

  _makePrioritySelect(selectedId, itemId) {
    const sel = document.createElement("select");
    sel.className = "filter-select reminder-priority-inline";
    sel.setAttribute("data-reminder-priority", String(itemId));
    sel.setAttribute("data-auth-act", "remPanel");
    sel.setAttribute("data-auth-act-level", "edit");
    [REMINDER_PRIORITY.WHEN, REMINDER_PRIORITY.ATTENTION, REMINDER_PRIORITY.URGENT].forEach(key => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = I18n.t("reminders.priority." + key);
      if (key === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  },

  _appendMeta(container, item) {
    const meta = document.createElement("div");
    meta.className = "reminder-item-meta";
    const parts = [];
    try {
      parts.push(`${I18n.t("reminders.createdLabel")}: ${Utils.formatDate(item.createdAt)}`);
    } catch (e) {
      parts.push(`${I18n.t("reminders.createdLabel")}: —`);
    }
    if (item.done && item.completedAt) {
      try {
        parts.push(`${I18n.t("reminders.completedLabel")}: ${Utils.formatDateTime(item.completedAt)}`);
      } catch (e) {
        parts.push(`${I18n.t("reminders.completedLabel")}: —`);
      }
    }
    meta.textContent = parts.join(" · ");
    container.appendChild(meta);
  },

  render() {
    const list = document.getElementById("reminders-list");
    if (!list) return;

    list.innerHTML = "";
    const sorted = this._sortedForEditor();
    const today = this._todayISO();

    if (!sorted.length) {
      const li = document.createElement("li");
      li.className = "reminder-empty";
      li.textContent = I18n.t("reminders.empty");
      list.appendChild(li);
      return;
    }

    sorted.forEach(item => {
      const sid = String(item.id);
      const expanded = this._isReminderExpanded(sid);
      const due = item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : "";
      const overdue = !item.done && due && due < today;

      const li = document.createElement("li");
      li.className = "reminder-item " + this._prioClass(item.priority);
      li.setAttribute("data-reminder-id", sid);
      if (item.done) li.classList.add("reminder-item--done");
      if (expanded) li.classList.add("reminder-item--expanded");
      else li.classList.add("reminder-item--collapsed");
      if (overdue) li.classList.add("reminder-item--overdue");

      const summaryRow = document.createElement("div");
      summaryRow.className = "reminder-summary-row";

      const lab = document.createElement("label");
      lab.className = "reminder-check-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.done;
      cb.setAttribute("data-reminder-id", sid);
      cb.setAttribute("data-auth-act", "remPanel");
      cb.setAttribute("data-auth-act-level", "edit");
      lab.appendChild(cb);

      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "reminder-summary-hit";
      hit.setAttribute("data-auth-act", "remPanel");
      hit.setAttribute("data-auth-act-level", "view");
      hit.setAttribute("data-reminder-expand", sid);
      hit.setAttribute("aria-expanded", expanded ? "true" : "false");
      hit.setAttribute(
        "aria-label",
        expanded ? I18n.t("reminders.collapseRow") : I18n.t("reminders.expandRow")
      );

      const pill = document.createElement("span");
      pill.className = "reminder-prio-pill " + this._prioClass(item.priority);
      pill.textContent = I18n.t("reminders.priorityShort." + this._normalizePriority(item.priority));

      const preview = document.createElement("span");
      preview.className = "reminder-preview-text";
      preview.textContent = item.text || "";

      const chev = document.createElement("span");
      chev.className = "reminder-chevron";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = expanded ? "▼" : "▶";

      hit.appendChild(pill);
      hit.appendChild(preview);
      hit.appendChild(chev);

      summaryRow.appendChild(lab);
      summaryRow.appendChild(hit);
      li.appendChild(summaryRow);

      const panel = document.createElement("div");
      panel.className = "reminder-expanded-panel";
      panel.hidden = !expanded;

      const detailRow = document.createElement("div");
      detailRow.className = "reminder-item-row reminder-item-row--detail";

      detailRow.appendChild(this._makePrioritySelect(this._normalizePriority(item.priority), item.id));

      const textFull = document.createElement("div");
      textFull.className = "reminder-item-text-full";
      textFull.textContent = item.text || "";

      detailRow.appendChild(textFull);

      if (due) {
        const dueSpan = document.createElement("span");
        dueSpan.className = "reminder-due";
        try {
          dueSpan.textContent = Utils.formatDate(due + "T12:00:00");
        } catch (e) {
          dueSpan.textContent = due;
        }
        if (overdue) {
          dueSpan.appendChild(document.createTextNode(" · "));
          const ov = document.createElement("strong");
          ov.className = "reminder-overdue-tag";
          ov.textContent = I18n.t("reminders.overdue");
          dueSpan.appendChild(ov);
        }
        detailRow.appendChild(dueSpan);
      }

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-sm btn-secondary reminder-delete";
      del.setAttribute("data-reminder-delete", sid);
      del.setAttribute("data-auth-act", "remPanel");
      del.setAttribute("data-auth-act-level", "edit");
      del.setAttribute("title", I18n.t("reminders.deleteTitle"));
      del.setAttribute("aria-label", I18n.t("reminders.deleteTitle"));
      del.textContent = "×";
      detailRow.appendChild(del);

      panel.appendChild(detailRow);
      this._appendMeta(panel, item);
      li.appendChild(panel);

      list.appendChild(li);
    });
    if (typeof Auth !== "undefined" && Auth.syncConfigActionDomState) Auth.syncConfigActionDomState();
  },

  renderDashboardPreview() {
    const ul = document.getElementById("dashboard-reminders-summary");
    const emptyEl = document.getElementById("dashboard-reminders-preview-empty");
    if (!ul) return;

    ul.innerHTML = "";
    const pending = this._sortedPendingForDashboard();
    const today = this._todayISO();

    if (!pending.length) {
      if (emptyEl) emptyEl.style.display = "";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    pending.forEach(item => {
      const li = document.createElement("li");
      li.className = "dashboard-reminder-summary-item " + this._prioClass(item.priority);
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.setAttribute("data-reminder-goto", String(item.id));
      const due = item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : "";
      const overdue = due && due < today;

      const label = document.createElement("span");
      label.className = "dashboard-reminder-summary-label";
      label.textContent = I18n.t("reminders.priority." + this._normalizePriority(item.priority));

      const text = document.createElement("span");
      text.className = "dashboard-reminder-summary-text";
      text.textContent = item.text || "";

      li.appendChild(label);
      li.appendChild(text);

      if (due) {
        const d = document.createElement("span");
        d.className = "dashboard-reminder-summary-due" + (overdue ? " is-overdue" : "");
        try {
          d.textContent = Utils.formatDate(due + "T12:00:00");
        } catch (e) {
          d.textContent = due;
        }
        li.appendChild(d);
      }

      li.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (typeof Auth !== "undefined" && !Auth.hasReminders()) return;
          if (typeof App !== "undefined" && App.switchTab) {
            this._setReminderExpanded(li.getAttribute("data-reminder-goto"), true);
            App.switchTab("reminders");
          }
        }
      });

      ul.appendChild(li);
    });
  },

  refreshAll() {
    this._migrateLegacyCreatorsOnce();
    this._processItems();
    this.render();
    this.renderDashboardPreview();
  }
};
