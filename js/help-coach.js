/**
 * Modo ayuda: cursor con «?» y descripción al pulsar un control (sin ejecutar la acción).
 */
const HelpCoach = {
  active: false,
  /** Elemento clicado más reciente (para resolver la sección en fallbacks). */
  _lastCoachTarget: null,
  _onClick: null,
  _onMove: null,
  _onKey: null,

  init() {
    this._badge = document.getElementById("help-coach-cursor-badge");
    this._banner = document.getElementById("help-coach-banner");
    this._bannerText = document.getElementById("help-coach-banner-text");
    this._popover = document.getElementById("help-coach-popover");
    this._popoverTitle = document.getElementById("help-coach-popover-title");
    this._popoverBody = document.getElementById("help-coach-popover-body");

    this._onClick = e => this._onDocClick(e);
    this._onMove = e => this._onDocMove(e);
    this._onKey = e => this._onKeyDown(e);

    document.getElementById("help-coach-toggle")?.addEventListener("click", () => this.toggle());
    document.getElementById("help-coach-modal-header-toggle")?.addEventListener("click", () => this.toggle());
    document.getElementById("help-coach-banner-close")?.addEventListener("click", () => this.setActive(false));
    document.getElementById("help-coach-popover-close")?.addEventListener("click", () => this.hidePopover());
    this._resetUiState();
    this.syncToggleButtonLabel();
  },

  _resetUiState() {
    // Evita estado visual "pegado" al recargar/navegar (badge visible en una esquina, clase html residual, etc.)
    this.active = false;
    document.documentElement.classList.remove("help-coach-on");
    if (this._banner) this._banner.hidden = true;
    if (this._badge) this._badge.hidden = true;
    this.hidePopover();
    document.removeEventListener("click", this._onClick, true);
    document.removeEventListener("mousemove", this._onMove, true);
    document.removeEventListener("keydown", this._onKey, true);
  },

  toggle() {
    this.setActive(!this.active);
  },

  setActive(on) {
    const want = !!on;
    if (want === this.active) return;
    this.active = want;
    document.documentElement.classList.toggle("help-coach-on", want);
    if (this._banner) this._banner.hidden = !want;
    if (this._badge) this._badge.hidden = !want;
    if (want) {
      if (typeof window.gneexCloseHelp === "function") window.gneexCloseHelp();
      else document.getElementById("help-modal")?.classList.remove("active");
      document.addEventListener("click", this._onClick, true);
      document.addEventListener("mousemove", this._onMove, true);
      document.addEventListener("keydown", this._onKey, true);
      if (this._bannerText && typeof I18n !== "undefined" && I18n.t) {
        this._bannerText.textContent = I18n.t("helpCoach.banner");
      }
    } else {
      document.removeEventListener("click", this._onClick, true);
      document.removeEventListener("mousemove", this._onMove, true);
      document.removeEventListener("keydown", this._onKey, true);
      this.hidePopover();
    }
    this.syncToggleButtonLabel();
  },

  syncToggleButtonLabel() {
    if (typeof I18n === "undefined" || !I18n.t) return;
    const longLabel = I18n.t(this.active ? "help.btnCoachOff" : "help.btnCoachOn");
    ["help-coach-modal-header-toggle"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = longLabel;
    });
  },

  hidePopover() {
    if (this._popover) this._popover.hidden = true;
  },

  _onDocMove(e) {
    if (!this.active || !this._badge) return;
    const pad = 14;
    this._badge.style.left = `${Math.min(e.clientX + pad, window.innerWidth - 36)}px`;
    this._badge.style.top = `${Math.min(e.clientY + pad, window.innerHeight - 36)}px`;
  },

  _onKeyDown(e) {
    if (!this.active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.setActive(false);
    }
  },

  _onDocClick(e) {
    if (!this.active) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("#help-coach-popover")) return;
    if (t.closest("#help-coach-banner")) return;
    if (t.closest("#help-modal")) return;
    if (t.closest("#gneex-help-open")) return;
    if (t.closest("#help-coach-toggle")) return;
    if (t.closest("#help-coach-modal-header-toggle")) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    const el = t.nodeType === 1 ? t : t.parentElement;
    const hint = this._resolveHint(el);
    const title = this._resolveTitle(el);
    this._showPopover(title, hint, e.clientX, e.clientY);
  },

  _findHelpKey(el) {
    let n = el;
    for (let i = 0; i < 28 && n && n !== document.body; i++, n = n.parentElement) {
      const k = n.getAttribute && n.getAttribute("data-help-key");
      if (k) return k;
    }
    return null;
  },

  _resolveTitle(el) {
    const lab = this._inferLabel(el);
    if (lab) return lab;
    return typeof I18n !== "undefined" && I18n.t ? I18n.t("helpCoach.popoverTitle") : "Información";
  },

  /** Pista según pestaña o modal donde está el elemento (textos en i18n). */
  _sectionHintKeyForEl(el) {
    if (!el || !el.closest) return "helpCoach.ctxUnknown";
    if (el.closest("#config-modal")) return "helpCoach.ctxConfig";
    if (el.closest("#help-modal")) return "helpCoach.ctxHelpModal";
    if (
      el.closest("#movement-form-window") ||
      el.closest(".movement-form-window") ||
      el.closest("#movement-draft-float-wrap")
    ) {
      return "helpCoach.ctxMovementForm";
    }
    if (el.closest("#movement-detail-modal")) return "helpCoach.ctxMovementDetail";
    const tab = el.closest(".tab-content");
    const map = {
      "dashboard-tab": "helpCoach.ctxDashboard",
      "reminders-tab": "helpCoach.ctxReminders",
      "inventory-tab": "helpCoach.ctxInventory",
      "movements-tab": "helpCoach.ctxMovements",
      "history-tab": "helpCoach.ctxHistory",
      "transport-tab": "helpCoach.ctxTransport",
      "orderlines-tab": "helpCoach.ctxOrderlines"
    };
    if (tab && tab.id && map[tab.id]) return map[tab.id];
    return "helpCoach.ctxUnknown";
  },

  _composeCoachFallback(el, labelOrEmpty) {
    if (typeof I18n === "undefined" || !I18n.t) return "";
    const hintKey = this._sectionHintKeyForEl(el || this._lastCoachTarget || document.body);
    let section = I18n.t(hintKey);
    if (!section || section === hintKey) section = I18n.t("helpCoach.ctxUnknown");
    const exitTip = I18n.t("helpCoach.exitModeTip");

    if (labelOrEmpty) {
      return I18n.t("helpCoach.fallbackWithLabel")
        .replace(/\{label\}/g, labelOrEmpty)
        .replace(/\{sectionHint\}/g, section)
        .replace(/\{exitTip\}/g, exitTip);
    }
    return I18n.t("helpCoach.noDescription")
      .replace(/\{sectionHint\}/g, section)
      .replace(/\{exitTip\}/g, exitTip);
  },

  _resolveHint(el) {
    this._lastCoachTarget = el;
    const key = this._findHelpKey(el);
    if (key && typeof I18n !== "undefined" && I18n.t) {
      const txt = I18n.t(key);
      if (txt && txt !== key) {
        const extra = this._coachSupplementForKey(key);
        return extra ? `${txt}\n\n${extra}` : txt;
      }
    }
    const lab = this._inferLabel(el);
    if (lab) return this._composeCoachFallback(el, lab);
    return this._composeCoachFallback(el, "");
  },

  /** Breve consejo al final cuando ya hay una entrada helpCoach.* concreta. */
  _coachSupplementForKey(key) {
    if (typeof I18n === "undefined" || !I18n.t) return "";
    const k = "helpCoach.afterKeyedHint";
    const t = I18n.t(k);
    if (!t || t === k) return "";
    return t;
  },

  _inferLabel(el) {
    const node =
      el.closest("button,[role='button'],a,label,input,select,textarea,[aria-label],[title]") || el;
    const a = node.getAttribute && (node.getAttribute("aria-label") || node.getAttribute("title"));
    if (a && String(a).trim()) return String(a).trim();
    const inner =
      node.querySelector && node.querySelector("span[data-i18n], .gneex-help-open-text[data-i18n]");
    if (inner && typeof I18n !== "undefined" && I18n.t) {
      const ik = inner.getAttribute("data-i18n");
      if (ik) {
        const tx = I18n.t(ik);
        if (tx && tx !== ik) return tx;
      }
    }
    const selfI18nKey = node.getAttribute && node.getAttribute("data-i18n");
    if (selfI18nKey && typeof I18n !== "undefined" && I18n.t) {
      const tx = I18n.t(selfI18nKey);
      if (tx && tx !== selfI18nKey) return tx;
    }
    const ownText = node.textContent ? String(node.textContent).trim() : "";
    if (ownText && ownText.length <= 80) {
      return ownText.replace(/\s+/g, " ");
    }
    return "";
  },

  _showPopover(title, body, cx, cy) {
    if (!this._popover || !this._popoverTitle || !this._popoverBody) return;
    this._popoverTitle.textContent = title || "";
    this._popoverBody.textContent = body || "";
    this._popover.hidden = false;
    const w = 320;
    const h = 200;
    let x = cx + 18;
    let y = cy + 18;
    if (x + w > window.innerWidth - 8) x = Math.max(8, window.innerWidth - w - 8);
    if (y + h > window.innerHeight - 8) y = Math.max(8, cy - h - 12);
    this._popover.style.left = `${x}px`;
    this._popover.style.top = `${y}px`;
  }
};
