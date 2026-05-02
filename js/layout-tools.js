/**
 * LayoutTools: redimensionado manual global
 * - Ventanas/modales: resize both + persistencia por ventana
 * - Columnas de tablas: arrastre en <th> + persistencia por tabla
 */
const LayoutTools = {
  _inited: false,
  _observer: null,
  _modalLayouts: null,
  _tableLayouts: null,

  init() {
    if (this._inited) return;
    this._inited = true;
    // Sin persistencia entre recargas: sólo sesión activa.
    this._modalLayouts = {};
    this._tableLayouts = {};
    this._applyAll();
    this._installObserver();
    window.addEventListener("resize", () => {
      this._applyModalSizes();
      this._initTopHorizontalScrollbars();
    });
  },

  _saveJson(key, value) {
    // Persistencia desactivada por requerimiento del usuario.
    void key;
    void value;
  },

  _applyAll() {
    this._initResizableModals();
    this._initResizableTables();
    this._initTopHorizontalScrollbars();
    this._applyModalSizes();
  },

  _installObserver() {
    if (this._observer) return;
    this._observer = new MutationObserver(() => this._applyAll());
    this._observer.observe(document.body, { childList: true, subtree: true });
  },

  _modalKeyFor(contentEl) {
    const host =
      contentEl.closest(".modal[id]") ||
      contentEl.closest(".gneex-help-overlay[id]") ||
      contentEl.closest("[id]");
    if (!host) return null;
    return host.id;
  },

  _initResizableModals() {
    const targets = document.querySelectorAll(".modal .modal-content, .gneex-help-panel");
    targets.forEach(el => {
      if (!el || el.dataset.gneexModalResizable === "1") return;
      const key = this._modalKeyFor(el);
      if (!key) return;
      if (key === "inventory-insight-modal" || key === "dashboard-alerts-modal") return;
      el.dataset.gneexModalResizable = "1";
      el.dataset.gneexModalKey = key;
      el.classList.add("gneex-resizable-modal");

      // Persistir cambios de tamaño.
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => this._persistModalSize(el));
        ro.observe(el);
      } else {
        el.addEventListener("mouseup", () => this._persistModalSize(el));
        el.addEventListener("touchend", () => this._persistModalSize(el), { passive: true });
      }
    });
  },

  _persistModalSize(el) {
    const key = el?.dataset?.gneexModalKey;
    if (!key) return;
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 220 || h < 140) return;
    this._modalLayouts[key] = { w, h };
    this._saveJson(STORAGE_KEYS.MODAL_LAYOUTS, this._modalLayouts);
  },

  _applyModalSizes() {
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    document.querySelectorAll(".modal .modal-content[data-gneex-modal-key], .gneex-help-panel[data-gneex-modal-key]").forEach(el => {
      const key = el.dataset.gneexModalKey;
      const s = key ? this._modalLayouts[key] : null;
      if (!s || !s.w || !s.h) return;
      const maxW = Math.max(320, vw - 24);
      const maxH = Math.max(220, vh - 24);
      const w = Math.min(Math.max(320, s.w), maxW);
      const h = Math.min(Math.max(220, s.h), maxH);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    });
  },

  _tableKey(table) {
    const host = table.closest("[id]");
    const hostId = host ? host.id : "table";
    const headers = Array.from(table.querySelectorAll("thead th"))
      .map(th => (th.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24))
      .join("|");
    return `${hostId}::${headers}`;
  },

  _initResizableTables() {
    const tables = document.querySelectorAll("table");
    tables.forEach(table => {
      const inFixedInsightModal =
        !!table.closest("#inventory-insight-modal") || !!table.closest("#dashboard-alerts-modal");
      if (inFixedInsightModal) return;
      const firstHeaderRow = table.querySelector("thead tr");
      if (!firstHeaderRow || table.dataset.gneexColsReady === "1") return;
      const ths = Array.from(firstHeaderRow.children).filter(n => n.tagName === "TH");
      if (ths.length < 2) return;

      table.dataset.gneexColsReady = "1";
      table.dataset.gneexTableKey = this._tableKey(table);
      table.classList.add("gneex-resizable-table");

      ths.forEach((th, idx) => {
        th.classList.add("gneex-resizable-th");
        const pos = window.getComputedStyle(th).position;
        if (!pos || pos === "static") th.classList.add("gneex-th-handle-host");
        if (idx === ths.length - 1) return; // última columna sin tirador
        const handle = document.createElement("span");
        handle.className = "gneex-col-resize-handle";
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-orientation", "vertical");
        handle.addEventListener("pointerdown", e => this._onColResizeStart(e, table, idx));
        th.appendChild(handle);
      });

      this._applySavedColumnWidths(table);
    });
  },

  _applySavedColumnWidths(table) {
    const key = table.dataset.gneexTableKey;
    const widths = key ? this._tableLayouts[key] : null;
    if (!Array.isArray(widths) || !widths.length) return;
    const ths = Array.from(table.querySelectorAll("thead tr:first-child th"));
    if (!ths.length) return;
    table.classList.add("gneex-cols-custom");
    table.style.tableLayout = "fixed";
    widths.forEach((w, i) => {
      if (!ths[i] || !Number.isFinite(w) || w < 48) return;
      ths[i].style.width = `${Math.round(w)}px`;
      ths[i].style.minWidth = `${Math.round(w)}px`;
    });
  },

  _onColResizeStart(ev, table, colIndex) {
    ev.preventDefault();
    ev.stopPropagation();
    const ths = Array.from(table.querySelectorAll("thead tr:first-child th"));
    const th = ths[colIndex];
    if (!th) return;
    const startX = ev.clientX;
    const startW = th.getBoundingClientRect().width;

    table.classList.add("gneex-cols-custom");
    table.style.tableLayout = "fixed";

    const onMove = e => {
      const dx = e.clientX - startX;
      const w = Math.max(52, Math.round(startW + dx));
      th.style.width = `${w}px`;
      th.style.minWidth = `${w}px`;
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      this._persistTableWidths(table);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  },

  _persistTableWidths(table) {
    const ths = Array.from(table.querySelectorAll("thead tr:first-child th"));
    if (!ths.length) return;
    const key = table.dataset.gneexTableKey;
    if (!key) return;
    const widths = ths.map(th => Math.round(th.getBoundingClientRect().width));
    this._tableLayouts[key] = widths;
    this._saveJson(STORAGE_KEYS.TABLE_COLUMN_LAYOUTS, this._tableLayouts);
  },

  _initTopHorizontalScrollbars() {
    const targets = document.querySelectorAll(
      ".inventory-table-container, .orderlines-table-wrap, .history-details-wrap, .consumo-ledger-table-wrap, .me-legacy-table-wrap, .transport-prepared-table-wrap"
    );
    targets.forEach(target => {
      const inFixedInsightModal =
        !!target.closest("#inventory-insight-modal") || !!target.closest("#dashboard-alerts-modal");
      if (inFixedInsightModal) return;
      if (!target || target.dataset.gneexTopScrollReady === "1") {
        if (target) this._syncTopHorizontalScrollbar(target);
        return;
      }
      target.dataset.gneexTopScrollReady = "1";

      const wrap = document.createElement("div");
      wrap.className = "gneex-top-scrollbar-wrap";
      wrap.setAttribute("aria-hidden", "true");
      const inner = document.createElement("div");
      inner.className = "gneex-top-scrollbar-inner";
      wrap.appendChild(inner);

      target.parentNode?.insertBefore(wrap, target);

      let syncing = false;
      wrap.addEventListener("scroll", () => {
        if (syncing) return;
        syncing = true;
        target.scrollLeft = wrap.scrollLeft;
        syncing = false;
      });
      target.addEventListener("scroll", () => {
        if (syncing) return;
        syncing = true;
        wrap.scrollLeft = target.scrollLeft;
        syncing = false;
      });
      target.addEventListener("mouseenter", () => this._syncTopHorizontalScrollbar(target));
      this._syncTopHorizontalScrollbar(target);
    });
  },

  _syncTopHorizontalScrollbar(target) {
    if (!target) return;
    const wrap = target.previousElementSibling;
    if (!wrap || !wrap.classList || !wrap.classList.contains("gneex-top-scrollbar-wrap")) return;
    const inner = wrap.firstElementChild;
    if (!inner) return;
    const need = (target.scrollWidth || 0) > (target.clientWidth || 0) + 1;
    wrap.style.display = need ? "block" : "none";
    inner.style.width = `${target.scrollWidth || 0}px`;
    wrap.scrollLeft = target.scrollLeft || 0;
  }
};

