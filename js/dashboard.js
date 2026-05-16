// dashboard.js — panel resumen con alertas y estadísticas del día (interactivo)

/** Días antes de la fecha de expedición en que empieza el aviso «qué falta para listo». */
const TRANSPORT_READINESS_DAYS_BEFORE = 7;

const Dashboard = {
  _collapsed: false,
  _interactivityBound: false,
  _heroCarouselBound: false,
  _heroCarouselTimer: null,

  init() {
    const toggle = document.getElementById("dashboard-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        this._collapsed = !this._collapsed;
        const body = document.getElementById("dashboard-body");
        if (body) body.style.display = this._collapsed ? "none" : "";
        toggle.textContent = I18n.t(this._collapsed ? "dashboard.expand" : "dashboard.collapse");
      });
    }
    this._setupInteractivity();
    this._setupAlertsModal();
    this._setupHeroCarousel();
    this.refresh();
  },

  _attrTitle(key) {
    const t = I18n.t(key);
    return String(t).replace(/"/g, "&quot;");
  },

  _esc(s) {
    return Utils.escapeHtml(s);
  },

  _todayISO() {
    return new Date().toISOString().slice(0, 10);
  },

  /** Fecha civil YYYY-MM-DD +/- N días (calendario local). */
  _ymdAddDays(ymd, deltaDays) {
    const s = String(ymd || "").trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    dt.setDate(dt.getDate() + deltaDays);
    return Utils.localDateKey(dt);
  },

  /**
   * Transportes activos en estado Parcial, desde N días antes de shipmentDate: detalle de líneas pendientes.
   * @returns {Array<{ t: object, gaps: Array<{ title: string, detail: string }> }>}
   */
  getTransportsReadinessGaps() {
    const TM = typeof TransportManager !== "undefined" ? TransportManager : null;
    if (!TM) return [];
    const today =
      typeof Utils !== "undefined" && Utils.localDateKey ? Utils.localDateKey() : this._todayISO();
    const out = [];
    for (const t of TM.transports || []) {
      if (t.expeditionAnnulled || t.expeditionShippedAt) continue;
      const ship = String(t.shipmentDate || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ship)) continue;
      const windowStart = this._ymdAddDays(ship, -TRANSPORT_READINESS_DAYS_BEFORE);
      if (!windowStart || today < windowStart) continue;

      (t.lines || []).forEach(l => TM.padDims(l));
      const unresolved = (t.lines || []).filter(l => !TM.isLineResolved(l));
      if (!unresolved.length) continue;

      const gaps = unresolved.map(l => {
        const title = TM.lineTitle(l);
        const detail = TM.describeLineReadinessGap(l) || I18n.t("dashboard.transportLineGapGeneric");
        return { title, detail };
      });
      out.push({ t, gaps });
    }
    return out;
  },

  /** Lista qué falta por línea para transportes en ventana (semana previa a expedición) y aún parciales. */
  updateTransportReadinessAttention() {
    const block = document.getElementById("dashboard-transport-readiness");
    const introEl = document.getElementById("dashboard-transport-readiness-intro");
    const bodyEl = document.getElementById("dashboard-transport-readiness-body");
    if (!block || !bodyEl) return;

    const rows = this.getTransportsReadinessGaps();
    if (!rows.length) {
      block.style.display = "none";
      bodyEl.innerHTML = "";
      return;
    }

    if (introEl) {
      const introRaw = I18n.t("dashboard.transportReadinessIntro");
      const introText =
        introRaw && !String(introRaw).startsWith("dashboard.transportReadinessIntro")
          ? introRaw
          : "";
      introEl.textContent = introText;
      introEl.style.display = introText ? "" : "none";
    }

    const fmtShip = ship =>
      typeof Utils !== "undefined" && Utils.formatDate
        ? Utils.formatDate(`${ship}T12:00:00`)
        : ship;

    const html = rows
      .map(({ t, gaps }) => {
        const ship = String(t.shipmentDate || "").trim();
        const truck = typeof TransportManager !== "undefined" ? TransportManager.getTransportLabel(t) : "";
        const head = I18n.t("dashboard.transportReadinessProject")
          .replace("{project}", this._esc(t.projectId || "—"))
          .replace("{truck}", this._esc(truck))
          .replace("{date}", this._esc(fmtShip(ship)));
        const lis = gaps
          .map(
            g =>
              `<li><strong>${this._esc(g.title)}</strong> — ${this._esc(g.detail)}</li>`
          )
          .join("");
        return `<div class="dashboard-readiness-card"><div class="dashboard-readiness-card-head">${head}</div><ul class="dashboard-readiness-ul">${lis}</ul></div>`;
      })
      .join("");
    bodyEl.innerHTML = html;
    block.style.display = "";
  },

  /**
   * Transportes con fecha de expedición (shipmentDate) ya pasada, sin expedir ni anulación de expedición.
   * @returns {Array<object>}
   */
  getOverdueExpeditionTransports() {
    const TM = typeof TransportManager !== "undefined" ? TransportManager : null;
    if (!TM) return [];
    const today = typeof Utils !== "undefined" && Utils.localDateKey ? Utils.localDateKey() : this._todayISO();
    return (TM.transports || []).filter(t => {
      if (t.expeditionAnnulled || t.expeditionShippedAt) return false;
      const d = String(t.shipmentDate || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
      return d < today;
    });
  },

  /** Aviso de urgencia en el panel si hay expediciones con fecha vencida. */
  updateTransportExpeditionUrgency() {
    const block = document.getElementById("dashboard-transport-expedition-urgent");
    const textEl = document.getElementById("dashboard-transport-expedition-urgent-text");
    if (!block || !textEl) return;

    const overdue = this.getOverdueExpeditionTransports();
    if (!overdue.length) {
      block.style.display = "none";
      return;
    }

    const n = overdue.length;
    const pids = overdue.map(t => (t.projectId || "").trim()).filter(Boolean);
    const show = pids.slice(0, 5);
    const more = pids.length > 5 ? pids.length - 5 : 0;
    let idsPart = show.join(", ");
    if (more > 0) {
      const extra = I18n.t("dashboard.transportExpeditionUrgentIdsMore").replace("{m}", String(more));
      idsPart = idsPart ? `${idsPart} ${extra}` : extra;
    }
    const idsLine = idsPart
      ? I18n.t("dashboard.transportExpeditionUrgentIdsLine").replace("{ids}", idsPart)
      : "";
    const body = I18n.t("dashboard.transportExpeditionUrgentText")
      .replace("{n}", String(n))
      .replace("{idsLine}", idsLine);
    textEl.textContent = body;
    block.style.display = "";
  },

  /** Stand-by y carrito consumo: avisos en el panel (requiere MovementManager). */
  updatePendingMovementAlerts() {
    const section = document.getElementById("dashboard-pending-movements");
    const rowS = document.getElementById("dashboard-pending-standby");
    const rowC = document.getElementById("dashboard-pending-consumo");
    const txtS = document.getElementById("dashboard-pending-standby-text");
    const txtC = document.getElementById("dashboard-pending-consumo-text");
    if (!section || !rowS || !rowC || !txtS || !txtC) return;

    const MM = typeof MovementManager !== "undefined" ? MovementManager : null;
    const nStandby = MM
      ? (MM.movements || []).filter(m => m.type === "STANDBY" && !m.annulled).length
      : 0;
    const nConsumo = MM && MM.consumoCart ? MM.consumoCart.length : 0;

    const showS = nStandby > 0;
    const showC = nConsumo > 0;
    section.style.display = showS || showC ? "" : "none";
    rowS.style.display = showS ? "" : "none";
    rowC.style.display = showC ? "" : "none";

    if (showS) {
      txtS.textContent = I18n.t("dashboard.pendingStandbyText").replace("{n}", String(nStandby));
    }
    if (showC) {
      txtC.textContent = I18n.t("dashboard.pendingConsumoText").replace("{n}", String(nConsumo));
    }
  },

  /**
   * Misma tabla de columnas que el modal de inventario (listado completo).
   * @param {Array} items
   */
  _renderFullInsightTable(items, opts = {}) {
    const Inv = typeof InventoryManager !== "undefined" ? InventoryManager : null;
    if (!Inv || !items.length) return "";
    const th = k => `<th>${this._esc(I18n.t(k))}</th>`;
    const fmt = v => Utils.formatDecimalDisplay(v);
    const canEditFromList = typeof Auth !== "undefined" && Auth.isAdmin();
    const canToggleLowIgnore = typeof Auth === "undefined" || Auth.hasPerm?.("editItems");
    const showLowIgnore = !!opts.showLowIgnore;
    const rows = items
      .map(it => {
        const tot = Inv.itemTotalStock(it);
        const eff =
          typeof Inv.getEffectiveExpirationDateForDisplay === "function"
            ? Inv.getEffectiveExpirationDateForDisplay(it)
            : Inv.getEffectiveExpirationDate(it);
        const ins = Inv.getExpirationInsight(it);
        const days =
          ins.has && ins.days !== null
            ? ins.days < 0
              ? I18n.t("inventory.insightExpired")
              : String(ins.days)
            : "—";
        const minS = it.minStock != null && it.minStock !== "" ? fmt(parseFloat(it.minStock) || 0) : "—";
        const maxS = it.maxStock != null && it.maxStock !== "" ? fmt(parseFloat(it.maxStock) || 0) : "—";
        const rowClass = canEditFromList ? " class=\"dashboard-insight-row dashboard-insight-row--editable\"" : "";
        const rowAttrs = canEditFromList
          ? ` data-item-id="${Utils.escapeAttr(String(it.id || ""))}" title="${Utils.escapeAttr(I18n.t("inventory.insightRowEditAdminHint"))}"`
          : "";
        const lowIgnoreCell = showLowIgnore
          ? `<td><label class="checkbox-label" style="justify-content:center;"><input type="checkbox" class="dash-low-ignore-toggle" data-item-id="${Utils.escapeAttr(
              String(it.id || "")
            )}" ${it.ignoreLowStockAlert ? "checked" : ""} ${canToggleLowIgnore ? "" : "disabled"} /><span>${this._esc(
              I18n.t("inventory.lowStockIgnoreShort")
            )}</span></label></td>`
          : "";
        return `<tr${rowClass}${rowAttrs}>
          ${lowIgnoreCell}
          <td class="app-code-copy-cell"><strong>${this._esc(it.code)}</strong></td>
          <td class="app-desc-copy-cell">${this._esc(it.description)}</td>
          <td>${this._esc(it.category || "—")}</td>
          <td>${fmt(it.mainStock ?? 0)}</td>
          <td>${fmt(tot)}</td>
          <td>${minS}</td>
          <td>${maxS}</td>
          <td>${it.expDate ? Utils.formatDate(it.expDate) : "—"}</td>
          <td>${eff ? Utils.formatDate(eff) : "—"}</td>
          <td>${this._esc(days)}</td>
          <td>${this._esc(it.location || "—")}</td>
        </tr>`;
      })
      .join("");
    return `<div class="inventory-table-container">
      <table class="inventory-table inventory-table--detail">
        <thead><tr>
          ${showLowIgnore ? th("inventory.lowStockIgnoreCol") : ""}
          ${th("table.code")}
          ${th("table.description")}
          ${th("table.category")}
          ${th("table.mainStock")}
          ${th("inventory.colTotal")}
          ${th("inventory.colMin")}
          ${th("inventory.colMax")}
          ${th("table.expDate")}
          ${th("table.expirationDate")}
          ${th("inventory.colDays")}
          ${th("table.location")}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  },

  /**
   * Modal con todas las alertas y tablas completas (mismos criterios que inventario).
   * @param {string} [scrollTo] - "low" | "negative" | "expiring" — desplazar a esa sección
   */
  openAllAlertsModal(scrollTo) {
    if (typeof Auth !== "undefined") {
      const lvl = Auth.matrixLevel("dashboardAlerts");
      if (lvl !== "edit") {
        if (lvl === "view" && typeof Utils !== "undefined" && typeof I18n !== "undefined") {
          Utils.showToast(I18n.t("auth.dashboardAlertsViewOnly"), "info");
        }
        return;
      }
    }
    const Inv = typeof InventoryManager !== "undefined" ? InventoryManager : null;
    const body = document.getElementById("dashboard-alerts-body");
    const modal = document.getElementById("dashboard-alerts-modal");
    const titleEl = document.getElementById("dashboard-alerts-title");
    if (!body || !modal) return;
    const content = modal.querySelector(".modal-content");
    if (content) {
      content.style.width = "";
      content.style.height = "";
    }

    if (titleEl) titleEl.textContent = I18n.t("dashboard.alertsModalTitle");

    if (!Inv) {
      body.innerHTML = `<p class="muted">${this._esc(I18n.t("dashboard.noAlerts"))}</p>`;
      modal.classList.add("active");
      return;
    }

    const lowList = Inv.getItemsLowStock();
    const negList = Inv.getItemsNegative();
    const expList = Inv.getItemsExpirationAlert();

    if (!lowList.length && !negList.length && !expList.length) {
      body.innerHTML = `<p class="muted">${this._esc(I18n.t("dashboard.noAlerts"))}</p>`;
      modal.classList.add("active");
      return;
    }

    const sections = [];
    if (lowList.length) {
      sections.push(
        `<section id="dash-alert-mod-low" class="dashboard-alert-section">
          <h3 class="dashboard-alert-section-h">📉 ${this._esc(I18n.t("dashboard.lowStock"))} <span class="dashboard-alert-count">(${lowList.length})</span></h3>
          <p class="dashboard-alert-desc">${this._esc(I18n.t("dashboard.alertSectionLowDesc"))}</p>
          ${this._renderFullInsightTable(lowList, { showLowIgnore: true })}
        </section>`
      );
    }
    if (negList.length) {
      sections.push(
        `<section id="dash-alert-mod-negative" class="dashboard-alert-section">
          <h3 class="dashboard-alert-section-h">🔴 ${this._esc(I18n.t("dashboard.negativeStock"))} <span class="dashboard-alert-count">(${negList.length})</span></h3>
          <p class="dashboard-alert-desc">${this._esc(I18n.t("dashboard.alertSectionNegativeDesc"))}</p>
          ${this._renderFullInsightTable(negList)}
        </section>`
      );
    }
    if (expList.length) {
      sections.push(
        `<section id="dash-alert-mod-expiring" class="dashboard-alert-section">
          <h3 class="dashboard-alert-section-h">⏰ ${this._esc(I18n.t("dashboard.expiring"))} <span class="dashboard-alert-count">(${expList.length})</span></h3>
          <p class="dashboard-alert-desc">${this._esc(I18n.t("dashboard.alertSectionExpiringDesc"))}</p>
          ${this._renderFullInsightTable(expList)}
        </section>`
      );
    }

    body.innerHTML = `<div class="dashboard-alerts-sections">${sections.join("")}</div>`;
    modal.classList.add("active");

    const map = { low: "dash-alert-mod-low", negative: "dash-alert-mod-negative", expiring: "dash-alert-mod-expiring" };
    const id = scrollTo && map[scrollTo];
    if (id) {
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  },

  _setupAlertsModal() {
    const close = document.getElementById("close-dashboard-alerts");
    const modal = document.getElementById("dashboard-alerts-modal");
    if (close && modal) {
      close.addEventListener("click", () => modal.classList.remove("active"));
    }
    if (modal) {
      modal.addEventListener("click", e => {
        const lowTg = e.target.closest(".dash-low-ignore-toggle[data-item-id]");
        if (lowTg) {
          e.stopPropagation();
          return;
        }
        const row = e.target.closest("tr.dashboard-insight-row--editable[data-item-id]");
        if (!row || typeof Auth === "undefined" || !Auth.isAdmin()) return;
        const id = row.getAttribute("data-item-id");
        if (!id || typeof ConfigManager === "undefined" || !ConfigManager.openItemEditorFromInventoryById) return;
        e.preventDefault();
        ConfigManager.openItemEditorFromInventoryById(id);
      });
      modal.addEventListener("change", e => {
        const tg = e.target.closest(".dash-low-ignore-toggle[data-item-id]");
        if (!tg) return;
        const id = tg.getAttribute("data-item-id");
        if (!id || typeof InventoryManager === "undefined") return;
        if (typeof Auth !== "undefined" && !Auth.hasPerm("editItems")) {
          tg.checked = !tg.checked;
          Utils.showToast(I18n.t("auth.noPermission"), "warning");
          return;
        }
        InventoryManager.setIgnoreLowStockDetection(id, !!tg.checked);
        this.openAllAlertsModal("low");
        if (typeof InventoryManager.render === "function") {
          InventoryManager.render(InventoryManager.search(document.getElementById("inventory-search")?.value || ""));
        }
      });
    }
  },

  /** Carrusel horizontal del hero: anchos fijos, recorte sin bleed, omite diapos vacías. */
  _setupHeroCarousel() {
    if (this._heroCarouselBound) return;
    const root = document.getElementById("dashboard-hero-carousel");
    const vp = root?.querySelector(".dashboard-carousel-viewport");
    const track = document.getElementById("dashboard-carousel-track");
    const prevBtn = document.getElementById("dashboard-carousel-prev");
    const nextBtn = document.getElementById("dashboard-carousel-next");
    if (!root || !vp || !track || !prevBtn || !nextBtn) return;

    this._heroCarouselBound = true;

    const visibleSlides = () =>
      Array.from(track.querySelectorAll(".dashboard-carousel-slide")).filter(
        s => !s.classList.contains("dashboard-carousel-slide--skip")
      );

    let slideIndex = 0;
    let scrollQuietTimer = null;

    const clearTimer = () => {
      if (this._heroCarouselTimer) {
        clearInterval(this._heroCarouselTimer);
        this._heroCarouselTimer = null;
      }
    };

    const updateNavState = () => {
      const vis = visibleSlides();
      const dis = vis.length < 2;
      prevBtn.disabled = dis;
      nextBtn.disabled = dis;
      prevBtn.setAttribute("aria-disabled", dis ? "true" : "false");
      nextBtn.setAttribute("aria-disabled", dis ? "true" : "false");
    };

    const applySlideWidths = () => {
      const w = Math.max(1, Math.floor(vp.getBoundingClientRect().width));
      const all = Array.from(track.querySelectorAll(".dashboard-carousel-slide"));
      all.forEach(sl => {
        if (sl.classList.contains("dashboard-carousel-slide--skip")) {
          sl.style.flex = "0 0 0";
          sl.style.width = "0";
          sl.style.minWidth = "0";
        } else {
          sl.style.flex = `0 0 ${w}px`;
          sl.style.width = `${w}px`;
          sl.style.minWidth = `${w}px`;
        }
      });
    };

    const scrollToVisibleIndex = (idx, smooth) => {
      const vis = visibleSlides();
      if (!vis.length) return;
      const n = vis.length;
      slideIndex = ((idx % n) + n) % n;
      vp.scrollTo({
        left: vis[slideIndex].offsetLeft,
        behavior: smooth === false ? "auto" : "smooth"
      });
    };

    const goNext = () => scrollToVisibleIndex(slideIndex + 1, true);
    const goPrev = () => scrollToVisibleIndex(slideIndex - 1, true);

    const syncIndexFromScroll = () => {
      const vis = visibleSlides();
      if (!vis.length) return;
      const mid = vp.scrollLeft + vp.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      vis.forEach((el, i) => {
        const c = el.offsetLeft + el.offsetWidth / 2;
        const d = Math.abs(mid - c);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      slideIndex = best;
    };

    const clampScrollToValidSlide = () => {
      const vis = visibleSlides();
      if (!vis.length) {
        vp.scrollTo({ left: 0, behavior: "auto" });
        return;
      }
      const prevScroll = vp.scrollLeft;
      let best = 0;
      let bestDist = Infinity;
      vis.forEach((el, i) => {
        const d = Math.abs(prevScroll - el.offsetLeft);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      slideIndex = Math.min(best, vis.length - 1);
      vp.scrollTo({ left: vis[slideIndex].offsetLeft, behavior: "auto" });
    };

    const applyLayoutAndClamp = () => {
      applySlideWidths();
      clampScrollToValidSlide();
      updateNavState();
    };

    const arm = () => {
      clearTimer();
      if (visibleSlides().length < 2) return;
      this._heroCarouselTimer = setInterval(goNext, 4000);
    };

    const fullResync = () => {
      applyLayoutAndClamp();
      arm();
    };

    this._heroCarouselApplyLayout = fullResync;

    prevBtn.addEventListener("click", () => {
      goPrev();
      arm();
    });
    nextBtn.addEventListener("click", () => {
      goNext();
      arm();
    });

    vp.addEventListener("scroll", () => {
      clearTimeout(scrollQuietTimer);
      scrollQuietTimer = setTimeout(syncIndexFromScroll, 120);
    });

    root.addEventListener("mouseenter", clearTimer);
    root.addEventListener("mouseleave", arm);

    window.addEventListener(
      "resize",
      () => {
        applyLayoutAndClamp();
        arm();
      },
      { passive: true }
    );

    fullResync();
  },

  /** Oculta diapositivas sin contenido visible y recalcula el carrusel (llamar tras actualizar el panel). */
  _syncHeroCarouselSlides() {
    const track = document.getElementById("dashboard-carousel-track");
    if (!track) return;
    const setSkip = (key, skip) => {
      const el = track.querySelector(`[data-carousel-slide="${key}"]`);
      if (el) el.classList.toggle("dashboard-carousel-slide--skip", !!skip);
    };
    const pend = document.getElementById("dashboard-pending-movements");
    setSkip("pending", !pend || window.getComputedStyle(pend).display === "none");
    const urg = document.getElementById("dashboard-transport-expedition-urgent");
    setSkip("urgent", !urg || window.getComputedStyle(urg).display === "none");
    const read = document.getElementById("dashboard-transport-readiness");
    setSkip("readiness", !read || window.getComputedStyle(read).display === "none");
    const remInner = track.querySelector('[data-carousel-slide="reminders"] .dashboard-reminders-preview');
    setSkip("reminders", !remInner || window.getComputedStyle(remInner).display === "none");
    const mx = typeof Auth !== "undefined" && Auth.getSessionMatrix ? Auth.getSessionMatrix() : {};
    let ordersOpen = 0;
    if (typeof OrderLinesManager !== "undefined" && OrderLinesManager.lines && mx.tabOrderlines !== "none") {
      const S = OrderLinesManager.STATUS;
      ordersOpen = (OrderLinesManager.lines || []).filter(
        l => l && l.status !== S.CANCELADA && l.status !== S.RECEPCION_TOTAL
      ).length;
    }
    setSkip("orders-pending", mx.tabOrderlines === "none" || ordersOpen === 0);
    let expN = 0;
    if (typeof InventoryManager !== "undefined" && InventoryManager.getItemsExpirationAlert && mx.tabInventory !== "none") {
      expN = InventoryManager.getItemsExpirationAlert().length;
    }
    setSkip("expiring", mx.tabInventory === "none" || expN === 0);
    let zb = 0;
    if (typeof InventoryManager !== "undefined" && InventoryManager._collectZeroQtyBoxRows && mx.tabInventory !== "none") {
      zb = InventoryManager._collectZeroQtyBoxRows().length;
    }
    setSkip("empty-boxes", mx.tabInventory === "none" || zb === 0);
    const authOk = typeof Auth !== "undefined" && Auth.getCurrentUser && Auth.getCurrentUser();
    if (authOk && typeof Auth.getSessionActionLevel === "function") {
      const noOverview =
        Auth.getSessionActionLevel("dashOverview") === "none" ||
        (typeof Auth.hasFullInventoryInsightWidgets === "function" && !Auth.hasFullInventoryInsightWidgets());
      setSkip("overview", noOverview);
      setSkip("today", Auth.getSessionActionLevel("dashToday") === "none");
    } else {
      setSkip("overview", false);
      setSkip("today", false);
    }
    if (typeof this._heroCarouselApplyLayout === "function") this._heroCarouselApplyLayout();
  },

  _setupInteractivity() {
    const root = document.getElementById("dashboard-tab");
    if (!root || this._interactivityBound) return;
    this._interactivityBound = true;

    root.addEventListener("click", e => {
      if (e.target.closest("#dashboard-goto-standby")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
        if (typeof MovementManager !== "undefined" && MovementManager.selectType) {
          MovementManager.selectType("STANDBY");
        }
        return;
      }
      if (e.target.closest("#dashboard-goto-consumo")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("movements");
        if (typeof MovementManager !== "undefined" && MovementManager.selectType) {
          MovementManager.selectType("CONSUMO_DIARIO");
        }
        return;
      }
      if (e.target.closest("#dashboard-goto-transport-urgent")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("transport");
        setTimeout(() => {
          document.getElementById("transport-tab")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
        return;
      }
      if (e.target.closest("#dashboard-goto-transport-readiness")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("transport");
        setTimeout(() => {
          document.getElementById("transport-tab")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
        return;
      }
      if (e.target.closest("#dashboard-carousel-goto-expiring")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("inventory");
        setTimeout(() => {
          if (typeof InventoryManager !== "undefined" && InventoryManager.openInsightModal) {
            InventoryManager.openInsightModal("expiration");
          }
        }, 120);
        return;
      }
      if (e.target.closest("#dashboard-carousel-goto-empty-boxes")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("inventory");
        setTimeout(() => {
          if (typeof InventoryManager !== "undefined" && InventoryManager.openZeroQtyBoxesModal) {
            InventoryManager.openZeroQtyBoxesModal();
          }
        }, 120);
        return;
      }

      if (e.target.closest("#dashboard-goto-transport-hero, #dashboard-transport-preview-block [data-dash-action=\"transport\"]")) {
        e.preventDefault();
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("transport");
        setTimeout(() => {
          document.getElementById("transport-tab")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
        return;
      }

      const insightEl = e.target.closest("[data-dash-insight]");
      if (insightEl) {
        e.stopPropagation();
        const kind = insightEl.getAttribute("data-dash-insight");
        const scrollTo = kind === "expiration" ? "expiring" : kind === "low" ? "low" : "negative";
        this.openAllAlertsModal(scrollTo);
        return;
      }

      const typeTag = e.target.closest(".dash-type-tag[data-movement-type]");
      if (typeTag) {
        e.stopPropagation();
        const type = typeTag.getAttribute("data-movement-type");
        const today = this._todayISO();
        if (typeof HistoryManager !== "undefined" && HistoryManager.applyFilterPreset) {
          HistoryManager.applyFilterPreset({ type, dateFrom: today, dateTo: today });
        }
        return;
      }

      const card = e.target.closest("#dashboard-panel .dash-card[data-dash-action]");
      if (!card) return;
      const action = card.getAttribute("data-dash-action");
      const today = this._todayISO();

      if (action === "history-today") {
        if (typeof HistoryManager !== "undefined" && HistoryManager.applyFilterPreset) {
          HistoryManager.applyFilterPreset({ dateFrom: today, dateTo: today });
        }
        return;
      }
      if (action === "inventory-alerts") {
        this.openAllAlertsModal();
        return;
      }
      if (action === "transport") {
        if (typeof App !== "undefined" && App.switchTab) App.switchTab("transport");
        setTimeout(() => {
          document.getElementById("transport-tab")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
        return;
      }
      if (action === "backup") {
        if (typeof ConfigManager !== "undefined" && ConfigManager.openModalAtTab) {
          ConfigManager.openModalAtTab("import");
        }
        return;
      }
    });

    root.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest("#dashboard-panel .dash-card[data-dash-action]");
      if (!card || e.target.closest("[data-dash-insight]") || e.target.closest(".dash-type-tag[data-movement-type]")) return;
      e.preventDefault();
      card.click();
    });
  },

  refresh() {
    if (typeof RemindersManager !== "undefined" && RemindersManager.refreshAll) {
      RemindersManager.refreshAll();
    }
    this._updateOverviewStats();
    this._updateMovementsToday();
    this._updateAlerts();
    this.updatePendingMovementAlerts();
    this._updatePendingTransports();
    this._updateTransportHeroPreview();
    this.updateTransportExpeditionUrgency();
    this.updateTransportReadinessAttention();
    this._updateLastBackup();
    const toggle = document.getElementById("dashboard-toggle");
    if (toggle) {
      toggle.textContent = I18n.t(this._collapsed ? "dashboard.expand" : "dashboard.collapse");
    }
    this._updateCarouselDashboardSlides();
    this._syncHeroCarouselSlides();
    this._refreshDailyTipCarousel();
  },

  /** Consejo del día: un texto por día del año (366); solo el cuerpo, sin contadores. */
  _refreshDailyTipCarousel() {
    const bodyIn = document.getElementById("dash-inline-daily-tip-body");
    if (!bodyIn) return;
    if (typeof globalThis.DashboardDailyTipsData === "undefined" || !DashboardDailyTipsData.getTip) {
      bodyIn.textContent = "";
      return;
    }
    const lang = (typeof I18n !== "undefined" && I18n.currentLang) || "en";
    const idx = DashboardDailyTipsData.dayIndex();
    bodyIn.textContent = DashboardDailyTipsData.getTip(idx, lang) || "";
  },

  _updateOverviewStats() {
    const artEl = document.getElementById("dash-total-articles");
    if (artEl && typeof InventoryManager !== "undefined") {
      artEl.textContent = String(InventoryManager.items.length);
    }
    const wEl = document.getElementById("dash-movements-week");
    if (wEl && typeof MovementManager !== "undefined") {
      const cutoff = Date.now() - 7 * 86400000;
      const n = (MovementManager.movements || []).filter(
        m => !m.annulled && m.date && new Date(m.date).getTime() >= cutoff
      ).length;
      wEl.textContent = String(n);
    }
    const oEl = document.getElementById("dash-order-lines-open");
    if (oEl && typeof OrderLinesManager !== "undefined" && OrderLinesManager.lines) {
      const S = OrderLinesManager.STATUS;
      const n = OrderLinesManager.lines.filter(
        l => l.status !== S.CANCELADA && l.status !== S.RECEPCION_TOTAL
      ).length;
      oEl.textContent = String(n);
    }
  },

  _updateMovementsToday() {
    const today = this._todayISO();
    const all = (typeof MovementManager !== "undefined" ? MovementManager.movements : []) || [];
    const todayMov = all.filter(m => !m.annulled && (m.date || "").slice(0, 10) === today);

    const el = document.getElementById("dash-movements-today");
    if (el) el.textContent = todayMov.length;

    const typeCounts = {};
    todayMov.forEach(m => {
      typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
    });

    const wrap = document.getElementById("dash-movement-types");
    const tt = this._attrTitle("dashboard.tooltipTypeTag");
    if (wrap) {
      if (!todayMov.length) {
        wrap.innerHTML = `<span class="dash-muted">${this._esc(I18n.t("dashboard.noMovements"))}</span>`;
      } else {
        wrap.innerHTML = Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => {
            const cfg = MOVEMENT_TYPES[type] || {};
            return `<span class="dash-type-tag dash-clickable" data-movement-type="${type}" style="border-color:${cfg.color || "#888"}" title="${tt}">${cfg.icon || ""} ${this._esc(I18n.t("movType." + type))} <strong>${count}</strong></span>`;
          })
          .join("");
      }
    }
  },

  _updateAlerts() {
    const Inv = typeof InventoryManager !== "undefined" ? InventoryManager : null;
    const lowList = Inv ? Inv.getItemsLowStock() : [];
    const negList = Inv ? Inv.getItemsNegative() : [];
    const expList = Inv ? Inv.getItemsExpirationAlert() : [];

    const lowStock = lowList.length;
    const negative = negList.length;
    const expiring = expList.length;

    const idSet = new Set();
    [...lowList, ...negList, ...expList].forEach(it => {
      if (!it) return;
      const k = it.id || it.code;
      if (k) idSet.add(k);
    });
    const totalUnique = idSet.size;

    const el = document.getElementById("dash-alerts");
    if (el) {
      el.textContent = String(totalUnique);
      el.closest(".dash-card")?.classList.toggle("dash-card--warning", totalUnique > 0);
    }

    const tLow = this._attrTitle("dashboard.tooltipTagOpenModal");
    const tNeg = this._attrTitle("dashboard.tooltipTagOpenModal");
    const tExp = this._attrTitle("dashboard.tooltipTagOpenModal");

    const detail = document.getElementById("dash-alert-detail");
    if (detail) {
      if (!totalUnique) {
        detail.innerHTML = `<span class="dash-muted">${this._esc(I18n.t("dashboard.noAlerts"))}</span>`;
      } else {
        const tags = [];
        if (lowStock) {
          tags.push(
            `<span class="dash-alert-tag dash-alert--low dash-clickable" data-dash-insight="low" title="${tLow}">📉 ${this._esc(I18n.t("dashboard.lowStock"))}: <strong>${lowStock}</strong></span>`
          );
        }
        if (negative) {
          tags.push(
            `<span class="dash-alert-tag dash-alert--negative dash-clickable" data-dash-insight="negative" title="${tNeg}">🔴 ${this._esc(I18n.t("dashboard.negativeStock"))}: <strong>${negative}</strong></span>`
          );
        }
        if (expiring) {
          tags.push(
            `<span class="dash-alert-tag dash-alert--expiring dash-clickable" data-dash-insight="expiration" title="${tExp}">⏰ ${this._esc(I18n.t("dashboard.expiring"))}: <strong>${expiring}</strong></span>`
          );
        }
        const hintRaw = I18n.t("dashboard.alertOpenHint");
        const hint =
          hintRaw && !String(hintRaw).startsWith("dashboard.alertOpenHint") ? String(hintRaw).trim() : "";
        detail.innerHTML = `<div class="dash-alert-detail-head">${tags.join("")}</div>${
          hint ? `<p class="dash-muted dash-alert-open-hint">${this._esc(hint)}</p>` : ""
        }`;
      }
    }
  },

  /** Transportes no expedidos con fecha válida, ordenados por fecha de expedición. */
  _pendingTransportSchedule() {
    const transports = (typeof TransportManager !== "undefined" ? TransportManager.transports : []) || [];
    const pending = transports.filter(t => !t.expeditionAnnulled && !t.expeditionShippedAt);
    const sorted = pending
      .filter(t => /^\d{4}-\d{2}-\d{2}$/.test(String(t.shipmentDate || "")))
      .sort((a, b) => String(a.shipmentDate).localeCompare(String(b.shipmentDate)));
    const today = this._todayISO();
    const todayList = sorted.filter(t => t.shipmentDate === today);
    const futureDates = [...new Set(sorted.map(t => t.shipmentDate).filter(d => d > today))].sort();
    const nextDate = futureDates.length ? futureDates[0] : null;
    const nextList = nextDate ? sorted.filter(t => t.shipmentDate === nextDate) : [];
    return { pending, sorted, today, todayList, nextDate, nextList };
  },

  _transportProjectLabel(t) {
    if (!t) return "—";
    const pid = String(t.projectId || "").trim();
    return pid || "—";
  },

  /** Proyecto + sufijo de camión si hay varios transportes del mismo proyecto. */
  _transportAlertLabel(t) {
    const pid = this._transportProjectLabel(t);
    const TM = typeof TransportManager !== "undefined" ? TransportManager : null;
    const extra = TM && typeof TM.getTransportLabel === "function" ? String(TM.getTransportLabel(t) || "").trim() : "";
    const combined = `${pid}${extra}`.trim();
    return combined || "—";
  },

  _updatePendingTransports() {
    const { pending } = this._pendingTransportSchedule();

    const el = document.getElementById("dash-pending-transport");
    if (el) el.textContent = pending.length;
    const card = el ? el.closest(".dash-card--transport") : null;
    if (!card) return;
    /* Detalle de fechas/proyectos solo arriba (bloque alertas); aquí solo el total. */
    card.querySelector(".dash-transport-dates")?.remove();
  },

  _updateTransportHeroPreview() {
    const host = document.getElementById("dashboard-transport-preview-body");
    if (!host) return;
    const { pending, todayList, nextList } = this._pendingTransportSchedule();
    if (!pending.length) {
      host.innerHTML = `<p class="muted">${this._esc(I18n.t("dashboard.transportPreviewNone"))}</p>`;
      return;
    }
    const rows = [];
    todayList.forEach(todayT => {
      rows.push(
        `<div class="dashboard-transport-preview-row dashboard-transport-preview-row--today" role="status"><span class="dashboard-transport-preview-label">${this._esc(
          I18n.t("dashboard.transportToday")
        )}</span> <strong>${this._esc(todayT.shipmentDate)}</strong> · ${this._esc(I18n.t("dashboard.transportProjectShort"))} <strong>${this._esc(
          this._transportAlertLabel(todayT)
        )}</strong></div>`
      );
    });
    nextList.forEach(nextT => {
      rows.push(
        `<div class="dashboard-transport-preview-row dashboard-transport-preview-row--next" role="status"><span class="dashboard-transport-preview-label">${this._esc(
          I18n.t("dashboard.transportNext")
        )}</span> <strong>${this._esc(nextT.shipmentDate)}</strong> · ${this._esc(I18n.t("dashboard.transportProjectShort"))} <strong>${this._esc(
          this._transportAlertLabel(nextT)
        )}</strong></div>`
      );
    });
    if (!todayList.length && !nextList.length) {
      rows.push(`<p class="muted">${this._esc(I18n.t("dashboard.transportPreviewNoDate"))}</p>`);
    }
    host.innerHTML = `<div class="dashboard-transport-preview-rows">${rows.join("")}</div>`;
  },

  _updateCarouselDashboardSlides() {
    const mx = typeof Auth !== "undefined" && Auth.getSessionMatrix ? Auth.getSessionMatrix() : {};
    this._fillCarouselOrdersSlide(mx);
    this._fillCarouselExpiringSlide(mx);
    this._fillCarouselEmptyBoxesSlide(mx);
  },

  _fillCarouselOrdersSlide(mx) {
    const summaryEl = document.getElementById("dash-carousel-orders-summary");
    const listEl = document.getElementById("dash-carousel-orders-list");
    if (!summaryEl || !listEl) return;
    if (mx.tabOrderlines === "none" || typeof OrderLinesManager === "undefined" || !OrderLinesManager.lines) {
      summaryEl.textContent = "";
      listEl.innerHTML = "";
      return;
    }
    const S = OrderLinesManager.STATUS;
    const open = (OrderLinesManager.lines || []).filter(
      l => l && l.status !== S.CANCELADA && l.status !== S.RECEPCION_TOTAL
    );
    const n = open.length;
    if (!n) {
      summaryEl.textContent = I18n.t("dashboard.carouselOrdersNone");
      listEl.innerHTML = "";
      return;
    }
    summaryEl.textContent = I18n.t("dashboard.carouselOrdersSummary").replace("{n}", String(n));
    const lineT = l => {
      const t = new Date(l.orderedAt || l.createdAt || 0).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const sorted = open.slice().sort((a, b) => lineT(a) - lineT(b));
    const take = sorted.slice(0, 8);
    listEl.innerHTML = take
      .map(l => {
        const ref = OrderLinesManager.formatLineRef(l);
        const rem = Math.max(0, (parseFloat(l.orderedQty) || 0) - (parseFloat(l.receivedQty) || 0));
        const st = OrderLinesManager.statusLabel(l.status);
        const desc = String(l.description || "").trim();
        const shortDesc = desc.length > 48 ? `${desc.slice(0, 46)}…` : desc;
        const line2 = shortDesc
          ? `<div class="muted dashboard-carousel-insight-desc">${this._esc(shortDesc)}</div>`
          : "";
        return `<li class="dashboard-carousel-insight-item"><span class="muted">${this._esc(ref)}</span> <strong>${this._esc(
          l.code || ""
        )}</strong> · ${this._esc(st)} · ${this._esc(I18n.t("dashboard.carouselOrdersRemaining").replace("{q}", String(rem)))}${line2}</li>`;
      })
      .join("");
  },

  _fillCarouselExpiringSlide(mx) {
    const summaryEl = document.getElementById("dash-carousel-expiring-summary");
    const listEl = document.getElementById("dash-carousel-expiring-list");
    if (!summaryEl || !listEl) return;
    if (mx.tabInventory === "none" || typeof InventoryManager === "undefined" || !InventoryManager.getItemsExpirationAlert) {
      summaryEl.textContent = "";
      listEl.innerHTML = "";
      return;
    }
    const items = InventoryManager.getItemsExpirationAlert();
    const n = items.length;
    if (!n) {
      summaryEl.textContent = I18n.t("dashboard.carouselExpiringNone");
      listEl.innerHTML = "";
      return;
    }
    summaryEl.textContent = I18n.t("dashboard.carouselExpiringSummary").replace("{n}", String(n));
    listEl.innerHTML = items.slice(0, 8).map(it => {
      const x = InventoryManager.getExpirationInsight(it);
      const d = x.days;
      const meta =
        d == null
          ? ""
          : x.expired
            ? I18n.t("dashboard.carouselExpiringExpired")
            : I18n.t("dashboard.carouselExpiringDays").replace("{d}", String(d));
      const desc = String(it.description || "").trim();
      const shortDesc = desc.length > 48 ? `${desc.slice(0, 46)}…` : desc;
      const line2 = shortDesc
        ? `<div class="muted dashboard-carousel-insight-desc">${this._esc(shortDesc)}</div>`
        : "";
      return `<li class="dashboard-carousel-insight-item"><strong>${this._esc(it.code || "")}</strong> · ${this._esc(meta)}${line2}</li>`;
    }).join("");
  },

  _fillCarouselEmptyBoxesSlide(mx) {
    const summaryEl = document.getElementById("dash-carousel-empty-boxes-summary");
    const listEl = document.getElementById("dash-carousel-empty-boxes-list");
    if (!summaryEl || !listEl) return;
    if (mx.tabInventory === "none" || typeof InventoryManager === "undefined" || !InventoryManager._collectZeroQtyBoxRows) {
      summaryEl.textContent = "";
      listEl.innerHTML = "";
      return;
    }
    const rows = InventoryManager._collectZeroQtyBoxRows();
    const n = rows.length;
    if (!n) {
      summaryEl.textContent = I18n.t("dashboard.carouselEmptyBoxesNone");
      listEl.innerHTML = "";
      return;
    }
    summaryEl.textContent = I18n.t("dashboard.carouselEmptyBoxesSummary").replace("{n}", String(n));
    listEl.innerHTML = rows.slice(0, 10).map(r => {
      const loc = String(r.locationLabel || "").trim();
      const locDisp = loc || "—";
      const emptyNote = r.empty ? ` · ${this._esc(I18n.t("inventory.boxMgrBadgeEmpty"))}` : "";
      return `<li class="dashboard-carousel-insight-item"><strong>${this._esc(r.code || "")}</strong> · ${this._esc(
        I18n.t("inventory.boxFilterOption").replace("{n}", String(r.boxNumber))
      )} · ${this._esc(locDisp)}${emptyNote}</li>`;
    }).join("");
  },

  _updateLastBackup() {
    const el = document.getElementById("dash-last-backup");
    if (!el) return;
    const last = localStorage.getItem("phoenix-last-backup");
    if (!last) {
      el.textContent = I18n.t("dashboard.never");
      el.closest(".dash-card")?.classList.add("dash-card--warning");
      return;
    }
    const d = new Date(last);
    const daysDiff = Math.floor((Date.now() - d.getTime()) / 86400000);
    el.textContent =
      daysDiff === 0
        ? I18n.t("dashboard.today")
        : daysDiff === 1
          ? I18n.t("dashboard.yesterday")
          : `${daysDiff} ${I18n.t("dashboard.daysAgo")}`;
    el.closest(".dash-card")?.classList.toggle("dash-card--warning", daysDiff > 7);
  }
};
