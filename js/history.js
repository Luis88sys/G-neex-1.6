// history.js - Gestión del Historial

const HistoryManager = {
    currentMovement: null,

    _HISTORY_VIEWS: ['tiles', 'list', 'details', 'carousel'],

    /** @type {ReturnType<typeof setTimeout>|null} */
    _historyFilterDebounceT: null,

    /** Sesión Annie: historial filtrado solo a recepción material (evita reconstruir el combo si ya aplicado). */
    _recvHistLocked: false,

    _esc(s) {
        return Utils.escapeHtml(s);
    },

    _attachmentBadgeHtml(mov) {
        const n = Array.isArray(mov?.attachments) ? mov.attachments.length : 0;
        if (!n) return "";
        return `<span class="history-attachment-badge" title="${this._esc(I18n.t("attachments.title"))}" aria-label="${this._esc(I18n.t("attachments.title"))}">📎</span>`;
    },

    /** Refresco del listado al escribir en filtros (evita un render por tecla). */
    _scheduleHistoryFilterRefresh() {
        clearTimeout(this._historyFilterDebounceT);
        this._historyFilterDebounceT = setTimeout(() => {
            this._historyFilterDebounceT = null;
            this.render();
        }, 140);
    },

    _bindLiveHistoryFilters() {
        const textIds = [
            'filter-ref',
            'filter-code',
            'filter-desc',
            'filter-notes',
            'filter-recipient',
            'filter-supplier',
            'filter-location',
            'filter-project-id',
            'filter-sales-order',
            'filter-pr-number',
            'filter-created-by',
            'filter-qty-min',
            'filter-qty-max'
        ];
        textIds.forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this._scheduleHistoryFilterRefresh());
        });
        const immediateIds = [
            'filter-type',
            'filter-overdraft',
            'filter-negative-stock',
            'filter-annul-status',
            'filter-date-from',
            'filter-date-to'
        ];
        immediateIds.forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.render());
        });
    },

    _getHistoryView() {
        let v = localStorage.getItem(STORAGE_KEYS.VIEW_HISTORY_UI);
        if (!this._HISTORY_VIEWS.includes(v)) v = 'tiles';
        return v;
    },

    _setHistoryView(mode) {
        if (!this._HISTORY_VIEWS.includes(mode)) return;
        localStorage.setItem(STORAGE_KEYS.VIEW_HISTORY_UI, mode);
        this.render();
    },

    _syncHistoryViewToolbar() {
        const mode = this._getHistoryView();
        document.querySelectorAll('[data-history-view]').forEach(btn => {
            const active = btn.getAttribute('data-history-view') === mode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    },

    /** Una celda tipo mosaico (vista por defecto). */
    _movementTileHtml(mov) {
        const config = MOVEMENT_TYPES[mov.type] || { icon: '📦', color: '#666' };
        const fromOrderPanel = mov.type === "COMPRA_STOCK" && mov.orderLineId;
        const showOd = MovementManager.effectiveHadOverdraft(mov);
        const titleParts = [`${I18n.t(`movType.${mov.type}`)} - ${mov.reference || ""}`];
        if (showOd) titleParts.push(I18n.t("history.overdraft"));
        if (fromOrderPanel) titleParts.push(I18n.t("history.compraFromOrderPanelTitle"));
        const cellTitle = this._esc(titleParts.join(" — "));
        const projectId = mov.type !== "CONSUMO_DIARIO" ? String(mov.projectId || "").trim() : "";
        const soPr =
            mov.type === "VENTA_DIRECTA" && String(mov.salesOrder || "").trim()
                ? String(mov.salesOrder).trim()
                : mov.type === "EXPEDICION_STOCK" && String(mov.prNumber || "").trim()
                  ? String(mov.prNumber).trim()
                  : "";
        return `
                <div class="history-cell${this._annulCellClass(mov)} ${showOd ? 'history-cell--overdraft' : ''} ${fromOrderPanel ? 'history-cell--orderline' : ''}" 
                     data-type="${mov.type}"
                     data-id="${Utils.escapeAttr(mov.id)}"
                     style="border-color: ${config.color}"
                     title="${cellTitle}">
                    ${this._annulBadgesHtml(mov)}
                    ${this._attachmentBadgeHtml(mov)}
                    <span class="cell-icon">${config.icon}</span>
                    <span class="cell-ref">${this._esc(mov.reference)}${showOd ? '<span class="overdraft-marker" aria-hidden="true">!</span>' : ''}${fromOrderPanel ? `<span class="cell-orderline-mark" title="${this._esc(I18n.t("history.compraFromOrderPanelTitle"))}">📋</span>` : ""}</span>
                    <span class="cell-type" style="color: ${config.color}">${this._esc(I18n.t(`movType.${mov.type}`))}</span>
                    <span class="cell-date">${Utils.formatDate(mov.date)}</span>
                    ${projectId ? `<span class="cell-project">${this._esc(projectId)}</span>` : ''}
                    ${soPr ? `<span class="cell-so-pr muted">${this._esc(soPr)}</span>` : ""}
                    ${mov.createdBy ? `<span class="cell-user">${this._esc(mov.createdBy)}</span>` : ''}
                </div>
            `;
    },

    /** Fila compacta tipo lista (Explorer). */
    _movementListRowHtml(mov) {
        const config = MOVEMENT_TYPES[mov.type] || { icon: '📦', color: '#666' };
        const fromOrderPanel = mov.type === "COMPRA_STOCK" && mov.orderLineId;
        const showOd = MovementManager.effectiveHadOverdraft(mov);
        const titleParts = [`${I18n.t(`movType.${mov.type}`)} - ${mov.reference || ""}`];
        if (showOd) titleParts.push(I18n.t("history.overdraft"));
        if (fromOrderPanel) titleParts.push(I18n.t("history.compraFromOrderPanelTitle"));
        const rowTitle = this._esc(titleParts.join(" — "));
        const soPr =
            mov.type === "VENTA_DIRECTA" && String(mov.salesOrder || "").trim()
                ? String(mov.salesOrder).trim()
                : mov.type === "EXPEDICION_STOCK" && String(mov.prNumber || "").trim()
                  ? String(mov.prNumber).trim()
                  : "";
        const meta = `${this._esc(I18n.t(`movType.${mov.type}`))} · ${this._esc(Utils.formatDate(mov.date))}${
            soPr ? ` · ${this._esc(soPr)}` : ""
        }`;
        return `
                <button type="button" class="history-list-row${this._annulCellClass(mov)} ${showOd ? 'history-cell--overdraft' : ''} ${fromOrderPanel ? 'history-cell--orderline' : ''}"
                    data-type="${mov.type}"
                    data-id="${Utils.escapeAttr(mov.id)}"
                    style="--history-row-accent: ${config.color}"
                    title="${rowTitle}">
                    ${this._annulBadgesHtml(mov)}
                    ${this._attachmentBadgeHtml(mov)}
                    <span class="history-list-row-icon" aria-hidden="true">${config.icon}</span>
                    <span class="history-list-row-main">
                        <span class="history-list-row-ref">${this._esc(mov.reference)}${showOd ? '<span class="overdraft-marker" aria-hidden="true">!</span>' : ''}${fromOrderPanel ? `<span class="cell-orderline-mark" title="${this._esc(I18n.t("history.compraFromOrderPanelTitle"))}">📋</span>` : ""}</span>
                        <span class="history-list-row-meta muted">${meta}</span>
                    </span>
                    ${mov.createdBy ? `<span class="history-list-row-user">${this._esc(mov.createdBy)}</span>` : '<span class="history-list-row-user"></span>'}
                </button>
            `;
    },

    /** Tabla con columnas (vista detalles). */
    _movementDetailsTableHtml(movements) {
        const headKeys = [
            'standby.reference',
            'standby.date',
            'history.filterType',
            'movements.projectId',
            'table.status',
            'history.createdBy'
        ];
        const th = k => `<th>${this._esc(I18n.t(k))}</th>`;
        const body = movements
            .map(m => {
                const st = m.annulled
                    ? I18n.t('status.annulled')
                    : this._isMovementPartiallyAnnulled(m)
                      ? I18n.t('history.statusPartiallyAnnulled')
                      : I18n.t('status.active');
                const proj = m.type === 'CONSUMO_DIARIO' ? '' : (m.projectId || '');
                return `<tr class="history-detail-row${m.annulled ? ' annulled' : ''}${this._isMovementPartiallyAnnulled(m) ? ' history-detail-row--partial-annul' : ''}" data-id="${Utils.escapeAttr(m.id)}" data-type="${m.type}">
          <td>${this._esc(m.reference || '')}</td>
          <td>${this._esc(Utils.formatDateTime(m.date))}</td>
          <td>${this._esc(I18n.t(`movType.${m.type}`))}</td>
          <td>${this._esc(proj)}</td>
          <td>${this._esc(st)}</td>
          <td>${this._esc(m.createdBy || '')}</td>
        </tr>`;
            })
            .join('');
        return `
            <div class="history-details-wrap inventory-table-container">
                <table class="inventory-table history-details-table">
                    <thead><tr>${headKeys.map(th).join('')}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        `;
    },

    /** Carrusel horizontal de tarjetas en orden cronológico (reciente -> antiguo). */
    _movementCarouselHtml(movements) {
        const firstDate = movements[0] && movements[0].date ? this._formatCarouselDateTime(movements[0].date) : '—';
        const cards = movements.map(mov => {
            const config = MOVEMENT_TYPES[mov.type] || { icon: '📦', color: '#666' };
            const fromOrderPanel = mov.type === "COMPRA_STOCK" && mov.orderLineId;
            const showOd = MovementManager.effectiveHadOverdraft(mov);
            const titleParts = [`${I18n.t(`movType.${mov.type}`)} - ${mov.reference || ""}`];
            if (showOd) titleParts.push(I18n.t("history.overdraft"));
            if (fromOrderPanel) titleParts.push(I18n.t("history.compraFromOrderPanelTitle"));
            const cellTitle = this._esc(titleParts.join(" — "));
            const projectId = mov.type !== "CONSUMO_DIARIO" ? String(mov.projectId || "").trim() : "";
            return `
                <button
                    type="button"
                    class="history-cell history-carousel-card${this._annulCellClass(mov)} ${showOd ? 'history-cell--overdraft' : ''} ${fromOrderPanel ? 'history-cell--orderline' : ''}"
                    data-type="${mov.type}"
                    data-id="${Utils.escapeAttr(mov.id)}"
                    data-carousel-date="${Utils.escapeAttr(mov.date || '')}"
                    style="border-color: ${config.color}"
                    title="${cellTitle}"
                >
                    ${this._annulBadgesHtml(mov)}
                    ${this._attachmentBadgeHtml(mov)}
                    <span class="cell-icon">${config.icon}</span>
                    <span class="cell-ref">${this._esc(mov.reference)}${showOd ? '<span class="overdraft-marker" aria-hidden="true">!</span>' : ''}${fromOrderPanel ? `<span class="cell-orderline-mark" title="${this._esc(I18n.t("history.compraFromOrderPanelTitle"))}">📋</span>` : ""}</span>
                    <span class="cell-type" style="color: ${config.color}">${this._esc(I18n.t(`movType.${mov.type}`))}</span>
                    <span class="cell-date">${this._esc(this._formatCarouselDateTime(mov.date))}</span>
                    ${projectId ? `<span class="cell-project">${this._esc(projectId)}</span>` : ''}
                    ${mov.createdBy ? `<span class="cell-user">${this._esc(mov.createdBy)}</span>` : ''}
                </button>
            `;
        }).join('');
        return `
            <div class="history-carousel-wrap" data-history-carousel-wrap>
                <button type="button" class="btn btn-secondary btn-sm history-carousel-nav" data-history-carousel-nav="prev" data-i18n-title="history.carouselPrev" title="${this._esc(I18n.t('history.carouselPrev'))}" aria-label="${this._esc(I18n.t('history.carouselPrev'))}">◀</button>
                <div class="history-carousel-main">
                    <div class="history-carousel-timeline" aria-label="Cronología" data-history-carousel-date-control>
                        <span class="history-carousel-timeline-point">
                            <span class="history-carousel-timeline-dot" aria-hidden="true"></span>
                            <span class="history-carousel-timeline-label" data-history-carousel-current-date>${this._esc(firstDate)}</span>
                        </span>
                    </div>
                    <div class="history-carousel-track" data-history-carousel-track>
                        ${cards}
                    </div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm history-carousel-nav" data-history-carousel-nav="next" data-i18n-title="history.carouselNext" title="${this._esc(I18n.t('history.carouselNext'))}" aria-label="${this._esc(I18n.t('history.carouselNext'))}">▶</button>
            </div>
        `;
    },

    /** Misma convención global que {@link Utils.formatDateTime} (vacío → em dash). */
    _formatCarouselDateTime(dateValue) {
        if (!dateValue) return '—';
        const s = Utils.formatDateTime(dateValue);
        return s || '—';
    },

    _syncHistoryCarouselActiveDate() {
        const root = document.getElementById('history-cells');
        if (!root) return;
        const track = root.querySelector('[data-history-carousel-track]');
        const label = root.querySelector('[data-history-carousel-current-date]');
        if (!track || !label) return;
        const cards = Array.from(track.querySelectorAll('.history-carousel-card'));
        if (!cards.length) {
            label.textContent = '—';
            return;
        }
        const best = this._findHistoryCarouselCenteredCard(cards, track) || cards[0];
        const nextText = this._formatCarouselDateTime(best?.dataset?.carouselDate || '');
        if (label.textContent === nextText) return;
        label.classList.remove('is-enter');
        label.classList.add('is-updating');
        clearTimeout(this._carouselDateAnimT);
        this._carouselDateAnimT = setTimeout(() => {
            label.textContent = nextText;
            label.classList.remove('is-updating');
            label.classList.add('is-enter');
            clearTimeout(this._carouselDateAnimInT);
            this._carouselDateAnimInT = setTimeout(() => label.classList.remove('is-enter'), 180);
        }, 120);
    },

    _bindHistoryCarouselDateSync() {
        const root = document.getElementById('history-cells');
        if (!root) return;
        const track = root.querySelector('[data-history-carousel-track]');
        if (!track || track.dataset.dateSyncBound === '1') return;
        track.dataset.dateSyncBound = '1';
        track.addEventListener('scroll', () => this._syncHistoryCarouselActiveDate(), { passive: true });
        this._syncHistoryCarouselActiveDate();
    },

    _findHistoryCarouselCenteredCard(cards, track) {
        if (!Array.isArray(cards) || !cards.length || !track) return null;
        const center = track.scrollLeft + track.clientWidth / 2;
        let best = cards[0];
        let bestDist = Number.POSITIVE_INFINITY;
        cards.forEach(card => {
            const cardCenter = card.offsetLeft + card.offsetWidth / 2;
            const dist = Math.abs(cardCenter - center);
            if (dist < bestDist) {
                bestDist = dist;
                best = card;
            }
        });
        return best;
    },

    _scrollHistoryCarousel(direction) {
        const track = document.querySelector('#history-cells [data-history-carousel-track]');
        if (!track) return;
        const label = document.querySelector('#history-cells [data-history-carousel-current-date]');
        const cards = Array.from(track.querySelectorAll('.history-carousel-card'));
        if (!cards.length) return;
        const current = this._findHistoryCarouselCenteredCard(cards, track) || cards[0];
        const curIdx = Math.max(0, cards.indexOf(current));
        const step = direction === 'prev' ? -1 : 1;
        const nextIdx = curIdx + step;
        if (nextIdx < 0 || nextIdx >= cards.length) return;
        const target = cards[nextIdx];
        const targetLabel = this._formatCarouselDateTime(target?.dataset?.carouselDate || '');
        if (label && label.textContent !== targetLabel) {
            label.classList.remove('is-enter');
            label.classList.add('is-updating');
            clearTimeout(this._carouselDateAnimT);
            this._carouselDateAnimT = setTimeout(() => {
                label.textContent = targetLabel;
                label.classList.remove('is-updating');
                label.classList.add('is-enter');
                clearTimeout(this._carouselDateAnimInT);
                this._carouselDateAnimInT = setTimeout(() => label.classList.remove('is-enter'), 180);
            }, 80);
        }
        const toLeft = Math.max(0, target.offsetLeft - Math.max(8, Math.round((track.clientWidth - target.offsetWidth) / 2)));
        track.scrollTo({ left: toLeft, behavior: 'smooth' });
        setTimeout(() => this._syncHistoryCarouselActiveDate(), 220);
    },

    /**
     * Trim, minúsculas, quita espacios invisibles;
     * unifica × (U+00D7) con x; guiones tipográficos (– — ‑) con el guion ASCII (-).
     */
    _normalizeFilterText(s) {
        return String(s ?? '')
            .trim()
            .replace(/[\u200b\ufeff\u00a0]/g, '')
            .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\u00ad]/g, '-')
            .toLowerCase()
            .replace(/\u00d7/g, 'x');
    },

    /** Código en línea de movimiento o, si viene vacío, el código actual del artículo en inventario. */
    _lineItemCode(line) {
        if (!line) return '';
        let c = line.code != null ? String(line.code) : '';
        if (c.trim() === '' && line.itemId && typeof InventoryManager !== 'undefined') {
            const it = InventoryManager.items.find(i => String(i.id) === String(line.itemId));
            if (it && it.code != null) c = String(it.code);
        }
        return c;
    },

    /**
     * ¿El filtro por código coincide con este movimiento?
     * Incluye líneas, artículo resultado de transformación (guardado + inventario) y recepción (nombre material).
     * Las notas del movimiento tienen filtro propio (`filter-notes`).
     */
    _movementMatchesCodeFilter(mov, needleNorm) {
        if (!needleNorm) return true;
        const hit = hay => this._normalizeFilterText(hay).includes(needleNorm);
        const items = mov.items || [];
        for (const i of items) {
            if (hit(this._lineItemCode(i))) return true;
            if (hit(i.recipientName || '')) return true;
        }
        if (mov.type === 'TRANSFORMACION') {
            if (hit(mov.transformationTargetCode)) return true;
            if (mov.transformationTargetItemId && typeof InventoryManager !== 'undefined') {
                const ti = InventoryManager.items.find(
                    x => String(x.id) === String(mov.transformationTargetItemId)
                );
                if (ti && hit(ti.code)) return true;
            }
        }
        const snap = mov.receptionSnapshot;
        if (snap && hit(snap.itemName)) return true;
        return false;
    },

    _movementHasAnnulledLine(mov) {
        return !!(mov.items && mov.items.some(i => i && i.annulled));
    },

    _isMovementPartiallyAnnulled(mov) {
        return !!mov && !mov.annulled && this._movementHasAnnulledLine(mov);
    },

    /** Clases en mosaico / lista / carrusel: total anulado vs líneas sueltas anuladas. */
    _annulCellClass(mov) {
        if (!mov) return '';
        if (mov.annulled) return ' annulled history-cell--annul-full';
        if (this._isMovementPartiallyAnnulled(mov)) return ' history-cell--annul-partial';
        return '';
    },

    _annulBadgesHtml(mov) {
        if (!mov) return '';
        const esc = s => this._esc(s);
        if (mov.annulled) {
            return `<span class="history-annul-stamp history-annul-stamp--full" aria-hidden="true"><span class="history-annul-stamp-inner">${esc(I18n.t('status.annulled'))}</span></span>`;
        }
        if (this._isMovementPartiallyAnnulled(mov)) {
            return `<span class="history-annul-stamp history-annul-stamp--partial" aria-hidden="true"><span class="history-annul-stamp-inner">${esc(I18n.t('history.statusPartiallyAnnulled'))}</span></span>`;
        }
        return '';
    },

    _movementAnnulFilterMatch(mov, filterVal) {
        if (!filterVal) return true;
        const full = !!mov.annulled;
        const partial = this._isMovementPartiallyAnnulled(mov);
        if (filterVal === 'active') return !full;
        if (filterVal === 'full') return full;
        if (filterVal === 'partial') return partial;
        return true;
    },

    init() {
        try {
            this.populateFilterTypes();
            this.render();
            this.setupEventListeners();
            document.getElementById('consumo-recipient-ledger-details')?.addEventListener('toggle', e => {
                if (e.target.open) this.renderConsumoRecipientLedger();
            });
            /** Filtros persona/código: refresco en vivo (sin depender de «Guardar cambios», que solo persiste ediciones en celdas). */
            let _ledgerFilterRefreshTimer = null;
            const scheduleLedgerFilterRefresh = () => {
                clearTimeout(_ledgerFilterRefreshTimer);
                _ledgerFilterRefreshTimer = setTimeout(() => this.renderConsumoRecipientLedger(), 100);
            };
            ['ledger-filter-person', 'ledger-filter-code'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', scheduleLedgerFilterRefresh);
                el.addEventListener('change', scheduleLedgerFilterRefresh);
            });
            this.applyMaterialReceptionHistoryLock();
        } catch (err) {
            console.error('❌ Error inicializando HistoryManager:', err);
        }
    },

    /** Annie (integrada): bloquea el filtro de tipo a RECEPCION_MATERIAL y refresca listado. */
    applyMaterialReceptionHistoryLock() {
        try {
            const sel = document.getElementById("filter-type");
            if (!sel) return;
            const lock =
                typeof Auth !== "undefined" &&
                Auth.historyMaterialReceptionOnly &&
                Auth.historyMaterialReceptionOnly();
            if (lock) {
                if (!this._recvHistLocked) {
                    this._recvHistLocked = true;
                    this.populateFilterTypes();
                    this.render();
                }
                return;
            }
            if (this._recvHistLocked) {
                this._recvHistLocked = false;
                this.populateFilterTypes();
                this.render();
            }
        } catch (e) {
            if (typeof window !== "undefined" && window.__GNEEX_DEBUG) {
                console.warn("applyMaterialReceptionHistoryLock", e);
            }
        }
    },

    populateFilterTypes() {
        const select = document.getElementById('filter-type');
        if (!select) return;
        const lock =
            typeof Auth !== "undefined" &&
            Auth.historyMaterialReceptionOnly &&
            Auth.historyMaterialReceptionOnly();

        if (lock) {
            select.disabled = true;
            select.innerHTML = `<option value="RECEPCION_MATERIAL">${this._esc(I18n.t('movType.RECEPCION_MATERIAL'))}</option>`;
            select.value = "RECEPCION_MATERIAL";
            return;
        }

        select.disabled = false;
        select.innerHTML = `<option value="">${this._esc(I18n.t('history.all'))}</option>`;
        Object.keys(MOVEMENT_TYPES).forEach(type => {
            select.innerHTML += `<option value="${type}">${this._esc(I18n.t(`movType.${type}`))}</option>`;
        });
    },

    /** Lista filtrada según los campos del historial (más recientes primero). */
    getFilteredMovements() {
        if (!MovementManager.movements || !MovementManager.movements.length) return [];
        let movements = [...MovementManager.movements].reverse();
        return this.applyFilters(movements);
    },

    /** XLSX del historial según filtros actuales (útil en vistas sin tabla HTML). */
    exportFilteredMovementsSpreadsheet() {
        try {
            const rows = this.getFilteredMovements();
            if (!rows.length) {
                Utils.showToast(I18n.t("ui.exportActiveTabNoTable"), "info");
                return;
            }
            const headers = ["reference", "type", "date", "projectId", "salesOrder", "prNumber", "createdBy", "notes"];
            const objs = rows.map(m => ({
                reference: String(m.reference || ""),
                type: String(m.type || ""),
                date:
                    m.date && typeof Utils.formatDateTime === "function"
                        ? Utils.formatDateTime(m.date)
                        : String(m.date || ""),
                projectId: String(m.projectId || ""),
                salesOrder: String(m.salesOrder || ""),
                prNumber: String(m.prNumber || ""),
                createdBy: String(m.createdBy || ""),
                notes: String(m.notes || "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 1200)
            }));
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const fn = `GNEEX_Historial_filtrado_${stamp}.xlsx`;
            const buf = Utils.buildStyledXlsxBuffer(headers, objs, {
                kind: "history-filtered",
                title: "Historial filtrado"
            });
            if (!buf || !buf.byteLength) {
                Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
                return;
            }
            Utils.downloadArrayBuffer(buf, fn);
            Utils.showToast(I18n.t("ui.exportDone"), "success");
        } catch (e) {
            if (typeof window !== "undefined" && window.__GNEEX_DEBUG) {
                console.warn("exportFilteredMovementsSpreadsheet", e);
            }
            Utils.showToast(I18n.t("msg.errorExportingReport"), "error");
        }
    },

    applyFilters(movements) {
        const type = document.getElementById('filter-type')?.value || '';
        const ref = this._normalizeFilterText(document.getElementById('filter-ref')?.value || '');
        const code = this._normalizeFilterText(document.getElementById('filter-code')?.value || '');
        const desc = this._normalizeFilterText(document.getElementById('filter-desc')?.value || '');
        const notesNeedle = this._normalizeFilterText(document.getElementById('filter-notes')?.value || '');
        const dateFrom = document.getElementById('filter-date-from')?.value || '';
        const dateTo = document.getElementById('filter-date-to')?.value || '';
        const location = this._normalizeFilterText(document.getElementById('filter-location')?.value || '');
        const projectId = this._normalizeFilterText(document.getElementById('filter-project-id')?.value || '');
        const salesOrderNeedle = this._normalizeFilterText(document.getElementById('filter-sales-order')?.value || '');
        const prNeedle = this._normalizeFilterText(document.getElementById('filter-pr-number')?.value || '');
        const createdBy = this._normalizeFilterText(document.getElementById('filter-created-by')?.value || '');
        const recipient = this._normalizeFilterText(document.getElementById('filter-recipient')?.value || '');
        const supplier = this._normalizeFilterText(document.getElementById('filter-supplier')?.value || '');
        const qtyMinRaw = document.getElementById('filter-qty-min')?.value ?? '';
        const qtyMaxRaw = document.getElementById('filter-qty-max')?.value ?? '';
        const qtyMin = qtyMinRaw === '' ? NaN : parseFloat(String(qtyMinRaw).replace(',', '.'));
        const qtyMax = qtyMaxRaw === '' ? NaN : parseFloat(String(qtyMaxRaw).replace(',', '.'));
        const overdraft = document.getElementById('filter-overdraft')?.value || '';
        const negativeStock = document.getElementById('filter-negative-stock')?.value || '';
        const annulFilter = document.getElementById('filter-annul-status')?.value || '';

        const recvOnly =
            typeof Auth !== "undefined" &&
            Auth.historyMaterialReceptionOnly &&
            Auth.historyMaterialReceptionOnly();
        const typeSelected = recvOnly ? "RECEPCION_MATERIAL" : type;

        return movements.filter(mov => {
            const items = mov.items || [];
            if (recvOnly && mov.type !== "RECEPCION_MATERIAL") return false;
            if (!this._movementAnnulFilterMatch(mov, annulFilter)) return false;
            if (typeSelected && mov.type !== typeSelected) return false;
            if (ref && !this._normalizeFilterText(mov.reference || '').includes(ref)) return false;
            if (code && !this._movementMatchesCodeFilter(mov, code)) return false;
            if (desc) {
                const hitD = hay => this._normalizeFilterText(hay).includes(desc);
                const inLines = items.some(
                    i =>
                        i &&
                        (hitD(i.description) ||
                            hitD(i.recipientName || ''))
                );
                const inTfTarget =
                    mov.type === 'TRANSFORMACION' && hitD(mov.transformationTargetDescription);
                let invDesc = false;
                if (mov.type === 'TRANSFORMACION' && mov.transformationTargetItemId && typeof InventoryManager !== 'undefined') {
                    const ti = InventoryManager.items.find(
                        x => String(x.id) === String(mov.transformationTargetItemId)
                    );
                    if (ti) invDesc = hitD(ti.description);
                }
                if (!inLines && !inTfTarget && !invDesc) {
                    for (const i of items) {
                        if (!i || !i.itemId || typeof InventoryManager === 'undefined') continue;
                        const it = InventoryManager.items.find(x => String(x.id) === String(i.itemId));
                        if (it && hitD(it.description)) {
                            invDesc = true;
                            break;
                        }
                    }
                }
                if (!inLines && !inTfTarget && !invDesc) return false;
            }
            if (notesNeedle && !this._normalizeFilterText(mov.notes || '').includes(notesNeedle)) return false;
            if (dateFrom && new Date(mov.date) < new Date(dateFrom)) return false;
            if (dateTo && new Date(mov.date) > new Date(dateTo + 'T23:59:59')) return false;
            if (location) {
                const hitL = hay => this._normalizeFilterText(hay).includes(location);
                const inLines = items.some(i => hitL(i.location));
                let tfLoc = false;
                if (
                    mov.type === 'TRANSFORMACION' &&
                    mov.transformationTargetItemId &&
                    typeof InventoryManager !== 'undefined'
                ) {
                    const it = InventoryManager.items.find(
                        i => String(i.id) === String(mov.transformationTargetItemId)
                    );
                    if (it && hitL(it.location)) tfLoc = true;
                }
                if (!inLines && !tfLoc) return false;
            }
            if (projectId && !this._normalizeFilterText(mov.projectId || '').includes(projectId)) return false;
            if (salesOrderNeedle && !this._normalizeFilterText(mov.salesOrder || '').includes(salesOrderNeedle)) return false;
            if (prNeedle && !this._normalizeFilterText(mov.prNumber || '').includes(prNeedle)) return false;
            if (createdBy && !this._normalizeFilterText(mov.createdBy || '').includes(createdBy)) return false;
            if (recipient) {
                const hitR = hay => this._normalizeFilterText(hay).includes(recipient);
                if (!items.some(i => i && hitR(i.recipientName || ''))) return false;
            }
            if (supplier) {
                const pm = mov.purchaseMeta && typeof mov.purchaseMeta === 'object' ? mov.purchaseMeta : {};
                const sup = this._normalizeFilterText(pm.supplier || '');
                if (!sup.includes(supplier)) return false;
            }
            if (Number.isFinite(qtyMin) || Number.isFinite(qtyMax)) {
                const lineMatch = items.some(i => {
                    if (!i) return false;
                    const q = Math.abs(parseFloat(i.quantity) || 0);
                    if (Number.isFinite(qtyMin) && q < qtyMin - 1e-9) return false;
                    if (Number.isFinite(qtyMax) && q > qtyMax + 1e-9) return false;
                    return true;
                });
                if (!lineMatch) return false;
            }
            if (overdraft === 'yes' && !MovementManager.effectiveHadOverdraft(mov)) return false;
            if (overdraft === 'no' && MovementManager.effectiveHadOverdraft(mov)) return false;
            
            if (negativeStock === 'yes' || negativeStock === 'no') {
                const hasNegative = items.some(item => {
                    const stock = InventoryManager.getStock(item.itemId, item.target);
                    return stock < 0;
                });
                if (negativeStock === 'yes' && !hasNegative) return false;
                if (negativeStock === 'no' && hasNegative) return false;
            }

            return true;
        });
    },

    render() {
        const container = document.getElementById('history-cells');
        if (!container) return;

        const mode = this._getHistoryView();
        container.className = `history-cells-container history-cells--${mode}`;
        this._syncHistoryViewToolbar();

        if (!MovementManager.movements || MovementManager.movements.length === 0) {
            container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 2rem;">${this._esc(I18n.t('history.noMovements'))}</p>`;
            this.maybeRefreshConsumoLedger();
            if (typeof App !== "undefined" && App.refreshActiveTabTableExportButton) App.refreshActiveTabTableExportButton();
            return;
        }

        const movements =
            mode === 'carousel'
                ? this.applyFilters([...(MovementManager.movements || [])]).sort((a, b) => {
                      const ta = new Date(a.date || 0).getTime();
                      const tb = new Date(b.date || 0).getTime();
                      if (ta !== tb) return tb - ta;
                      return String(b.id || '').localeCompare(String(a.id || ''));
                  })
                : this.getFilteredMovements();

        if (movements.length === 0) {
            container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 2rem;">${this._esc(I18n.t('msg.noResults'))}</p>`;
            this.maybeRefreshConsumoLedger();
            if (typeof App !== "undefined" && App.refreshActiveTabTableExportButton) App.refreshActiveTabTableExportButton();
            return;
        }

        if (mode === 'details') {
            container.innerHTML = this._movementDetailsTableHtml(movements);
            const histTb = container.querySelector('.history-details-table tbody');
            if (histTb && typeof Utils !== 'undefined' && Utils.installTableBodyArrowNav) {
                Utils.installTableBodyArrowNav(histTb);
            }
        } else if (mode === 'carousel') {
            container.innerHTML = this._movementCarouselHtml(movements);
            this._bindHistoryCarouselDateSync();
            const carouselTrack = container.querySelector('[data-history-carousel-track]');
            if (carouselTrack && typeof Utils !== 'undefined' && Utils.installListArrowNav) {
                Utils.installListArrowNav(carouselTrack, '.history-carousel-card');
            }
        } else if (mode === 'list') {
            container.innerHTML = movements.map(mov => this._movementListRowHtml(mov)).join('');
            if (typeof Utils !== 'undefined' && Utils.installListArrowNav) {
                Utils.installListArrowNav(container, '.history-list-row');
            }
        } else {
            container.innerHTML = movements.map(mov => this._movementTileHtml(mov)).join('');
        }
        this.maybeRefreshConsumoLedger();
        if (typeof App !== "undefined" && App.refreshActiveTabTableExportButton) App.refreshActiveTabTableExportButton();
    },

    maybeRefreshConsumoLedger() {
        const det = document.getElementById('consumo-recipient-ledger-details');
        if (det && det.open) this.renderConsumoRecipientLedger();
    },

    /** Mueve filtros + tabla al overlay grande; el mismo DOM conserva filtros y datos. */
    openConsumoLedgerExpandedView() {
        const det = document.getElementById('consumo-recipient-ledger-details');
        const root = document.getElementById('consumo-ledger-expandable-root');
        const slot = document.getElementById('consumo-ledger-fs-slot');
        const overlay = document.getElementById('consumo-ledger-fs-overlay');
        if (!root || !slot || !overlay) return;
        if (det) det.open = true;
        slot.appendChild(root);
        overlay.hidden = false;
        document.body.classList.add('consumo-ledger-fs-open');
        this.renderConsumoRecipientLedger();
        document.getElementById('consumo-ledger-fs-close')?.focus();
    },

    closeConsumoLedgerExpandedView() {
        const root = document.getElementById('consumo-ledger-expandable-root');
        const details = document.getElementById('consumo-recipient-ledger-details');
        const overlay = document.getElementById('consumo-ledger-fs-overlay');
        if (!overlay || overlay.hidden) return;
        if (root && details) details.appendChild(root);
        overlay.hidden = true;
        document.body.classList.remove('consumo-ledger-fs-open');
        this.renderConsumoRecipientLedger();
    },

    _isConsumoLedgerExpandedOpen() {
        const overlay = document.getElementById('consumo-ledger-fs-overlay');
        return !!(overlay && !overlay.hidden);
    },

    /**
     * Líneas de consumo diario con destinatario (más recientes primero).
     * @param {boolean} fromLedgerInputs Si true, aplica filtros de persona/código del bloque Historial.
     */
    getConsumoRecipientLedgerRows(fromLedgerInputs = true) {
        let personN = '';
        let codeN = '';
        if (fromLedgerInputs) {
            personN = this._normalizeFilterText(document.getElementById('ledger-filter-person')?.value || '');
            codeN = this._normalizeFilterText(document.getElementById('ledger-filter-code')?.value || '');
        }
        const rows = [];
        for (const m of MovementManager.movements || []) {
            if (m.type !== 'CONSUMO_DIARIO' || m.annulled) continue;
            for (const it of m.items || []) {
                if (!it || it.annulled || it.transformationOutput) continue;
                const person = String(it.recipientName || '').trim();
                const code = this._lineItemCode(it);
                if (!person) continue;
                if (personN && !this._normalizeFilterText(person).includes(personN)) continue;
                if (codeN && !this._normalizeFilterText(code).includes(codeN)) continue;
                rows.push({ m, it, person, code });
            }
        }
        rows.sort((a, b) => new Date(b.m.date) - new Date(a.m.date));
        return rows;
    },

    _fmtLedgerQty(q) {
        const x = Math.abs(parseFloat(q) || 0);
        return Utils.formatDecimalDisplay(x);
    },

    /** { headers: string[], rowObjects: {}[] } para Utils.toCSV */
    buildConsumoRecipientLedgerCsvPayload(rows) {
        const headers = [
            I18n.t('standby.date'),
            I18n.t('standby.reference'),
            I18n.t('movements.recipientName'),
            I18n.t('table.code'),
            I18n.t('table.description'),
            I18n.t('table.quantity'),
            I18n.t('table.target')
        ];
        const rowObjects = rows.map(r => {
            const o = {};
            o[headers[0]] = r.m.date ? Utils.formatDateTime(r.m.date) : '';
            o[headers[1]] = r.m.reference || '';
            o[headers[2]] = r.person || '';
            o[headers[3]] = r.code || '';
            o[headers[4]] = r.it.description || '';
            o[headers[5]] = this._fmtLedgerQty(r.it.quantity);
            o[headers[6]] = I18n.t(`target.${r.it.target || 'main'}`);
            return o;
        });
        return { headers, rowObjects };
    },

    async printConsumoRecipientLedger() {
        if (typeof Auth !== 'undefined' && !Auth.hasConsumoLedgerAdmin()) return;
        const rows = this.getConsumoRecipientLedgerRows(true);
        if (!rows.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        const esc = s => this._esc(s);
        const headLabels = [
            I18n.t('standby.date'),
            I18n.t('standby.reference'),
            I18n.t('movements.recipientName'),
            I18n.t('table.code'),
            I18n.t('table.description'),
            I18n.t('table.quantity'),
            I18n.t('table.target')
        ];
        const selected = await Utils.pickColumns(headLabels, I18n.t("history.consumoRecipientLedgerTitle"));
        if (!selected || !selected.length) return;
        const body = rows
            .map(r => {
                const map = {
                    [I18n.t('standby.date')]: `<td>${esc(Utils.formatDateTime(r.m.date))}</td>`,
                    [I18n.t('standby.reference')]: `<td>${esc(r.m.reference || '')}</td>`,
                    [I18n.t('movements.recipientName')]: `<td>${esc(r.person || '—')}</td>`,
                    [I18n.t('table.code')]: `<td class="print-cell-code app-code-copy-cell">${esc(r.code)}</td>`,
                    [I18n.t('table.description')]: `<td class="app-desc-copy-cell">${esc(r.it.description || '')}</td>`,
                    [I18n.t('table.quantity')]: `<td>${esc(this._fmtLedgerQty(r.it.quantity))}</td>`,
                    [I18n.t('table.target')]: `<td>${esc(I18n.t(`target.${r.it.target || 'main'}`))}</td>`
                };
                return `<tr>${selected.map(h => map[h] || "<td></td>").join("")}</tr>`;
            })
            .join('');
        const headRow = selected
            .map((label, i) => {
                const cls = label === I18n.t('table.code') ? "print-cell-code" : "";
                return `<th${cls ? ` class="${cls}"` : ""}>${esc(label)}</th>`;
            })
            .join("");
        const table = `<table class="inventory-table"><thead><tr>${headRow}</tr></thead><tbody>${body}</tbody></table>`;
        const subParts = [];
        const pf = (document.getElementById('ledger-filter-person')?.value || '').trim();
        const cf = (document.getElementById('ledger-filter-code')?.value || '').trim();
        if (pf) subParts.push(`${I18n.t('history.ledgerFilterPerson')}: ${esc(pf)}`);
        if (cf) subParts.push(`${I18n.t('history.ledgerFilterCode')}: ${esc(cf)}`);
        const subtitle = subParts.length ? subParts.join(' · ') : I18n.t('history.consumoLedgerPrintSubtitleAll');
        Utils.printHtmlDocument(I18n.t('history.consumoRecipientLedgerTitle'), subtitle, table);
    },

    async exportConsumoRecipientLedgerCsv(fromLedgerInputs = true) {
        if (typeof Auth !== 'undefined' && !Auth.hasConsumoLedgerAdmin()) return;
        const rows = this.getConsumoRecipientLedgerRows(fromLedgerInputs);
        if (!rows.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        const { headers, rowObjects } = this.buildConsumoRecipientLedgerCsvPayload(rows);
        const selected = await Utils.pickColumns(headers, I18n.t("history.exportFilteredCsv"));
        if (!selected || !selected.length) return;
        const projected = rowObjects.map(r => {
            const o = {};
            selected.forEach(h => {
                o[h] = r[h] ?? "";
            });
            return o;
        });
        const stamp =
            typeof ReportExporter !== 'undefined' && ReportExporter.fileStamp
                ? ReportExporter.fileStamp()
                : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const suffix = fromLedgerInputs ? 'ledger' : 'all';
        const name = `GNEEX_Consumo_destinatario_${suffix}_${stamp}.xlsx`;
        const pf = fromLedgerInputs
            ? (document.getElementById('ledger-filter-person')?.value || '').trim()
            : '';
        const cf = fromLedgerInputs
            ? (document.getElementById('ledger-filter-code')?.value || '').trim()
            : '';
        const details = [
            `${I18n.t('export.manifest.rows')}: ${rows.length}`,
            fromLedgerInputs ? I18n.t('export.manifest.ledgerModeLedger') : I18n.t('export.manifest.ledgerModeAll')
        ];
        if (pf) details.push(`${I18n.t('history.ledgerFilterPerson')}: ${pf}`);
        if (cf) details.push(`${I18n.t('history.ledgerFilterCode')}: ${cf}`);
        await Utils.exportStyledXlsxToInformFolder(name, selected, projected, {
            kind: `history:consumo_ledger_${suffix}`,
            title: I18n.t('export.manifest.consumoLedger'),
            details
        });
    },

    async printFilteredHistoryList() {
        const list = this.getFilteredMovements();
        if (!list.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        const esc = s => this._esc(s);
        const th = k => `<th>${esc(I18n.t(k))}</th>`;
        const headKeys = [
            'standby.reference',
            'standby.date',
            'history.filterType',
            'movements.projectId',
            'table.status',
            'history.createdBy'
        ];
        const labels = headKeys.map(k => I18n.t(k));
        const selected = await Utils.pickColumns(labels, I18n.t("history.printFiltered"));
        if (!selected || !selected.length) return;
        const body = list
            .map(m => {
                const st = m.annulled
                    ? I18n.t('status.annulled')
                    : this._isMovementPartiallyAnnulled(m)
                      ? I18n.t('history.statusPartiallyAnnulled')
                      : I18n.t('status.active');
                const proj =
                  m.type === 'CONSUMO_DIARIO' ? '' : (m.projectId || '');
                const map = {
                  [I18n.t('standby.reference')]: `<td>${esc(m.reference || '')}</td>`,
                  [I18n.t('standby.date')]: `<td>${esc(Utils.formatDateTime(m.date))}</td>`,
                  [I18n.t('history.filterType')]: `<td>${esc(I18n.t(`movType.${m.type}`))}</td>`,
                  [I18n.t('movements.projectId')]: `<td>${esc(proj)}</td>`,
                  [I18n.t('table.status')]: `<td>${esc(st)}</td>`,
                  [I18n.t('history.createdBy')]: `<td>${esc(m.createdBy || '')}</td>`
                };
                return `<tr>${selected.map(h => map[h] || "<td></td>").join("")}</tr>`;
            })
            .join('');
        const table = `<table class="inventory-table"><thead><tr>${selected.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
        Utils.printHtmlDocument(I18n.t('history.printFilteredTitle'), I18n.t('history.printFilteredSubtitle'), table);
    },

    async exportFilteredHistorySummaryCsv() {
        if (typeof Auth !== 'undefined' && !Auth.guardPerm('movements')) return;
        const list = this.getFilteredMovements();
        if (!list.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        if (typeof ReportExporter === 'undefined' || !ReportExporter.buildMovementsSummary) {
            Utils.showToast(I18n.t('msg.errorExportingReport'), 'error');
            return;
        }
        const { headers, rows } = ReportExporter.buildMovementsSummary(list);
        const selected = await Utils.pickColumns(headers, I18n.t("history.exportFilteredCsv"));
        if (!selected || !selected.length) return;
        const projected = rows.map(r => {
            const o = {};
            selected.forEach(h => {
                o[h] = r[h] ?? "";
            });
            return o;
        });
        const rng =
            typeof ReportExporter !== 'undefined' && ReportExporter.dateRange
                ? ReportExporter.dateRange(list)
                : '';
        const name = `GNEEX_History_Filtered_Summary_${rng || (typeof ReportExporter !== 'undefined' && ReportExporter.fileStamp ? ReportExporter.fileStamp() : 'export')}.xlsx`;
        await Utils.exportStyledXlsxToInformFolder(name, selected, projected, {
            kind: 'history:filtered_summary',
            title: I18n.t('export.manifest.historyFiltered'),
            details: [`${I18n.t('export.manifest.rows')}: ${list.length}`]
        });
    },

    /**
     * HTML de impresión del detalle: tablas (cabecera del movimiento + líneas como en export XLSX), sin botones ni layout del modal.
     */
    _buildMovementDetailPrintInnerHtml(movement, selectedLineHeaders = null) {
        const esc = s => this._esc(s);
        const m = movement;
        const rows = [];

        const add = (label, value) => {
            if (value === undefined || value === null) return;
            const t = typeof value === "string" ? value.trim() : String(value);
            rows.push({ label, value: t });
        };

        add(I18n.t("history.filterRef"), m.reference || "");
        add(I18n.t("history.filterType"), I18n.t(`movType.${m.type}`) || m.type || "");
        add(I18n.t("history.movementDate"), Utils.formatDateTime(m.date));
        if (m.type !== "CONSUMO_DIARIO") add(I18n.t("movements.projectId"), m.projectId || "—");
        if (m.type === "VENTA_DIRECTA" && String(m.salesOrder || "").trim())
            add(I18n.t("movements.salesOrder"), m.salesOrder);
        if (m.type === "EXPEDICION_STOCK" && String(m.prNumber || "").trim())
            add(I18n.t("movements.prNumber"), m.prNumber);
        add(
            I18n.t("table.status"),
            m.annulled
                ? I18n.t("status.annulled")
                : this._isMovementPartiallyAnnulled(m)
                  ? I18n.t("history.statusPartiallyAnnulled")
                  : I18n.t("status.active")
        );
        add(I18n.t("history.createdBy"), m.createdBy || "—");
        if (m.notes && String(m.notes).trim()) add(I18n.t("movements.notes"), String(m.notes).trim());
        if (MovementManager.effectiveHadOverdraft(m)) {
            add(I18n.t("history.overdraftFlag"), I18n.t("history.yes"));
            add(
                I18n.t("history.overdraftReason"),
                m.overdraftReason || I18n.t("history.overdraftReasonMissing")
            );
            if (m.overdraftAt)
                add(`${I18n.t("history.overdraftFlag")} (${I18n.t("standby.date")})`, Utils.formatDateTime(m.overdraftAt));
        }
        if (m.transportExpeditedAt)
            add(I18n.t("history.transportExpedited"), Utils.formatDateTime(m.transportExpeditedAt));
        if (m.type === "TRANSFORMACION" && m.transformationVendor)
            add(I18n.t("movements.transformationVendor"), m.transformationVendor);
        if (m.type === "TRANSFORMACION" && (m.transformationTargetCode || m.transformationTargetDescription)) {
            const tgt = [m.transformationTargetCode, m.transformationTargetDescription]
                .filter(Boolean)
                .join(" — ");
            add(I18n.t("movements.transformationTarget"), tgt || "—");
        }
        if (m.purchaseMeta) {
            add(I18n.t("movCompra.po"), m.purchaseMeta.poNumber || "—");
            add(I18n.t("movCompra.packingSlip"), m.purchaseMeta.packingSlip || "—");
            add(I18n.t("reception.supplier"), m.purchaseMeta.supplier || "—");
        }
        if (m.type === "COMPRA_STOCK" && m.orderLineId) {
            let orderLineDisplay = String(m.orderLineId);
            if (
                typeof OrderLinesManager !== "undefined" &&
                OrderLinesManager.getLine &&
                OrderLinesManager.formatLineRef
            ) {
                const line = OrderLinesManager.getLine(m.orderLineId);
                if (line) orderLineDisplay = OrderLinesManager.formatLineRef(line);
            }
            add(I18n.t("history.compraFromOrderPanelBadge"), orderLineDisplay);
        }
        const snap = m.receptionSnapshot;
        if (snap) {
            const catLabel =
                I18n.t(`reception.mat.${snap.materialCategory}`) !==
                `reception.mat.${snap.materialCategory}`
                    ? I18n.t(`reception.mat.${snap.materialCategory}`)
                    : snap.materialCategory;
            add(I18n.t("reception.materialCategory"), catLabel || "—");
            add(I18n.t("reception.item"), snap.itemName || "—");
            add(I18n.t("reception.quantity"), snap.quantity != null ? String(snap.quantity) : "—");
            add(I18n.t("reception.purchaseOrder"), snap.purchaseOrder || "—");
            add(
                I18n.t("reception.provisional"),
                snap.provisional ? I18n.t("history.yes") : I18n.t("history.no")
            );
            const d = snap.dimensions || {};
            const dL = parseFloat(d.L) || 0;
            const dW = parseFloat(d.W) || 0;
            const dH = parseFloat(d.H) || 0;
            if (dL > 0 || dW > 0 || dH > 0) {
                const fmtn = v =>
                    v > 0 ? String(Utils.roundDecimal(v, 4)).replace(/\.?0+$/, "") : "0";
                add(
                    I18n.t("reception.dimensionsCol"),
                    `${fmtn(dL)}×${fmtn(dW)}×${fmtn(dH)}`
                );
            }
            if (snap.glassPacking === "standard_box" || snap.glassPacking === "loose_mixed") {
                add(
                    I18n.t("reception.glassPackingCol"),
                    snap.glassPacking === "standard_box"
                        ? I18n.t("reception.glassPackingStandard")
                        : I18n.t("reception.glassPackingLoose")
                );
            }
        }
        const atts = Array.isArray(m.attachments) ? m.attachments : [];
        if (atts.length) {
            const names = atts
                .map(a => a.originalName || a.fileName || "—")
                .filter(Boolean)
                .join("; ");
            if (names) add(I18n.t("attachments.title"), names);
        }

        const metaTable = `<table class="movement-print-meta"><tbody>${rows
            .map(
                r => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`
            )
            .join("")}</tbody></table>`;

        let linesBlock = "";
        if (typeof ReportExporter !== "undefined" && ReportExporter.buildMovementItemRows) {
            let payload = ReportExporter.buildMovementItemRows([m]);
            let { headers, rows: dataRows } = payload;
            if (!dataRows.length && ReportExporter.buildMovementsSummary) {
                payload = ReportExporter.buildMovementsSummary([m]);
                ({ headers, rows: dataRows } = payload);
            }
            if (headers.length && dataRows.length) {
                const shownHeaders =
                    Array.isArray(selectedLineHeaders) && selectedLineHeaders.length
                        ? headers.filter(h => selectedLineHeaders.includes(h))
                        : headers;
                if (!shownHeaders.length) return `<div class="movement-print-document">${metaTable}</div>`;
                const codeH = I18n.t("table.code");
                const thead = `<thead><tr>${shownHeaders
                    .map(h => {
                        const cls = h === codeH ? "print-cell-code" : "";
                        return `<th${cls ? ` class="${cls}"` : ""}>${esc(h)}</th>`;
                    })
                    .join("")}</tr></thead>`;
                const tbody = `<tbody>${dataRows
                    .map(row => {
                        const cells = shownHeaders.map(h => {
                            const cell = row[h];
                            const t = cell == null ? "" : String(cell);
                            const cls = h === codeH ? "print-cell-code" : "";
                            return `<td${cls ? ` class="${cls}"` : ""}>${esc(t)}</td>`;
                        });
                        return `<tr>${cells.join("")}</tr>`;
                    })
                    .join("")}</tbody>`;
                linesBlock = `<p class="print-section-title">${esc(
                    I18n.t("movements.selectedItems")
                )}</p><table class="inventory-table">${thead}${tbody}</table>`;
            }
        }

        return `<div class="movement-print-document">${metaTable}${linesBlock}</div>`;
    },

    async printCurrentMovementDetail() {
        if (!this.currentMovement) return;
        const m = this.currentMovement;
        let selectedLineHeaders = null;
        if (typeof ReportExporter !== "undefined" && ReportExporter.buildMovementItemRows) {
            let payload = ReportExporter.buildMovementItemRows([m]);
            let candHeaders = payload.headers || [];
            if ((!candHeaders || !candHeaders.length) && ReportExporter.buildMovementsSummary) {
                payload = ReportExporter.buildMovementsSummary([m]);
                candHeaders = payload.headers || [];
            }
            if (candHeaders.length) {
                selectedLineHeaders = await Utils.pickColumns(candHeaders, I18n.t("history.printMovementDetail"));
                if (!selectedLineHeaders || !selectedLineHeaders.length) return;
            }
        }
        const title = `${I18n.t(`movType.${m.type}`)} — ${m.reference || ""}`;
        const showProj = m.type !== "CONSUMO_DIARIO";
        const subtitle = `${Utils.formatDateTime(m.date)}${
            showProj && m.projectId ? ` · ${I18n.t("movements.projectId")}: ${m.projectId}` : ""
        }`;
        Utils.printHtmlDocument(title, subtitle, this._buildMovementDetailPrintInnerHtml(m, selectedLineHeaders));
    },

    async exportCurrentMovementDetailCsv() {
        if (typeof Auth !== 'undefined' && !Auth.guardPerm('movements')) return;
        if (!this.currentMovement) return;
        if (typeof ReportExporter === 'undefined' || !ReportExporter.buildMovementItemRows) {
            Utils.showToast(I18n.t('msg.errorExportingReport'), 'error');
            return;
        }
        const m = this.currentMovement;
        let { headers, rows } = ReportExporter.buildMovementItemRows([m]);
        if (!rows.length && ReportExporter.buildMovementsSummary) {
            ({ headers, rows } = ReportExporter.buildMovementsSummary([m]));
        }
        if (!rows.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        const selected = await Utils.pickColumns(headers, I18n.t('history.exportMovementCsv'));
        if (!selected || !selected.length) return;
        const projected = rows.map(r => {
            const o = {};
            selected.forEach(h => {
                o[h] = r[h] ?? "";
            });
            return o;
        });
        const stamp =
            typeof ReportExporter !== 'undefined' && ReportExporter.fileStamp
                ? ReportExporter.fileStamp()
                : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const refSafe = String(m.reference || 'mov').replace(/[^\w\-]+/g, '_');
        const name = `GNEEX_Movement_${refSafe}_lines_${stamp}.xlsx`;
        const typeLbl =
            m.type && typeof I18n !== 'undefined' ? I18n.t(`movType.${m.type}`) : '';
        await Utils.exportStyledXlsxToInformFolder(name, selected, projected, {
            kind: 'history:movement_detail_lines',
            title: I18n.t('export.manifest.historyMovementDetail'),
            details: [
                `${I18n.t('history.filterRef')}: ${m.reference || '—'}`,
                typeLbl ? `${I18n.t('history.filterType')}: ${typeLbl}` : '',
                `${I18n.t('export.manifest.rows')}: ${projected.length}`
            ].filter(Boolean)
        });
    },

    /**
     * Tabla de auditoría: consumo diario archivado por persona, artículo, cantidad y fecha.
     * Respeta filtros locales del bloque (persona / código).
     */
    renderConsumoRecipientLedger() {
        const body = document.getElementById('consumo-recipient-ledger-body');
        if (!body) return;
        const rows = this.getConsumoRecipientLedgerRows(true);
        const esc = s => this._esc(s);
        const editable =
            typeof Auth === 'undefined' ||
            typeof Auth.hasConsumoLedgerAdmin !== 'function' ||
            Auth.hasConsumoLedgerAdmin();
        const det = document.getElementById('consumo-recipient-ledger-details');
        if (det) det.classList.toggle('consumo-ledger-editable', editable);
        if (!rows.length) {
            const colspan = editable ? 8 : 7;
            body.innerHTML = `<tr><td colspan="${colspan}" class="muted" style="text-align:center;padding:1rem;">${esc(I18n.t('history.consumoLedgerEmpty'))}</td></tr>`;
            return;
        }
        body.innerHTML = rows
            .map(
                r =>
                    editable
                        ? `
            <tr data-ledger-mid="${Utils.escapeAttr(r.m.id)}" data-ledger-idx="${Utils.escapeAttr(String((r.m.items || []).indexOf(r.it)))}">
                <td>${esc(Utils.formatDateTime(r.m.date))}</td>
                <td>${esc(r.m.reference || '')}</td>
                <td>
                    <input
                        type="text"
                        class="filter-input ledger-recipient-input"
                        value="${Utils.escapeAttr(r.person || '')}"
                        autocomplete="name"
                        data-ledger-mid="${Utils.escapeAttr(r.m.id)}"
                        data-ledger-idx="${Utils.escapeAttr(String((r.m.items || []).indexOf(r.it)))}"
                    >
                </td>
                <td class="app-code-copy-cell"><strong>${esc(r.code)}</strong></td>
                <td class="app-desc-copy-cell">${esc(r.it.description || '')}</td>
                <td>${esc(this._fmtLedgerQty(r.it.quantity))}</td>
                <td>${esc(I18n.t(`target.${r.it.target || 'main'}`))}</td>
                <td>
                    <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        data-ledger-clear-row="1"
                        data-ledger-mid="${Utils.escapeAttr(r.m.id)}"
                        data-ledger-idx="${Utils.escapeAttr(String((r.m.items || []).indexOf(r.it)))}"
                    >${esc(I18n.t('history.consumoLedgerClearRow'))}</button>
                </td>
            </tr>`
                        : `
            <tr>
                <td>${esc(Utils.formatDateTime(r.m.date))}</td>
                <td>${esc(r.m.reference || '')}</td>
                <td>${esc(r.person || '')}</td>
                <td class="app-code-copy-cell"><strong>${esc(r.code)}</strong></td>
                <td class="app-desc-copy-cell">${esc(r.it.description || '')}</td>
                <td>${esc(this._fmtLedgerQty(r.it.quantity))}</td>
                <td>${esc(I18n.t(`target.${r.it.target || 'main'}`))}</td>
            </tr>`
            )
            .join('');
        if (typeof Utils !== 'undefined' && Utils.installTableBodyArrowNav) {
            Utils.installTableBodyArrowNav(body);
        }
    },

    saveConsumoRecipientLedgerEdits() {
        if (typeof Auth !== 'undefined' && !Auth.hasConsumoLedgerAdmin()) return;
        const inputs = document.querySelectorAll('#consumo-recipient-ledger-body .ledger-recipient-input');
        if (!inputs.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        let changed = 0;
        inputs.forEach(inp => {
            const movementId = inp.getAttribute('data-ledger-mid') || '';
            const itemIndex = parseInt(inp.getAttribute('data-ledger-idx') || '-1', 10);
            if (!movementId || !Number.isInteger(itemIndex) || itemIndex < 0) return;
            const movement = (MovementManager.movements || []).find(m => String(m.id) === String(movementId));
            if (!movement || movement.annulled || !Array.isArray(movement.items) || itemIndex >= movement.items.length) return;
            const item = movement.items[itemIndex];
            if (!item || item.annulled || item.transformationOutput) return;
            const nextName = String(inp.value || '').trim();
            const prevName = String(item.recipientName || '').trim();
            if (nextName === prevName) return;
            item.recipientName = nextName;
            if (!nextName) {
                delete item.recipientClass;
                delete item.consumoRecipientEntry;
            }
            changed += 1;
        });
        if (!changed) {
            Utils.showToast(I18n.t('msg.consumoLedgerNothingToSave'), 'info');
            return;
        }
        MovementManager.save();
        if (typeof Auth !== 'undefined' && Auth.logAudit) {
            Auth.logAudit('history.consumoLedger.save', `${changed} line(s) by ${Auth.getDisplayName()}`);
        }
        Utils.showToast(I18n.t('msg.consumoLedgerSaved'), 'success');
        this.render();
    },

    _clearSingleLedgerRecipient(movementId, itemIndex) {
        const movement = (MovementManager.movements || []).find(m => String(m.id) === String(movementId));
        if (!movement || movement.annulled || !Array.isArray(movement.items) || itemIndex < 0 || itemIndex >= movement.items.length) return false;
        const item = movement.items[itemIndex];
        if (!item || item.annulled || item.transformationOutput) return false;
        const prev = String(item.recipientName || '').trim();
        if (!prev) return false;
        item.recipientName = '';
        delete item.recipientClass;
        delete item.consumoRecipientEntry;
        return true;
    },

    clearConsumoRecipientLedger() {
        if (typeof Auth !== 'undefined' && !Auth.hasConsumoLedgerAdmin()) return;
        const rows = this.getConsumoRecipientLedgerRows(true);
        if (!rows.length) {
            Utils.showToast(I18n.t('msg.reportEmpty'), 'warning');
            return;
        }
        App.showConfirm(I18n.t('confirm.consumoLedgerClear'), () => {
            let changed = 0;
            rows.forEach(r => {
                const idx = (r.m.items || []).indexOf(r.it);
                if (idx < 0) return;
                if (this._clearSingleLedgerRecipient(r.m.id, idx)) changed += 1;
            });
            if (!changed) {
                Utils.showToast(I18n.t('msg.consumoLedgerNothingToSave'), 'info');
                return;
            }
            MovementManager.save();
            if (typeof Auth !== 'undefined' && Auth.logAudit) {
                Auth.logAudit('history.consumoLedger.clear', `${changed} line(s) by ${Auth.getDisplayName()}`);
            }
            Utils.showToast(I18n.t('msg.consumoLedgerCleared'), 'success');
            this.render();
        });
    },

    clearConsumoRecipientLedgerRow(movementId, itemIndex) {
        if (typeof Auth !== 'undefined' && !Auth.hasConsumoLedgerAdmin()) return;
        App.showConfirm(I18n.t('confirm.consumoLedgerClearRow'), () => {
            if (!this._clearSingleLedgerRecipient(movementId, itemIndex)) {
                Utils.showToast(I18n.t('msg.consumoLedgerNothingToSave'), 'info');
                return;
            }
            MovementManager.save();
            if (typeof Auth !== 'undefined' && Auth.logAudit) {
                Auth.logAudit('history.consumoLedger.clear.row', `${movementId}[${itemIndex}] by ${Auth.getDisplayName()}`);
            }
            Utils.showToast(I18n.t('msg.consumoLedgerCleared'), 'success');
            this.render();
        });
    },

    /**
     * Depósito / origen en el detalle de línea (modal Historial).
     * AJUSTE ligado a caja: «Principal — Caja N (cantidad)» usando el mismo criterio que el formulario de movimientos.
     */
    _movementLineTargetLabelForDetail(movement, item) {
        if (
            movement.type === "TRANSFERENCIA" &&
            item.transferFrom &&
            item.transferTo &&
            item.transferFrom !== item.transferTo
        ) {
            return `${I18n.t(`target.${item.transferFrom}`)} → ${I18n.t(`target.${item.transferTo}`)}`;
        }
        if (movement.type === "AJUSTE" && item) {
            const sid = String(item.stockSourceId || "").trim();
            const boxLinked = !!(item.metaBoxMgrAjuste || sid.startsWith("box:"));
            if (boxLinked && typeof MovementManager !== "undefined" && MovementManager._formatStockSourceAsDestLabel) {
                const bl = MovementManager._formatStockSourceAsDestLabel(item);
                if (bl && String(bl).trim()) {
                    return `${I18n.t("target.main")} — ${bl}`;
                }
            }
        }
        const t = item.target || "main";
        const key = `target.${t}`;
        const lab = I18n.t(key);
        return lab !== key ? lab : t;
    },

    /** Evita «Caja N» duplicada cuando el resumen de depósito ya incluye la caja (AJUSTE desde gestor / origen box:). */
    _movementLineRedundantBoxNumberSuffix(movement, item) {
        if (!item || item.boxNumber == null || item.boxNumber === "") return false;
        if (movement.type !== "AJUSTE") return false;
        const sid = String(item.stockSourceId || "").trim();
        return !!(item.metaBoxMgrAjuste || sid.startsWith("box:"));
    },

    showMovementDetail(movementId) {
        const movement = MovementManager.getMovementById(movementId);
        if (!movement) return;

        this.currentMovement = movement;
        const config = MOVEMENT_TYPES[movement.type] || { icon: '📦', color: '#666' };

        const content = document.getElementById('movement-detail-content');
        if (!content) return;

        const items = movement.items || [];
        const { before: stockBeforeList, after: stockAfterList } =
            MovementManager.computeMovementLineStockBeforeAfter(movement);
        const fmtStock = v => {
            if (v === null || v === undefined || Number.isNaN(v)) return "—";
            return Utils.formatDecimalDisplay(Number(v));
        };
        const fmtLineDate = v => (v ? Utils.formatDateTime(v) : "");
        const snap = movement.receptionSnapshot;
        const catLabel = snap
            ? (I18n.t(`reception.mat.${snap.materialCategory}`) !== `reception.mat.${snap.materialCategory}`
                  ? I18n.t(`reception.mat.${snap.materialCategory}`)
                  : snap.materialCategory)
            : "";
        const snapDimLine = (() => {
            if (!snap) return "";
            const d = snap.dimensions || {};
            const dL = parseFloat(d.L) || 0;
            const dW = parseFloat(d.W) || 0;
            const dH = parseFloat(d.H) || 0;
            if (!(dL > 0 || dW > 0 || dH > 0)) return "";
            const fmtn = v =>
                v > 0 ? String(Utils.roundDecimal(v, 4)).replace(/\.?0+$/, "") : "0";
            return `<div class="detail-item"><span class="detail-label">${this._esc(
                I18n.t("reception.dimensionsCol")
            )}</span><span class="detail-value">${Utils.escapeHtml(`${fmtn(dL)}×${fmtn(dW)}×${fmtn(dH)}`)}</span></div>`;
        })();
        const snapGlassPackLine = (() => {
            if (!snap || (snap.glassPacking !== "standard_box" && snap.glassPacking !== "loose_mixed"))
                return "";
            const lab =
                snap.glassPacking === "standard_box"
                    ? I18n.t("reception.glassPackingStandard")
                    : I18n.t("reception.glassPackingLoose");
            return `<div class="detail-item"><span class="detail-label">${this._esc(
                I18n.t("reception.glassPackingCol")
            )}</span><span class="detail-value">${Utils.escapeHtml(lab)}</span></div>`;
        })();
        const orderLineRow =
            typeof OrderLinesManager !== "undefined" && movement.orderLineId
                ? OrderLinesManager.getLine(movement.orderLineId)
                : null;
        const orderLineDisplay =
            orderLineRow && typeof OrderLinesManager.formatLineRef === "function"
                ? OrderLinesManager.formatLineRef(orderLineRow)
                : String(movement.orderLineId || "");

        const atts = Array.isArray(movement.attachments) ? movement.attachments : [];
        const canAttach =
            typeof Auth !== "undefined" && Auth.hasPerm && Auth.hasPerm("movements");
        const attachmentsSection =
            canAttach || atts.length
                ? `
            <div class="gneex-attachments-block">
                <h4 class="gneex-attachments-title">📎 ${this._esc(I18n.t("attachments.title"))} (${atts.length})</h4>
                ${
                    canAttach
                        ? `<div class="gneex-attachments-toolbar">
                    <button type="button" class="btn btn-sm btn-secondary" id="movement-detail-attach-btn">📎 ${this._esc(I18n.t("attachments.add"))}</button>
                </div>`
                        : ""
                }
                ${
                    atts.length
                        ? `<ul class="gneex-attachments-list">${atts
                              .map(a => {
                                  const nm = a.originalName || a.fileName || "—";
                                  const kb = Math.max(0, Math.round((a.size || 0) / 1024));
                                  const isLegacy = !!(a.relPath && a.linkKind !== "localHandle");
                                  const openBtn = !isLegacy
                                      ? `<button type="button" class="btn btn-sm btn-secondary" data-open-movement-attachment="${Utils.escapeAttr(a.id)}">${this._esc(I18n.t("attachments.open"))}</button>`
                                      : "";
                                  const legacyCopy =
                                      isLegacy && a.relPath
                                          ? `<button type="button" class="btn btn-sm btn-secondary" data-copy-movement-rel="${Utils.escapeAttr(a.relPath)}">${this._esc(I18n.t("attachments.copyLegacyPath"))}</button>`
                                          : "";
                                  return `<li class="gneex-attachment-row">
                        <span class="gneex-att-name" title="${Utils.escapeHtml(nm)}">${Utils.escapeHtml(nm)}</span>
                        <span class="muted gneex-att-meta">${Utils.escapeHtml(Utils.formatDateTime(a.addedAt))} · ${kb} KB</span>
                        <div class="gneex-att-actions">
                            ${openBtn}${legacyCopy}
                            ${
                                canAttach
                                    ? `<button type="button" class="btn btn-sm btn-danger" data-remove-movement-attachment="${Utils.escapeAttr(a.id)}">${this._esc(I18n.t("attachments.remove"))}</button>`
                                    : ""
                            }
                        </div>
                    </li>`;
                              })
                              .join("")}</ul>`
                        : `<p class="muted">${this._esc(I18n.t("attachments.empty"))}</p>`
                }
            </div>`
                : "";

        const tfHasOutputLine = items.some(i => i && i.transformationOutput);
        const tfLegacyOutQty =
            movement.type === 'TRANSFORMACION' &&
            !tfHasOutputLine &&
            movement.transformationOutputQuantity != null &&
            Number.isFinite(parseFloat(movement.transformationOutputQuantity)) &&
            parseFloat(movement.transformationOutputQuantity) > 0;

        const showProjectRow = movement.type !== "CONSUMO_DIARIO";

        content.innerHTML = `
            <div class="movement-detail-header">
                <div class="detail-type" style="color: ${config.color}">
                    <span style="font-size: 2rem;">${config.icon}</span>
                    <strong>${this._esc(I18n.t(`movType.${movement.type}`))}</strong>
                </div>
            </div>
            <div class="detail-info">
                <div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('history.filterRef'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(movement.reference)}</span>
                </div>
                ${showProjectRow ? `<div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('movements.projectId'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(movement.projectId || '-')}</span>
                </div>` : ''}
                ${movement.type === 'VENTA_DIRECTA' ? `<div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('movements.salesOrder'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(String(movement.salesOrder || '').trim() || '—')}</span>
                </div>` : ''}
                ${movement.type === 'EXPEDICION_STOCK' ? `<div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('movements.prNumber'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(String(movement.prNumber || '').trim() || '—')}</span>
                </div>` : ''}
                <div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('history.movementDate'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(Utils.formatDateTime(movement.date))}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('table.status'))}</span>
                    <span class="detail-value">${
                        movement.annulled
                            ? `<span class="movement-status-stamp movement-status-stamp--full"><span class="movement-status-stamp-inner">${this._esc(I18n.t('status.annulled'))}</span></span>`
                            : this._isMovementPartiallyAnnulled(movement)
                              ? `<span class="movement-status-stamp movement-status-stamp--partial"><span class="movement-status-stamp-inner">${this._esc(I18n.t('history.statusPartiallyAnnulled'))}</span></span>`
                              : '✅ ' + this._esc(I18n.t('status.active'))
                    }</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('history.createdBy'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(movement.createdBy || '—')}</span>
                </div>
            </div>
            ${attachmentsSection}
            ${movement.transportExpeditedAt ? `
            <div class="detail-info movement-expedited-banner" role="status" style="margin-top:0.65rem;border-left:3px solid var(--accent-primary);padding-left:0.65rem;">
                <div class="detail-item">
                    <span class="detail-label">${this._esc(I18n.t('history.transportExpedited'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(Utils.formatDateTime(movement.transportExpeditedAt))}</span>
                </div>
            </div>` : ''}
            ${MovementManager.effectiveHadOverdraft(movement) ? `
            <div class="detail-overdraft" role="alert">
                <div class="detail-overdraft-title">${Utils.escapeHtml(I18n.t('history.overdraftFlag'))}</div>
                <div class="detail-item" style="margin-top:0.5rem;">
                    <span class="detail-label">${Utils.escapeHtml(I18n.t('history.overdraftReason'))}</span>
                    <span class="detail-value detail-overdraft-reason">${movement.overdraftReason ? Utils.escapeHtml(movement.overdraftReason) : Utils.escapeHtml(I18n.t('history.overdraftReasonMissing'))}</span>
                </div>
                ${movement.overdraftAt ? `<p class="muted" style="margin-top:0.35rem;font-size:0.85rem;">${Utils.escapeHtml(Utils.formatDateTime(movement.overdraftAt))}</p>` : ''}
            </div>` : ''}
            ${movement.type === 'TRANSFORMACION' && movement.transformationVendor ? `
            <div class="detail-info" style="margin-top:0.75rem;">
                <div class="detail-item">
                    <span class="detail-label">${Utils.escapeHtml(I18n.t('movements.transformationVendor'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(movement.transformationVendor)}</span>
                </div>
            </div>` : ''}
            ${movement.type === 'TRANSFORMACION' && (movement.transformationTargetCode || movement.transformationTargetDescription) ? `
            <div class="detail-info" style="margin-top:0.75rem;">
                <div class="detail-item">
                    <span class="detail-label">${Utils.escapeHtml(I18n.t('movements.transformationTarget'))}</span>
                    <span class="detail-value">${Utils.escapeHtml(movement.transformationTargetCode || '—')}${movement.transformationTargetDescription ? ` — ${Utils.escapeHtml(movement.transformationTargetDescription)}` : ''}${movement.transformationTargetCreatedNew ? ` <span class="muted">(${Utils.escapeHtml(I18n.t('movements.transformationTargetCreatedNew'))})</span>` : ''}</span>
                </div>
            </div>` : ''}
            ${tfLegacyOutQty ? `
            <div class="detail-info" style="margin-top:0.75rem;">
                <div class="detail-item">
                    <span class="detail-label">${Utils.escapeHtml(I18n.t('movements.transformationOutputQty'))}</span>
                    <span class="detail-value">+${Utils.escapeHtml(fmtStock(parseFloat(movement.transformationOutputQuantity)))} → ${Utils.escapeHtml(I18n.t('target.main'))}</span>
                </div>
            </div>` : ''}
            ${(() => {
                const canNotes =
                    typeof Auth !== "undefined" && Auth.hasPerm && Auth.hasPerm("movements");
                const existing = String(movement.notes || "").trim();
                const escExisting = Utils.escapeHtml(existing);
                if (canNotes) {
                    const existingBlock =
                        existing.length > 0
                            ? `<div style="margin-bottom:0.75rem;">
                        <strong class="detail-label" style="display:block;margin-bottom:0.35rem;">${this._esc(
                            I18n.t("history.movementNotesExisting")
                        )}</strong>
                        <div class="form-input" style="white-space:pre-wrap;max-height:12rem;overflow:auto;background:var(--bg-secondary, #f5f5f5);cursor:default;" readonly tabindex="0" aria-readonly="true">${escExisting}</div>
                    </div>`
                            : "";
                    return `<div class="gneex-movement-notes-block" style="margin-top:1rem;">
                    ${existingBlock}
                    <label for="movement-detail-note-new" class="detail-label" style="display:block;margin-bottom:0.35rem;"><strong>${this._esc(
                        I18n.t("history.movementNotesNewLabel")
                    )}</strong></label>
                    <textarea id="movement-detail-note-new" class="form-input" rows="3" style="width:100%;max-width:100%;box-sizing:border-box;resize:vertical;" placeholder="${this._esc(
                        I18n.t("history.movementNotesNewPlaceholder")
                    )}"></textarea>
                    <div style="margin-top:0.4rem;">
                        <button type="button" class="btn btn-sm btn-primary" id="movement-detail-notes-append">${this._esc(
                            I18n.t("history.movementNotesAppend")
                        )}</button>
                    </div>
                </div>`;
                }
                if (movement.notes && String(movement.notes).trim()) {
                    return `<p style="margin-top:1rem;white-space:pre-wrap;"><strong>${this._esc(
                        I18n.t("movements.notes")
                    )}:</strong> ${Utils.escapeHtml(movement.notes)}</p>`;
                }
                return `<p class="muted" style="margin-top:1rem;">${this._esc(I18n.t("history.movementNotesReadOnlyEmpty"))}</p>`;
            })()}
            ${movement.purchaseMeta ? `
            <div class="detail-info" style="margin-top:0.75rem;">
                ${
                    movement.type === 'COMPRA_STOCK' &&
                    !(movement.purchaseMeta.poNumber || '').trim() &&
                    !(movement.purchaseMeta.supplier || '').trim()
                        ? ''
                        : `
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('movCompra.po'))}</span><span class="detail-value">${Utils.escapeHtml(movement.purchaseMeta.poNumber || '—')}</span></div>
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('reception.supplier'))}</span><span class="detail-value">${Utils.escapeHtml(movement.purchaseMeta.supplier || '—')}</span></div>`
                }
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('movCompra.packingSlip'))}</span><span class="detail-value">${Utils.escapeHtml(movement.purchaseMeta.packingSlip || '—')}</span></div>
            </div>` : ''}
            ${movement.type === 'COMPRA_STOCK' && movement.orderLineId ? `
            <div class="history-orderline-banner" role="status">
                <span class="history-orderline-badge">${Utils.escapeHtml(I18n.t('history.compraFromOrderPanelBadge'))}</span>
                <code class="history-orderline-id" title="${Utils.escapeHtml(orderLineDisplay)}">${Utils.escapeHtml(orderLineDisplay)}</code>
            </div>` : ''}
            ${snap ? `
            <div class="detail-info" style="margin-top:0.75rem;">
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('reception.materialCategory'))}</span><span class="detail-value">${Utils.escapeHtml(catLabel)}</span></div>
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('reception.item'))}</span><span class="detail-value">${Utils.escapeHtml(snap.itemName || '—')}</span></div>
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('reception.quantity'))}</span><span class="detail-value">${Utils.escapeHtml(snap.quantity ?? '—')}</span></div>
                ${snapDimLine}
                ${snapGlassPackLine}
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('reception.purchaseOrder'))}</span><span class="detail-value">${Utils.escapeHtml(snap.purchaseOrder || '—')}</span></div>
                <div class="detail-item"><span class="detail-label">${this._esc(I18n.t('reception.provisional'))}</span><span class="detail-value">${snap.provisional ? this._esc(I18n.t('history.yes')) : this._esc(I18n.t('history.no'))}</span></div>
            </div>` : ''}
            <div class="detail-items-list">
                <h4>${this._esc(I18n.t('movements.selectedItems'))} (${items.length})</h4>
                ${items.length === 0 && !snap ? `<p class="muted">${this._esc(I18n.t('history.noMovementLines'))}</p>` : ''}
                ${items.map((item, index) => `
                    <div class="detail-item-row detail-item-row-line ${item.annulled ? 'detail-item-row--annulled-line' : ''}">
                        ${item.annulled ? `<span class="detail-item-annul-stamp" aria-hidden="true">${this._esc(I18n.t('status.annulled'))}</span>` : ''}
                        <div class="detail-item-info">
                            <span class="detail-item-code">${Utils.escapeHtml(item.code)}</span>
                            <span class="detail-item-desc">${Utils.escapeHtml(item.description)}</span>
                            <small>${
                                movement.type === 'CONSUMO_DIARIO' && (item.recipientName || '').trim()
                                    ? `${Utils.escapeHtml(I18n.t('movements.recipientShort'))}: ${Utils.escapeHtml(String(item.recipientName).trim())} · `
                                    : ''
                            }${this._esc(this._movementLineTargetLabelForDetail(movement, item))} | ${Utils.escapeHtml(item.location || '-')}${
                                item.boxNumber && !this._movementLineRedundantBoxNumberSuffix(movement, item)
                                    ? ` · ${this._esc(I18n.t('inventory.boxFilterOption').replace('{n}', String(item.boxNumber)))}`
                                    : ''
                            }${
                                item.locationStockLabel || item.locationStockKey
                                    ? ` · ${Utils.escapeHtml(String(item.locationStockLabel || item.locationStockKey).trim())}`
                                    : ''
                            }${
                                item.transformationOutput
                                    ? ` · ${this._esc(I18n.t('movements.transformationOutputLineBadge'))}`
                                    : ''
                            }${
                                movement.type === 'COMPRA_STOCK' && item.consumableReceipt
                                    ? ` · ${this._esc(I18n.t('movements.compraConsumableLineBadge'))}`
                                    : ''
                            }${
                                movement.type === 'COMPRA_STOCK' &&
                                ((item.compraLinePo || '').trim() || (item.compraLineSupplier || '').trim())
                                    ? ` · ${this._esc(I18n.t('movCompra.po'))}: ${Utils.escapeHtml(String(item.compraLinePo || '—'))} · ${this._esc(I18n.t('reception.supplier'))}: ${Utils.escapeHtml(String(item.compraLineSupplier || '—'))}`
                                    : ''
                            }${
                                movement.type === 'CONSUMO_DIARIO' && item.lineAddedAt
                                    ? ` · ${Utils.escapeHtml(I18n.t('standby.date'))}: ${Utils.escapeHtml(
                                          fmtLineDate(item.lineAddedAt)
                                      )}`
                                    : ''
                            }</small>
                        </div>
                        <div class="detail-item-actions">
                            <span class="detail-stock-prior">${this._esc(I18n.t('history.stockBefore'))} <strong>${fmtStock(stockBeforeList[index])}</strong></span>
                            <div class="detail-qty-row">
                                <span class="detail-item-qty ${item.quantity >= 0 ? 'positive' : 'negative'}">
                                    ${
                                        movement.type === 'TRANSFERENCIA' &&
                                        item.transferFrom &&
                                        item.transferTo &&
                                        item.transferFrom !== item.transferTo
                                            ? '+' +
                                              Utils.formatDecimalDisplay(Math.abs(parseFloat(item.quantity) || 0))
                                            : (item.quantity >= 0 ? '+' : '') +
                                              Utils.formatDecimalDisplay(item.quantity)
                                    }
                                </span>
                                <span class="detail-stock-result muted">${this._esc(I18n.t('history.stockAfter'))} <strong>${fmtStock(stockAfterList[index])}</strong></span>
                                ${
                                  !movement.annulled &&
                                  !item.annulled &&
                                  (typeof Auth === "undefined" || !Auth.hasMovementAnnul || Auth.hasMovementAnnul())
                                    ? `
                                    <button class="annul-item-btn" data-index="${index}">
                                        ${this._esc(I18n.t('buttons.annulItem'))}
                                    </button>
                                `
                                    : ""
                                }
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Mostrar/ocultar botón de anular
        const annulBtn = document.getElementById('annul-movement-btn');
        if (annulBtn) {
            const canAnnul =
                typeof Auth === "undefined" || !Auth.hasMovementAnnul ? true : Auth.hasMovementAnnul();
            annulBtn.style.display = !canAnnul || movement.annulled ? 'none' : 'block';
        }

        document.getElementById('movement-detail-modal').classList.add('active');
    },

    /** Vacía los campos de filtro sin volver a renderizar (uso interno). */
    clearFilterFieldsOnly() {
        clearTimeout(this._historyFilterDebounceT);
        this._historyFilterDebounceT = null;
        const ids = [
            'filter-type', 'filter-ref', 'filter-code', 'filter-desc', 'filter-notes', 'filter-recipient', 'filter-date-from', 'filter-date-to',
            'filter-location', 'filter-project-id', 'filter-sales-order', 'filter-pr-number', 'filter-created-by', 'filter-overdraft', 'filter-negative-stock', 'filter-annul-status'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    },

    /**
     * Aplica un conjunto de filtros, abre Historial y desplaza la vista.
     * @param {Object} preset - Ej.: { type, dateFrom, dateTo, ref, ... } (solo las claves indicadas)
     */
    applyFilterPreset(preset = {}) {
        this.clearFilterFieldsOnly();
        const map = {
            type: 'filter-type',
            ref: 'filter-ref',
            code: 'filter-code',
            desc: 'filter-desc',
            notes: 'filter-notes',
            dateFrom: 'filter-date-from',
            dateTo: 'filter-date-to',
            location: 'filter-location',
            projectId: 'filter-project-id',
            salesOrder: 'filter-sales-order',
            prNumber: 'filter-pr-number',
            createdBy: 'filter-created-by',
            recipient: 'filter-recipient',
            overdraft: 'filter-overdraft',
            negativeStock: 'filter-negative-stock',
            annulStatus: 'filter-annul-status'
        };
        Object.keys(map).forEach(key => {
            if (preset[key] !== undefined) {
                const el = document.getElementById(map[key]);
                if (el) el.value = preset[key];
            }
        });
        if (typeof App !== 'undefined' && App.switchTab) App.switchTab('history');
        this.render();
        setTimeout(() => {
            document.getElementById('history-tab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    },

    clearFilters() {
        clearTimeout(this._historyFilterDebounceT);
        this._historyFilterDebounceT = null;
        document.getElementById('filter-type').value = '';
        document.getElementById('filter-ref').value = '';
        document.getElementById('filter-code').value = '';
        document.getElementById('filter-desc').value = '';
        const notesEl = document.getElementById('filter-notes');
        if (notesEl) notesEl.value = '';
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-location').value = '';
        document.getElementById('filter-project-id').value = '';
        const fso = document.getElementById('filter-sales-order');
        if (fso) fso.value = '';
        const fpr = document.getElementById('filter-pr-number');
        if (fpr) fpr.value = '';
        document.getElementById('filter-created-by').value = '';
        document.getElementById('filter-recipient').value = '';
        const supEl = document.getElementById('filter-supplier');
        if (supEl) supEl.value = '';
        const qminEl = document.getElementById('filter-qty-min');
        const qmaxEl = document.getElementById('filter-qty-max');
        if (qminEl) qminEl.value = '';
        if (qmaxEl) qmaxEl.value = '';
        document.getElementById('filter-overdraft').value = '';
        document.getElementById('filter-negative-stock').value = '';
        const annulEl = document.getElementById('filter-annul-status');
        if (annulEl) annulEl.value = '';
        this.populateFilterTypes();
        if (
            typeof Auth !== "undefined" &&
            Auth.historyMaterialReceptionOnly &&
            Auth.historyMaterialReceptionOnly()
        ) {
            this.applyMaterialReceptionHistoryLock();
        }
        this.render();
    },

    setupEventListeners() {
        // Click en celdas del historial
        const container = document.getElementById('history-cells');
        if (container) {
            container.addEventListener('click', (e) => {
                const cell = e.target.closest('.history-cell, .history-list-row, .history-detail-row, .history-carousel-card');
                if (cell && cell.dataset.id) {
                    this.showMovementDetail(cell.dataset.id);
                }
            });
        }

        document.getElementById('history-tab')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-history-view]');
            if (btn) {
                e.preventDefault();
                this._setHistoryView(btn.getAttribute('data-history-view'));
                return;
            }
            const dateControl = e.target.closest('[data-history-carousel-date-control]');
            if (dateControl) {
                e.preventDefault();
                const r = dateControl.getBoundingClientRect();
                const dir = e.clientX < r.left + r.width / 2 ? 'prev' : 'next';
                this._scrollHistoryCarousel(dir);
                return;
            }
            const navBtn = e.target.closest('[data-history-carousel-nav]');
            if (!navBtn) return;
            e.preventDefault();
            this._scrollHistoryCarousel(navBtn.getAttribute('data-history-carousel-nav'));
        });

        this._bindLiveHistoryFilters();

        // Limpiar filtros
        const clearBtn = document.getElementById('clear-filters');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearFilters());
        }

        // Cerrar modal de detalle
        const closeDetail = document.getElementById('close-movement-detail');
        if (closeDetail) {
            closeDetail.addEventListener('click', () => {
                document.getElementById('movement-detail-modal').classList.remove('active');
            });
        }

        // Anular movimiento completo
        const annulMovementBtn = document.getElementById('annul-movement-btn');
        if (annulMovementBtn) {
            annulMovementBtn.addEventListener('click', () => {
                if (!this.currentMovement) return;
                if (typeof Auth !== "undefined" && Auth.guardMovementAnnul && !Auth.guardMovementAnnul()) return;
                App.showConfirm(I18n.t('confirm.annulMovement'), () => {
                    /* Una sola confirmación: si annulMovement pide otra, hideConfirm() la borra antes de aceptar. */
                    MovementManager.annulMovement(this.currentMovement.id, true);
                    document.getElementById('movement-detail-modal').classList.remove('active');
                });
            });
        }

        // Anular artículo individual
        const detailContent = document.getElementById('movement-detail-content');
        if (detailContent) {
            detailContent.addEventListener('click', (e) => {
                const copyRel = e.target.closest('[data-copy-movement-rel]');
                if (copyRel) {
                    const path = copyRel.getAttribute('data-copy-movement-rel') || '';
                    if (path && navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(path).then(
                            () => Utils.showToast(I18n.t('attachments.pathCopied'), 'success'),
                            () => Utils.showToast(I18n.t('attachments.pathCopyFailed'), 'warning')
                        );
                    } else if (path) {
                        Utils.showToast(I18n.t('attachments.pathCopyFailed'), 'warning');
                    }
                    return;
                }
                const openMovAtt = e.target.closest('[data-open-movement-attachment]');
                if (openMovAtt && this.currentMovement) {
                    const aid = openMovAtt.getAttribute('data-open-movement-attachment') || '';
                    const meta = (this.currentMovement.attachments || []).find(x => x && x.id === aid);
                    void Utils.openLinkedAttachment(meta);
                    return;
                }
                if (e.target.closest('#movement-detail-attach-btn')) {
                    if (!this.currentMovement) return;
                    const mid = this.currentMovement.id;
                    void MovementManager.addMovementAttachments(mid).then(ok => {
                        if (ok) {
                            Utils.showToast(I18n.t('attachments.saved'), 'success');
                            this.showMovementDetail(mid);
                        }
                    });
                    return;
                }
                if (e.target.closest('#movement-detail-notes-append')) {
                    if (!this.currentMovement) return;
                    const mid = this.currentMovement.id;
                    const ta = document.getElementById('movement-detail-note-new');
                    const raw = ta ? ta.value : '';
                    if (!String(raw).trim()) {
                        Utils.showToast(I18n.t('history.movementNotesAppendEmpty'), 'warning');
                        return;
                    }
                    if (typeof MovementManager.appendMovementNote !== 'function') return;
                    if (MovementManager.appendMovementNote(mid, raw)) {
                        Utils.showToast(I18n.t('history.movementNotesAppended'), 'success');
                        this.currentMovement = MovementManager.getMovementById(mid);
                        this.showMovementDetail(mid);
                    }
                    return;
                }
                const rmAtt = e.target.closest('[data-remove-movement-attachment]');
                if (rmAtt && this.currentMovement && typeof Auth !== 'undefined' && Auth.hasPerm('movements')) {
                    const aid = rmAtt.getAttribute('data-remove-movement-attachment') || '';
                    if (!aid) return;
                    App.showConfirm(I18n.t('confirm.removeAttachment'), () => {
                        void MovementManager.removeMovementAttachment(this.currentMovement.id, aid).then(() => {
                            this.showMovementDetail(this.currentMovement.id);
                        });
                    });
                    return;
                }
                const annulItemBtn = e.target.closest('.annul-item-btn');
                if (annulItemBtn && this.currentMovement) {
                    if (typeof Auth !== "undefined" && Auth.guardMovementAnnul && !Auth.guardMovementAnnul()) return;
                    const index = parseInt(annulItemBtn.dataset.index);
                    App.showConfirm(I18n.t('confirm.annulItem'), () => {
                        MovementManager.annulMovementItem(this.currentMovement.id, index, true);
                        this.showMovementDetail(this.currentMovement.id);
                    });
                }
            });
        }

        document.getElementById('history-print-filtered')?.addEventListener('click', () => this.printFilteredHistoryList());
        document.getElementById('history-export-filtered-csv')?.addEventListener('click', () => void this.exportFilteredHistorySummaryCsv());
        document.getElementById('consumo-ledger-save')?.addEventListener('click', () => this.saveConsumoRecipientLedgerEdits());
        document.getElementById('consumo-ledger-clear-table')?.addEventListener('click', () => this.clearConsumoRecipientLedger());
        document.getElementById('consumo-ledger-print')?.addEventListener('click', () => this.printConsumoRecipientLedger());
        document.getElementById('consumo-ledger-export-csv')?.addEventListener('click', () => void this.exportConsumoRecipientLedgerCsv(true));
        document.getElementById('consumo-ledger-open-expanded')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this.openConsumoLedgerExpandedView();
        });
        document.getElementById('consumo-ledger-fs-close')?.addEventListener('click', () => this.closeConsumoLedgerExpandedView());
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (!this._isConsumoLedgerExpandedOpen()) return;
            e.preventDefault();
            this.closeConsumoLedgerExpandedView();
        });
        document.getElementById('consumo-recipient-ledger-body')?.addEventListener('click', e => {
            const rowBtn = e.target.closest('[data-ledger-clear-row]');
            if (!rowBtn) return;
            const movementId = rowBtn.getAttribute('data-ledger-mid') || '';
            const itemIndex = parseInt(rowBtn.getAttribute('data-ledger-idx') || '-1', 10);
            if (!movementId || !Number.isInteger(itemIndex) || itemIndex < 0) return;
            this.clearConsumoRecipientLedgerRow(movementId, itemIndex);
        });
        document.getElementById('movement-detail-print-btn')?.addEventListener('click', () => this.printCurrentMovementDetail());
        document.getElementById('movement-detail-export-csv-btn')?.addEventListener('click', () => void this.exportCurrentMovementDetailCsv());
    }
};
