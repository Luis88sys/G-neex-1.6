/**
 * Arrastra los globos flotantes (Stand-by y carrito Consumo diario) y persiste posición en localStorage.
 */
const FloatFabDrag = {
    _inited: false,
    _DRAG_PX: 10,
    /** 0 = todo el viewport (el globo no sale de la ventana visible). */
    _EDGE_PAD: 0,
    _resizeTimer: null,

    init() {
        if (this._inited) return;
        this._inited = true;
        this._bindPair(
            document.getElementById("standby-float-wrap"),
            document.getElementById("standby-float-fab"),
            STORAGE_KEYS.FLOAT_STANDBY_POS
        );
        this._bindPair(
            document.getElementById("consumo-cart-float-wrap"),
            document.getElementById("consumo-cart-float-fab"),
            STORAGE_KEYS.FLOAT_CONSUMO_POS
        );
        window.addEventListener(
            "resize",
            () => {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => this._clampAll(), 200);
            },
            { passive: true }
        );
    },

    _clampAll() {
        this._clampWrap(
            document.getElementById("standby-float-wrap"),
            document.getElementById("standby-float-fab"),
            STORAGE_KEYS.FLOAT_STANDBY_POS
        );
        this._clampWrap(
            document.getElementById("consumo-cart-float-wrap"),
            document.getElementById("consumo-cart-float-fab"),
            STORAGE_KEYS.FLOAT_CONSUMO_POS
        );
    },

    _readPos(wrap) {
        if (!wrap?.classList.contains("float-wrap--custom-pos")) return null;
        const l = parseFloat(wrap.style.left);
        const t = parseFloat(wrap.style.top);
        if (Number.isFinite(l) && Number.isFinite(t)) return { l, t };
        return null;
    },

    _applySaved(wrap, fab, key) {
        if (!wrap) return;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (typeof p.l !== "number" || typeof p.t !== "number") return;
            wrap.classList.add("float-wrap--custom-pos");
            wrap.style.left = `${p.l}px`;
            wrap.style.top = `${p.t}px`;
            wrap.style.right = "auto";
            wrap.style.bottom = "auto";
            this._clampWrap(wrap, fab, key);
        } catch (e) {}
    },

    _savePos(wrap, key) {
        const pos = this._readPos(wrap);
        if (!pos) return;
        try {
            localStorage.setItem(key, JSON.stringify(pos));
        } catch (e) {}
    },

    /**
     * Límites del wrap (left/top) para que el FAB quede dentro del viewport.
     * El wrap puede ser más ancho que el botón (panel); acotar por el FAB permite left negativo
     * y movimiento real hacia la izquierda.
     */
    _clampLtToViewport(wrap, fab, l, t) {
        const p = this._EDGE_PAD;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (!fab || !wrap) {
            const rect = wrap.getBoundingClientRect();
            const maxL = Math.max(p, vw - rect.width - p);
            const maxT = Math.max(p, vh - rect.height - p);
            return {
                l: Math.min(Math.max(p, l), maxL),
                t: Math.min(Math.max(p, t), maxT)
            };
        }
        const fr = fab.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const ox = fr.left - wr.left;
        const oy = fr.top - wr.top;
        const fw = fr.width;
        const fh = fr.height;
        const minL = p - ox;
        const maxL = vw - fw - p - ox;
        const minT = p - oy;
        const maxT = vh - fh - p - oy;
        return {
            l: Math.min(Math.max(minL, l), Math.max(minL, maxL)),
            t: Math.min(Math.max(minT, t), Math.max(minT, maxT))
        };
    },

    _clampWrap(wrap, fab, key) {
        if (!wrap || !wrap.classList.contains("float-wrap--custom-pos")) return;
        let l = parseFloat(wrap.style.left);
        let t = parseFloat(wrap.style.top);
        if (!Number.isFinite(l) || !Number.isFinite(t)) return;
        const c = this._clampLtToViewport(wrap, fab, l, t);
        wrap.style.left = `${c.l}px`;
        wrap.style.top = `${c.t}px`;
        try {
            localStorage.setItem(key, JSON.stringify({ l: c.l, t: c.t }));
        } catch (e) {}
    },

    _ensureCustomFromRect(wrap) {
        if (wrap.classList.contains("float-wrap--custom-pos")) return;
        const r = wrap.getBoundingClientRect();
        wrap.classList.add("float-wrap--custom-pos");
        wrap.style.right = "auto";
        wrap.style.bottom = "auto";
        wrap.style.left = `${r.left}px`;
        wrap.style.top = `${r.top}px`;
    },

    _bindPair(wrap, fab, key) {
        if (!wrap || !fab) return;
        this._applySaved(wrap, fab, key);

        fab.addEventListener(
            "click",
            e => {
                if (fab._phoenixFloatDragSuppressClick) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    fab._phoenixFloatDragSuppressClick = false;
                }
            },
            true
        );

        fab.addEventListener("pointerdown", e => {
            if (e.button !== 0) return;
            this._ensureCustomFromRect(wrap);
            const pos = this._readPos(wrap);
            if (!pos) return;

            const pid = e.pointerId;
            const startX = e.clientX;
            const startY = e.clientY;
            const origL = pos.l;
            const origT = pos.t;
            let dragging = false;

            const onMove = ev => {
                if (ev.pointerId !== pid) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!dragging) {
                    if (dx * dx + dy * dy < this._DRAG_PX * this._DRAG_PX) return;
                    dragging = true;
                    fab.classList.add("float-fab--dragging");
                    try {
                        fab.setPointerCapture(pid);
                    } catch (err) {}
                }
                let nl = origL + dx;
                let nt = origT + dy;
                const c = this._clampLtToViewport(wrap, fab, nl, nt);
                wrap.style.left = `${c.l}px`;
                wrap.style.top = `${c.t}px`;
            };

            const onUp = ev => {
                if (ev.pointerId !== pid) return;
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
                document.removeEventListener("pointercancel", onUp);
                if (dragging) {
                    fab._phoenixFloatDragSuppressClick = true;
                    this._savePos(wrap, key);
                    fab.classList.remove("float-fab--dragging");
                    try {
                        fab.releasePointerCapture(pid);
                    } catch (err) {}
                }
            };

            document.addEventListener("pointermove", onMove, { passive: true });
            document.addEventListener("pointerup", onUp);
            document.addEventListener("pointercancel", onUp);
        });
    }
};
