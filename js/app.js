// app.js — núcleo de inicialización G-NEEX

const App = {
  confirmCallback: null,
  /** Resuelve `showConfirmAsync` (solo uno activo). */
  confirmPromiseResolve: null,
  promptResolve: null,
  _appReady: false,
  _draftFloatZSeed: 1090,
  _modalStackObserverBound: false,

  /** Título de ventana fijo (evita que el navegador muestre la ruta del archivo como título). */
  applyWindowTitle() {
    try {
      const raw = typeof I18n !== "undefined" && I18n.t ? I18n.t("app.windowTitle") : "";
      const t = String(raw || "").trim();
      document.title = t && !t.startsWith("app.") ? t : "G-neex";
    } catch (e) {
      document.title = "G-neex";
    }
  },

  // =========================================================
  // Pre-auth init: i18n + theme + auth gate
  // =========================================================
  init() {
    try {
      I18n.init();
      this.applyWindowTitle();
      this.initTheme();
      this.initTestMode();
      document.getElementById("test-mode-toggle")?.addEventListener("change", e => {
        this.applyTestModeToggle(e.target.checked);
      });
      this.bindHelpModal();
      Auth.init();
    } catch (err) {
      console.error("❌ Error al iniciar la app:", err);
    }
  },

  bindHelpModal() {
    if (typeof HelpCoach !== "undefined" && HelpCoach.init) HelpCoach.init();

    const navSel = document.getElementById("nav-open-target");
    if (navSel) {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.NAV_OPEN_TARGET);
        if (saved === "tab" || saved === "window" || saved === "same") navSel.value = saved;
      } catch (e) {
        /* ignore */
      }
      navSel.addEventListener("change", () => {
        try {
          localStorage.setItem(STORAGE_KEYS.NAV_OPEN_TARGET, navSel.value);
        } catch (e) {
          /* ignore */
        }
      });
    }

    /* Abrir/cerrar ayuda: js/help-ui.js (#gneex-help-open, overlay #help-modal) */
  },

  // =========================================================
  // Post-auth init: modules + events (called by Auth.enterApp)
  // =========================================================
  initApplication() {
    if (this._appReady) return;
    this._appReady = true;
    try {
      this.applyWindowTitle();
      if (typeof EmployeeManager !== "undefined") EmployeeManager.init();
      if (typeof SupplierManager !== "undefined") SupplierManager.init();
      if (typeof ConsumableManager !== "undefined") ConsumableManager.init();
      MovementManager.init();
      try {
        localStorage.removeItem("phoenix-material-trace");
      } catch (e) {
        /* legacy trace store removed */
      }
      InventoryManager.init();
      HistoryManager.init();
      ReceptionsManager.init();
      if (typeof MELegacyPendingManager !== "undefined") MELegacyPendingManager.init();
      TransportManager.init();
      ConfigManager.init();
      ReportExporter.init();
      if (typeof OrderLinesManager !== "undefined") OrderLinesManager.init();
      if (typeof RemindersManager !== "undefined") RemindersManager.init();
      if (typeof Dashboard !== "undefined") Dashboard.init();
      if (typeof FloatFabDrag !== "undefined" && FloatFabDrag.init) FloatFabDrag.init();
      if (typeof Auth !== "undefined" && Auth.loadUsers) Auth.loadUsers();
      Utils.syncEntityIdCounter();
      this.setupGlobalEvents();
      this._setupModalStackObserver();
      this.setupDraftFloatStacking();
      if (typeof LayoutTools !== "undefined" && LayoutTools.init) LayoutTools.init();
      this.applyTabFromHash();
      window.addEventListener("hashchange", () => this.applyTabFromHash());
      console.log("🔥 G-NEEX iniciado correctamente");
    } catch (err) {
      console.error("❌ Error al iniciar módulos:", err);
    }
  },

  setupDraftFloatStacking() {
    const wraps = [
      { el: document.getElementById("movement-draft-float-wrap"), key: STORAGE_KEYS.FLOAT_DRAFT_MOVEMENT_POS },
      { el: document.getElementById("config-draft-float-wrap"), key: STORAGE_KEYS.FLOAT_DRAFT_CONFIG_POS }
    ].filter(x => x.el);
    if (!wraps.length) return;
    const dragPx = 10;
    const clamp = (wrap, l, t) => {
      const rect = wrap.getBoundingClientRect();
      const maxL = Math.max(0, (window.innerWidth || 0) - rect.width);
      const maxT = Math.max(0, (window.innerHeight || 0) - rect.height);
      return { l: Math.min(Math.max(0, l), maxL), t: Math.min(Math.max(0, t), maxT) };
    };
    const savePos = (key, l, t) => {
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify({ l, t }));
      } catch (e) {
        /* ignore */
      }
    };
    const applySavedPos = (wrap, key) => {
      if (!key) return false;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const p = JSON.parse(raw);
        if (!Number.isFinite(p?.l) || !Number.isFinite(p?.t)) return false;
        wrap.classList.add("draft-float-bar-wrap--custom-pos");
        const c = clamp(wrap, p.l, p.t);
        wrap.style.left = `${c.l}px`;
        wrap.style.top = `${c.t}px`;
        savePos(key, c.l, c.t);
        return true;
      } catch (e) {
        return false;
      }
    };
    const ensureCustomPosFromRect = wrap => {
      if (wrap.classList.contains("draft-float-bar-wrap--custom-pos")) return;
      const r = wrap.getBoundingClientRect();
      wrap.classList.add("draft-float-bar-wrap--custom-pos");
      wrap.style.left = `${r.left}px`;
      wrap.style.top = `${r.top}px`;
    };
    const resetToBasePos = (wrap, idx, key) => {
      wrap.classList.remove("draft-float-bar-wrap--custom-pos");
      wrap.style.left = "";
      wrap.style.top = "";
      wrap.style.setProperty("--draft-stack-offset", `${idx * 96}px`);
      if (key) {
        try {
          localStorage.removeItem(key);
        } catch (e) {
          /* ignore */
        }
      }
    };
    const bringToFront = wrap => {
      this._draftFloatZSeed += 1;
      wrap.style.zIndex = String(this._draftFloatZSeed);
      wraps.forEach(w => w.el.classList.toggle("draft-float-bar-wrap--active", w.el === wrap));
    };
    wraps.forEach((entry, idx) => {
      const wrap = entry.el;
      wrap.style.setProperty("--draft-stack-offset", `${idx * 96}px`);
      applySavedPos(wrap, entry.key);
      wrap.addEventListener("pointerdown", e => {
        bringToFront(wrap);
        const target = e.target;
        if (
          target?.closest?.("button, a, input, textarea, select, [role='button']") ||
          target?.closest?.(".draft-float-bar-actions")
        ) {
          return;
        }
        if (e.button !== 0) return;
        ensureCustomPosFromRect(wrap);
        const startL = parseFloat(wrap.style.left);
        const startT = parseFloat(wrap.style.top);
        if (!Number.isFinite(startL) || !Number.isFinite(startT)) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const pid = e.pointerId;
        let dragging = false;
        const onMove = ev => {
          if (ev.pointerId !== pid) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!dragging) {
            if (dx * dx + dy * dy < dragPx * dragPx) return;
            dragging = true;
            wrap.classList.add("draft-float-bar-wrap--dragging");
            try {
              wrap.setPointerCapture(pid);
            } catch (err) {}
          }
          const c = clamp(wrap, startL + dx, startT + dy);
          wrap.style.left = `${c.l}px`;
          wrap.style.top = `${c.t}px`;
        };
        const onUp = ev => {
          if (ev.pointerId !== pid) return;
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
          wrap.classList.remove("draft-float-bar-wrap--dragging");
          if (dragging) {
            const l = parseFloat(wrap.style.left);
            const t = parseFloat(wrap.style.top);
            if (Number.isFinite(l) && Number.isFinite(t)) savePos(entry.key, l, t);
            try {
              wrap.releasePointerCapture(pid);
            } catch (err) {}
          }
        };
        document.addEventListener("pointermove", onMove, { passive: true });
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
      });
      wrap.addEventListener("click", () => bringToFront(wrap));
      wrap.addEventListener("dblclick", e => {
        if (e.target?.closest?.("button, a, input, textarea, select, [role='button']")) return;
        e.preventDefault();
        resetToBasePos(wrap, idx, entry.key);
        bringToFront(wrap);
      });
    });
    window.addEventListener("resize", () => {
      wraps.forEach(entry => {
        const wrap = entry.el;
        if (!wrap.classList.contains("draft-float-bar-wrap--custom-pos")) return;
        const l = parseFloat(wrap.style.left);
        const t = parseFloat(wrap.style.top);
        if (!Number.isFinite(l) || !Number.isFinite(t)) return;
        const c = clamp(wrap, l, t);
        wrap.style.left = `${c.l}px`;
        wrap.style.top = `${c.t}px`;
        savePos(entry.key, c.l, c.t);
      });
    });
    bringToFront(wraps[0].el);
  },

  _allowedMainTabs: new Set(["dashboard", "reminders", "inventory", "movements", "history", "transport", "orderlines"]),
  _allowedOpenViews: new Set([
    "config",
    "reports-movements",
    "reports-transport"
  ]),
  _navContextMenuOpenTab: null,
  _navContextMenuOpenView: null,

  parseTabFromHash() {
    try {
      const q = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      const tab = (q.get("tab") || "").trim();
      return this._allowedMainTabs.has(tab) ? tab : null;
    } catch (e) {
      return null;
    }
  },

  parseOpenViewFromHash() {
    try {
      const q = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      const view = (q.get("openView") || "").trim();
      return this._allowedOpenViews.has(view) ? view : null;
    } catch (e) {
      return null;
    }
  },

  updateHashForTab(tab, openView = null) {
    if (!tab || !this._allowedMainTabs.has(tab)) return;
    try {
      const u = new URL(window.location.href);
      const q = new URLSearchParams();
      q.set("tab", tab);
      if (openView && this._allowedOpenViews.has(openView)) q.set("openView", openView);
      u.hash = q.toString();
      history.replaceState(null, "", u.toString());
    } catch (e) {
      /* ignore */
    }
  },

  applyTabFromHash() {
    if (!this._appReady) return;
    const tab = this.parseTabFromHash();
    if (!tab) return;
    const view = this.parseOpenViewFromHash();
    this.switchTab(tab);
    if (view) {
      setTimeout(() => this._openViewInCurrent(view), 60);
    }
  },

  // =========================================================
  // Tema oscuro / claro
  // =========================================================
  initTheme() {
    const t = localStorage.getItem(STORAGE_KEYS.THEME) || "dark";
    document.documentElement.setAttribute("data-theme", t);
    this.updateThemeIcon(t);
  },

  toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const nt = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nt);
    localStorage.setItem(STORAGE_KEYS.THEME, nt);
    this.updateThemeIcon(nt);
  },

  updateThemeIcon(t) {
    const icon = document.querySelector(".theme-icon");
    if (icon) icon.textContent = t === "dark" ? "🌙" : "☀️";
  },

  // =========================================================
  // Modo prueba / demostración (tema azul + sandbox localStorage)
  // =========================================================
  _testDemoMetaKeySet() {
    return new Set([
      STORAGE_KEYS.THEME,
      STORAGE_KEYS.LANG,
      STORAGE_KEYS.TEST_MODE,
      STORAGE_KEYS.TEST_DEMO_SNAPSHOT
    ]);
  },

  _captureTestDemoSnapshot() {
    const meta = this._testDemoMetaKeySet();
    const snap = Object.create(null);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || meta.has(k)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) snap[k] = v;
    }
    localStorage.setItem(STORAGE_KEYS.TEST_DEMO_SNAPSHOT, JSON.stringify(snap));
  },

  _restoreTestDemoSnapshotAndReload() {
    const meta = this._testDemoMetaKeySet();
    const raw = localStorage.getItem(STORAGE_KEYS.TEST_DEMO_SNAPSHOT);
    if (raw) {
      let snap;
      try {
        snap = JSON.parse(raw);
      } catch (e) {
        snap = null;
      }
      if (snap && typeof snap === "object") {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && !meta.has(k)) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
        Object.keys(snap).forEach(k => {
          if (meta.has(k)) return;
          const v = snap[k];
          if (v !== undefined && v !== null) localStorage.setItem(k, String(v));
        });
      }
      localStorage.removeItem(STORAGE_KEYS.TEST_DEMO_SNAPSHOT);
    }
    localStorage.setItem(STORAGE_KEYS.TEST_MODE, "0");
    location.reload();
  },

  initTestMode() {
    let on = localStorage.getItem(STORAGE_KEYS.TEST_MODE) === "1";
    const snap = localStorage.getItem(STORAGE_KEYS.TEST_DEMO_SNAPSHOT);
    if (on && !snap) {
      on = false;
      localStorage.setItem(STORAGE_KEYS.TEST_MODE, "0");
    }
    if (!on && snap) {
      localStorage.removeItem(STORAGE_KEYS.TEST_DEMO_SNAPSHOT);
    }
    document.documentElement.setAttribute("data-test-mode", on ? "on" : "off");
    const cb = document.getElementById("test-mode-toggle");
    if (cb) cb.checked = on;
  },

  applyTestModeToggle(wantOn) {
    const cb = document.getElementById("test-mode-toggle");
    const currentlyOn = localStorage.getItem(STORAGE_KEYS.TEST_MODE) === "1";

    if (wantOn && !currentlyOn) {
      try {
        this._captureTestDemoSnapshot();
      } catch (err) {
        console.error(err);
        if (cb) cb.checked = false;
        if (typeof Utils !== "undefined") Utils.showToast(I18n.t("ui.testModeSnapshotError"), "error");
        return;
      }
      document.documentElement.setAttribute("data-test-mode", "on");
      localStorage.setItem(STORAGE_KEYS.TEST_MODE, "1");
      if (cb) cb.checked = true;
      if (typeof Utils !== "undefined") Utils.showToast(I18n.t("ui.testModeEnterToast"), "info", 10000);
      return;
    }

    if (!wantOn && currentlyOn) {
      if (cb) cb.checked = true;
      this.showConfirm(I18n.t("ui.testModeExitConfirm"), () => this._restoreTestDemoSnapshotAndReload());
      return;
    }

    if (cb) cb.checked = currentlyOn;
  },

  // =========================================================
  // Navegación entre pestañas
  // =========================================================
  switchTab(tab) {
    if (typeof Auth !== "undefined" && tab) {
      if (!Auth.matrixTabVisible(tab)) {
        const order = [
          "dashboard",
          "reminders",
          "inventory",
          "movements",
          "history",
          "transport",
          "orderlines"
        ];
        const alt = order.find(t => Auth.matrixTabVisible(t));
        tab = alt || "dashboard";
      }
    }
    this.updateHashForTab(tab);
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-content").forEach(sec => sec.classList.toggle("active", sec.id === `${tab}-tab`));

    if (
      tab !== "history" &&
      typeof HistoryManager !== "undefined" &&
      typeof HistoryManager.closeConsumoLedgerExpandedView === "function"
    ) {
      HistoryManager.closeConsumoLedgerExpandedView();
    }

    if (tab !== "transport" && typeof TransportManager !== "undefined") {
      TransportManager._expandedTransportId = null;
    }

    if (tab === "dashboard" && typeof Dashboard !== "undefined" && Dashboard.refresh) Dashboard.refresh();
    if (tab === "inventory") InventoryManager.render();
    if (tab === "movements") MovementManager.renderMovementTypes();
    if (tab === "history") HistoryManager.render();
    if (tab === "transport") TransportManager.render();
    if (tab === "orderlines" && typeof OrderLinesManager !== "undefined") OrderLinesManager.render();
    if (tab === "reminders" && typeof RemindersManager !== "undefined" && RemindersManager.refreshAll) {
      RemindersManager.refreshAll();
    }
  },

  // =========================================================
  // Confirmaciones
  // =========================================================
  /** Mueve el modal al final del body y sube z-index por encima de configuración / otros overlays. */
  _bringModalToFront(modalEl) {
    if (!modalEl || !document.body) return;
    try {
      document.body.appendChild(modalEl);
      if (typeof Utils !== "undefined" && typeof Utils.nextModalStackZIndex === "function") {
        modalEl.style.zIndex = String(Utils.nextModalStackZIndex());
      }
    } catch (e) {
      /* ignore */
    }
  },

  /**
   * Cualquier `.modal` que reciba `active` pasa al frente (p. ej. permisos encima de Configuración).
   */
  _setupModalStackObserver() {
    if (this._modalStackObserverBound) return;
    this._modalStackObserverBound = true;
    try {
      const obs = new MutationObserver(mutations => {
        for (const m of mutations) {
          if (m.type !== "attributes" || m.attributeName !== "class") continue;
          const el = m.target;
          if (!el || !el.classList || !el.classList.contains("modal")) continue;
          if (!el.classList.contains("active")) continue;
          this._bringModalToFront(el);
        }
      });
      obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    } catch (e) {
      console.warn("modal stack observer", e);
    }
  },

  showConfirm(msg, cb) {
    const m = document.getElementById("confirm-modal");
    if (!m) return;

    this.confirmCallback = cb;
    const t = document.getElementById("confirm-message");
    if (t) t.textContent = msg;
    this._bringModalToFront(m);
    m.classList.add("active");
  },

  /**
   * Igual que showConfirm pero devuelve Promise: true si Confirma, false si Cancelar / cerrar / Escape.
   */
  showConfirmAsync(msg) {
    return new Promise(resolve => {
      this.confirmPromiseResolve = resolve;
      const m = document.getElementById("confirm-modal");
      const t = document.getElementById("confirm-message");
      if (!m) {
        this.confirmPromiseResolve = null;
        resolve(false);
        return;
      }
      if (t) t.textContent = msg;
      this.confirmCallback = null;
      this._bringModalToFront(m);
      m.classList.add("active");
    });
  },

  _resolveConfirmAsync(result) {
    if (this.confirmPromiseResolve) {
      const fn = this.confirmPromiseResolve;
      this.confirmPromiseResolve = null;
      fn(!!result);
    }
  },

  hideConfirm() {
    const m = document.getElementById("confirm-modal");
    if (m) m.classList.remove("active");
    this._resolveConfirmAsync(false);
    this.confirmCallback = null;
  },

  /**
   * Sustituye window.prompt: devuelve el texto o null si cancela.
   * @param {string|{message?:string,defaultValue?:string,inputType?:'text'|'date'}} options
   */
  showPrompt(options) {
    const opts = typeof options === "string" ? { message: options } : options || {};
    const message = opts.message || "";
    const defaultValue = opts.defaultValue != null ? String(opts.defaultValue) : "";
    const inputType = opts.inputType === "date" ? "date" : "text";

    return new Promise(resolve => {
      if (this.promptResolve) {
        const prev = this.promptResolve;
        this.promptResolve = null;
        prev(null);
      }
      const modal = document.getElementById("app-prompt-modal");
      const input = document.getElementById("app-prompt-input");
      const msgEl = document.getElementById("app-prompt-message");
      if (!modal || !input || !msgEl) {
        resolve(null);
        return;
      }
      this.promptResolve = resolve;
      msgEl.textContent = message;
      input.type = inputType;
      input.value = defaultValue;
      this._bringModalToFront(modal);
      modal.classList.add("active");
      setTimeout(() => {
        input.focus();
        if (input.type === "text") input.select();
      }, 50);
    });
  },

  _completePrompt(value) {
    const fn = this.promptResolve;
    this.promptResolve = null;
    document.getElementById("app-prompt-modal")?.classList.remove("active");
    if (fn) fn(value);
  },

  cancelPrompt() {
    if (!this.promptResolve) return;
    this._completePrompt(null);
  },

  submitPrompt() {
    if (!this.promptResolve) return;
    const input = document.getElementById("app-prompt-input");
    this._completePrompt(input ? input.value : "");
  },

  // =========================================================
  // Eventos globales
  // =========================================================
  _openMainTabIn(tab, mode) {
    if (!tab) return;
    if (mode === "tab" || mode === "window") {
      try {
        const u = new URL(window.location.href);
        u.hash = `tab=${encodeURIComponent(tab)}`;
        const feats = mode === "window" ? "noopener,noreferrer,width=1200,height=800" : "noopener,noreferrer";
        window.open(u.toString(), "_blank", feats);
      } catch (e) {
        /* ignore */
      }
      return;
    }
    this.switchTab(tab);
  },

  _openViewInCurrent(view) {
    if (!view || !this._allowedOpenViews.has(view)) return;
    if (view === "config") {
      document.getElementById("config-btn")?.click();
      return;
    }
    if (view === "reports-movements") {
      if (typeof ReportExporter !== "undefined" && typeof ReportExporter.openModal === "function") {
        ReportExporter.openModal("movements_filtered");
      } else {
        document.getElementById("open-report-modal")?.click();
      }
      return;
    }
    if (view === "reports-transport") {
      if (typeof ReportExporter !== "undefined" && typeof ReportExporter.openModal === "function") {
        ReportExporter.openModal("transports");
      } else {
        document.getElementById("open-report-modal-transport")?.click();
      }
    }
  },

  _openViewIn(view, mode) {
    if (!view || !this._allowedOpenViews.has(view)) return;
    if (mode === "tab" || mode === "window") {
      try {
        const u = new URL(window.location.href);
        const q = new URLSearchParams();
        q.set("tab", this.parseTabFromHash() || "dashboard");
        q.set("openView", view);
        u.hash = q.toString();
        const feats = mode === "window" ? "noopener,noreferrer,width=1200,height=800" : "noopener,noreferrer";
        window.open(u.toString(), "_blank", feats);
      } catch (e) {
        /* ignore */
      }
      return;
    }
    this._openViewInCurrent(view);
  },

  _hideNavContextMenu() {
    const menu = document.getElementById("nav-context-menu");
    if (menu) menu.hidden = true;
    this._navContextMenuOpenTab = null;
    this._navContextMenuOpenView = null;
  },

  _showNavContextMenu(x, y, tab, view) {
    const menu = document.getElementById("nav-context-menu");
    if (!menu) return;
    this._navContextMenuOpenTab = tab || null;
    this._navContextMenuOpenView = view || null;
    menu.hidden = false;
    const pad = 8;
    const w = menu.offsetWidth || 220;
    const h = menu.offsetHeight || 120;
    const px = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - w - pad));
    const py = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - h - pad));
    menu.style.left = `${px}px`;
    menu.style.top = `${py}px`;
  },

  setupGlobalEvents() {
    // navegación principal: click izquierdo abre aquí; click derecho abre menú contextual
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (!tab) return;
        this._openMainTabIn(tab, "same");
      });
      btn.addEventListener("contextmenu", e => {
        const tab = btn.dataset.tab;
        if (!tab) return;
        e.preventDefault();
        this._showNavContextMenu(e.clientX, e.clientY, tab, null);
      });
    });
    document.querySelectorAll("[data-open-config-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-open-config-tab");
        if (!tab || typeof ConfigManager === "undefined" || !ConfigManager.openModalAtTab) return;
        ConfigManager.openModalAtTab(tab);
      });
    });

    document.querySelectorAll("[data-open-tab]").forEach(btn => {
      btn.addEventListener("contextmenu", e => {
        const tab = btn.getAttribute("data-open-tab");
        if (!tab || !this._allowedMainTabs.has(tab)) return;
        e.preventDefault();
        this._showNavContextMenu(e.clientX, e.clientY, tab, null);
      });
    });

    document.querySelectorAll("[data-open-view]").forEach(btn => {
      btn.addEventListener("contextmenu", e => {
        const view = btn.getAttribute("data-open-view");
        if (!view || !this._allowedOpenViews.has(view)) return;
        e.preventDefault();
        this._showNavContextMenu(e.clientX, e.clientY, null, view);
      });
    });

    const navCtx = document.getElementById("nav-context-menu");
    navCtx?.addEventListener("click", e => {
      const opt = e.target.closest("[data-nav-open-target]");
      if (!opt) return;
      const mode = opt.getAttribute("data-nav-open-target");
      if (this._navContextMenuOpenTab) this._openMainTabIn(this._navContextMenuOpenTab, mode);
      else if (this._navContextMenuOpenView) this._openViewIn(this._navContextMenuOpenView, mode);
      this._hideNavContextMenu();
    });

    document.addEventListener("click", e => {
      const menu = document.getElementById("nav-context-menu");
      if (!menu || menu.hidden) return;
      if (e.target && e.target.closest && e.target.closest("#nav-context-menu")) return;
      this._hideNavContextMenu();
    });

    window.addEventListener("resize", () => this._hideNavContextMenu());
    window.addEventListener("scroll", () => this._hideNavContextMenu(), true);

    // tema
    document.getElementById("theme-toggle")?.addEventListener("click", () => this.toggleTheme());

    // idioma: los selectores se enlazan en I18n.init (también #login-language-select antes de iniciar sesión)

    // modal de confirmación
    const acc = document.getElementById("confirm-accept");
    const canc = document.getElementById("confirm-cancel");
    const close = document.getElementById("close-confirm");

    if (acc)
      acc.addEventListener("click", () => {
        if (this.confirmPromiseResolve) {
          const fn = this.confirmPromiseResolve;
          this.confirmPromiseResolve = null;
          fn(true);
          const m = document.getElementById("confirm-modal");
          if (m) m.classList.remove("active");
          this.confirmCallback = null;
        } else {
          if (this.confirmCallback) this.confirmCallback();
          this.hideConfirm();
        }
      });
    if (canc) canc.addEventListener("click", () => this.hideConfirm());
    if (close) close.addEventListener("click", () => this.hideConfirm());

    const pOk = document.getElementById("app-prompt-ok");
    const pCan = document.getElementById("app-prompt-cancel");
    const pClose = document.getElementById("app-prompt-close");
    const pInput = document.getElementById("app-prompt-input");
    if (pOk) pOk.addEventListener("click", () => this.submitPrompt());
    if (pCan) pCan.addEventListener("click", () => this.cancelPrompt());
    if (pClose) pClose.addEventListener("click", () => this.cancelPrompt());
    if (pInput)
      pInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submitPrompt();
        }
      });

    // cerrar modales clic fuera (confirmación / prompt resuelven estado)
    document.querySelectorAll(".modal").forEach(m =>
      m.addEventListener("click", e => {
        if (e.target !== m) return;
        if (m.id === "confirm-modal") this.hideConfirm();
        else if (m.id === "app-prompt-modal") this.cancelPrompt();
        else m.classList.remove("active");
      })
    );

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (typeof HelpCoach !== "undefined" && HelpCoach.active) return;
      this.hideConfirm();
      this.cancelPrompt();
      if (typeof window.gneexCloseHelp === "function") window.gneexCloseHelp();
      this._hideNavContextMenu();
      document.querySelectorAll(".modal.active").forEach(m => {
        if (m.id === "movement-form-window") return;
        m.classList.remove("active");
      });
    });

    if (!this._numberWheelGuardBound) {
      this._numberWheelGuardBound = true;
      document.addEventListener(
        "wheel",
        e => {
          const tgt = e.target;
          const isNumberInput =
            tgt &&
            tgt.closest &&
            tgt.closest('input[type="number"]:not([disabled]):not([readonly])');
          const active = document.activeElement;
          const isActiveNumber =
            active &&
            active.matches &&
            active.matches('input[type="number"]:not([disabled]):not([readonly])');
          if (!isNumberInput && !isActiveNumber) return;
          e.preventDefault();
        },
        { passive: false, capture: true }
      );
    }

    this._setupGlobalCodeHoldCopy();
  },

  /**
   * Mantener pulsado ~1,2 s: copia código o descripción al portapapeles.
   * Código: `td.inv-code-cell`, `td.app-code-copy-cell`, `td[data-app-code-copy]`.
   * Descripción: `td.inv-desc-cell`, `td.app-desc-copy-cell`, `td[data-app-desc-copy]`.
   * Pedidos: `td.orderline-col-article` — pulsación sobre `strong` = código; sobre `.orderline-desc` = descripción.
   */
  _setupGlobalCodeHoldCopy() {
    if (this._globalCodeHoldBound) return;
    this._globalCodeHoldBound = true;
    const HOLD_MS = 1200;
    let timer = null;
    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener(
      "pointerdown",
      e => {
        let text = "";
        let toastOkKey = "inventory.codeCopied";

        const articleTd = e.target.closest("td.orderline-col-article");
        if (articleTd) {
          if (e.target.closest("button, a, input, select, textarea")) return;
          if (e.target.closest(".orderline-desc")) {
            const el = articleTd.querySelector(".orderline-desc");
            text = String(el?.textContent || "").trim();
            toastOkKey = "msg.descriptionCopied";
          } else if (e.target.closest("strong")) {
            const el = articleTd.querySelector("strong");
            text = String(el?.textContent || "").trim();
            toastOkKey = "inventory.codeCopied";
          } else {
            return;
          }
        } else {
          const td = e.target.closest(
            "td.inv-code-cell, td.app-code-copy-cell, td[data-app-code-copy], " +
              "td.inv-desc-cell, td.app-desc-copy-cell, td[data-app-desc-copy]"
          );
          if (!td) return;
          if (e.target.closest("button, a, input, select, textarea")) return;
          const isDesc = td.matches(".inv-desc-cell, .app-desc-copy-cell, [data-app-desc-copy]");
          const explicit = td.getAttribute("data-copy-text");
          if (explicit != null && String(explicit).trim() !== "") {
            text = String(explicit).trim();
            toastOkKey = isDesc ? "msg.descriptionCopied" : "inventory.codeCopied";
          } else if (isDesc) {
            const sub = td.querySelector(".inv-desc-text, .result-description, .detail-item-desc");
            text = String((sub && sub.textContent) || td.textContent || "").trim();
            toastOkKey = "msg.descriptionCopied";
          } else {
            const strong = td.querySelector("strong");
            text = String((strong && strong.textContent) || td.textContent || "").trim();
            toastOkKey = "inventory.codeCopied";
          }
        }

        if (!text) return;
        cancel();
        timer = setTimeout(async () => {
          timer = null;
          const ok =
            typeof Utils !== "undefined" && Utils.copyTextToClipboard
              ? await Utils.copyTextToClipboard(text)
              : false;
          const okMsg =
            typeof I18n !== "undefined" && I18n.t ? I18n.t(toastOkKey) : "Copied";
          const failMsg =
            typeof I18n !== "undefined" && I18n.t ? I18n.t("inventory.codeCopyFailed") : "Failed";
          if (typeof Utils !== "undefined" && Utils.showToast) {
            Utils.showToast(ok ? okMsg : failMsg, ok ? "success" : "warning");
          }
        }, HOLD_MS);
      },
      true
    );
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") cancel();
    }, true);
  }
};

// =========================================================
// Iniciar aplicación cuando el DOM esté listo
// =========================================================
document.addEventListener("DOMContentLoaded", () => App.init());
