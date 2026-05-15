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
  showFileProtocolStorageNoticeIfNeeded() {
    try {
      if (window.location.protocol !== "file:") return;
      if (sessionStorage.getItem("phoenix-file-protocol-storage-toast")) return;
      sessionStorage.setItem("phoenix-file-protocol-storage-toast", "1");
      if (typeof Utils !== "undefined" && Utils.showToast && typeof I18n !== "undefined") {
        Utils.showToast(I18n.t("app.fileProtocolStorageHint"), "warning", 14000);
      }
    } catch (e) {
      /* ignore */
    }
  },

  initApplication() {
    if (this._appReady) return;
    this._appReady = true;
    try {
      this.showFileProtocolStorageNoticeIfNeeded();
      this.applyWindowTitle();
      if (typeof EmployeeManager !== "undefined") EmployeeManager.init();
      if (typeof SupplierManager !== "undefined") SupplierManager.init();
      if (typeof ConsumableManager !== "undefined") ConsumableManager.init();
      if (typeof MeasureUnitsManager !== "undefined") MeasureUnitsManager.init();
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
      this.refreshActiveTabTableExportButton();
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

  _allowedMainTabs: new Set(["dashboard", "reminders", "inventory", "movements", "history", "transport", "orderlines", "receptions"]),
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

  /** Primera tabla principal visible en la pestaña activa (exportación rápida). */
  pickPrimaryExportTable(panel) {
    if (!panel) return null;
    const pid = panel.id || "";
    if (pid === "inventory-tab") {
      return panel.querySelector("table.inventory-table--main") || panel.querySelector("table.inventory-table") || null;
    }
    if (pid === "history-tab") {
      return panel.querySelector("table.history-details-table") || panel.querySelector("table.inventory-table") || null;
    }
    if (pid === "orderlines-tab") {
      return panel.querySelector("table.orderlines-table") || panel.querySelector("table.data-table") || null;
    }
    if (pid === "movements-tab") {
      return (
        panel.querySelector("table.selected-items-table") ||
        panel.querySelector("table.mov-tf-stock-table") ||
        panel.querySelector("table.inventory-table") ||
        null
      );
    }
    if (pid === "transport-tab") {
      return panel.querySelector("table.inventory-table") || panel.querySelector("table.data-table") || panel.querySelector("table") || null;
    }
    if (pid === "receptions-tab") {
      const wrap = panel.querySelector("#receptions-config-table");
      if (wrap) return wrap.querySelector("table");
      return panel.querySelector("table");
    }
    return (
      panel.querySelector("table.inventory-table, table.data-table, table.history-details-table") ||
      panel.querySelector("table")
    );
  },

  async exportActiveMainTabContent() {
    try {
      const panel = document.querySelector(".tab-content.active");
      if (!panel || typeof Utils === "undefined") return;
      const slug = (panel.id || "").replace(/-tab$/, "");
      if (slug === "dashboard" || slug === "reminders") {
        Utils.showToast(I18n.t("ui.exportActiveTabNoTable"), "info");
        return;
      }
      if (slug === "history") {
        const tbl = panel.querySelector("table.history-details-table");
        if (tbl && tbl.querySelector("tbody tr")) {
          const pickTitle =
            typeof I18n !== "undefined" && I18n.t ? I18n.t("ui.exportActiveTabTitle") : "Export";
          const res = await Utils.exportDomTableToStyledDownloadPickColumns(
            tbl,
            `GNEEX_Historial_${new Date().toISOString().slice(0, 10)}`,
            pickTitle
          );
          if (res === "ok") {
            Utils.showToast(I18n.t("ui.exportDone"), "success");
            return;
          }
          if (res === "fail") Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
          return;
        }
        if (typeof HistoryManager !== "undefined" && HistoryManager.exportFilteredMovementsSpreadsheet) {
          await HistoryManager.exportFilteredMovementsSpreadsheet();
        }
        return;
      }
      if (slug === "receptions") {
        if (
          typeof ConfigManager !== "undefined" &&
          ConfigManager.getFilteredReceptions &&
          ConfigManager._buildReceptionsPrintExportHeaders &&
          typeof Utils.exportReceptionsXlsx === "function"
        ) {
          const filtered = ConfigManager.getFilteredReceptions();
          const q = (document.getElementById("receptions-adv-search")?.value || "").trim();
          void (async () => {
            const headers = ConfigManager._buildReceptionsPrintExportHeaders();
            const selectedHeaders = await Utils.pickColumns(headers, I18n.t("config.exportReceptionsFiltered"));
            if (!selectedHeaders || !selectedHeaders.length) return;
            void Utils.exportReceptionsXlsx(filtered, {
              scopeLabel: q || I18n.t("history.filterAll"),
              selectedHeaders
            });
          })();
          return;
        }
      }
      const tbl = this.pickPrimaryExportTable(panel);
      if (!tbl || !tbl.querySelector("tr")) {
        Utils.showToast(I18n.t("ui.exportActiveTabNoTable"), "info");
        return;
      }
      const pickTitle =
        typeof I18n !== "undefined" && I18n.t ? I18n.t("ui.exportActiveTabTitle") : "Export";
      const res = await Utils.exportDomTableToStyledDownloadPickColumns(
        tbl,
        `GNEEX_${slug}_${new Date().toISOString().slice(0, 10)}`,
        pickTitle
      );
      if (res === "ok") Utils.showToast(I18n.t("ui.exportDone"), "success");
      else if (res === "fail") Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
    } catch (e) {
      console.warn("exportActiveMainTabContent", e);
    }
  },

  printActiveMainTabContent() {
    try {
      const panel = document.querySelector(".tab-content.active");
      if (!panel || typeof Utils === "undefined") return;
      const slug = (panel.id || "").replace(/-tab$/, "");
      if (slug === "dashboard" || slug === "reminders") {
        Utils.showToast(I18n.t("ui.printActiveTabNoTable"), "info");
        return;
      }
      if (slug === "history") {
        if (typeof HistoryManager !== "undefined" && HistoryManager.printFilteredHistoryList) {
          void HistoryManager.printFilteredHistoryList();
          return;
        }
      }
      if (slug === "orderlines") {
        if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.printFilteredTable) {
          void OrderLinesManager.printFilteredTable();
          return;
        }
      }
      if (slug === "receptions") {
        if (
          typeof ConfigManager !== "undefined" &&
          ConfigManager.getFilteredReceptions &&
          ConfigManager.printReceptionsFiltered
        ) {
          const filtered = ConfigManager.getFilteredReceptions();
          const q = (document.getElementById("receptions-adv-search")?.value || "").trim();
          void ConfigManager.printReceptionsFiltered(filtered, q || I18n.t("history.filterAll"));
          return;
        }
      }
      const tbl = this.pickPrimaryExportTable(panel);
      if (!tbl || !tbl.querySelector("tr")) {
        Utils.showToast(I18n.t("ui.printActiveTabNoTable"), "info");
        return;
      }
      const clone = tbl.cloneNode(true);
      Utils.printHtmlDocument(I18n.t("ui.printActiveTabTitle"), "", clone.outerHTML);
    } catch (e) {
      console.warn("printActiveMainTabContent", e);
    }
  },

  refreshActiveTabTableExportButton() {
    const btn = document.getElementById("header-export-active-table-btn");
    const pbtn = document.getElementById("header-print-active-table-btn");
    if (!btn && !pbtn) return;
    const panel = document.querySelector(".tab-content.active");
    if (!panel) {
      if (btn) btn.hidden = true;
      if (pbtn) pbtn.hidden = true;
      return;
    }
    const slug = (panel.id || "").replace(/-tab$/, "");
    if (slug === "dashboard" || slug === "reminders") {
      if (btn) btn.hidden = true;
      if (pbtn) pbtn.hidden = true;
      return;
    }
    if (slug === "history") {
      if (btn) btn.hidden = false;
      if (pbtn) pbtn.hidden = false;
      return;
    }
    const tbl = this.pickPrimaryExportTable(panel);
    const show = !!(tbl && tbl.querySelector("tr"));
    if (btn) btn.hidden = !show;
    if (pbtn) pbtn.hidden = !show;
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
          "orderlines",
          "receptions"
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
    if (tab === "receptions" && typeof ConfigManager !== "undefined" && ConfigManager.renderReceptionList) {
      ConfigManager._receptionEditId = null;
      ConfigManager.renderReceptionList();
    }
    if (tab === "reminders" && typeof RemindersManager !== "undefined" && RemindersManager.refreshAll) {
      RemindersManager.refreshAll();
    }
    this.refreshActiveTabTableExportButton();
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

  /** Devuelve el texto de Confirmar/Cancelar (p. ej. tras un diálogo Sí/No). */
  _resetConfirmModalChrome() {
    if (typeof I18n === "undefined" || !I18n.t) return;
    const tit = document.getElementById("confirm-modal-title");
    const accept = document.getElementById("confirm-accept");
    const cancel = document.getElementById("confirm-cancel");
    if (tit) tit.textContent = I18n.t("confirm.title");
    if (accept) accept.textContent = I18n.t("buttons.confirm");
    if (cancel) cancel.textContent = I18n.t("buttons.cancel");
  },

  showConfirm(msg, cb) {
    const m = document.getElementById("confirm-modal");
    if (!m) return;

    this.confirmCallback = cb;
    this._resetConfirmModalChrome();
    const t = document.getElementById("confirm-message");
    if (t) t.textContent = msg;
    this._bringModalToFront(m);
    m.classList.add("active");
  },

  /**
   * Igual que showConfirm pero devuelve Promise: true botón derecho («Confirmar» o «Sí»), false en cancelar/cerrar.
   * @param {string} msg
   * @param {{ yesNo?: boolean }} [options] Si `yesNo`, botones **Sí** / **No** (preguntas cerradas).
   */
  showConfirmAsync(msg, options) {
    const opts = options && typeof options === "object" ? options : null;
    return new Promise(resolve => {
      this.confirmPromiseResolve = resolve;
      const m = document.getElementById("confirm-modal");
      const t = document.getElementById("confirm-message");
      if (!m) {
        this.confirmPromiseResolve = null;
        resolve(false);
        return;
      }
      this._resetConfirmModalChrome();
      if (opts && opts.yesNo && typeof I18n !== "undefined" && I18n.t) {
        const accept = document.getElementById("confirm-accept");
        const cancel = document.getElementById("confirm-cancel");
        const tit = document.getElementById("confirm-modal-title");
        if (accept) accept.textContent = I18n.t("buttons.yes");
        if (cancel) cancel.textContent = I18n.t("buttons.no");
        if (tit) tit.textContent = I18n.t("confirm.titleYesNo");
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
    this._resetConfirmModalChrome();
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
    document.getElementById("header-export-active-table-btn")?.addEventListener("click", () => {
      void this.exportActiveMainTabContent();
    });
    document.getElementById("header-print-active-table-btn")?.addEventListener("click", () => {
      this.printActiveMainTabContent();
    });

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
          this._resetConfirmModalChrome();
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

    // G-NEEX: no cerrar modales al clic en el fondo del overlay (solo botones explícitos).
    // Antes se usaba `data-close-on-backdrop`; se eliminó por política de producto (evita cierres accidentales).

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

    this._setupGlobalTableCellHoverTitles();
    this._setupGlobalCodeHoldCopy();
  },

  /**
   * Añade title automático en celdas truncadas para mostrar texto completo en hover.
   */
  _setupGlobalTableCellHoverTitles() {
    if (this._globalTableTitleBound) return;
    this._globalTableTitleBound = true;
    const cellSel =
      ".inventory-table td, .inventory-table th, .data-table td, .data-table th, " +
      ".selected-items-table td, .selected-items-table th, .history-details-table td, .history-details-table th";
    const hasInteractive = el => !!el.querySelector("button, a, input, select, textarea, [contenteditable='true']");
    const setTitleIfNeeded = cell => {
      if (!cell || hasInteractive(cell)) return;
      if (cell.hasAttribute("data-title-lock")) return;
      const txt = String(cell.getAttribute("data-copy-text") || cell.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt) return;
      const overflowed = cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1;
      if (!overflowed && txt.length < 48) return;
      cell.title = txt;
      cell.setAttribute("data-title-lock", "1");
    };
    document.addEventListener(
      "pointerover",
      e => {
        const cell = e.target?.closest?.(cellSel);
        if (!cell) return;
        setTitleIfNeeded(cell);
      },
      true
    );
  },

  /**
   * Mantener pulsado ~1,2 s: copia texto al portapapeles en toda la app.
   */
  _setupGlobalCodeHoldCopy() {
    if (this._globalCodeHoldBound) return;
    this._globalCodeHoldBound = true;
    const HOLD_MS = 1200;
    const MOVE_CANCEL_PX = 8;
    let timer = null;
    let longPressTriggered = false;
    let startPoint = null;
    const nonCopyRootSel = "button, a, input, select, textarea, option, label[for], [contenteditable='true']";
    const textNodeSel =
      "[data-copy-text], td, th, code, strong, span, p, li, small, em, b, i, h1, h2, h3, h4, h5, h6, div";
    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      longPressTriggered = false;
      startPoint = null;
    };
    const isScrollbarHit = (evt, src) => {
      let node = src && src.nodeType === 1 ? src : src?.parentElement;
      while (node && node !== document.body) {
        const hasVert = node.scrollHeight > node.clientHeight;
        const hasHorz = node.scrollWidth > node.clientWidth;
        if (hasVert || hasHorz) {
          const rect = node.getBoundingClientRect();
          const sbW = Math.max(0, (node.offsetWidth || 0) - (node.clientWidth || 0));
          const sbH = Math.max(0, (node.offsetHeight || 0) - (node.clientHeight || 0));
          const inX = evt.clientX >= rect.left && evt.clientX <= rect.right;
          const inY = evt.clientY >= rect.top && evt.clientY <= rect.bottom;
          if (hasVert && sbW > 0 && inY && evt.clientX >= rect.right - sbW) return true;
          if (hasHorz && sbH > 0 && inX && evt.clientY >= rect.bottom - sbH) return true;
        }
        node = node.parentElement;
      }
      return false;
    };
    const normalizeText = raw => String(raw || "").replace(/\s+/g, " ").trim();
    const resolveTextTarget = src => {
      const explicit = src.closest?.("[data-copy-text]");
      if (explicit) {
        const val = normalizeText(explicit.getAttribute("data-copy-text"));
        if (val) return val;
      }
      const node = src.closest?.(textNodeSel);
      if (!node || node.closest(nonCopyRootSel)) return "";
      const directText = normalizeText(node.textContent);
      if (directText && directText.length <= 280) return directText;
      const targetText = normalizeText(src.textContent);
      if (targetText && targetText.length <= 280) return targetText;
      return directText.slice(0, 280).trim();
    };
    document.addEventListener(
      "pointerdown",
      e => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.(nonCopyRootSel)) return;
        if (isScrollbarHit(e, e.target)) return;
        const text = resolveTextTarget(e.target);
        if (!text) return;
        cancel();
        startPoint = { x: e.clientX, y: e.clientY };
        timer = setTimeout(async () => {
          timer = null;
          longPressTriggered = true;
          const ok =
            typeof Utils !== "undefined" && Utils.copyTextToClipboard
              ? await Utils.copyTextToClipboard(text)
              : false;
          const okMsg = typeof I18n !== "undefined" && I18n.t ? I18n.t("ui.textCopied") : "Texto copiado";
          const failMsg =
            typeof I18n !== "undefined" && I18n.t ? I18n.t("ui.copyFailed") : "No se pudo copiar";
          if (typeof Utils !== "undefined" && Utils.showToast) {
            Utils.showToast(ok ? okMsg : failMsg, ok ? "success" : "warning");
          }
        }, HOLD_MS);
      },
      true
    );
    document.addEventListener(
      "pointermove",
      e => {
        if (!timer || !startPoint) return;
        const dx = Math.abs((e.clientX || 0) - startPoint.x);
        const dy = Math.abs((e.clientY || 0) - startPoint.y);
        if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) cancel();
      },
      true
    );
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener(
      "click",
      e => {
        if (!longPressTriggered) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") cancel();
    }, true);
  }
};

// =========================================================
// Iniciar aplicación cuando el DOM esté listo
// =========================================================
document.addEventListener("DOMContentLoaded", () => App.init());
