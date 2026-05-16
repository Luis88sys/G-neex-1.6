/**
 * Calculadora de cantidad en movimientos: UI del proyecto (calculadora 2/),
 * evaluación segura vía MovementManager._evaluateQuantityExpression (sin eval).
 */
const QtyCalculator = {
    _initialized: false,
    _resolve: null,
    _lastEq: false,
    _onDocKey: null,

    init() {
        if (this._initialized) return;
        this._initialized = true;
        const modal = document.getElementById("qty-calculator-modal");
        const keys = document.getElementById("qty-calc-keys");
        if (!modal || !keys) return;

        keys.addEventListener("click", e => {
            const btn = e.target.closest("[data-qty-act]");
            if (!btn) return;
            e.preventDefault();
            const act = btn.getAttribute("data-qty-act");
            const v = btn.getAttribute("data-qty-v");
            this._handle(act, v);
        });

        document.getElementById("qty-calc-apply")?.addEventListener("click", () => this._apply());
        document.getElementById("qty-calc-cancel")?.addEventListener("click", () => this._close(null));
        document.getElementById("qty-calc-close")?.addEventListener("click", () => this._close(null));

        this._onDocKey = e => {
            if (e.key !== "Escape") return;
            if (!modal.classList.contains("active")) return;
            this._close(null);
        };
        document.addEventListener("keydown", this._onDocKey);
    },

    /**
     * @param {number} index — índice en MovementManager.selectedItems
     * @returns {Promise<number|null>} resultado aplicado o null si cancela
     */
    openAsync(index) {
        this.init();
        return new Promise(resolve => {
            if (typeof MovementManager === "undefined" || !MovementManager.selectedItems) {
                resolve(null);
                return;
            }
            if (!Number.isFinite(index) || index < 0 || index >= MovementManager.selectedItems.length) {
                resolve(null);
                return;
            }
            this._resolve = resolve;
            this._lastEq = false;
            const conf =
                MovementManager.currentType && typeof MOVEMENT_TYPES !== "undefined"
                    ? MOVEMENT_TYPES[MovementManager.currentType]
                    : null;
            const ui = MovementManager._movementQtyInputUi(MovementManager.selectedItems[index], conf);
            const start = ui && ui.value !== "" && ui.value != null ? String(ui.value) : "0";
            const dm = this._ds();
            const dr = this._dr();
            const dmem = this._mem();
            if (dm) dm.textContent = start;
            if (dr) dr.textContent = "0";
            if (dmem) dmem.textContent = "0";
            const modal = document.getElementById("qty-calculator-modal");
            if (!modal) {
                this._resolve = null;
                resolve(null);
                return;
            }
            if (typeof I18n !== "undefined" && I18n.apply) I18n.apply(modal);
            if (typeof App !== "undefined" && App._bringModalToFront) App._bringModalToFront(modal);
            modal.classList.add("active");
        });
    },

    _ds() {
        return document.getElementById("qty-calc-display-main");
    },
    _dr() {
        return document.getElementById("qty-calc-display-result");
    },
    _mem() {
        return document.getElementById("qty-calc-mem-val");
    },

    _evalExpr(raw) {
        const s = String(raw || "")
            .replace(/×/g, "*")
            .replace(/÷/g, "/")
            .replace(/−/g, "-");
        return MovementManager._evaluateQuantityExpression(s);
    },

    _handle(act, v) {
        const mainEl = this._ds();
        const resEl = this._dr();
        const memEl = this._mem();
        if (!mainEl || !resEl || !memEl) return;
        let main = mainEl.textContent;
        let res = resEl.textContent;
        const mem = memEl.textContent;

        const clearError = () => {
            if (res === "ERROR!!!") {
                resEl.textContent = "0";
                res = "0";
            }
        };

        if (act === "ce") {
            mainEl.textContent = "0";
            resEl.textContent = "0";
            this._lastEq = false;
            return;
        }
        if (act === "c") {
            mainEl.textContent = "0";
            this._lastEq = false;
            return;
        }
        if (act === "del") {
            clearError();
            main = mainEl.textContent;
            if (main.length <= 1) {
                mainEl.textContent = "0";
            } else {
                mainEl.textContent = main.slice(0, -1);
            }
            this._lastEq = false;
            return;
        }
        if (act === "percent") {
            mainEl.textContent = `${main}/100`;
            this._lastEq = false;
            return;
        }
        if (act === "sqrt") {
            const x = this._evalExpr(main);
            if (x == null || x < 0) {
                resEl.textContent = "ERROR!!!";
                this._lastEq = false;
            } else {
                const r =
                    typeof Utils !== "undefined" && Utils.roundDecimal
                        ? Utils.roundDecimal(Math.sqrt(x))
                        : Math.round(Math.sqrt(x) * 1e6) / 1e6;
                const rs = String(r);
                mainEl.textContent = rs;
                resEl.textContent = rs;
                this._lastEq = true;
            }
            return;
        }
        if (act === "eq") {
            const x = this._evalExpr(main);
            if (x == null) {
                resEl.textContent = "ERROR!!!";
                this._lastEq = false;
            } else {
                resEl.textContent = String(x);
                this._lastEq = true;
            }
            return;
        }
        if (act === "mr") {
            if (res === "ERROR!!!") return;
            if (res === "0" && main === "0") return;
            memEl.textContent = res;
            return;
        }
        if (act === "mrl") {
            memEl.textContent = "0";
            return;
        }
        if (act === "mrp") {
            const m = mem && mem !== "" ? mem : "0";
            if (main === "0" || main === "") {
                mainEl.textContent = m;
            } else {
                mainEl.textContent = main + m;
            }
            this._lastEq = false;
            return;
        }
        if (act === "op") {
            clearError();
            const op = v || "+";
            const sym = op === "/" ? "÷" : op === "*" ? "×" : op === "-" ? "−" : op;
            if (op === "-" && main === "0" && !this._lastEq) {
                mainEl.textContent = "-";
                return;
            }
            if (this._lastEq) {
                mainEl.textContent = res + sym;
                this._lastEq = false;
            } else {
                mainEl.textContent = main + sym;
            }
            return;
        }
        if (act === "digit") {
            clearError();
            const d = v != null ? String(v) : "";
            if (!d) return;
            if (this._lastEq) {
                if (d === ".") mainEl.textContent = "0.";
                else mainEl.textContent = d;
                resEl.textContent = "0";
                this._lastEq = false;
                return;
            }
            if (main === "-" && d === ".") {
                mainEl.textContent = "-0.";
                return;
            }
            if (main === "-" && d !== ".") {
                mainEl.textContent = `-${d}`;
                return;
            }
            if (main === "0" && d !== ".") {
                mainEl.textContent = d;
            } else if (main === "0" && d === ".") {
                mainEl.textContent = "0.";
            } else {
                mainEl.textContent = main + d;
            }
        }
    },

    _apply() {
        const mainEl = this._ds();
        if (!mainEl || typeof MovementManager === "undefined") return;
        const val = this._evalExpr(mainEl.textContent);
        if (val == null) {
            if (typeof Utils !== "undefined" && Utils.showToast && typeof I18n !== "undefined") {
                Utils.showToast(I18n.t("movements.qtyCalcInvalid"), "warning");
            }
            return;
        }
        this._close(val);
    },

    _close(val) {
        const modal = document.getElementById("qty-calculator-modal");
        if (modal) modal.classList.remove("active");
        const fn = this._resolve;
        this._resolve = null;
        if (fn) fn(val != null ? val : null);
    }
};
